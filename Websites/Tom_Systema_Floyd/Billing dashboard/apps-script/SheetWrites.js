/** ─── SheetWrites.gs ──────────────────────────────────────────────
 *  Functions that write rows to the Dashboard sheet.
 *  Depends on: Configuration.gs, Helpers.gs
 */

// ─── getDashboardSheet ───────────────────────────────────────────────
/**
 * Returns the Dashboard sheet, throwing if not found.
 * @returns {GoogleAppsScript.Spreadsheet.Sheet}
 */
function getDashboardSheet() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sh = ss.getSheetByName(SHEET_NAME);
  if (!sh) throw new Error('Dashboard sheet not found');
  return sh;
}

// ─── findCustomerRowByEmail ──────────────────────────────────────────
/**
 * Scan col B (EMAIL) for a matching email (case-insensitive).
 * Only matches rows where col A is non-empty AND col B contains "@"
 * (i.e., customer rows, not tx rows).
 * @param {string} email
 * @returns {number|null} 1-indexed row number or null
 */
function findCustomerRowByEmail(email) {
  const sh = getDashboardSheet();
  const lastRow = sh.getLastRow();
  if (lastRow < 2) return null;
  const colA = sh.getRange(2, COL.NAME_OR_DATE, lastRow - 1, 1).getValues();
  const colB = sh.getRange(2, COL.EMAIL_OR_ITEM, lastRow - 1, 1).getValues();
  const needle = email.trim().toLowerCase();
  for (let i = 0; i < colA.length; i++) {
    const a = String(colA[i][0]).trim();
    const b = String(colB[i][0]).trim();
    if (a && b.toLowerCase() === needle && b.includes('@')) {
      return i + 2; // +2: 1-indexed + header offset
    }
  }
  return null;
}

// ─── findCustomerTxRange ─────────────────────────────────────────────
/**
 * Given a customer row number, find the sub-header and tx rows below it.
 * The row immediately below customerRow should be the sub-header (col A = "Date").
 * Tx rows follow the sub-header until a row with col A non-empty and col B
 * containing "@" (next customer) or end of data.
 *
 * @param {number} customerRow  1-indexed row of the customer row
 * @returns {{ firstTx: number, lastTx: number, lastInGroup: number }}
 *   firstTx    = subHeaderRow + 1
 *   lastTx     = last tx row (>= firstTx if there are tx rows; < firstTx if none)
 *   lastInGroup = last row of entire group (sub-header + tx rows)
 */
function findCustomerTxRange(customerRow) {
  const sh = getDashboardSheet();
  const lastRow = sh.getLastRow();
  const subHeaderRow = customerRow + 1;
  const firstTx = subHeaderRow + 1;

  if (subHeaderRow > lastRow) {
    return { firstTx: firstTx, lastTx: firstTx - 1, lastInGroup: customerRow };
  }

  // Walk rows from firstTx downward until we hit a new customer or end
  let lastTx = firstTx - 1; // assume no tx rows yet
  let lastInGroup = subHeaderRow;

  if (firstTx <= lastRow) {
    const remaining = lastRow - firstTx + 1;
    const colA = sh.getRange(firstTx, COL.NAME_OR_DATE, remaining, 1).getValues();
    const colB = sh.getRange(firstTx, COL.EMAIL_OR_ITEM, remaining, 1).getValues();

    for (let i = 0; i < colA.length; i++) {
      const a = String(colA[i][0]).trim();
      const b = String(colB[i][0]).trim();
      // Stop if we hit a new customer row (non-empty A, B has @)
      if (a && b.includes('@')) break;
      lastTx = firstTx + i;
      lastInGroup = firstTx + i;
    }
  }

  // lastInGroup is at least subHeaderRow
  if (lastInGroup < subHeaderRow) lastInGroup = subHeaderRow;

  return { firstTx: firstTx, lastTx: lastTx, lastInGroup: lastInGroup };
}

// ─── _isEmailDerivedNamePlaceholder_ ─────────────────────────────────
/**
 * True when the customer's Name cell currently holds what the legacy
 * importer set as a fallback: the email's local part (segment before
 * the @). Case-insensitive. Used by upsertCustomerRow to decide
 * whether overwriting Name is safe (placeholder → replace with real
 * name from GHL) or destructive (real human-entered name → preserve).
 *
 * Examples:
 *   ("marilyn", "marilyn@gmail.com")    → true  (placeholder, OK to overwrite)
 *   ("Marilyn Smith", "marilyn@...")    → false (real name, preserve)
 *   ("1Nemayynyr", "1nemayynyr@...")    → true  (placeholder)
 *   ("",         anything)               → false (caller handles empty separately)
 */
function _isEmailDerivedNamePlaceholder_(name, email) {
  if (!name || !email) return false;
  const at = String(email).indexOf('@');
  if (at < 1) return false;
  const local = String(email).substring(0, at).toLowerCase();
  return String(name).toLowerCase().trim() === local;
}

// ─── upsertCustomerRow ──────────────────────────────────────────────
/**
 * Insert or update a customer row.
 * New 7-column layout (Stage 9):
 *   A=Name  B=Email  C=Phone  D=WaiverOrigin  E=StudentName  F=ContactProfile  G=Balance
 * @param {{ email, name, phone, waiverOrigin, studentNames,
 *           profileUrl:string|null, contactId:string|null }} payload
 * @returns {number} 1-indexed row number of the customer row
 */
