/** ─── Transactions.gs ──────────────────────────────────────────
 *  Builds a "Transactions" tab that mirrors the Dashboard layout +
 *  adds payment-history-specific signal the team uses day-to-day:
 *
 *  Customer row (dark blue, 7 cols):
 *     A Name | B Email | C Phone | D Students | E Subaccount |
 *     F Profile link | G Net Total Paid
 *     - Col B Note: routing summary (FL contact -> subaccount)
 *     - Col F formula: HYPERLINK to the SUBACCOUNT contact (where the
 *       payments actually live, so the team lands in the right place
 *       to issue refunds / update the card on file)
 *     - Col F Note: the FL profile URL as plain text for cross-ref
 *     - Col G Note: full breakdown (succeeded / refunded / failed
 *       counts + amounts, last payment date)
 *
 *  Sub-header (mid blue): DATE | SOURCE | AMOUNT | STATUS | CARD |
 *                         RECEIPT | REFUNDED
 *
 *  Tx rows: as-is, with Source-cell Note carrying the GHL tx ID for
 *  cross-reference against subaccount records.
 *
 *  Row 1 cols H/I/J: filter dropdowns — same widget pattern as the
 *  Dashboard's setupBalanceFilterToggle.
 *
 *  Refresh model: runs as a tail of pollFloridaSubmissions on EVERY
 *  poll (5 min cadence). No menu, no buttons.
 *
 *  Font: matched at sync time to whatever the Dashboard sheet is
 *  currently using (read from Dashboard A2), so visual changes there
 *  propagate here without code edits.
 */

const TX_SHEET_NAME = 'Transactions';

// ─── getTransactionsSheet ────────────────────────────────────────────
function getTransactionsSheet() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sh = ss.getSheetByName(TX_SHEET_NAME);
  if (!sh) {
    sh = ss.insertSheet(TX_SHEET_NAME);
    setupTransactionsSheet_(sh);
  }
  return sh;
}

// ─── getDashboardFontFamily_ ─────────────────────────────────────────
/**
 * Read the font family currently in use on the Dashboard sheet so we can
 * mirror it on Transactions. Prefer a data row (A2); fall back to header.
 * Returns null when the Dashboard sheet is missing or read fails — caller
 * should treat null as "leave default in place".
 */
function getDashboardFontFamily_() {
  try {
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const dash = ss.getSheetByName(SHEET_NAME);
    if (!dash) return null;
    const probeRow = dash.getLastRow() >= 2 ? 2 : 1;
    const ff = dash.getRange(probeRow, 1).getFontFamily();
    return ff && ff.length ? ff : null;
  } catch (e) {
    return null;
  }
}

// ─── setupTransactionsSheet_ ─────────────────────────────────────────
/**
 * Initializes the Transactions sheet: header row, column widths, frozen
 * row, conditional-format rules for the status pill column (col D), and
 * the H1/I1/J1 filter dropdowns.
 */
function setupTransactionsSheet_(sh) {
  sh.getRange(1, 1, 1, 7).setValues([[
    'Name', 'Email', 'Phone', 'Students', 'Subaccount', 'Profile', 'Net Total Paid'
  ]]);
  sh.getRange(1, 1, 1, 7)
    .setBackground('#0F3634')
    .setFontColor('#FFFFFF')
    .setFontWeight('bold')
    .setFontSize(11)
    .setHorizontalAlignment('left');
  sh.setFrozenRows(1);

  sh.setColumnWidth(1, 200);  // A Name / Date
  sh.setColumnWidth(2, 220);  // B Email / Source
  sh.setColumnWidth(3, 140);  // C Phone / Amount
  sh.setColumnWidth(4, 220);  // D Students / Status
  sh.setColumnWidth(5, 130);  // E Subaccount / Card
  sh.setColumnWidth(6, 220);  // F Profile / Receipt
  sh.setColumnWidth(7, 150);  // G Net Total / Refunded

  // Conditional formatting on col D — status pills on tx rows.
  // Customer rows have student names in D, which never collide with
  // the status keywords below, so the rules are safe.
  const range = sh.getRange(2, 4, 1000, 1);
  const rules = [];
  rules.push(SpreadsheetApp.newConditionalFormatRule()
    .whenTextEqualTo('succeeded')
    .setBackground('#D4EDDA').setFontColor('#155724').setBold(true)
    .setRanges([range]).build());
  rules.push(SpreadsheetApp.newConditionalFormatRule()
    .whenTextEqualTo('refunded')
    .setBackground('#FFE5CC').setFontColor('#A05A00').setBold(true)
    .setRanges([range]).build());
  rules.push(SpreadsheetApp.newConditionalFormatRule()
    .whenTextEqualTo('failed')
    .setBackground('#F8D7DA').setFontColor('#721C24').setBold(true)
    .setRanges([range]).build());
  rules.push(SpreadsheetApp.newConditionalFormatRule()
    .whenTextEqualTo('pending')
    .setBackground('#FFF3CD').setFontColor('#856404').setBold(true)
    .setRanges([range]).build());
  sh.setConditionalFormatRules(rules);

  // Apply Dashboard font to the header so it matches.
  const headerFont = getDashboardFontFamily_();
  if (headerFont) sh.getRange(1, 1, 1, 10).setFontFamily(headerFont);

  // Row 1 filter cells (H, I, J) — see setupTxFilters_ for option lists.
  setupTxFilters_(sh);
}

