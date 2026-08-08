/** ─── Menu.gs ─────────────────────────────────────────────────────
 *  onOpen trigger: creates the Maintenance menu in the spreadsheet UI.
 *  Maintenance functions: Re-sort by email, Show debug log.
 *  Depends on: Configuration.gs, Helpers.gs, SheetWrites.gs
 */

// ─── onOpen ──────────────────────────────────────────────────────────
/**
 * Simple trigger — fires when the spreadsheet is opened.
 *
 * Scope intentionally narrow: just the "Billing" menu, and inside it
 * the manual-item add dialog (the high-frequency operator action). The
 * older bulk-status + re-sort helpers are still defined as functions
 * (bulkSetPaid, resortByEmail, etc.) and can be called from the script
 * editor, but they're not surfaced here.
 *
 * Status flips: select cells in col G + type the new status (or use the
 * dropdown). Multi-select + Ctrl+Enter still works for bulk flips.
 */
function onOpen() {
  buildAddItemMenu_();
}

/**
 * Build (or rebuild) the Add Item menu. The "Install 3 AM auto-heal"
 * row is omitted when the trigger on `dailyDashboardSelfHeal` already
 * exists for the current user — keeps the menu single-purpose after
 * setup. Calling .addToUi() with the same menu name replaces the
 * previous version, so this is safe to call mid-session (e.g. right
 * after the install succeeds).
 */
function buildAddItemMenu_() {
  var menu = SpreadsheetApp.getUi()
    .createMenu('Add Item')
    .addItem('+ New manual item', 'showAddManualItemDialog')
    .addSeparator()
    .addItem('Audit Dashboard (report only)', 'menu_auditDashboardReportOnly')
    .addItem('Repair Dashboard (full rebuild)', 'menu_repairDashboardBackground');
  if (!hasDailySelfHealTrigger_()) {
    menu.addSeparator()
        .addItem('Install 3 AM auto-heal trigger', 'menu_installDailySelfHeal');
  }
  menu.addToUi();
}

function hasDailySelfHealTrigger_() {
  try {
    var triggers = ScriptApp.getProjectTriggers();
    for (var i = 0; i < triggers.length; i++) {
      if (triggers[i].getHandlerFunction() === 'dailyDashboardSelfHeal') return true;
    }
  } catch (e) {
    // Permission issue — assume not installed so the option stays visible.
  }
  return false;
}

/**
 * Install (or re-install) the daily 3 AM self-heal trigger. One click.
 * Shows a UI alert with the resulting trigger ID + timezone so the
 * operator can confirm it landed in their account.
 */
function menu_installDailySelfHeal() {
  var ui = SpreadsheetApp.getUi();
  var result;
  try { result = installDailyDashboardSelfHealTrigger(); }
  catch (e) {
    ui.alert('Install failed: ' + (e && e.message || e));
    return;
  }
  // Rebuild the menu so the install entry disappears now that the
  // trigger is in place. No sheet reload needed.
  try { buildAddItemMenu_(); } catch (e) { /* not fatal — onOpen rebuilds next reload */ }
  ui.alert(
    'Daily self-heal installed',
    'Trigger handler: ' + result.handler + '\n' +
    'Fires daily at hour ' + result.hourOfDay + ' (' + result.timezone + ')\n' +
    'Trigger ID: ' + result.uniqueId + '\n' +
    '\n' +
    'Behavior at 3 AM:\n' +
    '  1. Audit: count ungrouped customers, malformed headers, balance errors.\n' +
    '  2. If any are non-zero, run nuclearResetBilling automatically.\n' +
    '  3. If everything is healthy, do nothing (silent).\n' +
    '\n' +
    'You will receive an email notification only when a repair was performed\n' +
    'or if the function crashes. Healthy days are silent.\n' +
    '\n' +
    'The install option will now hide from the Add Item menu.',
    ui.ButtonSet.OK
  );
}

/**
 * Read-only audit: counts groups, detects malformed customer headers
 * and ungrouped sections, shows one UI alert. No destructive action,
 * always completes well under the 6-min menu cap.
 */