function upsertCustomerRow(payload) {
  const sh = getDashboardSheet();
  const { email, name, phone, waiverOrigin, studentNames, profileUrl } = payload;

  let row = findCustomerRowByEmail(email);
  if (!row) {
    // Append a new row at the bottom
    row = Math.max(sh.getLastRow() + 1, 2);
    sh.insertRowAfter(row - 1);
    // `insertRowAfter` copies data validation from the source row. If the
    // source was a tx row (with status-dropdown validation), the new
    // customer row would reject any value that isn't paid/owed/canceled/
    // refunded — including a SUMIFS formula. Clear it.
    sh.getRange(row, 1, 1, 7).clearDataValidations();
  }

  // Col A–D: basic contact info
  //
  // Preservation rule (added 2026-05-23): Name + Phone used to be
  // unconditionally overwritten on every call. Manual cleanup (typo
  // fix, formatted phone number, etc.) reverted on the next poll
  // within 5 minutes. Now: only overwrite Name if the existing cell
  // is empty OR is a recognized email-derived placeholder (legacy
  // importer sometimes set Name = email's local part as a fallback
  // — e.g. "marilyn" from "marilyn@gmail.com"). Only overwrite Phone
  // if empty. Email + WaiverOrigin always sync from GHL: email is
  // the lookup key, waiverOrigin is the routing field.
  const existingName = String(sh.getRange(row, COL.NAME_OR_DATE).getValue() || '').trim();
  const incomingName = String(name || '').trim();
  if (!existingName || _isEmailDerivedNamePlaceholder_(existingName, email)) {
    sh.getRange(row, COL.NAME_OR_DATE).setValue(incomingName);
  }
  sh.getRange(row, COL.EMAIL_OR_ITEM).setValue(email || '');
  const existingPhone = String(sh.getRange(row, COL.PHONE_OR_UNIT_PRICE).getValue() || '').trim();
  if (!existingPhone) {
    sh.getRange(row, COL.PHONE_OR_UNIT_PRICE).setValue(phone || '');
  }
  sh.getRange(row, COL.WAIVER_OR_DAYS).setValue(waiverOrigin || '');

  // Col E: Student names — APPEND new names that aren't already present
  // (case-insensitive dedupe). Stage 9 wrote new value over old, which lost
  // history when a parent registered multiple kids across multiple forms.
  const newStudentNames = (studentNames || '').toString().trim();
  if (newStudentNames) {
    const existingRaw = String(sh.getRange(row, COL.STUDENT_NAME_OR_WEEKS).getValue() || '').trim();
    const existingList = existingRaw ? existingRaw.split(',').map(function(s) { return s.trim(); }).filter(Boolean) : [];
    const incomingList = newStudentNames.split(',').map(function(s) { return s.trim(); }).filter(Boolean);
    const merged = existingList.slice();
    const seenLower = new Set(existingList.map(function(s) { return s.toLowerCase(); }));
    incomingList.forEach(function(name) {
      const k = name.toLowerCase();
      if (!seenLower.has(k)) { merged.push(name); seenLower.add(k); }
    });
    sh.getRange(row, COL.STUDENT_NAME_OR_WEEKS).setValue(merged.join(', '));
  }

  // Col F: Contact Profile hyperlink
  //
  // Preservation rule (added 2026-05-23): when profileUrl is null we used
  // to unconditionally overwrite col F with "(not found in <state>)" plain
  // text — which destroyed any existing =HYPERLINK(...) formula written
  // by a prior poll that DID find the contact. Now: only overwrite if
  // col F is empty OR already shows the same "(not found in...)" sentinel.
  // If a real HYPERLINK is already there, leave it alone.
  if (profileUrl) {
    const profileFormula = '=HYPERLINK("' + profileUrl + '","Contact Profile Link")';
    sh.getRange(row, COL.CONTACT_OR_TOTAL).setFormula(profileFormula);
  } else {
    const cell = sh.getRange(row, COL.CONTACT_OR_TOTAL);
    const existingFormula = String(cell.getFormula() || '');
    if (existingFormula.toUpperCase().indexOf('HYPERLINK') !== -1) {
      // Already has a HYPERLINK — preserve it.
    } else {
      const state = waiverOrigin || 'unknown';
      cell.setValue('(not found in ' + state + ')');
    }
  }

  // Col G: Balance formula — set by updateBalanceFormula; skip here on first write
  // (updateBalanceFormula is called right after this in processSubmission)

  // Apply brand styling to entire customer row (A–G)
  const rowRange = sh.getRange(row, 1, 1, 7);
  rowRange.setBackground('#143980');
  rowRange.setFontColor('#FFFFFF');
  rowRange.setFontWeight('bold');
  rowRange.setFontSize(12);
  rowRange.setHorizontalAlignment('left');

  // Col F: keep link-style underline on profile cell
  sh.getRange(row, COL.CONTACT_OR_TOTAL).setFontLine('underline');

  return row;
}

// ─── restoreLostProfileLinks ─────────────────────────────────────────
/**
 * One-shot repair: walk every customer header row on the Dashboard,
 * find ones whose col F (Contact Profile) is empty or shows the
 * "(not found in <state>)" plain-text sentinel, re-search GHL by email
 * (always Florida, since contacts canonically live there per
 * PROJECT.md), and write a fresh =HYPERLINK formula if a contact is
 * found.
 *
 * Idempotent: customers whose col F is already a HYPERLINK are skipped
 * entirely. Customers truly absent from GHL stay as-is.
 *
 * Logs a per-customer trace line for restored rows + a final summary.
 * Safe to call from a menu, remote-trigger webapp, or another script.
 */
function restoreLostProfileLinks() {
  const dash = getDashboardSheet();
  const lastRow = dash.getLastRow();
  if (lastRow < 2) return { ok: true, customersScanned: 0, restored: 0, stillMissing: 0, alreadyHadLink: 0, stillMissingDetails: [] };

  const values = dash.getRange(2, 1, lastRow - 1, 7).getValues();
  const formulas = dash.getRange(2, 1, lastRow - 1, 7).getFormulas();
  let scanned = 0, restored = 0, stillMissing = 0, alreadyHadLink = 0;
  const stillMissingDetails = [];

  for (let i = 0; i < values.length; i++) {
    const row = values[i];
    const sheetRow = i + 2;
    const email = String(row[1] || '').trim();
    const colBFormula = String(formulas[i][1] || '');
    const colFValue = String(row[5] || '').trim();
    const colFFormula = String(formulas[i][5] || '').trim();

    // Customer-header detection: col B contains '@' AND is NOT a
    // HYPERLINK formula. Tx rows have col B as a HYPERLINK whose
    // visible label may embed an email (e.g. "Henry Reynolds, T-Shirt:
    // someone@gmail.com (...)") — getValue() returns the rendered text
    // including the embedded email, which would false-positive without
    // the formula check.
    if (email.indexOf('@') === -1) continue;
    if (colBFormula.toUpperCase().indexOf('HYPERLINK') !== -1) continue;

    // Skip if col F already has a HYPERLINK formula — nothing to repair.
    if (colFFormula.toUpperCase().indexOf('HYPERLINK') !== -1) {
      alreadyHadLink++;
      continue;
    }

    scanned++;

    let contactId = null;
    try {
      contactId = ghlSearchContactByEmail('Florida', email);
    } catch (e) {
      Logger.log('[restoreLostProfileLinks] ghl search failed for ' + email + ' row ' + sheetRow + ': ' + e.message);
      stillMissing++;
      stillMissingDetails.push({ email: email, row: sheetRow, reason: 'api_error', message: e.message });
      continue;
    }

    if (!contactId) {
      stillMissing++;
      stillMissingDetails.push({ email: email, row: sheetRow, reason: 'not_in_ghl', priorValue: colFValue || '(empty)' });
      continue;
    }

    const profileUrl = buildProfileUrl(SUBACCOUNTS.Florida.locationId, contactId);
    const formula = '=HYPERLINK("' + profileUrl + '","View profile")';
    dash.getRange(sheetRow, COL.CONTACT_OR_TOTAL).setFormula(formula);
    dash.getRange(sheetRow, COL.CONTACT_OR_TOTAL).setFontLine('underline');
    restored++;
    Logger.log('[restoreLostProfileLinks] restored ' + email + ' (row ' + sheetRow + ') -> ' + contactId);
  }

  Logger.log('[restoreLostProfileLinks] done: scanned=' + scanned +
             ' restored=' + restored + ' stillMissing=' + stillMissing +
             ' alreadyHadLink=' + alreadyHadLink);
  return {
    ok: true,
    customersScanned: scanned,
    restored: restored,
    stillMissing: stillMissing,
    alreadyHadLink: alreadyHadLink,
    stillMissingDetails: stillMissingDetails
  };
}

// ─── appendSubHeaderRow ──────────────────────────────────────────────
/**
 * Insert a sub-header row directly after afterRow.
 * Content: A=Date, B=Item, C=Unit Price, D=Days, E=Weeks, F=Total, G=Status
 * Styling: #4a6493 bg, white bold UPPERCASE text, font size 10.
 * @param {number} afterRow  1-indexed row to insert after
 * @returns {number} 1-indexed row number of the new sub-header row
 */
function appendSubHeaderRow(afterRow) {
  const sh = getDashboardSheet();
  sh.insertRowAfter(afterRow);
  const subRow = afterRow + 1;
  sh.getRange(subRow, 1, 1, 7).clearDataValidations();
  sh.getRange(subRow, 1, 1, 7).setValues([[
    'DATE', 'ITEM', 'UNIT PRICE', 'DAYS', 'WEEKS', 'TOTAL', 'STATUS'
  ]]);
  // Make col G of the sub-header a dropdown that doubles as a bulk-action
  // menu. Default value 'STATUS' acts as the column header. Picking any
  // "Mark all X" option dispatches a bulk update on this customer's tx
  // rows and resets back to 'STATUS' (handled in onEdit).
  applyStatusActionDropdown(subRow);
  // Brand styling for sub-header
  const subRange = sh.getRange(subRow, 1, 1, 7);
  subRange.setBackground('#4a6493');
  subRange.setFontColor('#FFFFFF');
  subRange.setFontWeight('bold');
  subRange.setFontSize(10);
  subRange.setHorizontalAlignment('left');
  return subRow;
}