// ─── setupTxFilters_ ─────────────────────────────────────────────────
/**
 * Install the three filter dropdowns in row 1 (cols H, I, J). Mirrors
 * Dashboard's setupBalanceFilterToggle option-list pattern (default
 * value is the literal column-label so the cell reads as a label until
 * the user picks a real filter):
 *
 *   H1  "Filters"            -> no filter (default)
 *       "With refunds"
 *       "With failures"
 *       "Has card on file"
 *       "No payments yet"
 *   I1  "All transactions"   -> no filter (default)
 *       "Succeeded only"
 *       "Refunded only"
 *       "Failed only"
 *       "Pending only"
 *   J1  "Actions"            -> no-op (default)
 *       "Minimize all groups"
 *       "Expand all groups"
 *
 * Filter values survive sheet rebuilds because syncTransactionsSheet
 * only wipes cols A:G; row 1 cols H+ stay intact.
 */
function setupTxFilters_(sh) {
  function setupCell(col, options, defaultVal) {
    const cell = sh.getRange(1, col);
    cell.clearDataValidations();
    const rule = SpreadsheetApp.newDataValidation()
      .requireValueInList(options, true)
      .setAllowInvalid(false)
      .build();
    cell.setDataValidation(rule);
    const current = String(cell.getValue() || '').trim();
    if (options.indexOf(current) === -1) cell.setValue(defaultVal);
    cell.setBackground('#1E3F8A')
        .setFontColor('#FFFFFF')
        .setFontWeight('bold')
        .setHorizontalAlignment('center')
        .clearNote();
    sh.setColumnWidth(col, 170);
    // Wipe any stray content/validation in rows 2+ of this column so
    // nothing bleeds below the filter cell.
    const maxRows = Math.max(sh.getMaxRows(), 100);
    if (maxRows > 1) {
      const below = sh.getRange(2, col, maxRows - 1, 1);
      below.clearDataValidations();
      below.clearContent();
      below.clearFormat();
    }
  }
  setupCell(8, [
    'Filters',
    'With refunds',
    'With failures',
    'Has card on file',
    'No payments yet'
  ], 'Filters');
  setupCell(9, [
    'All transactions',
    'Succeeded only',
    'Refunded only',
    'Failed only',
    'Pending only'
  ], 'All transactions');
  setupCell(10, [
    'Actions',
    'Minimize all groups',
    'Expand all groups'
  ], 'Actions');
}

// ─── collapseAllTxGroups / expandAllTxGroups ─────────────────────────
function collapseAllTxGroups() {
  const sh = getTransactionsSheet();
  const lastRow = sh.getLastRow();
  if (lastRow < 2) return;
  const values = sh.getRange(2, 1, lastRow - 1, 7).getValues();
  for (let i = 0; i < values.length; i++) {
    if (String(values[i][1] || '').indexOf('@') === -1) continue;
    const custRow = i + 2;
    try {
      const grp = sh.getRowGroup(custRow + 1, 1);
      if (grp) grp.collapse();
    } catch (e) { /* no group on this customer — skip */ }
  }
}

function expandAllTxGroups() {
  const sh = getTransactionsSheet();
  const lastRow = sh.getLastRow();
  if (lastRow < 2) return;
  const values = sh.getRange(2, 1, lastRow - 1, 7).getValues();
  for (let i = 0; i < values.length; i++) {
    if (String(values[i][1] || '').indexOf('@') === -1) continue;
    const custRow = i + 2;
    try {
      const grp = sh.getRowGroup(custRow + 1, 1);
      if (grp) grp.expand();
    } catch (e) { /* no group on this customer — skip */ }
  }
}