function menu_auditDashboardReportOnly() {
  var ui = SpreadsheetApp.getUi();
  var ungrouped, malformed;
  try {
    ungrouped = findUngroupedCustomers_();
    malformed = findMalformedCustomerHeaders_();
  } catch (e) {
    ui.alert('Audit failed: ' + (e && e.message || e));
    return;
  }

  var lines = [];
  lines.push('Customer sections without row group: ' + ungrouped.length);
  ungrouped.slice(0, 10).forEach(function(u) {
    lines.push('  - Row ' + u.row + ': ' + (u.students || u.email || '(unknown)'));
  });
  if (ungrouped.length > 10) lines.push('  ... +' + (ungrouped.length - 10) + ' more');
  lines.push('');
  lines.push('Malformed customer headers (col B is not an email): ' + malformed.length);
  malformed.slice(0, 10).forEach(function(m) {
    lines.push('  - Row ' + m.row + ': "' + m.colA + '" | col B = "' + m.colB + '"');
  });
  if (malformed.length > 10) lines.push('  ... +' + (malformed.length - 10) + ' more');
  lines.push('');
  if (ungrouped.length === 0 && malformed.length === 0) {
    lines.push('Dashboard looks healthy.');
  } else {
    lines.push('To clean up: click "Repair Dashboard (full rebuild)".');
    lines.push('That schedules a background rebuild from source sheets — fixes');
    lines.push('balance formulas, row groups, and removes orphan rows that');
    lines.push('aren\'t in any source. Takes ~3-5 minutes.');
  }
  ui.alert('Dashboard audit', lines.join('\n'), ui.ButtonSet.OK);
}

/**
 * Schedule nuclearResetBilling as a one-time trigger ~10s out so the
 * rebuild runs with the 30-min trigger execution cap (vs 6 min for
 * direct menu invocations). Returns immediately — no risk of the menu
 * timing out. The Apps Script auto-deletes one-time triggers after
 * they fire, so no inventory bloat.
 */
function menu_repairDashboardBackground() {
  var ui = SpreadsheetApp.getUi();
  var resp = ui.alert(
    'Full Dashboard rebuild',
    'This will rebuild the entire Dashboard from source sheets in the\n' +
    'background (~3-5 minutes). Effects:\n' +
    '\n' +
    '  - All balance #N/A errors get fixed (SUMIFS ranges rewritten)\n' +
    '  - All customer row groups rebuilt cleanly\n' +
    '  - Orphan rows (not in any source sheet) are removed automatically\n' +
    '  - Paid/refunded/refund-needed statuses are preserved by fingerprint\n' +
    '\n' +
    'You can keep working in other tabs while it runs. Proceed?',
    ui.ButtonSet.YES_NO
  );
  if (resp !== ui.Button.YES) return;
  try {
    ScriptApp.newTrigger('nuclearResetBilling')
      .timeBased()
      .after(10 * 1000)
      .create();
  } catch (e) {
    ui.alert('Could not schedule rebuild: ' + (e && e.message || e));
    return;
  }
  ui.alert(
    'Rebuild scheduled',
    'Starts in ~10 seconds. Watch the Apps Script Executions tab for\n' +
    'progress. Dashboard will look temporarily empty mid-rebuild — that\'s\n' +
    'normal. Once it completes you can close this dialog and reload the\n' +
    'sheet.',
    ui.ButtonSet.OK
  );
}

/**
 * One-click audit + repair. Rebuilds row groups, finds malformed
 * customer headers + ungrouped customers, reports it all in a single
 * UI alert, and offers Yes/No deletion of any malformed sections.
 */