// ─── appendTxRow ─────────────────────────────────────────────────────
/**
 * Insert a transaction row after the last existing tx row for this customer,
 * or after the sub-header if no tx rows yet.
 *
 * Required fields on txData:
 *   date, item, days, weeks, status, submissionId, sourceFieldName
 *   unitPriceNumeric  - the raw price as a number (e.g., 215)
 *   unitMultiplier    - '/day' | '/week' | '' (drives col C number format)
 *   pricingRule       - 'flat' | 'per_day' | 'per_week' (drives col F formula)
 *
 * Col F (Total) gets a formula that references C/D/E so users can click in
 * to see how it was calculated. A cell Note explains the math in plain English.
 *
 * @param {number} customerRow
 * @returns {number} 1-indexed row of the new tx row
 */
function appendTxRow(customerRow, txData) {
  const sh = getDashboardSheet();
  const { firstTx, lastTx } = findCustomerTxRange(customerRow);

  const insertAfter = lastTx >= firstTx ? lastTx : customerRow + 1;
  sh.insertRowAfter(insertAfter);
  const txRow = insertAfter + 1;

  const {
    date, item, days, weeks, status,
    submissionId, sourceFieldName,
    unitPriceNumeric, unitMultiplier, pricingRule,
    selectedWeeks, selectedDays
  } = txData;

  sh.getRange(txRow, COL.NAME_OR_DATE).setValue(date || '');
  sh.getRange(txRow, COL.EMAIL_OR_ITEM).setValue(item || '');

  // Col C: store NUMERIC unit price + custom format that shows the multiplier.
  // Lets col F's formula reference this cell directly via =C<row>.
  const priceNum = (typeof unitPriceNumeric === 'number') ? unitPriceNumeric : 0;
  const priceCell = sh.getRange(txRow, COL.PHONE_OR_UNIT_PRICE);
  priceCell.setValue(priceNum);
  if (unitMultiplier === '/day')       priceCell.setNumberFormat('"$"0.00"/day"');
  else if (unitMultiplier === '/week') priceCell.setNumberFormat('"$"0.00"/week"');
  else                                  priceCell.setNumberFormat('"$"0.00');

  sh.getRange(txRow, COL.WAIVER_OR_DAYS).setValue(days !== undefined ? days : '');
  sh.getRange(txRow, COL.BALANCE_OR_WEEKS).setValue(weeks !== undefined ? weeks : '');

  // Col F (Total): cell-referencing formula + a verbose Note that spells out
  // the math AND the actual weeks/days the customer selected. The user
  // wants to be able to click any total and understand exactly what it's
  // billing for.
  const colC = 'C' + txRow;  // Unit price (numeric, e.g. 215)
  const colD = 'D' + txRow;  // Days   (e.g. 5)
  const colE = 'E' + txRow;  // Weeks  (e.g. 4)
  const totalCell = sh.getRange(txRow, COL.TOTAL);
  let totalFormula;
  const noteLines = [];

  function fmtMoney(n) { return '$' + Number(n).toFixed(2); }
  const weeksList = Array.isArray(selectedWeeks) ? selectedWeeks : [];
  const daysList  = Array.isArray(selectedDays)  ? selectedDays  : [];

  // Optional rich context fields
  const weekLabel = txData.weekLabel || '';            // e.g. "June 1-5"
  const allWeeksOnSubmission = Array.isArray(txData.allWeeksOnSubmission)
    ? txData.allWeeksOnSubmission : weeksList;
  const formAnswerLabel = txData.formAnswerLabel || ''; // raw form-option label

  if (pricingRule === 'per_day') {
    totalFormula = '=' + colC + '*' + colD + '*' + colE;
    const expectedTotal = priceNum * (Number(days) || 0) * (Number(weeks) || 0);
    noteLines.push('Per-day pricing');
    if (formAnswerLabel) noteLines.push('  Form selection: ' + formAnswerLabel);
    if (weekLabel) noteLines.push('  Week covered: ' + weekLabel);
    if (allWeeksOnSubmission.length > 1) {
      noteLines.push('  All weeks on this submission: ' + allWeeksOnSubmission.join(', '));
    }
    noteLines.push('  Unit price: ' + fmtMoney(priceNum) + ' per day (cell ' + colC + ')');
    noteLines.push('  Days: ' + (days || 0) + (daysList.length
      ? ' (' + daysList.join(', ') + ')'
      : '') + ' (cell ' + colD + ')');
    noteLines.push('  Weeks on this row: ' + (weeks || 0) + ' (cell ' + colE + ')');
    noteLines.push('  Total: ' + fmtMoney(priceNum) + ' x ' + (days || 0) +
                   ' x ' + (weeks || 0) + ' = ' + fmtMoney(expectedTotal));
    noteLines.push('  Formula: ' + totalFormula);
  } else if (pricingRule === 'per_week') {
    totalFormula = '=' + colC + '*' + colE;
    const expectedTotal = priceNum * (Number(weeks) || 0);
    noteLines.push('Per-week pricing');
    if (formAnswerLabel) noteLines.push('  Form selection: ' + formAnswerLabel);
    if (weekLabel) noteLines.push('  Week covered: ' + weekLabel);
    if (allWeeksOnSubmission.length > 1) {
      noteLines.push('  All weeks on this submission: ' + allWeeksOnSubmission.join(', '));
    }
    noteLines.push('  Unit price: ' + fmtMoney(priceNum) + ' per week (cell ' + colC + ')');
    noteLines.push('  Weeks on this row: ' + (weeks || 0) + ' (cell ' + colE + ')');
    noteLines.push('  Total: ' + fmtMoney(priceNum) + ' x ' + (weeks || 0) +
                   ' = ' + fmtMoney(expectedTotal));
    noteLines.push('  Formula: ' + totalFormula);
  } else {
    // flat
    totalFormula = '=' + colC;
    noteLines.push('Flat pricing');
    if (formAnswerLabel) noteLines.push('  Form selection: ' + formAnswerLabel);
    noteLines.push('  Charge: ' + fmtMoney(priceNum) + ' (cell ' + colC + ')');
    if (item && /^cc verification fee/i.test(String(item))) {
      noteLines.push('  Status: already paid (charged at form submission).');
    }
    noteLines.push('  Formula: ' + totalFormula);
  }
  totalCell.setFormula(totalFormula);
  totalCell.setNumberFormat('"$"#,##0.00');
  totalCell.setNote(noteLines.join('\n'));

  sh.getRange(txRow, COL.STATUS).setValue(status || 'owed');
  // Reset visual style — `insertRowAfter` copies formatting from the row
  // above, so a tx row inserted right after a sub-header would otherwise
  // inherit #4a6493 + white text + bold. Force back to plain row defaults.
  sh.getRange(txRow, 1, 1, 7)
    .setBackground(null)
    .setFontColor('#000000')
    .setFontWeight('normal')
    .setFontSize(11);
  // User preference: every cell on tx rows is left-aligned for visual
  // consistency, including numeric columns (Days, Weeks, Total).
  sh.getRange(txRow, 1, 1, 7).setHorizontalAlignment('left');

  // Store submission_id + source-field-name as a cell Note on the Item cell
  // (col B) — gives Erin context on what GHL form field this line came from
  // without needing an extra column.
  if (submissionId || sourceFieldName) {
    var noteParts = [];
    if (submissionId) noteParts.push('Submission ID: ' + submissionId);
    if (sourceFieldName) noteParts.push('Field: ' + sourceFieldName);
    sh.getRange(txRow, COL.EMAIL_OR_ITEM).setNote(noteParts.join('\n'));
  }

  // Apply status dropdown so col G renders as a chip with the 4 status options
  applyStatusDropdown(txRow);

  return txRow;
}

