/** ─── Triggers.gs ─────────────────────────────────────────────────
 *  onEdit trigger: recomputes customer balance when a tx row status
 *  changes or a new tx row is manually added.
 *  Depends on: Configuration.gs, SheetWrites.gs
 */

// ─── findOwningCustomerRow ────────────────────────────────────────────────────
/**
 * Walks UP from rowNumber until it finds a row whose col B contains "@".
 * Customer rows always have an email address in col B.
 *
 * @param {number} rowNumber - 1-indexed starting row
 * @returns {number|null}    - 1-indexed customer row, or null if not found
 */
function findOwningCustomerRow(rowNumber) {
  const sh = getDashboardSheet();
  for (let r = rowNumber - 1; r >= 2; r--) {
    const colB = String(sh.getRange(r, COL.EMAIL_OR_ITEM).getValue() || '');
    if (colB.includes('@')) {
      return r;
    }
  }
  Logger.log('[findOwningCustomerRow] WARNING: no customer row found above row ' + rowNumber);
  return null;
}

// ─── extractProfileUrlFromCell ────────────────────────────────────────────────
/**
 * Reads the current F cell of a customer row and extracts the profileUrl.
 * If F cell contains a HYPERLINK formula, parses out the URL.
 * If F cell is plain text (e.g. "(not found in Florida)"), returns null.
 *
 * @param {number} customerRow
 * @returns {string|null}
 */
function extractProfileUrlFromCell(customerRow) {
  try {
    const sh = getDashboardSheet();
    const formula = sh.getRange(customerRow, COL.CONTACT_OR_TOTAL).getFormula();
    if (!formula) return null;
    // HYPERLINK formula looks like: =HYPERLINK("https://...","$123.45")
    const match = formula.match(/HYPERLINK\("([^"]+)"/i);
    return match ? match[1] : null;
  } catch (e) {
    return null;
  }
}

// ─── isTxRow ──────────────────────────────────────────────────────────────────
/**
 * Returns true if the given row is a transaction row.
 * Tx rows have col A = a date (or date string), NOT a name or "Date" literal.
 * We detect by: col A is NOT empty, col B is NOT an email (@), col A is NOT "Date".
 *
 * @param {number} rowNumber
 * @returns {boolean}
 */
function isTxRow(rowNumber) {
  try {
    const sh = getDashboardSheet();
    const colA = String(sh.getRange(rowNumber, COL.NAME_OR_DATE).getValue() || '').trim();
    const colB = String(sh.getRange(rowNumber, COL.EMAIL_OR_ITEM).getValue() || '').trim();
    if (!colA) return false;                  // empty row
    if ((colA === 'Date' || colA === 'DATE')) return false;         // sub-header row
    if (colB.includes('@')) return false;      // customer row
    if (colA === 'Name') return false;         // header row
    return true;
  } catch (e) {
    return false;
  }
}

// ─── isInsideExistingGroup ────────────────────────────────────────────────────
/**
 * Returns true if the row above the given row is part of an existing customer group.
 * We detect by walking up: if the row above is a tx row or sub-header, then
 * the edited row is inside (or just below) an existing group.
 *
 * @param {number} rowNumber
 * @returns {boolean}
 */
function isInsideExistingGroup(rowNumber) {
  if (rowNumber <= 2) return false;
  const sh = getDashboardSheet();
  const rowAbove = rowNumber - 1;
  // Row above is part of a group if it's a tx row or a sub-header
  const colA = String(sh.getRange(rowAbove, COL.NAME_OR_DATE).getValue() || '').trim();
  const colB = String(sh.getRange(rowAbove, COL.EMAIL_OR_ITEM).getValue() || '').trim();
  // Sub-header: colA === 'Date'
  if ((colA === 'Date' || colA === 'DATE')) return true;
  // Tx row: colA non-empty, colB not email, colA not 'Name'
  if (colA && colA !== 'Name' && !colB.includes('@')) return true;
  return false;
}

// ─── onEdit ───────────────────────────────────────────────────────────────────
/**
 * Installed simple trigger — fires on every cell edit.
 * Handles two cases:
 *   A) Status flip in col G of a tx row → recompute customer balance.
 *   B) New row manually added inside an existing group → apply dropdown + recompute.
 *
 * KEEP FAST: no network calls, no GHL API.
 *
 * @param {GoogleAppsScript.Events.SheetsOnEdit} e
 */