function menu_auditAndRepairDashboard() {
  var ui = SpreadsheetApp.getUi();

  // 1. Rebuild groups first — gives every healthy customer a clean
  //    toggle. Reports back how many it managed to do.
  var groupResult;
  try { groupResult = fixDashboardGroups(); }
  catch (e) {
    ui.alert('Group rebuild failed: ' + (e && e.message || e));
    return;
  }
  var rebuiltCount = (groupResult && groupResult.rebuilt) || 0;

  // 2. Look for customer sections that STILL don't have a depth-1
  //    group on their sub-header row. If readDashboardState_ couldn't
  //    detect a customer's boundaries cleanly, fixDashboardGroups
  //    would have skipped them silently — surface that.
  var ungrouped = findUngroupedCustomers_();

  // 3. Find malformed customer headers (look like a header by lookahead
  //    but col B isn't an email — usually data corruption).
  var malformed = findMalformedCustomerHeaders_();

  // Build the report
  var lines = [];
  lines.push('Row groups rebuilt for ' + rebuiltCount + ' customer section(s).');
  lines.push('');

  if (ungrouped.length === 0) {
    lines.push('OK: every detected customer section has a row group.');
  } else {
    lines.push('WARNING: ' + ungrouped.length + ' customer(s) still missing a group toggle:');
    ungrouped.slice(0, 12).forEach(function(u) {
      lines.push('  - Row ' + u.row + ': ' + (u.students || u.email || '(unknown)'));
    });
    if (ungrouped.length > 12) lines.push('  ... (+ ' + (ungrouped.length - 12) + ' more)');
  }
  lines.push('');

  if (malformed.length === 0) {
    lines.push('OK: no malformed customer headers detected.');
    ui.alert('Audit complete', lines.join('\n'), ui.ButtonSet.OK);
    return;
  }

  lines.push('Found ' + malformed.length + ' malformed customer header(s) (col B is not an email):');
  malformed.forEach(function(m) {
    lines.push('  - Row ' + m.row + ': "' + m.colA + '"  |  col B = "' + m.colB + '"');
  });
  lines.push('');
  lines.push('These are rows that LOOK like customer headers (sub-header below them) but col B contains a non-email value, usually a data-import mistake. Each row will be deleted along with its sub-header and any tx rows below it, up to the next real customer.');
  lines.push('');
  lines.push('Delete the malformed sections now?');

  var resp = ui.alert(
    'Audit + cleanup',
    lines.join('\n'),
    ui.ButtonSet.YES_NO
  );

  if (resp !== ui.Button.YES) {
    return;
  }

  // Delete in descending order so earlier row numbers stay valid.
  var dash = getDashboardSheet();
  var rowsToDelete = malformed.map(function(m) { return m.row; })
    .sort(function(a, b) { return b - a; });

  var totalRowsDeleted = 0;
  rowsToDelete.forEach(function(headerRow) {
    try {
      totalRowsDeleted += deleteMalformedCustomerSection_(dash, headerRow);
    } catch (e) {
      Logger.log('[menu_auditAndRepair] delete err row ' + headerRow + ': ' + e.message);
    }
  });

  // Rebuild groups one more time after deletion to refresh the toggles.
  var finalGroupResult;
  try { finalGroupResult = fixDashboardGroups(); } catch (e) {}
  var finalRebuilt = (finalGroupResult && finalGroupResult.rebuilt) || 0;

  ui.alert(
    'Cleanup complete',
    'Deleted ' + totalRowsDeleted + ' row(s) across ' + rowsToDelete.length + ' malformed section(s).\n' +
    'Final row group count: ' + finalRebuilt + ' customer section(s).',
    ui.ButtonSet.OK
  );
}

/**
 * Scan the Dashboard for rows that LOOK like a customer header
 * (i.e., the very next row is a sub-header — DATE in col A, STATUS in
 * col G) but col B is missing the '@' sign that a valid email would
 * have. These are data-corruption candidates.
 *
 * Returns an array of {row, colA, colB}.
 */