// ─── applyStatusDropdown ─────────────────────────────────────────────
/**
 * Set chip-style data validation on col G of rowNumber. Uses the Sheets
 * Advanced Service to force `showCustomUi: true`, which renders the
 * dropdown as a smart-chip pill in modern Sheets — Apps Script's plain
 * `requireValueInList(values, true)` produces a dropdown ARROW, not a chip.
 *
 * Combined with the conditional-formatting rules on F2:G1000 (paid →
 * green, owed → red, canceled → yellow, refunded → orange), each chip
 * picks up its semantic color automatically.
 * @param {number} rowNumber
 */
function applyStatusDropdown(rowNumber) {
  // Apps Script API path — works as a fallback if Sheets Advanced is off
  const sh = getDashboardSheet();
  const rule = SpreadsheetApp.newDataValidation()
    .requireValueInList(['paid', 'owed', 'canceled', 'refunded'], true)
    .setAllowInvalid(false)
    .build();
  sh.getRange(rowNumber, COL.STATUS).setDataValidation(rule);

  // Sheets Advanced API path — explicit chip rendering via showCustomUi
  if (typeof Sheets !== 'undefined') {
    try {
      var ssId = SpreadsheetApp.getActiveSpreadsheet().getId();
      var sheetId = sh.getSheetId();
      Sheets.Spreadsheets.batchUpdate({
        requests: [{
          setDataValidation: {
            range: {
              sheetId: sheetId,
              startRowIndex: rowNumber - 1,   // 0-indexed
              endRowIndex: rowNumber,
              startColumnIndex: COL.STATUS - 1,
              endColumnIndex: COL.STATUS
            },
            rule: {
              condition: {
                type: 'ONE_OF_LIST',
                values: [
                  { userEnteredValue: 'paid' },
                  { userEnteredValue: 'owed' },
                  { userEnteredValue: 'canceled' },
                  { userEnteredValue: 'refunded' }
                ]
              },
              showCustomUi: true,
              strict: true
            }
          }
        }]
      }, ssId);
    } catch (e) {
      Logger.log('[applyStatusDropdown] Sheets API chip path failed (falling back): ' + e.message);
    }
  }
}

/**
 * Bulk-apply chip dropdowns to every tx row's col G in a single
 * batchUpdate request — avoids per-row API calls when the sheet has
 * many tx rows. Use after polling / replay / regroup.
 */
function applyChipDropdownsToAllTxRows() {
  if (typeof Sheets === 'undefined') return { skipped: true };
  var sh = getDashboardSheet();
  var lastRow = sh.getLastRow();
  if (lastRow < 2) return { applied: 0 };
  var values = sh.getRange(2, 1, lastRow - 1, 7).getValues();
  var ssId = SpreadsheetApp.getActiveSpreadsheet().getId();
  var sheetId = sh.getSheetId();
  var requests = [];
  for (var i = 0; i < values.length; i++) {
    var sheetRow = i + 2;
    var a = String(values[i][0] || '').trim();
    var b = String(values[i][1] || '').trim();
    if (b.indexOf('@') !== -1) continue;     // customer rows
    if (a.toUpperCase() === 'DATE') continue; // sub-headers
    if (!a) continue;
    requests.push({
      setDataValidation: {
        range: {
          sheetId: sheetId,
          startRowIndex: sheetRow - 1,
          endRowIndex: sheetRow,
          startColumnIndex: 6, // col G zero-indexed
          endColumnIndex: 7
        },
        rule: {
          condition: {
            type: 'ONE_OF_LIST',
            values: [
              { userEnteredValue: 'paid' },
              { userEnteredValue: 'owed' },
              { userEnteredValue: 'canceled' },
              { userEnteredValue: 'refunded' }
            ]
          },
          showCustomUi: true,
          strict: true
        }
      }
    });
  }
  if (requests.length) Sheets.Spreadsheets.batchUpdate({ requests: requests }, ssId);
  return { applied: requests.length };
}

// ─── updateBalanceFormula ──────────────────────────────────────────────
/**
 * Recompute and write the Balance HYPERLINK formula in col G of customerRow.
 * Sets balance-state background AND appropriate text color on that cell.
 * @param {number} customerRow
 * @param {string|null} profileUrl  if null, reads from col F cell formula
 */
function updateBalanceFormula(customerRow, profileUrl) {
  const sh = getDashboardSheet();
  const { firstTx, lastTx } = findCustomerTxRange(customerRow);
  const subaccount = String(sh.getRange(customerRow, COL.WAIVER_OR_DAYS).getValue() || 'Florida');

  // Resolve profileUrl: use passed value OR extract from col F cell
  let resolvedUrl = profileUrl;
  if (!resolvedUrl) {
    const colFCell = sh.getRange(customerRow, COL.CONTACT_OR_TOTAL);
    const fFormula = colFCell.getFormula();
    // Extract URL from =HYPERLINK("url","label")
    const urlMatch = fFormula.match(/HYPERLINK\("([^"]+)"/);
    resolvedUrl = urlMatch ? urlMatch[1] : null;
  }

  const formula = buildBalanceFormula(resolvedUrl, firstTx, lastTx, subaccount);
  const balanceCell = sh.getRange(customerRow, COL.BALANCE_OR_STATUS);

  // Clear any inherited status-dropdown validation that would reject
  // the SUMIFS formula (validation only allows paid/owed/canceled/refunded).
  balanceCell.clearDataValidations();

  if (typeof formula === 'string' && formula.startsWith('=')) {
    balanceCell.setFormula(formula);
  } else {
    balanceCell.setValue(formula);
  }
  // Nice-to-have #3: balance is numeric, currency-formatted, no link.
  balanceCell.setNumberFormat('"$"#,##0.00');

  // Compute numeric balance directly from tx rows to set bg+text color
  let numericBalance = 0;
  if (firstTx <= lastTx) {
    const fCol = sh.getRange(firstTx, COL.CONTACT_OR_TOTAL, lastTx - firstTx + 1, 1).getValues();
    const gCol = sh.getRange(firstTx, COL.BALANCE_OR_STATUS, lastTx - firstTx + 1, 1).getValues();
    for (let i = 0; i < fCol.length; i++) {
      if (String(gCol[i][0]).trim() === 'owed') {
        const v = parseFloat(fCol[i][0]);
        if (!isNaN(v)) numericBalance += v;
      }
    }
  }

  // Set background based on balance; dark text since col G is no longer a link.
  if (numericBalance > 0) {
    balanceCell.setBackground('#FCE4E4'); // light red
    balanceCell.setFontColor('#143980');
  } else if (numericBalance < 0) {
    balanceCell.setBackground('#E0EEF8'); // light blue
    balanceCell.setFontColor('#143980');
  } else {
    balanceCell.setBackground(null); // white / default
    balanceCell.setFontColor('#143980');
  }
  balanceCell.setFontLine('none');  // no underline anymore
}

// ─── applyRowGrouping ────────────────────────────────────────────────
/**
 * Wrap rows subHeaderRow through lastInGroup into a collapsible group.
 * @param {number} subHeaderRow
 * @param {number} lastInGroup
 */
