/**
 * Stage 1 Setup — Build the Dashboard sheet structure.
 * Run this once (or re-run) to create/reset headers, formatting,
 * column widths, filters, and conditional formatting rules.
 */
function setupDashboard() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const DASH = 'Dashboard';

  // 1. Delete any existing Dashboard sheet, plus all other sheets
  //    We need at least 1 sheet at all times, so create a temp sheet first
  const tempSheet = ss.insertSheet('__temp__');
  
  // Delete all other sheets (including any previous Dashboard)
  for (const sh of ss.getSheets()) {
    if (sh.getName() !== '__temp__') {
      ss.deleteSheet(sh);
    }
  }

  // Create Dashboard
  const dashSheet = ss.insertSheet(DASH);
  
  // Delete temp
  ss.deleteSheet(tempSheet);

  // 2. Set headers in row 1
  const headers = [['Name', 'Email', 'Phone', 'Waiver Origin', 'Balance', '', '']];
  dashSheet.getRange(1, 1, 1, 7).setValues(headers);

  // 3. Freeze row 1
  dashSheet.setFrozenRows(1);

  // 4. Style header row: bold, font size 11, dark blue-grey bg (#0F3634), white text
  const headerRange = dashSheet.getRange(1, 1, 1, 7);
  headerRange.setFontWeight('bold');
  headerRange.setFontSize(11);
  headerRange.setBackground('#0F3634');
  headerRange.setFontColor('#FFFFFF');

  // 5. Set column widths (in pixels)
  dashSheet.setColumnWidth(1, 180); // A: Name
  dashSheet.setColumnWidth(2, 220); // B: Email
  dashSheet.setColumnWidth(3, 140); // C: Phone
  dashSheet.setColumnWidth(4, 130); // D: Waiver Origin
  dashSheet.setColumnWidth(5, 130); // E: Balance
  dashSheet.setColumnWidth(6, 110); // F
  dashSheet.setColumnWidth(7, 130); // G

  // 6. Format col E and F as currency (USD)
  const currencyFormat = '"$"#,##0.00';
  dashSheet.getRange('E2:E1000').setNumberFormat(currencyFormat);
  dashSheet.getRange('F2:F1000').setNumberFormat(currencyFormat);

  // 7. Add filter on A1:G1
  dashSheet.getRange('A1:G1').createFilter();

  // 8. Conditional formatting rules
  // ConditionalFormatRuleBuilder supports: setBackground, setFontColor, setBold, setItalic
  const cfRange = dashSheet.getRange('A2:G1000');

  // Rule 1 — Customer rows (col B has "@", col A non-empty, col A != "Date")
  const rule1 = SpreadsheetApp.newConditionalFormatRule()
    .whenFormulaSatisfied('=AND($B2<>"", REGEXMATCH($B2, "@"), $A2<>"Date")')
    .setBackground('#EEF3F8')
    .setBold(true)
    .setRanges([cfRange])
    .build();

  // Rule 2 — Sub-header rows (col A = "Date")
  const rule2 = SpreadsheetApp.newConditionalFormatRule()
    .whenFormulaSatisfied('=$A2="Date"')
    .setBackground('#D5DCE5')
    .setFontColor('#FFFFFF')
    .setBold(true)
    .setRanges([cfRange])
    .build();

  // Rule 3 — Tx row paid (col G = "paid")
  const rule3 = SpreadsheetApp.newConditionalFormatRule()
    .whenFormulaSatisfied('=$G2="paid"')
    .setBackground('#E0F4E5')
    .setRanges([cfRange])
    .build();

  // Rule 4 — Tx row canceled (col G = "canceled")
  const rule4 = SpreadsheetApp.newConditionalFormatRule()
    .whenFormulaSatisfied('=$G2="canceled"')
    .setBackground('#FCE4E4')
    .setFontColor('#D8453D')
    .setRanges([cfRange])
    .build();

  // Rule 5 — Tx row refunded (col G = "refunded")
  const rule5 = SpreadsheetApp.newConditionalFormatRule()
    .whenFormulaSatisfied('=$G2="refunded"')
    .setBackground('#FFE5CC')
    .setFontColor('#D8453D')
    .setRanges([cfRange])
    .build();

  dashSheet.setConditionalFormatRules([rule1, rule2, rule3, rule4, rule5]);

  Logger.log('setupDashboard complete.');
  return 'Dashboard sheet created successfully.';
}


// ─── Temporary setup wrappers (run-once, safe to keep) ───────────────
function runSetupInvoiceColumns() { setupInvoiceColumns_(); }
function runInstallInvoiceTrigger() { installInvoiceTrigger_(); }