// ─── applyTxFilters_ ─────────────────────────────────────────────────
/**
 * Re-derive row visibility on the Transactions sheet from the three
 * filter cells (H1/I1/J1). Always resets visibility first so stale
 * hidden rows don't accumulate.
 *
 * Customer-level (H1):
 *   "With refunds"     -> any tx with status=refunded OR amountRefunded>0
 *   "With failures"    -> any tx with status=failed
 *   "Has card on file" -> any tx row with a non-empty CARD cell (col E)
 *   "No payments yet"  -> customer has zero tx rows (i.e., not present in
 *                          the sheet today). Treated as a no-op since the
 *                          sync skips zero-tx customers; left in the list
 *                          so the team's mental model still works.
 *
 * Tx-row-level (I1): hide individual rows whose status doesn't match.
 * Action picks (J1): collapse/expand groups, then reset to "Actions".
 *
 * Called from the onEdit dispatcher in Triggers.gs.
 */
function applyTxFilters_() {
  const sh = getTransactionsSheet();
  const lastRow = sh.getLastRow();
  if (lastRow < 2) return;

  const custFilter = String(sh.getRange(1, 8).getValue() || '').trim();
  const itemFilter = String(sh.getRange(1, 9).getValue() || '').trim();
  const action     = String(sh.getRange(1, 10).getValue() || '').trim();

  // J1 actions are one-shot. Fire, reset, exit early — calling showRows
  // afterwards would undo any collapse the user just asked for.
  if (action === 'Minimize all groups') {
    collapseAllTxGroups();
    sh.getRange(1, 10).setValue('Actions');
    return;
  }
  if (action === 'Expand all groups') {
    expandAllTxGroups();
    sh.getRange(1, 10).setValue('Actions');
    return;
  }

  // Reset visibility, then re-apply the two stateful filters from scratch.
  sh.showRows(2, lastRow - 1);

  const values = sh.getRange(2, 1, lastRow - 1, 7).getValues();

  // Find customer-row indices in the data array (col B contains @).
  const custIdx = [];
  for (let i = 0; i < values.length; i++) {
    if (String(values[i][1] || '').indexOf('@') !== -1) custIdx.push(i);
  }

  // Customer-level filter (H1): hide whole customer sections.
  const isCustFilterActive = (
    custFilter === 'With refunds' ||
    custFilter === 'With failures' ||
    custFilter === 'Has card on file'
  );
  if (isCustFilterActive) {
    for (let k = 0; k < custIdx.length; k++) {
      const iC = custIdx[k];
      const custRow = iC + 2;
      const nextI = (k + 1 < custIdx.length) ? custIdx[k + 1] : values.length;
      const sectionLength = nextI - iC;

      let hasRefund = false, hasFailure = false, hasCard = false;
      for (let r = iC + 1; r < nextI; r++) {
        const a = String(values[r][0] || '').trim();
        const b = String(values[r][1] || '').trim();
        if (a.toUpperCase() === 'DATE') continue;     // sub-header
        if (b.indexOf('@') !== -1) continue;           // shouldn't hit, but safe
        if (!a) continue;
        const status   = String(values[r][3] || '').toLowerCase().trim();
        const card     = String(values[r][4] || '').trim();
        const refunded = Number(values[r][6] || 0);
        if (status === 'refunded' || refunded > 0) hasRefund = true;
        if (status === 'failed') hasFailure = true;
        if (card) hasCard = true;
      }
      const keep =
        (custFilter === 'With refunds'     && hasRefund)  ||
        (custFilter === 'With failures'    && hasFailure) ||
        (custFilter === 'Has card on file' && hasCard);
      if (!keep) sh.hideRows(custRow, sectionLength);
    }
  }

  // Tx-row-level filter (I1): hide individual tx rows by status.
  let wantStatus = null;
  if      (itemFilter === 'Succeeded only') wantStatus = 'succeeded';
  else if (itemFilter === 'Refunded only')  wantStatus = 'refunded';
  else if (itemFilter === 'Failed only')    wantStatus = 'failed';
  else if (itemFilter === 'Pending only')   wantStatus = 'pending';
  if (wantStatus) {
    for (let i = 0; i < values.length; i++) {
      const sheetRow = i + 2;
      if (sh.isRowHiddenByUser(sheetRow)) continue;  // already hidden by H1
      const a = String(values[i][0] || '').trim();
      const b = String(values[i][1] || '').trim();
      if (b.indexOf('@') !== -1) continue;            // customer row
      if (a.toUpperCase() === 'DATE') continue;       // sub-header
      if (!a) continue;
      const status = String(values[i][3] || '').toLowerCase().trim();
      if (status !== wantStatus) sh.hideRows(sheetRow, 1);
    }
  }
}