function applyRowGrouping(firstRow, lastRow) {
  if (lastRow < firstRow) return;
  const sheet = getDashboardSheet();

  // Remove ANY pre-existing groups at firstRow, every depth, before
  // applying a fresh depth-1 group. (getRowGroupDepth lives on Sheet,
  // not Range — Range only has shiftRowGroupDepth.)
  let depth = sheet.getRowGroupDepth(firstRow);
  while (depth > 0) {
    const group = sheet.getRowGroup(firstRow, depth);
    if (group) group.remove();
    depth--;
  }

  // Now apply a single depth=1 group over (firstRow ... lastRow).
  const range = sheet.getRange(firstRow, 1, lastRow - firstRow + 1, 1);
  range.shiftRowGroupDepth(1);
}

// ─── setGroupExpansion ───────────────────────────────────────────────
/**
 * Expand or collapse the row group at subHeaderRow.
 * @param {number} subHeaderRow
 * @param {boolean} expanded
 */
function setGroupExpansion(subHeaderRow, expanded) {
  const sh = getDashboardSheet();
  const groups = sh.getRowGroupControlPosition
    ? null // newer API — handled below
    : null;
  // Apps Script row group collapse/expand via row groups array
  try {
    const rg = sh.getRowGroup(subHeaderRow, 1);
    if (rg) {
      if (expanded) {
        rg.expand();
      } else {
        rg.collapse();
      }
    }
  } catch(e) {
    // getRowGroup may not be available in all environments; silently skip
    Logger.log('setGroupExpansion note: ' + e.message);
  }
}

// ─── stage3SheetWriteTests ───────────────────────────────────────────
/**
 * End-to-end test for Stage 3 acceptance.
 * Creates a test customer, 3 tx rows, verifies, then cleans up.
 */
function stage3SheetWriteTests() {
  const sh = getDashboardSheet();
  const results = [];
  const TEST_EMAIL = 'stage3test@example.com';

  function assert(label, actual, expected) {
    const pass = JSON.stringify(actual) === JSON.stringify(expected);
    results.push((pass ? '[PASS]' : '[FAIL]') + ' ' + label +
      (pass ? '' : '  got=' + JSON.stringify(actual) + '  want=' + JSON.stringify(expected)));
  }

  // ── Step 0: pre-cleanup (idempotent) ─────────────────────────────
  const existingRow = findCustomerRowByEmail(TEST_EMAIL);
  if (existingRow !== null) {
    const { lastInGroup } = findCustomerTxRange(existingRow);
    sh.deleteRows(existingRow, lastInGroup - existingRow + 1);
    SpreadsheetApp.flush();
  }

  // ── Step 1: upsert customer row ───────────────────────────────────
  const custRow = upsertCustomerRow({
    email: TEST_EMAIL,
    name: 'Stage 3 Test',
    phone: '555-0100',
    waiverOrigin: 'Florida',
    profileUrl: null,
    contactId: null
  });
  SpreadsheetApp.flush();
  assert('customerRow >= 2', custRow >= 2, true);

  // ── Step 2: append sub-header ─────────────────────────────────────
  const subHeaderRow = appendSubHeaderRow(custRow);
  SpreadsheetApp.flush();
  assert('subHeaderRow = custRow+1', subHeaderRow, custRow + 1);
  const subHeaderA = String(sh.getRange(subHeaderRow, 1).getValue());
  assert('subHeader A = Date', subHeaderA, 'Date');

  // ── Step 3: append three tx rows ──────────────────────────────────
  const txRowA = appendTxRow(custRow, {
    date: 'Apr 12 2026', item: 'Camp 3-day', unitPriceDisplay: '$285/wk',
    days: 3, weeks: 3, totalFormula: '=285*3', status: 'owed'
  });
  const txRowB = appendTxRow(custRow, {
    date: 'Apr 12 2026', item: 'Pizza', unitPriceDisplay: '$7.75/day',
    days: 3, weeks: 3, totalFormula: '=7.75*3*3', status: 'owed'
  });
  const txRowC = appendTxRow(custRow, {
    date: 'Apr 13 2026', item: 'T-shirt XL', unitPriceDisplay: '$25',
    days: '', weeks: '', totalFormula: '=25', status: 'paid'
  });
  SpreadsheetApp.flush();

  assert('txRowA = subHeader+1', txRowA, subHeaderRow + 1);
  assert('txRowB = subHeader+2', txRowB, subHeaderRow + 2);
  assert('txRowC = subHeader+3', txRowC, subHeaderRow + 3);

  // ── Step 4: apply status dropdowns ────────────────────────────────
  applyStatusDropdown(txRowA);
  applyStatusDropdown(txRowB);
  applyStatusDropdown(txRowC);

  // ── Step 5: update balance formula ────────────────────────────────
  updateBalanceFormula(custRow, null); // profileUrl = null → fallback text
  SpreadsheetApp.flush();

  // ── Step 6: apply row grouping ────────────────────────────────────
  const { lastInGroup } = findCustomerTxRange(custRow);
  applyRowGrouping(subHeaderRow, lastInGroup);

  // ── Step 7: set group expanded (balance > 0) ──────────────────────
  setGroupExpansion(subHeaderRow, true);
  SpreadsheetApp.flush();

  // ── Step 8: verify by reading back ───────────────────────────────
  // 8a: customer row email
  const emailVal = String(sh.getRange(custRow, COL.EMAIL_OR_ITEM).getValue()).trim();
  assert('email readback', emailVal, TEST_EMAIL);

  // 8b: sub-header immediately below customer
  const subAVal = String(sh.getRange(custRow + 1, COL.NAME_OR_DATE).getValue());
  assert('sub-header below customer', subAVal, 'Date');

  // 8c: three tx rows exist below sub-header
  const txAItem = String(sh.getRange(txRowA, COL.EMAIL_OR_ITEM).getValue());
  const txBItem = String(sh.getRange(txRowB, COL.EMAIL_OR_ITEM).getValue());
  const txCItem = String(sh.getRange(txRowC, COL.EMAIL_OR_ITEM).getValue());
  assert('txA item', txAItem, 'Camp 3-day');
  assert('txB item', txBItem, 'Pizza');
  assert('txC item', txCItem, 'T-shirt XL');

  // 8d: verify formula values (Apps Script reads computed values)
  const fA = sh.getRange(txRowA, COL.TOTAL).getValue();
  const fB = sh.getRange(txRowB, COL.TOTAL).getValue();
  const fC = sh.getRange(txRowC, COL.TOTAL).getValue();
  assert('TxA total = 855', fA, 855);
  assert('TxB total = 69.75', Math.round(fB * 100) / 100, 69.75);
  assert('TxC total = 25', fC, 25);

  // 8e: balance cell text = "(not found in Florida)"
  const balVal = String(sh.getRange(custRow, COL.BALANCE_OR_WEEKS).getValue());
  assert('balance text = not found', balVal, '(not found in Florida)');

  // 8f: balance cell background = light red (balance > 0 = 855+69.75 = 924.75)
  const balBg = sh.getRange(custRow, COL.BALANCE_OR_WEEKS).getBackground();
  assert('balance bg = light red', balBg.toLowerCase(), '#fce4e4');

  // ── Mid-run screenshot point (log before cleanup) ─────────────────
  results.push('--- Mid-run state logged (before cleanup) ---');
  results.push('custRow=' + custRow + ' subHeaderRow=' + subHeaderRow +
    ' txA=' + txRowA + ' txB=' + txRowB + ' txC=' + txRowC +
    ' lastInGroup=' + lastInGroup);

  // ── Step 9: cleanup ───────────────────────────────────────────────
  // Delete the customer row + sub-header + all tx rows
  const groupSize = lastInGroup - custRow + 1;
  sh.deleteRows(custRow, groupSize);
  SpreadsheetApp.flush();

  // 8g: sheet should be empty (only header row)
  const afterLastRow = sh.getLastRow();
  assert('sheet empty after cleanup', afterLastRow, 1);

  Logger.log(results.join('\n'));
  return results;
}