function findMalformedCustomerHeaders_() {
  var dash = getDashboardSheet();
  var lastRow = dash.getLastRow();
  if (lastRow < 3) return [];
  var values = dash.getRange(2, 1, lastRow - 1, 7).getValues();
  var out = [];
  for (var i = 0; i < values.length; i++) {
    var row = values[i];
    var sheetRow = i + 2;
    var a = String(row[0] || '').trim();
    var b = String(row[1] || '').trim();
    if (!a) continue;                              // blank — not a header
    if (a.toUpperCase() === 'DATE') continue;      // sub-header itself
    if (b.indexOf('@') !== -1) continue;           // healthy header
    if (i + 1 >= values.length) continue;          // no row after — can't be a header
    var next = values[i + 1];
    var nextIsSubHeader = (String(next[0] || '').toUpperCase() === 'DATE' &&
                           String(next[6] || '').toUpperCase() === 'STATUS');
    if (!nextIsSubHeader) continue;
    out.push({ row: sheetRow, colA: a, colB: b });
  }
  return out;
}

/**
 * For each customer detected by readDashboardState_, check whether
 * the sub-header row is actually at row-group depth >= 1. Returns
 * a list of customers where fixDashboardGroups failed silently or
 * was skipped (no sub-header / no tx rows).
 */
function findUngroupedCustomers_() {
  var state = readDashboardState_();
  var dash = getDashboardSheet();
  var out = [];
  Object.keys(state.customers).forEach(function(email) {
    var c = state.customers[email];
    if (!c.subHeaderRow || !c.txLast || c.txLast < c.subHeaderRow) return;
    try {
      var depth = dash.getRowGroupDepth(c.subHeaderRow);
      if (depth < 1) {
        out.push({
          email:    email,
          row:      c.customerRow,
          students: String(c.students || '').trim()
        });
      }
    } catch (e) { /* ignore */ }
  });
  return out;
}

/**
 * Delete a malformed customer header row PLUS its sub-header (if
 * present at +1) plus any "tx rows" below until the next valid
 * customer header. Conservative: returns the total row count deleted.
 *
 * The "next valid header" detection mirrors readDashboardState_'s
 * lookahead logic — col B has '@' OR the row after is a sub-header.
 */
function deleteMalformedCustomerSection_(dash, headerRow) {
  var lastRow = dash.getLastRow();
  if (headerRow > lastRow) return 0;

  var endRow = headerRow;  // at minimum, delete just the header
  if (headerRow + 1 <= lastRow) {
    var tail = dash.getRange(headerRow + 1, 1, lastRow - headerRow, 7).getValues();
    for (var i = 0; i < tail.length; i++) {
      var row = tail[i];
      var realRow = headerRow + 1 + i;
      var a = String(row[0] || '').trim();
      var b = String(row[1] || '').trim();

      var isSubHeader = (a.toUpperCase() === 'DATE' &&
                         String(row[6] || '').toUpperCase() === 'STATUS');
      if (isSubHeader) { endRow = realRow; continue; }

      // Lookahead: does THIS row look like the NEXT customer header?
      var nextNextIsSubHeader = false;
      if (i + 1 < tail.length) {
        var nn = tail[i + 1];
        nextNextIsSubHeader = (String(nn[0] || '').toUpperCase() === 'DATE' &&
                               String(nn[6] || '').toUpperCase() === 'STATUS');
      }
      var thisRowIsNextCustomerHeader = (!isSubHeader && (b.indexOf('@') !== -1 || nextNextIsSubHeader));
      if (thisRowIsNextCustomerHeader) break;  // stop — leave the next customer alone

      // Otherwise: this is a tx-or-trailing row of the malformed section
      endRow = realRow;
    }
  }

  var count = endRow - headerRow + 1;
  dash.deleteRows(headerRow, count);
  return count;
}

// ─── maintenanceRefreshNow ───────────────────────────────────────────────────────────────────
function maintenanceRefreshNow() {
  pollFloridaSubmissions();
  const summary = PropertiesService.getScriptProperties().getProperty('lastPollSummary');
  SpreadsheetApp.getUi().alert(summary || 'No poll summary available yet.');
}