// ─── extractContactIdFromProfileUrl ──────────────────────────────────
/**
 * The Dashboard col F HYPERLINK formula contains the FL contact ID.
 * URL format: https://app.nilsdigital.com/v2/location/{loc}/contacts/detail/{contactId}
 * Returns null if the URL is missing or the path doesn't match.
 */
function extractContactIdFromProfileUrl(url) {
  if (!url) return null;
  const m = String(url).match(/\/contacts\/detail\/([^/?#"\s]+)/i);
  return m ? m[1] : null;
}

// ─── resetTransactionsSheet_ ─────────────────────────────────────────
/**
 * Clears the data area + removes all row groups so a fresh sync writes
 * onto a clean slate. Header row stays, column widths/CF rules stay,
 * row 1 cols H/I/J filter cells stay (they live outside A:G).
 */
function resetTransactionsSheet_(sh) {
  const lastRow = sh.getLastRow();
  if (lastRow < 2) return;

  // Remove every row group (walk depth high → low until none remain)
  let safety = 20;
  while (safety-- > 0) {
    let any = false;
    for (let r = 2; r <= lastRow; r++) {
      let depth = sh.getRowGroupDepth(r);
      while (depth > 0) {
        const g = sh.getRowGroup(r, depth);
        if (g) { g.remove(); any = true; }
        depth--;
      }
    }
    if (!any) break;
  }
  sh.deleteRows(2, lastRow - 1);
}

// ─── buildBreakdownNote_ ─────────────────────────────────────────────
/**
 * Build the rich "Net Total" cell Note for a customer: succeeded /
 * refunded / failed / pending counts and totals, last payment date,
 * average tx size. Designed to be readable at a glance when the team
 * hovers the Net Total cell.
 */
function buildBreakdownNote_(txs, subaccount, waiverOrigin) {
  let succN = 0, succAmt = 0;
  let refN = 0, refAmt = 0;
  let failN = 0, pendN = 0;
  let lastPaidAt = null;

  txs.forEach(function(t) {
    const status = String(t.status || '').toLowerCase();
    const amt = Number(t.amount || 0);
    const refunded = Number(t.amountRefunded || 0);
    if (status === 'succeeded') {
      succN++; succAmt += amt;
      const d = t.date ? new Date(t.date) : null;
      if (d && !isNaN(d.getTime()) && (!lastPaidAt || d > lastPaidAt)) lastPaidAt = d;
    }
    if (refunded > 0 || status === 'refunded') {
      refN++; refAmt += refunded || amt;
    }
    if (status === 'failed')  failN++;
    if (status === 'pending') pendN++;
  });

  const fmt = function(n) { return '$' + Number(n).toFixed(2); };
  const tz = Session.getScriptTimeZone();
  const lines = [];
  lines.push('Routing: FL contact -> ' + (subaccount || '?') +
             ' subaccount (Waiver Origin: ' + (waiverOrigin || '?') + ')');
  lines.push('');
  lines.push('Succeeded: ' + succN + ' (' + fmt(succAmt) + ')');
  lines.push('Refunded:  ' + refN  + ' (' + fmt(refAmt)  + ')');
  if (failN) lines.push('Failed:    ' + failN);
  if (pendN) lines.push('Pending:   ' + pendN);
  lines.push('Net total: ' + fmt(succAmt - refAmt));
  if (lastPaidAt) {
    lines.push('Last payment: ' + Utilities.formatDate(lastPaidAt, tz, 'MMM d yyyy'));
  }
  if (succN > 0) {
    lines.push('Avg succeeded: ' + fmt(succAmt / succN));
  }
  return lines.join('\n');
}

// ─── syncTransactionsSheet ───────────────────────────────────────────
/**
 * Walk every Dashboard customer row, fetch their transactions from the
 * routed (WaiverOrigin) subaccount, and rewrite the Transactions sheet
 * top-to-bottom. Idempotent — safe to run repeatedly.
 *
 * Customers with zero transactions are skipped so the sheet stays
 * compact (their info is already on the Dashboard tab).
 *
 * @returns {{ customersWithTx, txWritten, errors }}
 */
function syncTransactionsSheet() {
  const dash = getDashboardSheet();
  const sh = getTransactionsSheet();

  // Wipe + re-init headers/CF.
  resetTransactionsSheet_(sh);
  setupTransactionsSheet_(sh);

  const dashLastRow = dash.getLastRow();
  if (dashLastRow < 2) {
    return { customersWithTx: 0, txWritten: 0, errors: 0 };
  }

  // Pull every Dashboard customer row.
  const dashValues = dash.getRange(2, 1, dashLastRow - 1, 7).getValues();
  const customers = [];
  for (let i = 0; i < dashValues.length; i++) {
    const dashRow = i + 2;
    const email = String(dashValues[i][1] || '').trim();
    if (!email || email.indexOf('@') === -1) continue;
    const profileUrl = extractProfileUrlFromCell(dashRow);
    customers.push({
      dashRow: dashRow,
      name: String(dashValues[i][0] || '').trim(),
      email: email,
      phone: String(dashValues[i][2] || '').trim(),
      waiver: String(dashValues[i][3] || '').trim(),
      students: String(dashValues[i][4] || '').trim(),
      flProfileUrl: profileUrl,
      flContactId: extractContactIdFromProfileUrl(profileUrl)
    });
  }

  const dashFont = getDashboardFontFamily_();
  const tz = Session.getScriptTimeZone();

  let writeRow = 2;
  let txWritten = 0;
  let customersWithTx = 0;
  const errors = [];

  customers.forEach(function(c) {
    let result = null;
    try {
      let flId = c.flContactId;
      if (!flId && c.email) {
        try { flId = ghlSearchContactByEmail('Florida', c.email); }
        catch (e) { /* swallow — handled below */ }
      }
      if (flId) result = tx_fetchTransactions(flId);
    } catch (e) {
      errors.push(c.email + ': ' + e.message);
      result = null;
    }
    if (!result || !result.ok) {
      if (result && result.error) errors.push(c.email + ': ' + result.error);
      return;
    }
    const txs = result.transactions || [];
    if (!txs.length) return;  // skip empty customers — keeps the sheet compact

    customersWithTx++;

    // Net total = succeeded amounts minus refunds.
    let totalPaid = 0;
    txs.forEach(function(t) {
      if (String(t.status).toLowerCase() === 'succeeded') totalPaid += Number(t.amount || 0);
      if (t.amountRefunded) totalPaid -= Number(t.amountRefunded || 0);
    });

    // Customer row (dark blue, bold, white) — matches Dashboard branding.
    sh.getRange(writeRow, 1, 1, 7).setValues([[
      c.name,
      c.email,
      c.phone,
      c.students,                                // D — students from Dashboard col E
      result.subaccount || c.waiver || '',       // E — subaccount where payments live
      '',                                         // F filled below
      ''                                          // G filled below
    ]]);

    // Col F: link to the SUBACCOUNT contact (where payments actually
    // live — refunds, card updates, etc. happen there). Falls back to
    // FL profile if the contact isn't in the subaccount yet. The FL
    // profile URL goes in the cell Note for cross-reference.
    let primaryUrl = null, primaryLabel = 'Profile';
    if (result.subContactId && result.subaccountLocationId) {
      primaryUrl = buildProfileUrl(result.subaccountLocationId, result.subContactId);
      primaryLabel = 'Open in ' + (result.subaccount || 'subaccount');
    } else if (c.flProfileUrl) {
      primaryUrl = c.flProfileUrl;
      primaryLabel = 'Open FL profile';
    }
    if (primaryUrl) {
      sh.getRange(writeRow, 6).setFormula(
        '=HYPERLINK("' + primaryUrl + '","' + primaryLabel + '")');
    }
    const profileNoteParts = [];
    if (result.subContactId) {
      profileNoteParts.push('Subaccount contact (' + (result.subaccount || '?') + '):');
      profileNoteParts.push(buildProfileUrl(result.subaccountLocationId, result.subContactId));
      profileNoteParts.push('');
    }
    if (c.flProfileUrl) {
      profileNoteParts.push('Florida contact (canonical home):');
      profileNoteParts.push(c.flProfileUrl);
    }
    if (profileNoteParts.length) {
      sh.getRange(writeRow, 6).setNote(profileNoteParts.join('\n'));
    }

    // Col G: net total, with rich breakdown Note.
    sh.getRange(writeRow, 7)
      .setValue(totalPaid)
      .setNumberFormat('"$"#,##0.00')
      .setNote(buildBreakdownNote_(txs, result.subaccount, result.waiverOrigin));

    // Col B Note: routing summary (lighter than the col G breakdown).
    const routingNote = 'WaiverOrigin: ' + (result.waiverOrigin || '?') +
                        '\nPayments live in: ' + (result.subaccount || '?') + ' subaccount' +
                        '\nFL contact ID: ' + (c.flContactId || '?');
    sh.getRange(writeRow, 2).setNote(routingNote);

    // Apply customer-row brand styling.
    sh.getRange(writeRow, 1, 1, 7)
      .setBackground('#143980')
      .setFontColor('#FFFFFF')
      .setFontWeight('bold')
      .setFontSize(12)
      .setHorizontalAlignment('left');
    sh.getRange(writeRow, 6).setFontLine('underline');

    // Sub-header (mid-blue).
    writeRow++;
    sh.getRange(writeRow, 1, 1, 7).setValues([[
      'DATE', 'SOURCE', 'AMOUNT', 'STATUS', 'CARD', 'RECEIPT', 'REFUNDED'
    ]]);
    sh.getRange(writeRow, 1, 1, 7)
      .setBackground('#4a6493')
      .setFontColor('#FFFFFF')
      .setFontWeight('bold')
      .setFontSize(10)
      .setHorizontalAlignment('left');
    const subHeaderRow = writeRow;

    // Tx rows.
    txs.forEach(function(t) {
      writeRow++;
      let dateStr = '';
      if (t.date) {
        try { dateStr = Utilities.formatDate(new Date(t.date), tz, 'MMM d yyyy h:mm a'); }
        catch (e) { dateStr = String(t.date); }
      }
      const card = t.cardBrand
        ? (t.cardBrand + (t.cardLast4 ? ' •••• ' + t.cardLast4 : ''))
        : '';
      sh.getRange(writeRow, 1, 1, 7).setValues([[
        dateStr,
        t.sourceName || '',
        Number(t.amount || 0),
        String(t.status || '').toLowerCase(),
        card,
        '',  // F: receipt link below
        Number(t.amountRefunded || 0)
      ]]);
      // GHL tx ID stored as a Note on the Source cell — gives the team
      // an easy way to find the underlying transaction in GHL/Stripe.
      if (t.id) {
        sh.getRange(writeRow, 2).setNote('GHL transaction ID: ' + t.id);
      }
      if (t.receiptUrl) {
        sh.getRange(writeRow, 6).setFormula(
          '=HYPERLINK("' + t.receiptUrl + '","Open receipt")');
      }
      sh.getRange(writeRow, 3).setNumberFormat('"$"#,##0.00');
      sh.getRange(writeRow, 7).setNumberFormat('"$"#,##0.00');
      sh.getRange(writeRow, 1, 1, 7)
        .setBackground(null)
        .setFontColor('#000000')
        .setFontWeight('normal')
        .setFontSize(11)
        .setHorizontalAlignment('left');
      if (t.receiptUrl) {
        sh.getRange(writeRow, 6).setFontColor('#143980').setFontLine('underline');
      }
    });
    txWritten += txs.length;

    // Group sub-header + tx rows; collapse by default to mirror Dashboard.
    const lastTxRow = writeRow;
    if (lastTxRow > subHeaderRow) {
      sh.getRange(subHeaderRow, 1, lastTxRow - subHeaderRow + 1, 1)
        .shiftRowGroupDepth(1);
      try {
        const grp = sh.getRowGroup(subHeaderRow, 1);
        if (grp) grp.collapse();
      } catch (e) { /* group API quirk — skip */ }
    }

    writeRow++;  // blank-line gap before next customer
  });

  // Apply Dashboard font to the entire data area in one batch — cheaper
  // than per-row setFontFamily calls during the write loop above.
  if (dashFont && writeRow > 2) {
    sh.getRange(2, 1, writeRow - 2, 7).setFontFamily(dashFont);
  }

  Logger.log('[syncTransactionsSheet] ' + customersWithTx + ' customer(s) with tx, ' +
             txWritten + ' tx row(s) written, ' + errors.length + ' error(s).');
  if (errors.length) Logger.log('[syncTransactionsSheet] Errors: ' + errors.join(' | '));

  return { customersWithTx: customersWithTx, txWritten: txWritten, errors: errors.length };
}