// ─── Temporary mid-run helpers for Stage 3 visual verification ───────────────

function midRunSetup() {
  const sh = getDashboardSheet();
  // Clear everything below header
  const last = sh.getLastRow();
  if (last > 1) sh.deleteRows(2, last - 1);

  const custRow = upsertCustomerRow({
    email: 'stage3test@example.com',
    name: 'Stage 3 Test',
    phone: '555-0100',
    waiverOrigin: 'Florida',
    profileUrl: null,
    contactId: null
  });
  const subHeaderRow = appendSubHeaderRow(custRow);
  const txA = appendTxRow(custRow, {
    date: 'Apr 12 2026', item: 'Camp 3-day', unitPriceDisplay: '$285/wk',
    days: 3, weeks: 3, totalFormula: '=285*3', status: 'owed'
  });
  applyStatusDropdown(txA);
  const txB = appendTxRow(custRow, {
    date: 'Apr 12 2026', item: 'Pizza', unitPriceDisplay: '$7.75/day',
    days: 3, weeks: 3, totalFormula: '=7.75*3*3', status: 'owed'
  });
  applyStatusDropdown(txB);
  const txC = appendTxRow(custRow, {
    date: 'Apr 13 2026', item: 'T-shirt XL', unitPriceDisplay: '$25',
    days: '', weeks: '', totalFormula: '=25', status: 'paid'
  });
  applyStatusDropdown(txC);
  updateBalanceFormula(custRow, null);
  applyRowGrouping(subHeaderRow, txC);
  setGroupExpansion(subHeaderRow, true);
  Logger.log('midRunSetup complete. custRow=' + custRow + ' subHeaderRow=' + subHeaderRow + ' txA=' + txA + ' txB=' + txB + ' txC=' + txC);
}

function midRunCleanup() {
  const sh = getDashboardSheet();
  const custRow = findCustomerRowByEmail('stage3test@example.com');
  if (!custRow) { Logger.log('No test row found — already clean'); return; }
  const { lastInGroup } = findCustomerTxRange(custRow);
  sh.deleteRows(custRow, lastInGroup - custRow + 1);
  Logger.log('midRunCleanup complete');
}

// ─── resetAllRowGroups_ ──────────────────────────────────────────────────────
/**
 * Removes ALL row groups from the data area of the given sheet.
 * Walk every depth from max down to 1, removing every group on every row.
 * Called before any rebuild (resortByEmail, replayAllSubmissions) to ensure
 * a clean slate so applyRowGrouping stays idempotent.
 * @param {GoogleAppsScript.Spreadsheet.Sheet} sheet
 */
/**
 * Defensive sweep: ensure every customer row has a properly-styled
 * sub-header right below it. Repairs any case where the sub-header has
 * been clobbered (wrong bg, missing 'STATUS' in col G, etc.).
 * Mirrors the regroupAllCustomers pattern used after polling.
 * Returns { repaired, inserted, alreadyOk }.
 */
/**
 * Apply the bulk-action dropdown to col G of a single sub-header row.
 * Options: 'STATUS' (default placeholder), 'Mark all paid', 'Mark all owed',
 * 'Mark all canceled', 'Mark all refunded'. The onEdit handler dispatches
 * the action and resets the cell back to 'STATUS'.
 *
 * @param {number} subRow  1-indexed sub-header row
 */
function applyStatusActionDropdown(subRow) {
  var sh = getDashboardSheet();
  var cell = sh.getRange(subRow, 7);
  cell.clearDataValidations();
  var rule = SpreadsheetApp.newDataValidation()
    .requireValueInList(
      ['STATUS', 'Mark all paid', 'Mark all owed', 'Mark all canceled', 'Mark all refunded'],
      true)
    .setAllowInvalid(false)
    .build();
  cell.setDataValidation(rule);
  if (String(cell.getValue() || '').trim() === '') cell.setValue('STATUS');
}

/**
 * Walk every sub-header row on the Dashboard and apply the bulk-action
 * dropdown. Also clears any leftover col H checkboxes from the previous
 * iteration of this feature.
 */
function addQuickActionCheckboxes() {
  var dash = getDashboardSheet();
  var lastRow = dash.getLastRow();
  if (lastRow < 2) return { added: 0 };
  var values = dash.getRange(2, 1, lastRow - 1, 7).getValues();
  var applied = 0;
  for (var i = 0; i < values.length; i++) {
    var a = String(values[i][0] || '').trim().toUpperCase();
    var g = String(values[i][6] || '').trim().toUpperCase();
    if (a !== 'DATE' || g !== 'STATUS') continue;
    var sheetRow = i + 2;
    applyStatusActionDropdown(sheetRow);
    applied++;
    // Clear any leftover col H checkbox from the previous design
    var hCell = dash.getRange(sheetRow, 8);
    hCell.clearDataValidations();
    hCell.clearContent();
    hCell.clearFormat();
  }
  return { added: applied };
}

/**
 * Build a copy-pasteable description of a customer's outstanding (owed)
 * items. Used as the cell Note on the Balance cell so team members can
 * click the balance, see exactly what's owed, and paste it into a payment
 * description.
 *
 * Skips items where status is anything other than 'owed' (paid, canceled,
 * refunded all excluded).
 *
 * @param {number} customerRow
 * @returns {string}  multi-line note text, or '' if balance is 0
 */
function buildBalanceNoteText(customerRow) {
  var sh = getDashboardSheet();
  var name = String(sh.getRange(customerRow, COL.NAME_OR_DATE).getValue() || '').trim();
  var range = findCustomerTxRange(customerRow);
  if (!range || range.lastTx < range.firstTx) return '';

  var n = range.lastTx - range.firstTx + 1;
  var rows = sh.getRange(range.firstTx, 1, n, 7).getValues();
  var owedItems = [], refundedItems = [];
  var owedTotal = 0, refundedTotal = 0;

  for (var i = 0; i < rows.length; i++) {
    var status = String(rows[i][6] || '').toLowerCase().trim();
    if (status !== 'owed' && status !== 'refunded') continue;
    var item   = String(rows[i][1] || '').trim();
    var unit   = rows[i][2];
    var days   = rows[i][3];
    var weeks  = rows[i][4];
    var total  = Number(rows[i][5]) || 0;
    var unitFmt = sh.getRange(range.firstTx + i, 3).getNumberFormat();
    var unitSuffix = '';
    if (unitFmt && unitFmt.indexOf('/day') !== -1) unitSuffix = '/day';
    else if (unitFmt && unitFmt.indexOf('/week') !== -1) unitSuffix = '/week';
    var unitDisplay = '$' + Number(unit).toFixed(2) + unitSuffix;
    var qtyParts = [];
    if (days  && unitSuffix === '/day')  qtyParts.push(days  + ' day(s)');
    if (weeks && (unitSuffix === '/day' || unitSuffix === '/week')) qtyParts.push(weeks + ' week(s)');
    var qty = qtyParts.length ? ' x ' + qtyParts.join(' x ') : '';
    // 2-space indent to match the appendTxRow note style
    var bullet = '  - ' + item + ': ' + unitDisplay + qty + ' = $' + total.toFixed(2);
    if (status === 'owed') {
      owedItems.push(bullet);
      owedTotal += total;
    } else {
      refundedItems.push(bullet);
      refundedTotal += total;
    }
  }

  if (!owedItems.length && !refundedItems.length) return '';

  // No header line: the cell is already labeled "Balance" by the column,
  // so the redundant "<name> (outstanding balance: $X)" is dropped.
  var lines = [];
  if (owedItems.length) {
    lines.push('Items owed:');
    lines = lines.concat(owedItems);
  }
  if (refundedItems.length) {
    if (owedItems.length) lines.push('');
    lines.push('Items refunded (we owe customer):');
    lines = lines.concat(refundedItems);
  }
  return lines.join('\n');
}

