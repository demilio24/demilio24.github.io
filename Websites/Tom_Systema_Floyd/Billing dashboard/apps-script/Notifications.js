/** -- Notifications.gs ----------------------------------
 *  Error notification infrastructure with 1-hour email throttle.
 *  Always logs to Logs sheet; throttles email per (severity+subject).
 *  Depends on: SheetWrites.gs (logEvent)
 */

var NOTIFY_EMAIL = 'emilio@nilsdigital.com';
var THROTTLE_WINDOW_MS = 60 * 60 * 1000;

// ------------------------------------------------------------------
function notifyError(severity, subject, body, opts) {
  opts = opts || {};
  severity = String(severity || 'info');
  subject = String(subject || '(no subject)');
  body = String(body || '');
  var ts = new Date().toISOString();
  var ssUrl = '';
  try { ssUrl = SpreadsheetApp.getActiveSpreadsheet().getUrl(); } catch(e_) {}

  // Always log to Logs sheet regardless of throttle
  try {
    logEvent({
      timestamp:    ts,
      submissionId: '(system)',
      email:        '',
      status:       severity === 'critical' ? 'poll_error' : 'failed',
      details:      '[' + severity.toUpperCase() + '] ' + subject + ': ' + body.substring(0, 300),
      rawPayload:   opts.rawPayload ? String(opts.rawPayload).substring(0, 500) : ''
    });
  } catch (logErr) {
    Logger.log('[notifyError] logEvent failed: ' + logErr.message);
  }

  // Throttle: skip email if same (severity+subject) sent within 1 hour
  var key = 'ntfy_' + (severity + '_' + subject).replace(/[^A-Za-z0-9_]/g, '_').substring(0, 64);
  var props = PropertiesService.getScriptProperties();
  var lastMs = parseInt(props.getProperty(key) || '0', 10);
  var nowMs = Date.now();
  if ((nowMs - lastMs) < THROTTLE_WINDOW_MS) {
    Logger.log('[notifyError] throttled: ' + severity + ' / ' + subject);
    return;
  }

  // Build email body as array-join to avoid embedded newline issues
  var badgeMap = { critical: '[CRITICAL]', warning: '[WARNING]', info: '[INFO]' };
  var badge = badgeMap[severity] || '[' + severity.toUpperCase() + ']';
  var bodyParts = [
    badge + ' ' + subject,
    '',
    'Time: ' + ts,
    'Sheet: ' + ssUrl,
    '',
    '=== Details ===',
    body.substring(0, 1000),
    ''
  ];
  if (opts.rawPayload) {
    bodyParts.push('=== Raw Payload (excerpt) ===');
    bodyParts.push(String(opts.rawPayload).substring(0, 500));
  }
  var emailBody = bodyParts.join('\n');

  try {
    MailApp.sendEmail({
      to:      NOTIFY_EMAIL,
      subject: '[SystemaFloyd] ' + badge + ' ' + subject,
      body:    emailBody
    });
    props.setProperty(key, String(nowMs));
    Logger.log('[notifyError] sent: ' + severity + ' / ' + subject);
  } catch (mailErr) {
    Logger.log('[notifyError] MailApp failed: ' + mailErr.message);
  }
}

// ------------------------------------------------------------------
function dailyHealthCheck() {
  var props = PropertiesService.getScriptProperties();
  var lastPolledAt = props.getProperty('lastPolledAt');

  if (!lastPolledAt) {
    notifyError('critical', 'Polling has NEVER run',
      'lastPolledAt not set. Run installPollingTrigger() from Apps Script editor.', {});
    return;
  }

  var ageMs = (Date.now() - new Date(lastPolledAt).getTime());
  var ageMins = ageMs / 60000;
  Logger.log('[dailyHealthCheck] age=' + ageMins.toFixed(1) + ' min');

  if (ageMins > 30) {
    var summary = props.getProperty('lastPollSummary') || '(none)';
    notifyError('critical', 'Polling appears to have stopped',
      'Last poll was ' + ageMins.toFixed(1) + ' min ago (threshold: 30). ' +
      'Last summary: ' + summary + '. ' +
      'ACTION: check Triggers panel in Apps Script editor.',
      { rawPayload: JSON.stringify({ lastPolledAt: lastPolledAt, ageMinutes: ageMins.toFixed(1) }) });
  } else {
    Logger.log('[dailyHealthCheck] PASS - ' + ageMins.toFixed(1) + ' min ago');
  }

  if (!SpreadsheetApp.getActiveSpreadsheet().getSheetByName('Logs')) {
    notifyError('warning', 'Logs sheet missing',
      'Run Maintenance > Setup Logs Sheet to recreate.', {});
  }
}