// ─── maintenanceShowPollStatus ─────────────────────────────────────────────────────────
function maintenanceShowPollStatus() {
  const props = PropertiesService.getScriptProperties();
  const lastPolledAt    = props.getProperty('lastPolledAt')    || '(never)';
  const lastPollSummary = props.getProperty('lastPollSummary') || '(none)';
  const html = HtmlService.createHtmlOutput(
    '<pre style="font-family:monospace;font-size:12px;line-height:1.6;">' +
    'Last polled at:  ' + lastPolledAt    + '\n' +
    'Last summary:    ' + lastPollSummary + '\n' +
    '</pre>' +
    '<p>For per-submission detail, see the <b>Logs</b> sheet.</p>'
  ).setWidth(620).setHeight(200);
  SpreadsheetApp.getUi().showModalDialog(html, 'Poll Status');
}

// ─── resortByEmail ────────────────────────────────────────────────────────────
/**
 * Reads all customer groups, sorts alphabetically by email, re-writes
 * the Dashboard in sorted order, and re-applies groupings + balance formulas.
 */
function resortByEmail() {
  const sh = getDashboardSheet();
  const lastRow = sh.getLastRow();

  if (lastRow <= 1) {
    SpreadsheetApp.getUi().alert('Nothing to sort — sheet is empty.');
    return;
  }

  // ── 1. Read all customer groups into an array ──────────────────────────────
  const groups = [];
  let i = 2;
  while (i <= lastRow) {
    const colB = String(sh.getRange(i, COL.EMAIL_OR_ITEM).getValue() || '').trim();
    // Customer row: col B contains "@"
    if (!colB.includes('@')) { i++; continue; }

    const custData   = sh.getRange(i, 1, 1, 7).getValues()[0];
    const custFormulas = sh.getRange(i, 1, 1, 7).getFormulas()[0];
    const custBg     = sh.getRange(i, 1, 1, 7).getBackgrounds()[0];
    const custFonts  = sh.getRange(i, 1, 1, 7).getFontWeights()[0];

    // Sub-header row (always customerRow + 1)
    let subHeaderData     = sh.getRange(i + 1, 1, 1, 7).getValues()[0];
    let subHeaderFormulas = sh.getRange(i + 1, 1, 1, 7).getFormulas()[0];
    let subHeaderBg       = sh.getRange(i + 1, 1, 1, 7).getBackgrounds()[0];
    // If no real sub-header exists (flat customer), supply canonical values
    if ((subHeaderData[0] !== 'Date' && subHeaderData[0] !== 'DATE')) {
      subHeaderData     = ['DATE', 'ITEM', 'UNIT PRICE', 'DAYS', 'WEEKS', 'TOTAL', 'STATUS'];
      subHeaderFormulas = ['', '', '', '', '', '', ''];
      subHeaderBg       = ['#EFEFEF', '#EFEFEF', '#EFEFEF', '#EFEFEF', '#EFEFEF', '#EFEFEF', '#EFEFEF'];
    }

    // Tx rows
    const { firstTx, lastTx } = findCustomerTxRange(i);
    const txRows = [];
    for (let r = firstTx; r <= lastTx; r++) {
      txRows.push({
        values:   sh.getRange(r, 1, 1, 7).getValues()[0],
        formulas: sh.getRange(r, 1, 1, 7).getFormulas()[0],
        bgs:      sh.getRange(r, 1, 1, 7).getBackgrounds()[0]
      });
    }

    // Extract profileUrl from E cell formula
    const profileUrl = extractProfileUrlFromCell(i);

    groups.push({
      email:        colB.toLowerCase(),
      custData, custFormulas, custBg, custFonts,
      subHeaderData, subHeaderFormulas, subHeaderBg,
      txRows,
      profileUrl,
      totalRows: (lastTx >= firstTx) ? (lastTx - i + 1) : 2
    });

    i = Math.max(lastTx + 1, i + 2); // advance past this group
  }

  if (groups.length === 0) {
    SpreadsheetApp.getUi().alert('No customer rows found.');
    return;
  }

  // ── 2. Sort alphabetically by email ───────────────────────────────────────
  groups.sort(function(a, b) { return a.email < b.email ? -1 : a.email > b.email ? 1 : 0; });

  // ── 3. Clear data area ────────────────────────────────────────────────────
  // === Clean-slate row group reset over the data area ===
  resetAllRowGroups_(sh);
  sh.deleteRows(2, lastRow - 1);

  // — 4. Re-write groups ————————————————————————————————
  let writeRow = 2;
  groups.forEach(function(g) {
    // Write customer row data (preserves saved values incl. student names)
    sh.getRange(writeRow, 1, 1, 7).setValues([g.custData]);
    // Brand styling: dark blue bg, white text, bold, size 12
    const custRange = sh.getRange(writeRow, 1, 1, 7);
    custRange.setBackground('#143980');
    custRange.setFontColor('#FFFFFF');
    custRange.setFontWeight('bold');
    custRange.setFontSize(12);
    custRange.setHorizontalAlignment('left');
    // Col F: underline for profile link
    sh.getRange(writeRow, COL.CONTACT_OR_TOTAL).setFontLine('underline');
    const custRow = writeRow;

    // Write sub-header row
    sh.getRange(custRow + 1, 1, 1, 7).setValues([g.subHeaderData]);
    // Brand styling: mid-blue bg, white text, bold, size 10
    const subHRange = sh.getRange(custRow + 1, 1, 1, 7);
    subHRange.setBackground('#4a6493');
    subHRange.setFontColor('#FFFFFF');
    subHRange.setFontWeight('bold');
    subHRange.setFontSize(10);
    subHRange.setHorizontalAlignment('left');

    // Write tx rows
    let txRow = custRow + 2;
    g.txRows.forEach(function(tx) {
      sh.getRange(txRow, 1, 1, 7).setValues([tx.values]);
      sh.getRange(txRow, 1, 1, 7).setBackgrounds([tx.bgs]);
      // Re-apply formula if present (col F = totalFormula)
      if (tx.formulas[5]) sh.getRange(txRow, 6).setFormula(tx.formulas[5]);
      applyStatusDropdown(txRow);
      // Alignment for tx rows
      sh.getRange(txRow, 1, 1, 7).setFontSize(11).setFontColor(null);
      sh.getRange(txRow, COL.CONTACT_OR_TOTAL).setHorizontalAlignment('right');  // Total
      sh.getRange(txRow, COL.BALANCE_OR_STATUS).setHorizontalAlignment('left');  // Status
      txRow++;
    });

    const lastTxRow = txRow - 1;

    // — 5. Re-apply balance formula with corrected ranges ————————————
    updateBalanceFormula(custRow, g.profileUrl);

    // — 6. Re-apply row grouping ————————————————————————————————
    if (lastTxRow >= custRow + 2) {
      applyRowGrouping(custRow + 1, lastTxRow);
    }

    // Set group expansion based on balance
    const balanceVal = sh.getRange(custRow, COL.BALANCE_OR_STATUS).getValue();
    const numericBalance = typeof balanceVal === 'number' ? balanceVal : 0;
    if (lastTxRow >= custRow + 2) {
      setGroupExpansion(custRow + 1, numericBalance > 0);
    }

    writeRow = lastTxRow + 1;
  });

  SpreadsheetApp.getUi().alert('Re-sorted ' + groups.length + ' customer(s) by email.');
}