/**
 * Refresh the Balance cell's Note for a single customer so it shows a
 * copy-pasteable list of what they owe. Empty note for $0 balance.
 */
function refreshBalanceNoteForCustomer(customerRow) {
  var sh = getDashboardSheet();
  var note = buildBalanceNoteText(customerRow);
  sh.getRange(customerRow, COL.BALANCE_OR_STATUS).setNote(note || '');
}

/**
 * Refresh Balance Notes for every customer on the Dashboard. Used as a
 * tail in pollFloridaSubmissions and nuclearReset.
 */
function refreshAllBalanceNotes() {
  var sh = getDashboardSheet();
  var lastRow = sh.getLastRow();
  if (lastRow < 2) return { refreshed: 0 };
  var values = sh.getRange(2, 1, lastRow - 1, 7).getValues();
  var refreshed = 0;
  for (var i = 0; i < values.length; i++) {
    var b = String(values[i][1] || '').trim();
    if (b.indexOf('@') === -1) continue;
    refreshBalanceNoteForCustomer(i + 2);
    refreshed++;
  }
  return { refreshed: refreshed };
}

/**
 * Nice-to-have #1: refresh row 1 col G's grand-total formula so it always
 * shows "Balance: $X,XXX.XX" — the sum of every customer's owed balance.
 * Call this AFTER any operation that mutates the data area (poll, replay,
 * resort) so Sheets' auto-adjust of relative references doesn't push the
 * range past the data.
 */
function refreshGrandTotalHeader() {
  var dash = getDashboardSheet();
  dash.getRange(1, 7).setFormula(
    '="Balance: $" & TEXT(SUMIF($B$2:$B,"*@*",$G$2:$G),"#,##0.00")'
  );
}

/**
 * Filters toggle in cell H1. The default value is the literal word "Filters"
 * so the cell reads as a filter label until a real filter is picked.
 *
 *   "Filters"             → no filter active (default — all rows visible)
 *   "Owes a balance"      → hide customers whose balance is 0
 *   "Fully paid"          → hide customers whose balance is > 0
 *   "Minimize all groups" → one-shot ACTION: collapse every group
 *   "Expand all groups"   → one-shot ACTION: expand every group
 *
 * Both action items reset H1 back to "Filters" after firing so the
 * menu is re-pickable (toggle freely between minimize and expand).
 *
 * H2:H1000 is also force-cleared so no validation/formatting bleeds below H1.
 */
function setupBalanceFilterToggle() {
  var dash = getDashboardSheet();

  function setupCell(col, options, defaultVal) {
    var cell = dash.getRange(1, col);
    cell.clearDataValidations();
    var rule = SpreadsheetApp.newDataValidation()
      .requireValueInList(options, true)
      .setAllowInvalid(false)
      .build();
    cell.setDataValidation(rule);
    var current = String(cell.getValue() || '').trim();
    if (options.indexOf(current) === -1) cell.setValue(defaultVal);
    cell.setBackground('#1E3F8A')
        .setFontColor('#FFFFFF')
        .setFontWeight('bold')
        .setHorizontalAlignment('center')
        .clearNote();   // no cell note per user preference
    dash.setColumnWidth(col, 150);
    var maxRows = Math.max(dash.getMaxRows(), 100);
    if (maxRows > 1) {
      var below = dash.getRange(2, col, maxRows - 1, 1);
      below.clearDataValidations();
      below.clearContent();
      below.clearFormat();
    }
  }

  // H1: customer-level filter (stateful)
  setupCell(8, ['Filters', 'Owes a balance', 'Fully paid'], 'Filters');
  // I1: tx-row-level filter (stateful)
  setupCell(9, ['All items', 'Hide paid items'], 'All items');
  // J1: one-shot actions. Reset themselves back to "Actions" after firing.
  setupCell(10, ['Actions', 'Minimize all groups', 'Expand all groups'], 'Actions');

  // The setupCell calls above wipe col H rows 2+ to make sure no validation
  // bleeds below H1. That also kills the per-customer "Mark all paid"
  // checkboxes, so re-add them right after.
  if (typeof addQuickActionCheckboxes === 'function') {
    try { addQuickActionCheckboxes(); }
    catch (e) { Logger.log('[setupBalanceFilterToggle] checkbox restore err: ' + e.message); }
  }
}

/**
 * Nice-to-have #7: native Google Sheets filter views with preset sorts +
 * filters. Uses the Sheets advanced service (enabled in appsscript.json).
 * Each view persists in the sheet so users can pick from Data → Filter views.
 *
 * Idempotent: deletes any prior versions of our managed views before adding.
 * Safe to call when the advanced service isn't available — wraps in try/catch.
 */
function setupFilterViews() {
  if (typeof Sheets === 'undefined') {
    Logger.log('[setupFilterViews] Sheets advanced service not available yet — skipping.');
    return { skipped: true };
  }
  var ssId = SpreadsheetApp.getActiveSpreadsheet().getId();
  var dash = getDashboardSheet();
  var sheetId = dash.getSheetId();

  var managedNames = [
    '1. Owes a balance',
    '2. Fully paid',
    '3. Highest balance first',
  ];

  // Fetch existing filter views so we can delete prior managed ones
  var ss = Sheets.Spreadsheets.get(ssId, { fields: 'sheets(properties.sheetId,filterViews(filterViewId,title))' });
  var existing = [];
  (ss.sheets || []).forEach(function(s) {
    if (s.properties.sheetId === sheetId && s.filterViews) {
      s.filterViews.forEach(function(fv) {
        if (managedNames.indexOf(fv.title) !== -1) {
          existing.push(fv.filterViewId);
        }
      });
    }
  });

  var deleteReqs = existing.map(function(id) {
    return { deleteFilterView: { filterId: id } };
  });

  var addReqs = [
    {
      addFilterView: {
        filter: {
          title: '1. Owes a balance',
          range: { sheetId: sheetId, startRowIndex: 0, startColumnIndex: 0, endColumnIndex: 7 },
          criteria: {
            '6': { condition: { type: 'NUMBER_GREATER', values: [{ userEnteredValue: '0' }] } }
          }
        }
      }
    },
    {
      addFilterView: {
        filter: {
          title: '2. Fully paid',
          range: { sheetId: sheetId, startRowIndex: 0, startColumnIndex: 0, endColumnIndex: 7 },
          criteria: {
            '6': { condition: { type: 'NUMBER_EQ', values: [{ userEnteredValue: '0' }] } }
          }
        }
      }
    },
    {
      addFilterView: {
        filter: {
          title: '3. Highest balance first',
          range: { sheetId: sheetId, startRowIndex: 0, startColumnIndex: 0, endColumnIndex: 7 },
          sortSpecs: [{ dimensionIndex: 6, sortOrder: 'DESCENDING' }]
        }
      }
    }
  ];

  if (deleteReqs.length) Sheets.Spreadsheets.batchUpdate({ requests: deleteReqs }, ssId);
  Sheets.Spreadsheets.batchUpdate({ requests: addReqs }, ssId);

  return { deletedPriorVersions: deleteReqs.length, added: addReqs.length };
}

/**
 * Collapse every customer's row group on the Dashboard. Used by the
 * "Minimize all groups" action in the H1 filter dropdown.
 */