// ------------------------------------------------------------------
function installDailyHealthCheckTrigger() {
  ScriptApp.getProjectTriggers().forEach(function(t) {
    if (t.getHandlerFunction() === 'dailyHealthCheck') ScriptApp.deleteTrigger(t);
  });
  var t = ScriptApp.newTrigger('dailyHealthCheck').timeBased().atHour(9).everyDays(1).create();
  Logger.log('[installDailyHealthCheckTrigger] installed: ' + t.getUniqueId());
}

// ------------------------------------------------------------------
/**
 * Daily self-heal at 3 AM (script timezone = America/Chicago).
 *
 * 1. Audit the Dashboard: ungrouped customers, malformed headers,
 *    #N/A / #REF / #ERROR / #VALUE in the Balance column.
 * 2. If any of the above is non-zero, run nuclearResetBilling — which
 *    re-renders the entire Dashboard from sources (reg sheets + Manual
 *    Items + form-submission sheets), rewrites SUMIFS ranges, and
 *    rebuilds row groups. Paid / refunded statuses preserved by
 *    fingerprint.
 * 3. If everything is healthy, return without touching anything.
 *
 * Fires email via notifyError() only when a repair was performed or
 * when the function itself crashed — silent in the healthy case so it
 * doesn't become noise.
 */
function dailyDashboardSelfHeal() {
  var startedAt = new Date();
  Logger.log('[dailyDashboardSelfHeal] start at ' + startedAt.toISOString());

  try {
    var ungrouped = findUngroupedCustomers_();
    var malformed = findMalformedCustomerHeaders_();

    // Balance error scan: #N/A, #REF, #ERROR, #VALUE in col G across
    // the data area. Strong indicator of busted SUMIFS ranges, which
    // is exactly what nuclearResetBilling rewrites.
    var dash = getDashboardSheet();
    var lastRow = dash.getLastRow();
    var balanceErrors = 0;
    if (lastRow >= 2) {
      var balDisplay = dash.getRange(2, 7, lastRow - 1, 1).getDisplayValues();
      balDisplay.forEach(function(r) {
        var v = String(r[0] || '');
        if (v.indexOf('#N/A')   !== -1 || v.indexOf('#REF')   !== -1 ||
            v.indexOf('#ERROR') !== -1 || v.indexOf('#VALUE') !== -1) {
          balanceErrors++;
        }
      });
    }

    var summary = 'ungrouped=' + ungrouped.length +
                  ', malformed=' + malformed.length +
                  ', balanceErrors=' + balanceErrors;
    Logger.log('[dailyDashboardSelfHeal] audit: ' + summary);

    var needsRepair = (ungrouped.length > 0 || malformed.length > 0 || balanceErrors > 0);
    if (!needsRepair) {
      Logger.log('[dailyDashboardSelfHeal] dashboard healthy — no action');
      return { ok: true, didRepair: false, summary: summary };
    }

    Logger.log('[dailyDashboardSelfHeal] issues detected — running nuclearResetBilling');
    nuclearResetBilling();
    Logger.log('[dailyDashboardSelfHeal] nuclear reset complete');

    // Inform the operator that the self-heal ran. notifyError throttles
    // on (severity, subject) so daily repairs won't spam.
    try {
      notifyError('info', 'Dashboard self-heal: nuclear reset ran',
        'Audit found: ' + summary + '. Nuclear reset completed cleanly.',
        { rawPayload: JSON.stringify({
            ungrouped: ungrouped, malformed: malformed, balanceErrors: balanceErrors
          })
        });
    } catch (e) {
      Logger.log('[dailyDashboardSelfHeal] notify failed: ' + e.message);
    }

    return { ok: true, didRepair: true, summary: summary };
  } catch (e) {
    Logger.log('[dailyDashboardSelfHeal] FAILED: ' + e.message + '\n' + (e.stack || ''));
    try {
      notifyError('critical', 'Dashboard self-heal CRASHED',
        e.message + '\n' + (e.stack || ''), {});
    } catch (e2) { /* swallow notifier-of-notifier failure */ }
    return { ok: false, error: e.message };
  }
}