function onEdit(e) {
  try {
    const range = e.range;
    const sheet = range.getSheet();
    const sheetName = sheet.getName();
    const editedRow = range.getRow();
    const editedCol = range.getColumn();

    // 0. Transactions sheet — H1/I1/J1 filter dropdowns. Re-derive
    //    visibility on every edit. Independent from the Dashboard
    //    handler below; same pattern.
    if (sheetName === TX_SHEET_NAME) {
      if (editedRow === 1 && (editedCol === 8 || editedCol === 9 || editedCol === 10)) {
        try { applyTxFilters_(); }
        catch (err) { Logger.log('[onEdit Transactions filter] err: ' + err.message); }
      }
      return;
    }

    // 0b. Logs sheet — pricing-syntax banner dropdown in A1. Picking
    //     a rule resets the cell back to the default label so the
    //     dropdown remains a re-usable reference instead of a state
    //     that "remembers" the last pick.
    if (sheetName === LOGS_SHEET_NAME && editedRow === 1 && editedCol === 1) {
      var picked = String(range.getValue() || '').trim();
      if (picked && picked !== PRICING_BANNER_DEFAULT) {
        try { resetPricingBannerCell(); }
        catch (err) { Logger.log('[onEdit Logs banner] err: ' + err.message); }
      }
      return;
    }

    // 1. Everything below acts on the Dashboard sheet only.
    if (sheetName !== SHEET_NAME) return;

    // 1b. Filter / action toggles in row 1 cols H, I, J
    //     Any change re-derives the full filter state from all three cells.
    if (editedRow === 1 && (editedCol === 8 || editedCol === 9 || editedCol === 10)) {
      try { applyAllFilters_(); }
      catch (err) { Logger.log('[onEdit filter row] err: ' + err.message); }
      return;
    }

    // 1c. Sub-header bulk-action dropdown (col G, row >= 3, sub-header).
    //     User picks "Mark all paid" / "Mark all owed" / etc.; the script
    //     applies the bulk update to the customer's tx rows above, then
    //     resets the cell back to "STATUS".
    //
    //     Verification fee rows are NEVER modified by the bulk action —
    //     they are real charges and stay paid.
    if (editedCol === COL.STATUS && editedRow >= 3) {
      var aBulk = String(sheet.getRange(editedRow, 1).getValue() || '').trim().toUpperCase();
      if (aBulk === 'DATE') {
        // Sub-header row; check if a "Mark all X" was picked
        var picked = String(range.getValue() || '').trim();
        if (picked === 'STATUS' || picked === '') return; // default value, no-op
        var newStatus = null;
        if (picked === 'Mark all paid')          newStatus = 'paid';
        else if (picked === 'Mark all owed')     newStatus = 'owed';
        else if (picked === 'Mark all canceled') newStatus = 'canceled';
        else if (picked === 'Mark all refunded') newStatus = 'refunded';
        if (!newStatus) {
          range.setValue('STATUS');
          return;
        }
        var bulkCustRow = editedRow - 1;
        var customerB = String(sheet.getRange(bulkCustRow, 2).getValue() || '');
        if (customerB.indexOf('@') === -1) {
          range.setValue('STATUS');
          return;
        }
        try {
          var bulkRange = findCustomerTxRange(bulkCustRow);
          if (bulkRange && bulkRange.lastTx >= bulkRange.firstTx) {
            var bulkN = bulkRange.lastTx - bulkRange.firstTx + 1;
            var bulkStatusCol = sheet.getRange(bulkRange.firstTx, COL.BALANCE_OR_STATUS, bulkN, 1);
            var bulkItemCol   = sheet.getRange(bulkRange.firstTx, COL.EMAIL_OR_ITEM, bulkN, 1);
            var bulkCurrent = bulkStatusCol.getValues();
            var bulkItems   = bulkItemCol.getValues();
            var bulkNew = bulkCurrent.map(function(row, idx) {
              var item = String(bulkItems[idx][0] || '').trim();
              if (item === 'CC verification fee') return [row[0]]; // never touch the fee
              return [newStatus];
            });
            bulkStatusCol.setValues(bulkNew);
            updateBalanceFormula(bulkCustRow, null);
            try { refreshBalanceNoteForCustomer(bulkCustRow); } catch (e) {}
          }
        } catch (err) {
          Logger.log('[onEdit sub-header bulk] err: ' + err.message);
        }
        // Reset to default placeholder so the menu is reusable
        range.setValue('STATUS');
        return;
      }
    }

    // 2. Status flip on tx rows. Handles BOTH single-cell edits (dropdown
    //    pick) and multi-cell edits (Ctrl+Enter / paste / drag-fill across
    //    col G of multiple tx rows, possibly across multiple customers).
    if (editedCol === COL.STATUS) {
      var startRow = range.getRow();
      var numRows = range.getNumRows();
      var customersTouched = {};
      for (var rr = 0; rr < numRows; rr++) {
        var thisRow = startRow + rr;
        if (!isTxRow(thisRow)) continue;
        var owner = findOwningCustomerRow(thisRow);
        if (owner) customersTouched[owner] = true;
      }
      var keys = Object.keys(customersTouched);
      if (!keys.length) return;
      keys.forEach(function(k) {
        var customerRow = parseInt(k, 10);
        var profileUrl = extractProfileUrlFromCell(customerRow);
        updateBalanceFormula(customerRow, profileUrl);
        try { refreshBalanceNoteForCustomer(customerRow); } catch (err) {}
      });
      return;
    }

    // 3. Manual edit on a tx row OR a new row typed into an existing
    //    customer's group. Handles two related workflows:
    //
    //      A) Adjust an existing row (e.g., parent calls and asks to
    //         change Days from 5 to 3): we just need to refresh the
    //         balance Note + bg color. The Total cell formula
    //         auto-recalculates from D/E changes; SUMIFS picks it up.
    //
    //      B) Add a new manual row inside the customer's group (e.g.,
    //         "add 2 days of pizza at $7.75/day"): we apply sane
    //         defaults so the user only has to type Date / Item /
    //         Unit / Days / Weeks and the system computes the total.
    //
    //    Defaults applied on an empty row:
    //      - Status dropdown on col G + value 'owed'
    //      - Col F formula =C*MAX(D,1)*MAX(E,1) — supports flat,
    //        per-week (Days blank), and per-day (Days set) without the
    //        team having to choose a pricing rule up front.
    //      - Col C number format $0.00 (team can switch to /day or
    //        /week if they want the multiplier label).
    //      - Group extended down to include the new row if it sits
    //        below the current last-in-group.
    if (editedRow < 2) return;
    const colA = String(sheet.getRange(editedRow, COL.NAME_OR_DATE).getValue() || '').trim();
    const colB = String(sheet.getRange(editedRow, COL.EMAIL_OR_ITEM).getValue() || '').trim();

    // Skip header / customer rows / sub-header rows
    if (colA === 'Name' || colA.toUpperCase() === 'DATE' || colB.includes('@')) return;

    // Must sit inside (or directly below) an existing customer's group
    if (!isInsideExistingGroup(editedRow)) return;

    const customerRow = findOwningCustomerRow(editedRow);
    if (!customerRow) return;

    // (a) Status dropdown + default value 'owed'
    const statusVal = String(sheet.getRange(editedRow, COL.STATUS).getValue() || '').trim();
    if (!statusVal) {
      applyStatusDropdown(editedRow);
      sheet.getRange(editedRow, COL.STATUS).setValue('owed');
    }

    // (b) Col F formula default (only if blank — never overwrite an
    //     existing polled-row formula like =C*D*E or =C*E)
    const totalCell = sheet.getRange(editedRow, COL.TOTAL);
    if (!totalCell.getFormula()) {
      totalCell.setFormula(
        '=C' + editedRow + '*MAX(D' + editedRow + ',1)*MAX(E' + editedRow + ',1)'
      );
      totalCell.setNumberFormat('"$"#,##0.00');
      totalCell.setNote(
        'Manual row formula: Total = Unit Price x max(Days, 1) x max(Weeks, 1)\n' +
        '  Flat:     leave Days and Weeks blank.\n' +
        '  Per-week: leave Days blank; set Weeks.\n' +
        '  Per-day:  set Days; set Weeks (or leave blank for 1 week).'
      );
    }

    // (c) Col C unit-price format default
    const unitCell = sheet.getRange(editedRow, COL.PHONE_OR_UNIT_PRICE);
    const unitFmt = unitCell.getNumberFormat();
    const looksUnformatted =
      !unitFmt ||
      unitFmt === 'General' ||
      unitFmt === '0' ||
      unitFmt === '0.###############' ||
      unitFmt === '@';
    if (looksUnformatted) {
      unitCell.setNumberFormat('"$"#,##0.00');
    }

    // (d) Extend the customer's row group to cover the edited row if
    //     it sits below the current last-in-group. Skip if already
    //     covered (no thrash on every keystroke of an in-group edit).
    const txRange = findCustomerTxRange(customerRow);
    if (txRange.lastInGroup < editedRow) {
      try { applyRowGrouping(customerRow + 1, editedRow); }
      catch (err) { Logger.log('[onEdit group extend] err: ' + err.message); }
    }

    // (e) Recompute balance formula + balance Note
    const profileUrl = extractProfileUrlFromCell(customerRow);
    try { updateBalanceFormula(customerRow, profileUrl); } catch (err) {}
    try { refreshBalanceNoteForCustomer(customerRow); } catch (err) {}

  } catch (err) {
    // Never crash a simple trigger — just log
    Logger.log('[onEdit] ERROR: ' + err.message);
  }
}