function collapseAllGroups() {
  var dash = getDashboardSheet();
  var lastRow = dash.getLastRow();
  if (lastRow < 2) return;
  var values = dash.getRange(2, 1, lastRow - 1, 7).getValues();
  for (var i = 0; i < values.length; i++) {
    if (String(values[i][1] || '').indexOf('@') === -1) continue;
    var custRow = i + 2;
    try {
      var group = dash.getRowGroup(custRow + 1, 1);
      if (group) group.collapse();
    } catch (e) { /* no group on this customer — skip */ }
  }
}

/**
 * Expand every customer's row group on the Dashboard. Pair to
 * collapseAllGroups; used by the "Expand all groups" action.
 */
function expandAllGroups() {
  var dash = getDashboardSheet();
  var lastRow = dash.getLastRow();
  if (lastRow < 2) return;
  var values = dash.getRange(2, 1, lastRow - 1, 7).getValues();
  for (var i = 0; i < values.length; i++) {
    if (String(values[i][1] || '').indexOf('@') === -1) continue;
    var custRow = i + 2;
    try {
      var group = dash.getRowGroup(custRow + 1, 1);
      if (group) group.expand();
    } catch (e) { /* no group on this customer — skip */ }
  }
}

/**
 * Hide / show customer sections based on the chosen mode.
 * Walks every customer row + their entire group (sub-header + tx rows)
 * and hides the contiguous block when the customer doesn't match.
 */
function applyBalanceFilter(mode) {
  // Re-apply ALL three filter dropdowns from row 1 (H, I, J) so the
  // current state is the union of every active filter. Single-call entry
  // point used by both the H1/I1 onEdit and any direct invocation.
  applyAllFilters_();
}

/**
 * Compose the visibility state from H1 (customer filter) + I1 (item
 * filter) + J1 (one-shot action). Always re-derives from scratch so
 * stale hidden rows don't accumulate.
 */
function applyAllFilters_() {
  var dash = getDashboardSheet();
  var lastRow = dash.getLastRow();
  if (lastRow < 2) return;

  var custFilter = String(dash.getRange(1, 8).getValue() || '').trim();
  var itemFilter = String(dash.getRange(1, 9).getValue() || '').trim();
  var action     = String(dash.getRange(1, 10).getValue() || '').trim();

  // J1 actions are one-shot. Fire, reset, and EXIT early — the showRows
  // step below would undo any collapse (showRows unhides rows that the
  // group collapse hid, which means the user sees the groups snap back
  // open immediately after minimizing). Stateful filters are unaffected
  // by an action firing.
  if (action === 'Minimize all groups') {
    collapseAllGroups();
    dash.getRange(1, 10).setValue('Actions');
    return;
  }
  if (action === 'Expand all groups') {
    expandAllGroups();
    dash.getRange(1, 10).setValue('Actions');
    return;
  }

  // Reset visibility, then re-apply the two stateful filters.
  dash.showRows(2, lastRow - 1);

  var values = dash.getRange(2, 1, lastRow - 1, 7).getValues();
  // Find all customer-row indices in the data array
  var custIdx = [];
  for (var i = 0; i < values.length; i++) {
    if (String(values[i][1] || '').indexOf('@') !== -1) custIdx.push(i);
  }

  // Customer-level filter (H1): hide whole customer sections
  if (custFilter === 'Owes a balance' || custFilter === 'Fully paid') {
    for (var k = 0; k < custIdx.length; k++) {
      var iC = custIdx[k];
      var custRow = iC + 2;
      var nextI = (k + 1 < custIdx.length) ? custIdx[k + 1] : values.length;
      var sectionLength = nextI - iC;
      var balance = Number(values[iC][6]) || 0;
      var keep =
        (custFilter === 'Owes a balance' && balance > 0) ||
        (custFilter === 'Fully paid'     && balance === 0);
      if (!keep) dash.hideRows(custRow, sectionLength);
    }
  }

  // Item-level filter (I1): hide individual tx rows whose status is paid
  if (itemFilter === 'Hide paid items') {
    for (var i = 0; i < values.length; i++) {
      var sheetRow = i + 2;
      // Skip rows already hidden by the customer filter (no harm to
      // hide twice but it's wasteful)
      if (dash.isRowHiddenByUser(sheetRow)) continue;
      var b = String(values[i][1] || '').trim();
      var a = String(values[i][0] || '').trim();
      if (b.indexOf('@') !== -1) continue;     // customer row
      if (a.toUpperCase() === 'DATE') continue; // sub-header
      if (!a) continue;
      var status = String(values[i][6] || '').toLowerCase().trim();
      if (status === 'paid') dash.hideRows(sheetRow, 1);
    }
  }
}

function repairAllSubHeaders() {
  var sh = getDashboardSheet();
  var lastRow = sh.getLastRow();
  if (lastRow < 2) return { repaired: 0, inserted: 0, alreadyOk: 0 };
  var values = sh.getRange(2, 1, lastRow - 1, 7).getValues();
  var repaired = 0, inserted = 0, alreadyOk = 0;
  // Walk top-to-bottom; row indices may shift as we insert, so re-read
  // values after any insert.
  var i = 0;
  while (i < values.length) {
    var sheetRow = i + 2;
    var b = String(values[i][1] || '').trim();
    if (b.indexOf('@') === -1) { i++; continue; }
    // It's a customer row. Inspect row below.
    var below = sheetRow + 1;
    var aBelow = String(sh.getRange(below, 1).getValue() || '').trim().toUpperCase();
    var gBelow = String(sh.getRange(below, 7).getValue() || '').trim().toUpperCase();
    if (aBelow === 'DATE' && gBelow === 'STATUS') {
      // Looks correct — also verify bg + style. Re-apply defensively.
      sh.getRange(below, 1, 1, 7)
        .setBackground('#4a6493')
        .setFontColor('#FFFFFF')
        .setFontWeight('bold')
        .setFontSize(10)
        .setHorizontalAlignment('left');
      alreadyOk++;
      i++;
      continue;
    }
    if (aBelow === 'DATE' && gBelow !== 'STATUS') {
      // Partial sub-header — clear validation on col G first (a stale
      // status dropdown rejects 'STATUS' as a value), then overwrite
      // values + style.
      sh.getRange(below, 7).clearDataValidations();
      sh.getRange(below, 1, 1, 7).setValues([['DATE', 'ITEM', 'UNIT PRICE', 'DAYS', 'WEEKS', 'TOTAL', 'STATUS']]);
      sh.getRange(below, 1, 1, 7)
        .setBackground('#4a6493')
        .setFontColor('#FFFFFF')
        .setFontWeight('bold')
        .setFontSize(10)
        .setHorizontalAlignment('left');
      repaired++;
      i++;
      continue;
    }
    // No sub-header below — insert one fresh
    appendSubHeaderRow(sheetRow);
    inserted++;
    // Re-read values so subsequent iterations see the inserted row
    lastRow = sh.getLastRow();
    values = sh.getRange(2, 1, lastRow - 1, 7).getValues();
    i++; // walk past customer; next iteration will land on the new sub-header (skipped)
  }
  return { repaired: repaired, inserted: inserted, alreadyOk: alreadyOk };
}

function resetAllRowGroups_(sheet) {
  const lastRow = sheet.getLastRow();
  if (lastRow < 2) return;
  // Walk every row in the data area; for any with depth > 0 remove all
  // groups at it. Repeat until no row reports a non-zero depth.
  // (Sheet.getRowGroupDepth(rowIndex) is the correct method — Range has
  //  no such accessor.)
  let safety = 20;
  while (safety-- > 0) {
    let anyRemoved = false;
    for (let row = 2; row <= lastRow; row++) {
      let depth = sheet.getRowGroupDepth(row);
      while (depth > 0) {
        const group = sheet.getRowGroup(row, depth);
        if (group) { group.remove(); anyRemoved = true; }
        depth--;
      }
    }
    if (!anyRemoved) return;
  }
}