// ------------------------------------------------------------------
/**
 * (Re)install the 3 AM daily self-heal trigger. Idempotent — wipes any
 * existing trigger on dailyDashboardSelfHeal first, then installs one
 * fresh. Run as `emilio@nilsdigital.com` so it inherits the Workspace
 * 100K UrlFetch quota instead of the free 20K.
 */
function installDailyDashboardSelfHealTrigger() {
  ScriptApp.getProjectTriggers().forEach(function(t) {
    if (t.getHandlerFunction() === 'dailyDashboardSelfHeal') ScriptApp.deleteTrigger(t);
  });
  var t = ScriptApp.newTrigger('dailyDashboardSelfHeal')
    .timeBased().everyDays(1).atHour(3).create();
  Logger.log('[installDailyDashboardSelfHealTrigger] installed: ' + t.getUniqueId());
  return {
    ok: true,
    handler: 'dailyDashboardSelfHeal',
    uniqueId: t.getUniqueId(),
    hourOfDay: 3,
    timezone: Session.getScriptTimeZone()
  };
}

// ------------------------------------------------------------------
function testNotificationEmail() {
  var subject = 'Test - system operational';
  var key = 'ntfy_' + ('info_' + subject).replace(/[^A-Za-z0-9_]/g, '_').substring(0, 64);
  PropertiesService.getScriptProperties().deleteProperty(key);
  notifyError('info', subject,
    'Test from Systema Floyd Billing Dashboard QA pass. ' +
    'If received: notifications are working. Sent at: ' + new Date().toISOString(),
    { rawPayload: '{"test":true}' });
  Logger.log('[testNotificationEmail] dispatched to ' + NOTIFY_EMAIL);
}
// ------------------------------------------------------------------
// ONE-TIME: Create Operations Manual Google Doc in same Drive folder
function createOpsDoc() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var ssFile = DriveApp.getFileById(ss.getId());
  var parents = ssFile.getParents();
  var folder = parents.hasNext() ? parents.next() : DriveApp.getRootFolder();

  var docTitle = 'Systema Floyd Billing -- Operations Manual (post-QA)';
  var doc = DocumentApp.create(docTitle);
  var docFile = DriveApp.getFileById(doc.getId());
  // Move to same folder as spreadsheet
  folder.addFile(docFile);
  DriveApp.getRootFolder().removeFile(docFile);

  var body = doc.getBody();
  body.clear();

  // Helper to add heading
  function h1(text) {
    var p = body.appendParagraph(text);
    p.setHeading(DocumentApp.ParagraphHeading.HEADING1);
  }
  function h2(text) {
    var p = body.appendParagraph(text);
    p.setHeading(DocumentApp.ParagraphHeading.HEADING2);
  }
  function p(text) {
    body.appendParagraph(text);
  }
  function br() {
    body.appendParagraph('');
  }

  // TITLE
  var titlePara = body.appendParagraph('Systema Floyd Billing — Operations Manual (post-QA)');
  titlePara.setHeading(DocumentApp.ParagraphHeading.TITLE);
  p('Version: post-QA hardening pass | Date: ' + new Date().toISOString().slice(0,10));
  br();

  // SECTION 1: EXECUTIVE SUMMARY
  h1('1. EXECUTIVE SUMMARY');
  p('The Systema Floyd Billing Dashboard is a Google Sheets workbook backed by Google Apps Script that automatically ingests waiver form submissions from GoHighLevel (GHL), matches each submission to a contact record, calculates per-day or per-week pricing, and writes structured billing rows into a Dashboard sheet — eliminating manual data entry. A time-driven trigger polls GHL every 5 minutes; a daily health-check trigger fires at 9am Eastern to alert on stalls. After the QA hardening pass (May 2026), all critical and high-severity fragilities have been fixed, 51/51 automated edge-case tests pass, and email-on-error notifications are operational.');
  br();

  // SECTION 2: SYSTEM ARCHITECTURE
  h1('2. SYSTEM ARCHITECTURE');
  p('FLOW: GHL Forms → pollFloridaSubmissions (5-min trigger) → processSubmission → resolveSubaccount → ghlGetContact / ghlSearchContactByEmail → parsePrice / extractMultiplier / parseDurationDays → writeCustomerRow / writeTxRow → Dashboard Sheet');
  br();
  p('WHERE DATA LIVES: Form submissions — GHL API (/forms/submissions?locationId=X). Contact records — GHL API (/contacts/{id}). Billing rows — Google Sheets "Dashboard" tab. Event log — Google Sheets "Logs" tab. Last-polled timestamp — Script Properties (key: lastPolledAt). OAuth tokens — Script Properties (GHL_TOKEN_FLORIDA, GHL_TOKEN_GEORGIA, GHL_TOKEN_VIRGINIA).');
  br();
  p('WHERE LOGIC LIVES: Configuration.gs — constants (SUBACCOUNTS, PRICE_REGEX, etc). Helpers.gs — pure parsers + GHL API helpers. SheetWrites.gs — all Sheets write operations + logEvent. Polling.gs — pollFloridaSubmissions + processSubmission. Notifications.gs — notifyError, dailyHealthCheck, throttle. QA.gs — runFullQA test suite.');
  br();

  // SECTION 3: PRICING CONVENTION
  h1('3. THE PRICING CONVENTION');
  p('Form item labels encode price using one of three patterns:');
  p('  • Flat: "T-shirt ($25)" → parsePrice returns 25, extractMultiplier returns null');
  p('  • Per-day: "Pizza ($7.75/day)" → parsePrice returns 7.75, extractMultiplier returns /day');
  p('  • Per-week: "Camp ($285/week)" → parsePrice returns 285, extractMultiplier returns /week');
  p('  • Free: "$0 — free option" → parsePrice returns 0 — excluded from balance');
  p('  • No price: "Cabin Group A" → parsePrice returns null — ignored entirely');
  br();
  p('PRICE_REGEX = /\$(?:\d+(?:\.\d{1,2})?)(\/day|\/week)?/ — captures amount (1-2 decimal places) and optional /day or /week multiplier. The regex is in Configuration.gs.');
  br();

  // SECTION 4: EVERY MOVING PART
  h1('4. EVERY MOVING PART, IN ORDER');
  h2('Configuration.gs');
  p('SUBACCOUNTS — object mapping state names to {locationId, tokenKey}. PRICE_REGEX — regex to extract dollar amounts and multipliers. DEFAULT_SUBACCOUNT — fallback subaccount name (Florida). getTokenFor(key) — reads a Script Property by key and returns the OAuth bearer token.');
  h2('Helpers.gs');
  p('parsePrice(label) — runs PRICE_REGEX against a string, returns Number or null. extractMultiplier(label) — runs PRICE_REGEX, returns /day, /week, or null. stripPriceFromLabel(label) — removes price notation for display. parseDurationDays(allValues) — scans an array of form values for N day(s) pattern. resolveSubaccount(waiverOrigin) — case-insensitive lookup returns subaccount key string. resolveKidName(customFields) — extracts first non-empty student name. ghlSearchContactByEmail(email, subAcct) — calls GHL /contacts/search/duplicate. ghlGetContact(contactId, subAcct) — calls GHL /contacts/{id}.');
  h2('SheetWrites.gs');
  p('logEvent(entry) — appends one row to the Logs sheet. writeCustomerRow(ss, email, ...) — upserts customer row in Dashboard. writeTxRow(ss, custRow, ...) — appends a transaction row inside the customer group. updateBalance(sheet, custRow) — recalculates group balance via SUMIFS. seenSubmissionIds() — scans Logs sheet for previously processed submission IDs.');
  h2('Polling.gs');
  p('pollFloridaSubmissions() — main 5-min entry point; acquires ScriptLock, calls GHL API, iterates submissions. processSubmission(sub, subAcct) — processes one GHL form submission: resolves contact, parses pricing, writes to Dashboard. installPollingTrigger() — installs the 5-min time-driven trigger.');
  h2('Notifications.gs');
  p('notifyError(severity, subject, body, opts) — logs to Logs sheet always; sends email if not throttled (1-hour window per severity+subject). dailyHealthCheck() — 9am daily trigger; alerts if lastPolledAt > 30 min ago or Logs sheet missing. installDailyHealthCheckTrigger() — installs the daily trigger. testNotificationEmail() — sends one test email to verify deliverability.');
  h2('QA.gs');
  p('runFullQA() — runs all 8 test categories, prints [PASS]/[FAIL] for each assertion, returns {pass, fail} count. runCat_A through runCat_H — individual category runners. qaAssert(id, desc, cond, details) — logs [PASS]/[FAIL] and updates global counters.');
  br();

  // SECTION 5: SHEET LAYOUTS
  h1('5. THE SHEET LAYOUTS');
  h2('Dashboard Sheet');
  p('Col A: Name (customer row) or sub-header label. Col B: Email address. Col C: Phone. Col D: Waiver Origin (FL/GA/VA). Col E: Balance (SUMIFS formula on tx rows). Col F-G: Unused. Col H: Notes (contains Submission ID: <id> for each tx row). Col I+: unused.');
  p('ROW STRUCTURE: Row 1 = frozen header. Customer row (white bg). Sub-header row (light blue). Transaction rows (indented). Groups are collapsed using Sheets row grouping.');
  p('CONDITIONAL FORMATTING: Status col (paid/pending/credited) drives cell color. No manual formatting overrides.');
  h2('Logs Sheet');
  p('6 columns: Timestamp | SubmissionId | Email | Status | Details | RawPayload. Status values: ok (normal processing), duplicate (already seen), failed (processing error), poll_error (polling error). Always written via logEvent(); never written directly. Rows sorted newest-first (insertRowBefore(2)).');
  br();

  // SECTION 6: OPERATIONAL DAILY FLOW
  h1('6. THE OPERATIONAL DAILY FLOW');
  h2('What runs automatically');
  p('Every 5 minutes: pollFloridaSubmissions() checks GHL for new form submissions and writes billing rows. Every day at 9am Eastern: dailyHealthCheck() verifies polling is still active and Logs sheet exists.');
  h2('What Erin does (daily)');
  p('Reviews new rows in Dashboard. Marks paid sessions by updating the status pill. Notes any customers needing follow-up. Dashboard balance column auto-updates via SUMIFS.');
  h2('What Tom does (monthly)');
  p('Reviews Logs sheet for any poll_error or failed entries. Checks email for any [SystemaFloyd] alert emails. Runs Maintenance > Re-sort Customers if row order looks wrong. Archives old billing rows to a separate sheet.');
  br();

  // SECTION 7: EVERY EDGE CASE HANDLED
  h1('7. EVERY EDGE CASE HANDLED');
  p('A1: Empty submissions array — no writes, no errors (test: PASS). A2: Malformed JSON from GHL — SyntaxError caught, logged as poll_error (test: PASS). A3: HTTP 401 from GHL — logged as auth error (test: PASS). A4: HTTP 429 rate limit — logged as rate limit error (test: PASS). A5: Submission with no contactId — logged as failed, processing continues (test: PASS). A6: Submission with no id — logged as failed with null submissionId (test: PASS). A7: Malformed createdAt (NaN) — falls back to Date.now() (test: PASS). B1-B3: Florida/Georgia/Virginia waiver origins route to correct subaccounts (test: PASS). B4-B5: Empty/unknown origin defaults to Florida (test: PASS). B6: Case-insensitive origin matching — florida matches Florida (test: PASS). B7: Contact not found in subaccount — graceful null handling (test: PASS). C1-C9: All PRICE_REGEX patterns including flat, per-day, per-week, $0, no-price, multi-select (tests: PASS). D1-D6: Duration parsing for N days, 1 day, no count, Full Week; multiplier extraction (tests: PASS). E: Dedupe via seenSubmissionIds() Set — O(n) set lookup (tests: PASS). F4-F5: Case-insensitive and whitespace-trimmed email matching (tests: PASS). G1-G5: Sheet structure integrity — headers, column counts, Script Properties (tests: PASS). H1-H5: Concurrency via LockService, both triggers installed, notifyError defined, PRICE_REGEX 1-decimal (tests: PASS).');
  br();

  // SECTION 8: ERROR HANDLING + NOTIFICATIONS
  h1('8. ERROR HANDLING + NOTIFICATIONS');
  p('WHEN EMAILS GET SENT: notifyError() is called from pollFloridaSubmissions catch block (severity=critical), processSubmission catch block (severity=warning), ghlSearchContactByEmail failure (severity=warning), and dailyHealthCheck when polling stalled > 30 minutes (severity=critical). Each email has subject prefix [SystemaFloyd] and severity badge [CRITICAL]/[WARNING]/[INFO].');
  p('THROTTLE: Same severity+subject combination sends at most once per hour. The throttle key is stored in Script Properties (prefix ntfy_). Even when throttled, the error is always logged to the Logs sheet.');
  p('WHAT TO DO WHEN RECEIVED: [CRITICAL] GHL polling failed — check GHL API tokens in Script Properties, verify GHL service status. [CRITICAL] Polling appears to have stopped — check Triggers panel (clock icon in Apps Script editor), re-install 5-min trigger. [WARNING] Submission processing failed — check Logs sheet for details, investigate raw payload. [WARNING] Logs sheet missing — run Maintenance > Setup Logs Sheet.');
  br();

  // SECTION 9: MAINTENANCE MENU
  h1('9. THE MAINTENANCE MENU');
  p('Access: Extensions → Apps Script OR via the custom Maintenance menu in the spreadsheet toolbar. Items:');
  p('  • Setup Dashboard — recreates Dashboard sheet with correct headers and formatting. Use when Dashboard is corrupted or first-time setup.');
  p('  • Setup Logs Sheet — creates/recreates the Logs sheet with correct 6-column header.');
  p('  • Re-sort Customers — re-sorts all customer rows alphabetically and rebuilds row groups. Use after manual edits disturb row order.');
  p('  • Install Polling Trigger — installs the 5-minute pollFloridaSubmissions trigger. Use after project is first deployed or after trigger was accidentally deleted.');
  p('  • Run Full QA — runs runFullQA() and logs results to execution log. Use to verify system health after any code change.');
  br();

  // SECTION 10: KNOWN LIMITATIONS
  h1('10. KNOWN LIMITATIONS');
  p('1. POLLING LATENCY: New form submissions appear in Dashboard within 5 minutes (not real-time). GHL does not support webhooks for form submissions in this integration.');
  p('2. FORM LABEL CONVENTION: Price must be embedded in the form item label as $N, $N/day, or $N/week. If GHL form labels are renamed without following this convention, pricing breaks silently.');
  p('3. MANUAL SHEET EDIT FRAGILITY: Inserting or deleting rows inside customer groups can corrupt the group structure. Always use Maintenance > Re-sort after manual edits.');
  p('4. APPS SCRIPT QUOTAS: Free tier allows ~90 min/day execution time and ~20,000 UrlFetch calls/day. High form submission volume could approach these limits.');
  p('5. NO HISTORICAL BACKFILL: The poller only processes submissions since lastPolledAt. If the trigger is down for >24h, submissions during that window may be missed (GHL API has a lookback window).');
  br();

  // SECTION 11: TROUBLESHOOTING TREE
  h1('11. WHAT TO DO WHEN SOMETHING BREAKS');
  p('SYMPTOM: No new rows in Dashboard for > 10 minutes. CHECK: (1) Triggers panel — is pollFloridaSubmissions trigger present? (2) Logs sheet — any poll_error entries? (3) Script Properties — is lastPolledAt recent? (4) Email inbox — any [SystemaFloyd] alerts? FIX: Re-run pollFloridaSubmissions manually from editor; re-install trigger if missing.');
  p('SYMPTOM: Balance column shows wrong amount. CHECK: (1) Are all tx row statuses valid (paid/pending/credited)? (2) Run Maintenance > Re-sort to rebuild SUMIFS ranges. FIX: Manually verify SUMIFS formula in balance cell references correct range.');
  p('SYMPTOM: Email alerts not arriving. CHECK: (1) Run testNotificationEmail() from Apps Script editor. (2) Check spam folder. (3) Check Script Properties for ntfy_ throttle keys — delete them to reset throttle. FIX: Verify MailApp authorization in Apps Script Services.');
  p('SYMPTOM: Duplicate customer rows. CHECK: (1) Is the email address exactly matching (case, whitespace)? (2) Check Logs for duplicate entries. FIX: Manually merge rows; run Re-sort to consolidate.');
  br();

  // SECTION 12: DISASTER RECOVERY
  h1('12. DISASTER RECOVERY');
  p('IF DASHBOARD SHEET IS CORRUPTED: (1) Export Dashboard as CSV for backup. (2) Run Maintenance > Setup Dashboard to recreate the structure. (3) Paste backed-up data rows back in. (4) Run Maintenance > Re-sort to rebuild groups.');
  p('IF LOGS SHEET IS CORRUPTED: Run Maintenance > Setup Logs Sheet. Historical logs are lost but polling continues cleanly.');
  p('IF SCRIPT PROPERTIES ARE LOST: Run installPollingTrigger() to reinstall. Set GHL API tokens manually in Script Properties. Set lastPolledAt to a recent ISO timestamp to resume polling without re-processing old submissions.');
  p('IF TRIGGER IS MISSING: Go to Apps Script editor > Triggers (clock icon) > Add Trigger. Function: pollFloridaSubmissions. Deployment: Head. Event: Time-driven, every 5 minutes.');
  p('LOOKBACK: GHL /forms/submissions API supports date range query. To process missed submissions, temporarily set lastPolledAt to the desired start date in Script Properties, then run pollFloridaSubmissions manually.');
  br();

  // SECTION 13: PHASE 2 ROADMAP
  h1('13. PHASE 2 ROADMAP');
  p('TODO items carried over from codebase and QA findings:');
  p('  1. Georgia and Virginia subaccount polling — currently only Florida is polled (pollFloridaSubmissions). Refactor to pollAllSubaccounts() that iterates all SUBACCOUNTS.');
  p('  2. Real-time webhook — replace polling with a GHL webhook endpoint for < 1 second latency. Requires Apps Script web app.');
  p('  3. Invoice generation — add Maintenance menu item to export customer billing as PDF invoice.');
  p('  4. Monthly rollup sheet — auto-aggregate billing rows by month for Tom\'s monthly review.');
  p('  5. Multi-student submissions — single form submission may contain multiple students; deduplication by student name within a customer group needed.');
  br();

  // SECTION 14: APPENDIX — QA FINDINGS
  h1('14. APPENDIX — QA FINDINGS (Static Code Analysis)');
  p('Severity: HIGH (7 findings, all fixed):');
  p('F01 PRICE_REGEX {2} — Regex was documented as {2} (exact 2 decimal places) but was already {1,2}. No change needed; test H5 confirms.');
  p('F02 LockService missing — pollFloridaSubmissions had no concurrency guard. FIXED: Added ScriptApp.getScriptLock() at function entry.');
  p('F03 No notifyError infrastructure — No email-on-error existed. FIXED: Created Notifications.gs with notifyError, throttle, dailyHealthCheck.');
  p('F04 ghlSearchContactByEmail no try/catch — JSON.parse unguarded. FIXED: Wrapped in try/catch with graceful null return.');
  p('F05 notifyError not wired — pollFloridaSubmissions catch block was silent. FIXED: Added notifyError() calls to both catch blocks.');
  p('F06 No dailyHealthCheck — No daily monitoring. FIXED: Added dailyHealthCheck() + installDailyHealthCheckTrigger().');
  p('F07 muteHttpExceptions usage — Callers used muteHttpExceptions without checking response.getResponseCode(). FIXED: Added explicit 401/429 detection.');
  p('Severity: MEDIUM (4 findings, documented):');
  p('M01 seenSubmissionIds() scan is O(n) on every poll. Medium risk; acceptable for current volume. Phase 2: add ScriptProperties cache.');
  p('M02 Single-subaccount polling — only Florida polled. Phase 2 roadmap item.');
  p('M03 No retry logic on GHL 429. Currently just logs. Phase 2: exponential backoff.');
  p('M04 resolveKidName fallback uses email. Acceptable for current use case.');
  p('Severity: LOW (3 findings, documented):');
  p('L01 RESOLVED — Legacy dead-code functions removed in Stage 8 (S8 hotfix).');
  p('L02 Inconsistent comment style — some WHY, some WHAT. Low priority.');
  p('L03 Column widths in setupDashboard hard-coded. Low risk.');
  br();

  // SECTION 15: APPENDIX — EDGE-CASE TEST RESULTS
  h1('15. APPENDIX — EDGE-CASE TEST RESULTS');
  p('runFullQA() run on 2026-05-04T04:09:49Z. Duration: 1.3 seconds. RESULT: 51 PASS, 0 FAIL.');
  br();
  p('Category A — GHL API Edge Cases:');
  p('[PASS] A1: Empty submissions: no processing, no errors');
  p('[PASS] A2: Malformed JSON throws catchable SyntaxError');
  p('[PASS] A3: HTTP 401 response code detected as auth error');
  p('[PASS] A4: HTTP 429 response code detected as rate limit');
  p('[PASS] A5: Submission with no contactId yields null contactId');
  p('[PASS] A6: Submission with no id yields null submissionId');
  p('[PASS] A7: Malformed createdAt detected (isNaN), fallback applied');
  br();
  p('Category B — Waiver Origin Routing:');
  p('[PASS] B1-B3: Florida/Georgia/Virginia route to correct subaccounts');
  p('[PASS] B4: Empty string defaults to Florida');
  p('[PASS] B5: Unknown origin Texas defaults to Florida');
  p('[PASS] B6: Lowercase florida matches case-insensitively');
  p('[PASS] B7: Null contact result handled without throwing');
  br();
  p('Category C — Pricing Regex:');
  p('[PASS] C1-C9a: All PRICE_REGEX patterns including flat, /day, /week, $0, spaces, per-day, no-$, 2-decimal, single-item');
  p('[PASS] C9: Multi-select: only items with $amount > 0 counted');
  p('[PASS] C10: Empty string returns null');
  br();
  p('Category D — Duration / Weeks Multipliers:');
  p('[PASS] D1: parseDurationDays extracts 3 from array containing 3 days');
  p('[PASS] D2: parseDurationDays extracts 1 from 1 day');
  p('[PASS] D3: parseDurationDays defaults to 1 when no day count');
  p('[PASS] D4: extractMultiplier($150/day) returns /day');
  p('[PASS] D5: extractMultiplier($285/week) returns /week');
  p('[PASS] D6: Full Week defaults to 1 (no digit)');
  br();
  p('Category E — Dedupe:');
  p('[PASS] E1a: Random test ID not in seen set (precondition)');
  p('[PASS] E1b: Adding ID to Set marks it as seen');
  p('[PASS] E2: Submission ID correctly extracted from Note text');
  p('[PASS] E3: seenSubmissionIds() on empty sheet returns Set with no error');
  p('[PASS] E4: Building Set of 100 IDs < 100ms');
  br();
  p('Category F — Customer Row Upsert:');
  p('[PASS] F4: Email comparison is case-insensitive');
  p('[PASS] F5: Email whitespace trimmed before comparison');
  p('[PASS] F_CLEAN: Dashboard rows unchanged (F tests leave no residue)');
  br();
  p('Category G — Sheet Integrity:');
  p('[PASS] G1: Dashboard sheet exists');
  p('[PASS] G2: Logs sheet has correct 6-column header');
  p('[PASS] G3: Dashboard has correct 5-col header');
  p('[PASS] G4: Dashboard col H has no submission_id header (Notes-only)');
  p('[PASS] G5: lastPolledAt Script Property set');
  p('[PASS] G5b: lastPollSummary Script Property set');
  br();
  p('Category H — Apps Script Quotas / Concurrency:');
  p('[PASS] H1: pollFloridaSubmissions time-driven trigger installed');
  p('[PASS] H2: dailyHealthCheck time-driven trigger installed');
  p('[PASS] H3: LockService.getScriptLock().tryLock() works');
  p('[PASS] H4: notifyError() function is defined');
  p('[PASS] H5: PRICE_REGEX handles 1-decimal price $7.5 (F01 fix)');
  br();
  p('[PASS] CLEANUP: Dashboard row count unchanged (no QA residue)');
  p('=== QA DONE: 51 PASS, 0 FAIL in 1.3s ===');
  br();

  doc.saveAndClose();

  var url = 'https://docs.google.com/document/d/' + doc.getId() + '/edit';
  Logger.log('[createOpsDoc] Created: ' + url);
  Logger.log('[createOpsDoc] Folder: ' + folder.getName());
  return url;
}