// ─── maintenanceForceRefreshRegistry ──────────────────────────────────────────
/**
 * Maintenance menu: Force-refreshes the field registry from GHL.
 */
function maintenanceForceRefreshRegistry() {
  refreshFieldRegistry('Florida');
  SpreadsheetApp.getUi().alert('Field registry refreshed for Florida.');
}

// ─── reprocessLeadOnlySubmissions ───────────────────────────────────────────
/**
 * Reads the Logs sheet, finds all rows where status='lead_only' with a real
 * submission_id (not '(poll)'), parses rawPayload back into a submission object,
 * and calls processSubmission() to reprocess each.
 *
 * The deduplication in processSubmission will skip ones that were previously
 * processed, but lead_only rows (no tx rows written) will get reprocessed.
 *
 * DO NOT auto-run. Exposed via Maintenance menu. Erin can run after Stage 7 ships.
 */
function reprocessLeadOnlySubmissions() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const logsSheet = ss.getSheetByName('Logs');
  if (!logsSheet) {
    SpreadsheetApp.getUi().alert('Logs sheet not found.');
    return;
  }

  const data = logsSheet.getDataRange().getValues();
  if (data.length < 2) {
    SpreadsheetApp.getUi().alert('No log entries found.');
    return;
  }

  // Find the column-header row by looking for 'Timestamp' in col A.
  // Tolerant of the pricing-syntax banner row that now sits in row 1.
  let headerRowIdx = data.findIndex(function(r) {
    return String(r[0] || '').trim().toLowerCase() === 'timestamp';
  });
  if (headerRowIdx === -1) headerRowIdx = 0;  // legacy layout (no banner)
  const headers = data[headerRowIdx].map(function(h) { return String(h).toLowerCase().trim(); });
  const colStatus    = headers.indexOf('status');
  const colSubId     = headers.indexOf('submission_id');
  const colPayload   = headers.indexOf('raw_payload');

  if (colStatus === -1 || colSubId === -1 || colPayload === -1) {
    SpreadsheetApp.getUi().alert('Logs sheet missing expected columns (status, submission_id, raw_payload).');
    return;
  }

  let reprocessed = 0, skipped = 0, failed = 0;
  const errors = [];

  for (let i = headerRowIdx + 1; i < data.length; i++) {
    const row = data[i];
    const status  = String(row[colStatus] || '').trim().toLowerCase();
    const subId   = String(row[colSubId]  || '').trim();
    const payload = String(row[colPayload] || '').trim();

    // Only reprocess lead_only rows with a real submission ID
    if (status !== 'lead_only' || !subId || subId === '(poll)') {
      skipped++;
      continue;
    }
    if (!payload || payload === 'undefined') {
      skipped++;
      continue;
    }

    try {
      const submission = JSON.parse(payload);
      // Clear the seen-IDs cache for this submission so it gets reprocessed
      // (processSubmission dedupe uses PropertiesService — we bypass by resetting seen set)
      // Actually: since this was lead_only (no rows written), the submissionId IS in the
      // seen set. We need to temporarily remove it so it gets reprocessed.
      const props = PropertiesService.getScriptProperties();
      const seenKey = 'seenSubmissions';
      let seenRaw = props.getProperty(seenKey);
      if (seenRaw) {
        const seenArr = JSON.parse(seenRaw);
        const filtered = seenArr.filter(function(id) { return id !== subId; });
        props.setProperty(seenKey, JSON.stringify(filtered));
      }

      const result = processSubmission(submission);
      if (result === 'processed') {
        reprocessed++;
      } else if (result === 'duplicate') {
        skipped++;
      } else {
        failed++;
        errors.push(subId + ': ' + result);
      }
    } catch (e) {
      failed++;
      errors.push(subId + ': ' + e.message);
    }
  }

  const summary = 'Reprocess complete:\n' +
    '  Reprocessed: ' + reprocessed + '\n' +
    '  Skipped:     ' + skipped    + '\n' +
    '  Failed:      ' + failed;
  Logger.log('[reprocessLeadOnly] ' + summary);
  if (errors.length > 0) {
    Logger.log('[reprocessLeadOnly] Errors: ' + errors.join(', '));
  }
  SpreadsheetApp.getUi().alert(summary + (errors.length > 0 ? '\n\nErrors:\n' + errors.slice(0, 5).join('\n') : ''));
}


// ─── bulkSetStatus ──────────────────────────────────────────────
/**
 * Set all tx rows of the currently-selected customer to a given status.
 * The selected cell can be on the customer row, sub-header, or any tx row.
 * @param {string} newStatus  'paid' | 'owed' | 'canceled' | 'refunded'
 */
function bulkSetStatus(newStatus) {
  const dashSheet = getDashboardSheet();
  const activeRow = dashSheet.getActiveRange().getRow();

  // Walk up to find the owning customer row
  const customerRow = findOwningCustomerRow(activeRow);
  if (!customerRow) {
    SpreadsheetApp.getUi().alert(
      'Click any cell inside a customer group (customer row, sub-header, or ' +
      'a tx row) before choosing this menu item.');
    return;
  }

  const range = findCustomerTxRange(customerRow);
  if (!range || range.lastTx < range.firstTx) {
    SpreadsheetApp.getUi().alert('This customer has no transaction rows yet.');
    return;
  }

  // Set col G (COL.BALANCE_OR_STATUS = STATUS) for every tx row
  const numRows = range.lastTx - range.firstTx + 1;
  const statusRange = dashSheet.getRange(range.firstTx, COL.BALANCE_OR_STATUS, numRows, 1);
  const values = Array.from({length: numRows}, function() { return [newStatus]; });
  statusRange.setValues(values);

  // Recompute balance — don't touch expand state; keep user's current view.
  updateBalanceFormula(customerRow, null);
  try { refreshBalanceNoteForCustomer(customerRow); } catch (e) {}

  SpreadsheetApp.getUi().alert('Set ' + numRows + ' tx row(s) to "' + newStatus + '" for this customer.');
}

function bulkSetPaid()     { bulkSetStatus('paid');     }
function bulkSetOwed()     { bulkSetStatus('owed');     }
function bulkSetCanceled() { bulkSetStatus('canceled'); }
function bulkSetRefunded() { bulkSetStatus('refunded'); }

// ─── bulkSetSelectedStatus ──────────────────────────────────────
/**
 * Nice-to-have #6: set status on every selected cell in col G that
 * belongs to a tx row. Supports multi-cell + multi-range selections
 * across multiple customers.
 * @param {string} newStatus  'paid' | 'owed' | 'canceled' | 'refunded'
 */
function bulkSetSelectedStatus(newStatus) {
  const sh = getDashboardSheet();
  const ui = SpreadsheetApp.getUi();
  const ranges = sh.getActiveRangeList();
  if (!ranges) { ui.alert('Select one or more cells first.'); return; }

  const allRanges = ranges.getRanges();
  const touchedTxRows = [];
  const touchedCustomers = new Set();

  for (let r = 0; r < allRanges.length; r++) {
    const range = allRanges[r];
    const startRow = range.getRow();
    const numRows = range.getNumRows();
    for (let i = 0; i < numRows; i++) {
      const sheetRow = startRow + i;
      // Inspect what kind of row this is via col A + col B values
      const a = String(sh.getRange(sheetRow, 1).getValue() || '').trim();
      const b = String(sh.getRange(sheetRow, 2).getValue() || '').trim();
      // Skip header (row 1), customer rows (col B has @), sub-headers (col A == DATE)
      if (sheetRow === 1) continue;
      if (b.indexOf('@') !== -1) continue;
      if (a.toUpperCase() === 'DATE') continue;
      if (!a) continue; // blank
      // Looks like a tx row — set its status
      sh.getRange(sheetRow, COL.BALANCE_OR_STATUS).setValue(newStatus);
      touchedTxRows.push(sheetRow);
      const owner = findOwningCustomerRow(sheetRow);
      if (owner) touchedCustomers.add(owner);
    }
  }

  if (!touchedTxRows.length) {
    ui.alert('No tx rows in your selection. Select status cells (col G) on transaction rows.');
    return;
  }

  // Recompute balance + refresh copy-pasteable Note for every customer
  // touched. Preserve current expand/collapse state.
  touchedCustomers.forEach(function(customerRow) {
    updateBalanceFormula(customerRow, null);
    try { refreshBalanceNoteForCustomer(customerRow); } catch (e) {}
  });

  ui.alert('Set ' + touchedTxRows.length + ' tx cell(s) to "' + newStatus +
           '" across ' + touchedCustomers.size + ' customer(s).');
}

function bulkSetSelectedPaid()     { bulkSetSelectedStatus('paid');     }
function bulkSetSelectedOwed()     { bulkSetSelectedStatus('owed');     }
function bulkSetSelectedCanceled() { bulkSetSelectedStatus('canceled'); }
function bulkSetSelectedRefunded() { bulkSetSelectedStatus('refunded'); }
