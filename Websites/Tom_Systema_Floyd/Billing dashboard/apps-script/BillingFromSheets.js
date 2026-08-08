/** ─── BillingFromSheets.gs ─────────────────────────────────────────
 *  Sheet-driven billing pipeline. Replaces the GHL-submission-driven
 *  flow's "freeze billing rows at first submission" problem with
 *  "rebuild billing every 5 min from current registration sheet state."
 *
 *  Phase 1 scope: summer camp sheets only
 *     Upper Campus, Lower Campus, FREE Upper, FREE Lower
 *
 *  Phase 2 will add after-school sheets in Drive folder
 *     1hT0qjM_NCIkONm1-HhUr3rvB4FDV-o8V
 *  once that folder is shared with emilio@nilsdigital.com and the
 *  monthly/quarterly pricing model is defined.
 *
 *  Pipeline:
 *    1. Read the central Pricing tab (in this Billing Dashboard sheet)
 *    2. For each registration sheet in REGISTRATION_SHEETS:
 *         a. Walk every week tab, extract enrollments
 *         b. Price each enrollment via the catalog
 *         c. Write/refresh a "Billing" tab at the end of the sheet
 *    3. (Phase 1.5) Rollup all per-sheet billing into the central Dashboard
 *
 *  Status pill preservation: each tx row carries a stable fingerprint
 *  in column A (hidden / very narrow). When rebuilding, the existing
 *  status pill is looked up by fingerprint and re-applied.
 *
 *  Trade-offs vs the GHL-poll pipeline:
 *    + Sheet edits propagate to billing within 5 min
 *    + No "submission once, then frozen" problem
 *    - $1 CC verification fee (GHL payment-field artifact) no longer captured
 *    - Pricing sheet must be kept current; an unpriced cell value
 *      becomes an "unpriced" line item flagged for Tom to add
 *  ─────────────────────────────────────────────────────────────── */

// ─── Registration sheet inventory ─────────────────────────────────
// Drive folder containing every registration sheet Tom uses. The
// discoverRegistrationSheets_() function walks this tree recursively
// every poll and classifies each sheet it finds (summer paid / free /
// after-school) by the parent-folder path and the sheet's column
// headers.
//
// Folder layout (as of 2026-05-13):
//   registration sheets/
//   ├── Summer Camp/
//   │   ├── Upper Campus sheet
//   │   ├── Lower Campus sheet
//   │   └── Free Summer Camp/
//   │       ├── FREE Upper Campus sheet
//   │       └── FREE Lower Campus sheet
//   └── After School Registration/
//       └── <one sheet per school program>
const REGISTRATION_ROOT_FOLDER_ID = '1ybmFvKPQV9YHeoxUfdcDpTdpjbUYpL2w';

// Second Drive root: form-submission sheets fed by the 4 new GHL forms
// (Vladimir Seminar, Private Lessons, Rent-A-Sensei, Balloons). Each
// sheet inside this folder has the shape "one row per form submission,
// raw form fields as columns." Distinct from REGISTRATION_ROOT_FOLDER_ID
// because classification is by file name (not folder path) and the
// shape is item-per-row, not enrollment-per-row.
const FORM_SUBMISSIONS_FOLDER_ID = '1YnCaA46sLC57w7A3vZf0tEGgZv9aoUxN';

// Sheet-name → category mapping for form-submission sheets. The Form
// Submissions folder has all four sheets as siblings, so classification
// happens by file name. Add a new entry when another form-submission
// sheet gets created.
const FORM_SUBMISSION_SHEET_CATEGORIES = [
  { pattern: /^Vladimir Vasiliev Seminar Registration/i, type: 'seminar' },
  { pattern: /^Private Lesson Booking/i,                 type: 'private-lessons' },
  { pattern: /^Rent-A-Sensei Booking/i,                  type: 'babysitting' },
  { pattern: /^Balloons by Balloons on the Ave/i,        type: 'decor' },
];

// The 4 categories above. Used by buildAllBilling to choose between the
// enrollment-pricing pipeline (camp / after-school) and the direct
// item-emit pipeline (form submissions).
const FORM_SUBMISSION_TYPES = ['seminar', 'private-lessons', 'babysitting', 'decor'];

// Tax + fees applied inline to each line item's unit price. Edit these
// constants when rates change; takes effect on the next 5-min trigger.
//
// Why inline rather than separate rows:
//   - Scales: if Tom adds a new item type tomorrow, the fee math
//     follows automatically (no "where does the processing fee row go?")
//   - Cleaner Dashboard: one row per priced item, fee baked in
//   - Per-cell Note explains the breakdown ("$30.00 = base $27.27 +
//     3% processing fee + 7% sales tax") so Erin can audit
//
// Per item kind:
//   shirt → SHIRT_SALES_TAX_RATE + PAYMENT_PROCESSING_FEE  (7% + 3%)
//   all other priced items → PAYMENT_PROCESSING_FEE        (3%)
//   unpriced / $0 → no inflation
const SHIRT_SALES_TAX_RATE   = 0.07;
const PAYMENT_PROCESSING_FEE = 0.03;

// Status pill lifecycle. 'refund-needed' is set automatically when a
// 'paid' item's registration disappears — surfaces a refund obligation
// for the team. After Tom processes the refund externally, he flips
// the cell to 'refunded' manually.
const STATUS_VALUES = [
  'owed', 'paid', 'canceled', 'refund-needed', 'refunded', 'unpriced', 'ambiguous'
];

// Fallback inventory: used when Drive folder scan fails (folder unshared,
// API error, permission issue, etc.). Keeps the 4 known summer-camp
// sheets discoverable as a safety net.
const FALLBACK_REGISTRATION_SHEETS = [
  { id: '1qejcgNQt3sS_UZ9Gl9Txr8TOocw3LzK5PjPICqnRrGA', label: 'Upper Campus', type: 'summer-paid' },
  { id: '18A_sc917xnxYo3UQ8_cGogqg46Im6qUQlakOC9Oc-Fs', label: 'Lower Campus', type: 'summer-paid' },
  { id: '1rK4p6jS1xqSf1qNO9-3ljCRzJcUIDF87sNo_UehBWYQ', label: 'FREE Upper Campus', type: 'summer-free' },
  { id: '1_659v7by990V4OJMd86nBG-HUN6_AzZNOAPoQN0LMxY', label: 'FREE Lower Campus', type: 'summer-free' },
];

// 12 weeks of summer camp, in chronological order. Tab N = WEEK_ORDER[N-1].
// Kept here (rather than imported from Snapshot.js) so this script is
// self-contained inside the Billing Dashboard project.
const BFS_WEEK_ORDER = [
  'June 1st-5th', 'June 8th-12th', 'June 15th-19th', 'June 22nd-26th',
  'June 29th-July 3rd', 'July 6th-10th', 'July 13th-17th',
  'July 20th-24th', 'July 27th-31st', 'August 3rd-7th',
  'August 10th-14th', 'August 17th-21st'
];

// Name-based tab → week resolution. Mirrors Snapshot.js weekKey_/resolveWeek_.
// Reason this exists: Tom's registration sheets have non-week tabs (Notes /
// Lookup / etc.) mixed in with the weekly tabs, so iterating by position
// silently mis-labels every week after the first non-week tab. See
// ACTIVE_INVESTIGATION.md (Cyrus bar-or +1 week shift) for the bug history.
function bfsWeekKey_(label) {
  if (!label) return null;
  var months = { jan:1,feb:2,mar:3,apr:4,may:5,jun:6,jul:7,aug:8,sep:9,oct:10,nov:11,dec:12 };
  var s = String(label).toLowerCase().replace(/(\d+)(st|nd|rd|th)/g, '$1');
  var m = s.match(/(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\s*(\d{1,2})/);
  if (m) return months[m[1]] + '-' + parseInt(m[2], 10);
  m = s.match(/(\d{1,2})\/(\d{1,2})/);
  if (m) return parseInt(m[1], 10) + '-' + parseInt(m[2], 10);
  return null;
}
var BFS_WEEK_KEY_MAP = (function() {
  var m = {};
  BFS_WEEK_ORDER.forEach(function(w) {
    var k = bfsWeekKey_(w);
    if (k) m[k] = w;
  });
  return m;
})();
function bfsResolveWeek_(tabName) {
  var k = bfsWeekKey_(tabName);
  return (k && BFS_WEEK_KEY_MAP[k]) || null;
}

const BILLING_TAB_NAME    = 'Billing';
const UNPRICED_TAG        = '(unpriced)';

// Manual Items tab: operator-entered line items (escape hatch for charges
// that don't live on a registration sheet — late fees, private lessons,
// one-off invoices, etc.). See setupManualItemsTab + readManualItems_.
const MANUAL_ITEMS_SHEET_NAME = 'Manual Items';

/* ═════════════════════════════════════════════════════════════════
   ENTRY POINTS
   ═════════════════════════════════════════════════════════════════ */

/* ═════════════════════════════════════════════════════════════════
   AUTO-DISCOVERY
   ═════════════════════════════════════════════════════════════════ */

/**
 * Walks the REGISTRATION_ROOT_FOLDER_ID tree recursively, finding every
 * Google Sheet that looks like a registration sheet. Each result is
 * classified by parent-folder path:
 *   - Path contains "Free Summer Camp"   → type: 'summer-free'
 *   - Path contains "Summer Camp"        → type: 'summer-paid'
 *   - Path contains "After School"       → type: 'after-school'
 *   - Anything else                      → skipped
 *
 * Falls back to FALLBACK_REGISTRATION_SHEETS on any error so a
 * permission glitch doesn't blow up the trigger.
 *
 * @returns {Array<{id, label, type, folderPath}>}
 */
function discoverRegistrationSheets_() {
  var found = [];

  function walkRoot(folderId, rootLabel) {
    if (!folderId || folderId.length < 5) return;
    try {
      var rootFolder = DriveApp.getFolderById(folderId);
      bfsWalkFolder_(rootFolder, rootFolder.getName(), function(file, folderPath) {
        if (file.getMimeType() !== MimeType.GOOGLE_SHEETS) return;
        var fileName = file.getName();
        var type = bfsClassifySheet_(folderPath, fileName);
        if (!type) return;
        found.push({
          id: file.getId(),
          label: fileName,
          type: type,
          folderPath: folderPath
        });
      });
    } catch (e) {
      Logger.log('[discoverRegistrationSheets_] ' + rootLabel +
                 ' walk failed: ' + e.message);
    }
  }

  walkRoot(REGISTRATION_ROOT_FOLDER_ID, 'registration root');
  walkRoot(FORM_SUBMISSIONS_FOLDER_ID, 'form-submissions root');

  if (found.length === 0) {
    Logger.log('[discoverRegistrationSheets_] WARN: zero sheets discovered — ' +
               'using fallback list');
    return FALLBACK_REGISTRATION_SHEETS;
  }
  Logger.log('[discoverRegistrationSheets_] found ' + found.length + ' sheet(s):');
  found.forEach(function(r) {
    Logger.log('  - [' + r.type + '] ' + r.label + ' (' + r.folderPath + ')');
  });
  return found;
}

function bfsWalkFolder_(folder, currentPath, callback) {
  // Files in this folder
  var files = folder.getFiles();
  while (files.hasNext()) {
    callback(files.next(), currentPath);
  }
  // Subfolders (recurse)
  var subfolders = folder.getFolders();
  while (subfolders.hasNext()) {
    var sub = subfolders.next();
    bfsWalkFolder_(sub, currentPath + '/' + sub.getName(), callback);
  }
}

function bfsClassifySheet_(folderPath, fileName) {
  if (/Free\s+Summer\s+Camp/i.test(folderPath)) return 'summer-free';
  if (/Summer\s+Camp/i.test(folderPath))        return 'summer-paid';
  if (/After\s+School/i.test(folderPath))       return 'after-school';
  // Form-submission sheets live as siblings inside a "Form Submissions"
  // folder. Classification is by file name, not folder path.
  if (fileName && /Form\s+Submissions/i.test(folderPath)) {
    for (var i = 0; i < FORM_SUBMISSION_SHEET_CATEGORIES.length; i++) {
      var rule = FORM_SUBMISSION_SHEET_CATEGORIES[i];
      if (rule.pattern.test(fileName)) return rule.type;
    }
  }
  return null;
}

// Sheet types we DON'T want on the billing dashboard. Free summer camp
// is intentionally excluded: those kids registered for the no-cost
// program and shouldn't appear with priced line items, even if the
// registration sheet happens to include opt-in fields the pricer
// could otherwise charge for.
const BFS_NON_BILLABLE_TYPES = ['summer-free'];

/**
 * Filter a discovered registration-sheet list down to only the types
 * we bill on. Logs the exclusions so it's obvious which sheets were
 * skipped on this run.
 */
function bfsFilterBillable_(sheets, logPrefix) {
  var keep = [], skip = [];
  sheets.forEach(function(r) {
    if (BFS_NON_BILLABLE_TYPES.indexOf(r.type) === -1) keep.push(r);
    else skip.push(r);
  });
  if (skip.length > 0) {
    Logger.log((logPrefix || '[bfsFilterBillable_]') + ' skipping ' +
               skip.length + ' non-billable sheet(s): ' +
               skip.map(function(r) { return r.label + ' (' + r.type + ')'; }).join(', '));
  }
  return keep;
}

/**
 * Main worker — aggregates priced line items across every registration
 * sheet and writes one consolidated "Billing" tab into the central
 * Billing Dashboard sheet (this script's bound spreadsheet).
 *
 * Was previously a per-sheet Billing tab per registration sheet, but
 * the user consolidated to a single billing view 2026-05-13. The
 * per-sheet tabs are cleaned up by deleteBillingTabsFromRegistrationSheets().
 *
 * Discovery: walks REGISTRATION_ROOT_FOLDER_ID (a Drive folder) every
 * run. New registration sheets dropped in that folder tree are picked
 * up automatically on the next 5-min trigger fire.
 *
 * Runs every 5 min via installBillingFromSheetsTrigger.
 */
function buildAllBilling() {
  // Wait up to 2 minutes for any in-flight run to finish (instead of
  // bailing instantly). Lets manual editor runs queue up cleanly
  // behind concurrent scheduled triggers — no more "previous run
  // still in progress, skipping" noise.
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(120000)) {
    Logger.log('[buildAllBilling] could not acquire lock after 2 min — another run is taking unusually long. Skipping.');
    return;
  }
  try {
    var startedAt = new Date();
    Logger.log('[buildAllBilling] start @ ' + startedAt.toISOString());

    var catalog = readPricingCatalog_();
    Logger.log('[buildAllBilling] pricing catalog: ' + catalog.items.length + ' entries');

    var registrationSheets = discoverRegistrationSheets_();
    registrationSheets = bfsFilterBillable_(registrationSheets, '[buildAllBilling]');
    Logger.log('[buildAllBilling] processing ' + registrationSheets.length + ' registration sheet(s)');

    // Collect priced items across every registration sheet
    var allItems = [];
    var perSheet = [];
    var seenShirts = {};  // one-time-per-student dedup across all sheets
    registrationSheets.forEach(function(reg) {
      var sheetEnroll = 0, sheetItems = 0, sheetUnpriced = 0;
      try {
        // Form-submission sheets emit priced items directly (no enrollment-
        // pricing two-step), because each row IS a priced submission and
        // the prices live in the form option labels. Items already carry
        // their enrollment + fingerprint when produced.
        if (FORM_SUBMISSION_TYPES.indexOf(reg.type) !== -1) {
          var formItems = bfsReadFormSubmissionSheet_(reg);
          sheetEnroll = formItems.length;
          formItems.forEach(function(it) {
            allItems.push(it);
            sheetItems++;
            if (it.unpriced) sheetUnpriced++;
          });
          perSheet.push(reg.label + ': ' + sheetEnroll + ' submission(s), ' +
                        sheetItems + ' tx rows, ' + sheetUnpriced + ' unpriced');
          return;
        }

        // Camp / after-school: enrollments → priceEnrollment_ → items
        var enrollments = (reg.type === 'after-school')
          ? readAfterSchoolEnrollments_(reg)
          : readRegistrationEnrollments_(reg);
        sheetEnroll = enrollments.length;
        enrollments.forEach(function(e) {
          var items = priceEnrollment_(e, catalog);
          items.forEach(function(it) {
            if (it.oneTimePerStudent) {
              if (seenShirts[it.fingerprint]) return;
              seenShirts[it.fingerprint] = true;
            }
            it.enrollment = e;
            allItems.push(it);
            sheetItems++;
            if (it.unpriced) sheetUnpriced++;
          });
        });
        perSheet.push(reg.label + ': ' + sheetEnroll + ' enrollments, ' +
                      sheetItems + ' tx rows, ' + sheetUnpriced + ' unpriced');
      } catch (e) {
        perSheet.push(reg.label + ': ERROR ' + e.message);
        Logger.log('[buildAllBilling] ' + reg.label + ' failed: ' + e.message +
                   '\n' + (e.stack || ''));
      }
    });

    // Manual Items tab: operator-entered line items merged in alongside
    // reg-sheet items so they share the same diff + lifecycle machinery
    // downstream. See readManualItems_ for the data flow.
    try {
      var manualItems = readManualItems_();
      manualItems.forEach(function(it) { allItems.push(it); });
      perSheet.push('Manual Items: ' + manualItems.length + ' tx row(s)');
    } catch (e) {
      perSheet.push('Manual Items: ERROR ' + e.message);
      Logger.log('[buildAllBilling] manual-items read failed: ' + e.message +
                 '\n' + (e.stack || ''));
    }

    // Sort: parent email → student → week → kind
    allItems.sort(function(a, b) {
      var byEmail = (a.enrollment.email || '').localeCompare(b.enrollment.email || '');
      if (byEmail !== 0) return byEmail;
      var byStudent = (a.enrollment.student || '').localeCompare(b.enrollment.student || '');
      if (byStudent !== 0) return byStudent;
      // Unified ordering: summer weeks first, then months, then quarters
      var allPeriods = BFS_WEEK_ORDER
        .concat(AFTER_SCHOOL_MONTH_COLUMNS)
        .concat(AFTER_SCHOOL_QUARTER_COLUMNS);
      var byWeek = allPeriods.indexOf(a.enrollment.week) - allPeriods.indexOf(b.enrollment.week);
      if (byWeek !== 0) return byWeek;
      return (a.kind || '').localeCompare(b.kind || '');
    });

    // Diff-based reconciliation: compute additions/cancellations/price
    // changes vs the current Dashboard and apply only those. Way faster
    // than full rebuild AND correctly transitions paid items into
    // 'refund-needed' when their registration disappears (the refund
    // flag the team needs).
    reconcileDashboard_(allItems);

    // Post-reconcile cleanup. Both functions are idempotent and cheap
    // (read one column, write a handful of cells / group structures
    // when needed). Running on every poll keeps the Dashboard cosmetic
    // state self-healing.
    try { sanitizeDashboardCustomerHeaders(); }
    catch (e) { Logger.log('[buildAllBilling] sanitize err: ' + e.message); }
    try { fixDashboardGroups(); }
    catch (e) { Logger.log('[buildAllBilling] group fix err: ' + e.message); }
    // Form-sheet quick links on header row K-O. 5 cell writes, idempotent.
    try { installFormSheetQuickLinks(); }
    catch (e) { Logger.log('[buildAllBilling] quick-links err: ' + e.message); }

    // Paid-invoice → dashboard sync: flip rows whose GHL invoice is now paid
    // (matched by the col-P invoiceId stamp) to 'paid'. Wrapped so a GHL
    // outage can never break the billing rebuild. See Invoicing.js.
    try { if (typeof syncPaidInvoices_ === 'function') syncPaidInvoices_(); }
    catch (e) { Logger.log('[buildAllBilling] paid-sync err: ' + e.message); }

    var elapsedMs = Date.now() - startedAt.getTime();
    Logger.log('[buildAllBilling] done in ' + elapsedMs + 'ms — totals: ' +
               allItems.length + ' tx rows, ' +
               allItems.filter(function(it){return it.unpriced;}).length + ' unpriced');
    perSheet.forEach(function(s) { Logger.log('  - ' + s); });
  } finally {
    lock.releaseLock();
  }
}

/* ═════════════════════════════════════════════════════════════════
   HIERARCHICAL DASHBOARD RENDERER
   ═════════════════════════════════════════════════════════════════
   Replaces the flat "Billing" tab output with the hierarchical
   layout the team prefers: customer header row → sub-header → tx
   rows grouped/collapsible beneath. Uses the existing helpers in
   SheetWrites.js so the look matches what the old GHL-poll pipeline
   produced (balance formula, profile column, row grouping, status
   pill conditional formatting, etc.).

   Status preservation across rebuilds: each tx row stores its
   fingerprint as part of the cell Note ("Submission ID: <fp>") on
   col B (Item). On rebuild, the renderer scans those Notes first,
   captures status pills by fingerprint, wipes the Dashboard data
   area, re-appends, and restores statuses where fingerprints match.

   $1 CC verification fee rows from processSubmissionVerificationFeeOnly
   used to live on this tab too. After this refactor they no longer
   get written (the function continues to log to the Logs sheet for
   audit, but stops writing to Dashboard). If the team needs them
   surfaced visually we can add a "CC Verification Fees" tab later.
   ═══════════════════════════════════════════════════════════════ */

/**
 * Walk every existing Dashboard tx row's col B Note, extract the
 * fingerprint (`Submission ID: <fp>`), and capture its current status
 * pill (col G value).
 */
function snapshotDashboardStatusesByFingerprint_() {
  var dash = getDashboardSheet();
  var lastRow = dash.getLastRow();
  if (lastRow < 2) return {};
  var notes = dash.getRange(2, 2, lastRow - 1, 1).getNotes();
  var statuses = dash.getRange(2, 7, lastRow - 1, 1).getValues();
  var out = {};
  for (var i = 0; i < notes.length; i++) {
    var n = String(notes[i][0] || '');
    if (!n) continue;
    var m = n.match(/Submission ID:\s*(\S+)/);
    if (!m) continue;
    var status = String(statuses[i][0] || '').toLowerCase().trim();
    if (status) out[m[1]] = status;
  }
  return out;
}

/**
 * Wipes the Dashboard data area (rows 2+) and all row groups, leaving
 * row 1 header intact. Resets formatting cleanly so the next rebuild
 * starts from a known baseline.
 */
function wipeDashboardDataArea_() {
  var dash = getDashboardSheet();
  var lastRow = dash.getLastRow();
  if (lastRow < 2) return;

  // Strip row groups first; otherwise deleteRows fails with "Cannot
  // delete rows in a group" in some edge cases.
  if (typeof resetAllRowGroups_ === 'function') {
    try { resetAllRowGroups_(dash); } catch (e) {
      Logger.log('[wipeDashboardDataArea_] resetAllRowGroups_ err: ' + e.message);
    }
  }
  dash.deleteRows(2, lastRow - 1);
}

/* ═════════════════════════════════════════════════════════════════
   DIFF-BASED RECONCILIATION (the new flow)
   ═════════════════════════════════════════════════════════════════
   Replaces the wipe-and-rebuild approach with surgical updates:

     for each existing fingerprint NOT in fresh registration data:
       if status == 'paid'     → set 'refund-needed' (the refund flag)
       if status in {'refund-needed','refunded'} → leave (audit trail)
       else                    → set 'canceled'

     for each fresh fingerprint NOT in existing dashboard:
       append a new tx row inside that customer's section
       (or create a new customer section if email is new)

     for each fingerprint in both:
       if price / total changed → update cells, keep status
       else                    → no-op

   Result:
     - 0 changes per 5-min poll → completes in <5s
     - Status pills NEVER lost — preserved by row position
     - Paid → canceled correctly transitions into refund-needed,
       which Tom resolves by issuing a refund externally and then
       flipping the status to refunded.
   ═══════════════════════════════════════════════════════════════ */

/**
 * Build the cell-Note text shown when hovering over an Item cell.
 * Surfaces source provenance prominently; fingerprint is stashed at
 * the very end as an internal reference (reconciler reads it).
 *
 * Format:
 *   Source: <sheet label>, <week>, row <N>
 *   Link: <url to source cell>
 *
 *   Pricing: <fee breakdown>
 *
 *   (Internal ref: <fingerprint>)
 */
function bfsBuildItemNote_(item) {
  var lines = [];
  if (item.enrollment && item.enrollment.sheetLabel) {
    var parts = [item.enrollment.sheetLabel];
    if (item.enrollment.week)      parts.push(item.enrollment.week);
    if (item.enrollment.sourceRow) parts.push('row ' + item.enrollment.sourceRow);
    lines.push('Source: ' + parts.join(', '));
  }
  if (item.linkToSource) {
    lines.push('Link: ' + item.linkToSource);
  }
  if (item.feeNote) {
    lines.push('');
    lines.push('Pricing: ' + item.feeNote);
  }
  if (item.fingerprint) {
    lines.push('');
    lines.push('(Internal ref: ' + item.fingerprint + ')');
  }
  return lines.join('\n');
}

/**
 * Build the human-readable label for a line item as it appears on the
 * Dashboard. Uses comma (no em-dash) per the team's preference.
 */
function bfsBuildItemLabel_(item) {
  if (item.enrollment && item.enrollment.student) {
    return item.enrollment.student + ', ' + item.label +
           (item.enrollment.week ? ' (' + item.enrollment.week + ')' : '');
  }
  return item.label;
}

/**
 * Build the HYPERLINK formula or plain label for col B (Item) based on
 * whether the item has a linkToSource URL.
 */
function bfsBuildItemCell_(item) {
  var label = bfsBuildItemLabel_(item);
  if (item.linkToSource) {
    return '=HYPERLINK("' + item.linkToSource + '","' +
           bfsEscapeFormula_(label) + '")';
  }
  return label;
}

/**
 * Escape double quotes inside strings destined for a formula literal.
 */
function bfsEscapeFormula_(s) {
  return String(s || '').replace(/"/g, '""');
}

/* ═════════════════════════════════════════════════════════════════
   CUSTOMER ENRICHMENT (GHL contact lookup)
   ═════════════════════════════════════════════════════════════════
   The registration sheets carry parent email + student name, but not
   reliably parent name / phone / waiver origin. Those live on the GHL
   contact. Enrichment runs one Search + one Get per unique email,
   caches the result for the rest of the execution, and falls back to
   empty strings when the contact can't be found or the API errors.

   2 calls per unique customer per run. At ~108 customers that's ~216
   calls — under 1% of the Workspace 100K UrlFetch daily quota. Per
   5-min reconciler run only NEW customers are looked up (the existing
   ones keep whatever enrichment was written on their last full
   refresh), so cost stays near zero on the steady-state cadence.
   ═══════════════════════════════════════════════════════════════ */
var BFS_ENRICH_CACHE = {};

function bfsClearEnrichCache_() {
  BFS_ENRICH_CACHE = {};
}

/**
 * Enrich a customer email with GHL contact data. Returns
 *   { name, phone, waiverOrigin, profileUrl }
 * with empty strings for any field that can't be resolved. Cached
 * per-email for the rest of the execution.
 */
function bfsEnrichCustomer_(email) {
  var out = { name: '', phone: '', waiverOrigin: '', profileUrl: '' };
  if (!email) return out;
  var key = String(email).toLowerCase().trim();
  if (BFS_ENRICH_CACHE.hasOwnProperty(key)) return BFS_ENRICH_CACHE[key];

  try {
    var contactId = ghlSearchContactByEmail('Florida', key);
    if (contactId) {
      var contact = {};
      try { contact = ghlGetContact('Florida', contactId) || {}; }
      catch (e2) { Logger.log('[bfsEnrichCustomer_] get ' + key + ' failed: ' + e2.message); }

      var first = String(contact.firstName || '').trim();
      var last  = String(contact.lastName  || '').trim();
      var full  = (first + ' ' + last).trim();
      if (!full) full = String(contact.contactName || contact.fullNameLowerCase || '').trim();

      out.name         = full;
      out.phone        = String(contact.phone || '').trim();
      try { out.waiverOrigin = readWaiverOrigin(contact); } catch (e3) {}
      out.profileUrl   = buildProfileUrl(SUBACCOUNTS.Florida.locationId, contactId);
    }
  } catch (e) {
    Logger.log('[bfsEnrichCustomer_] search ' + key + ' failed: ' + e.message);
  }

  BFS_ENRICH_CACHE[key] = out;
  return out;
}

/**
 * Build the 7-cell customer header row tuple given the enrichment.
 * Profile col is a HYPERLINK formula if a contact was found, else
 * empty. Balance col gets a SUMIFS formula computed by the caller.
 */
function bfsCustomerHeaderTuple_(enriched, email, students, balFormula) {
  var profileCell = enriched.profileUrl
    ? '=HYPERLINK("' + enriched.profileUrl + '","View profile")'
    : '';
  return [
    enriched.name || '',     // A: Parent name
    email,                   // B: Email
    enriched.phone || '',    // C: Phone
    enriched.waiverOrigin || '',  // D: Waiver Origin
    students,                // E: Student Names
    profileCell,             // F: Contact Profile
    balFormula               // G: Balance
  ];
}

/**
 * Walk the Dashboard tab and build a structured snapshot of what's
 * currently there. Returns:
 *   {
 *     customers: { [email]: {customerRow, subHeaderRow, txFirst, txLast,
 *                            name, phone, waiverOrigin, students, profile} },
 *     items:     { [fingerprint]: {row, customerEmail, status, price,
 *                                   total, item, qty, days, weeks, date} }
 *   }
 */
function readDashboardState_() {
  var dash = getDashboardSheet();
  var lastRow = dash.getLastRow();
  if (lastRow < 2) return { customers: {}, items: {} };

  // One bulk read for values + one for col B notes (fingerprints live there)
  var values = dash.getRange(2, 1, lastRow - 1, 7).getValues();
  var notes  = dash.getRange(2, 2, lastRow - 1, 1).getNotes();

  var customers = {};
  var items = {};
  var currentCustomer = null;

  for (var i = 0; i < values.length; i++) {
    var row = values[i];
    var sheetRow = i + 2;
    var a = String(row[0] || '').trim();
    var b = String(row[1] || '').trim();
    var g = String(row[6] || '').trim().toLowerCase();

    var isSubHeader = (a.toUpperCase() === 'DATE' && String(row[6] || '').toUpperCase() === 'STATUS');
    // Customer header detection:
    //   primary: col B contains '@' (the normal case)
    //   fallback: lookahead — if the very next row is a sub-header, this
    //   row is a customer header even if col B got corrupted (e.g.
    //   "small" pasted in place of an email by an earlier import bug).
    //   Without this fallback, a malformed header silently extends the
    //   previous customer's section across the bad row, which corrupts
    //   row-group rebuilds for the customer ABOVE it.
    var nextLooksLikeSubHeader = false;
    if (!isSubHeader && i + 1 < values.length) {
      var nextRow = values[i + 1];
      nextLooksLikeSubHeader =
        (String(nextRow[0] || '').toUpperCase() === 'DATE' &&
         String(nextRow[6] || '').toUpperCase() === 'STATUS');
    }
    var isCustomerHeader = (!isSubHeader && (b.indexOf('@') !== -1 || nextLooksLikeSubHeader));

    if (isCustomerHeader) {
      currentCustomer = {
        email:        b.toLowerCase(),
        customerRow:  sheetRow,
        subHeaderRow: null,
        txFirst:      null,
        txLast:       null,
        name:         row[0],
        phone:        row[2],
        waiverOrigin: row[3],
        students:     row[4],
        profile:      row[5]
      };
      customers[currentCustomer.email] = currentCustomer;
      continue;
    }
    if (isSubHeader) {
      if (currentCustomer) currentCustomer.subHeaderRow = sheetRow;
      continue;
    }
    if (!currentCustomer) continue;

    // Tx row
    if (currentCustomer.txFirst === null) currentCustomer.txFirst = sheetRow;
    currentCustomer.txLast = sheetRow;

    // Extract fingerprint from col B note. New format uses "(Internal
    // ref: <fp>)"; legacy uses "Submission ID: <fp>". The (Internal
    // ref: ...) form is multi-word-safe (we match everything up to
    // the closing paren); the legacy form stops at whitespace which
    // is fine since legacy fingerprints had no spaces. Bug 2026-05-14:
    // earlier this regex was [^)\s]+ which truncated multi-word
    // fingerprints like "...|tuition|3 days" at the space, causing
    // every reconciler tick to mass-cancel all tuition rows.
    var note = String(notes[i][0] || '');
    var fpMatch = note.match(/Internal ref:\s*([^)]+)\)/) ||
                  note.match(/Submission ID:\s*(\S+)/);
    if (!fpMatch) continue;  // row without fingerprint — skip from diff
    var fp = fpMatch[1].trim();

    items[fp] = {
      row:           sheetRow,
      customerEmail: currentCustomer.email,
      status:        g,
      price:         Number(row[2]) || 0,
      total:         Number(row[5]) || 0,
      item:          String(row[1] || ''),
      days:          row[3],
      weeks:         row[4],
      date:          row[0]
    };
  }

  return { customers: customers, items: items };
}

/**
 * Diff the fresh items against existing Dashboard state, apply minimal
 * updates. Returns a summary of what changed.
 */
function reconcileDashboard_(freshItems) {
  var startedAt = new Date();

  // 1. Snapshot existing state
  var state = readDashboardState_();
  var existingItems = state.items;
  var existingCustomers = state.customers;

  // 2. Build fresh lookup
  var freshByFingerprint = {};
  freshItems.forEach(function(it) {
    if (!it || !it.fingerprint) return;
    freshByFingerprint[it.fingerprint] = it;
  });

  // 3. Compute diff
  var statusUpdates = [];   // [{row, newStatus, oldStatus, customerEmail}]
  var priceUpdates  = [];   // [{row, newPrice, newTotal}]
  var newItemsByCustomer = {};  // {email: [items]}
  var rowsToDelete  = [];   // legacy fee/tax rows (architectural debris)

  // 3a. Cancellations: existing fingerprints no longer in fresh
  Object.keys(existingItems).forEach(function(fp) {
    if (freshByFingerprint[fp]) return;  // still present, not a cancellation
    var existing = existingItems[fp];

    // Legacy tax/fee fingerprints (architectural debris) — delete the
    // row outright. These exist on Dashboards built before fees moved
    // inline. Fingerprint patterns:
    //   *|tax-7pct    — the old shirt sales-tax row
    //   processing-fee|*  — the old per-customer fee row
    if (/\|tax-\d+pct$/.test(fp) || fp.indexOf('processing-fee|') === 0) {
      rowsToDelete.push(existing.row);
      return;
    }

    // Normal cancellation lifecycle
    var oldStatus = existing.status;
    var newStatus;
    if (oldStatus === 'paid') {
      newStatus = 'refund-needed';   // <-- the flag the user asked for
    } else if (oldStatus === 'refund-needed' || oldStatus === 'refunded') {
      return;  // already in refund flow — don't overwrite
    } else if (oldStatus === 'canceled') {
      return;  // already canceled — no-op
    } else {
      newStatus = 'canceled';
    }
    statusUpdates.push({
      row: existing.row,
      newStatus: newStatus,
      oldStatus: oldStatus,
      customerEmail: existing.customerEmail
    });
  });

  // 3b. Additions + price updates
  Object.keys(freshByFingerprint).forEach(function(fp) {
    var fresh = freshByFingerprint[fp];
    var existing = existingItems[fp];
    if (existing) {
      // Price/total comparison
      var newPrice = Number(fresh.price) || 0;
      var newTotal = Number(fresh.total) || 0;
      if (Math.abs(existing.price - newPrice) > 0.005 ||
          Math.abs(existing.total - newTotal) > 0.005) {
        priceUpdates.push({
          row:           existing.row,
          newPrice:      newPrice,
          newTotal:      newTotal,
          fresh:         fresh,   // for label + linkToSource upgrade
          customerEmail: existing.customerEmail
        });
      }
      return;
    }
    // Brand-new fingerprint
    var email = (fresh.enrollment.email || '').toLowerCase();
    if (!email) return;
    if (!newItemsByCustomer[email]) newItemsByCustomer[email] = [];
    newItemsByCustomer[email].push(fresh);
  });

  var summary = {
    elapsedMs:    null,
    statusUpdates:  statusUpdates.length,
    priceUpdates:   priceUpdates.length,
    newItemRows:    0,
    newCustomers:   0,
    refundNeeded:   statusUpdates.filter(function(u) { return u.newStatus === 'refund-needed'; }).length,
    canceled:       statusUpdates.filter(function(u) { return u.newStatus === 'canceled'; }).length,
    notesRefreshed: 0
  };

  var dash = getDashboardSheet();

  // 4a. Provenance-note sweep FIRST, before the no-changes early-return.
  //     Source row numbers in cell notes go stale every time a teammate
  //     reorders or deletes rows in a reg sheet, even when the
  //     fingerprint-based diff shows no other changes. Compare the
  //     freshly-computed note for each matched fingerprint against the
  //     current note on the row and rewrite where they differ. Done in
  //     ONE batch setNotes call so cost is flat regardless of how many
  //     tx rows there are.
  try {
    var swDashLast = dash.getLastRow();
    if (swDashLast >= 2) {
      var swNotesRange = dash.getRange(2, 2, swDashLast - 1, 1);
      var swCurrent = swNotesRange.getNotes();
      var swRowToFp = {};
      Object.keys(existingItems).forEach(function(fp) {
        swRowToFp[existingItems[fp].row] = fp;
      });
      var swChanged = false;
      for (var ni = 0; ni < swCurrent.length; ni++) {
        var sheetRow = ni + 2;
        var fp = swRowToFp[sheetRow];
        if (fp && freshByFingerprint[fp]) {
          var newNote = bfsBuildItemNote_(freshByFingerprint[fp]);
          if (newNote !== swCurrent[ni][0]) {
            swCurrent[ni][0] = newNote;
            summary.notesRefreshed++;
            swChanged = true;
          }
        }
      }
      if (swChanged) swNotesRange.setNotes(swCurrent);
    }
  } catch (sweepErr) {
    Logger.log('[reconcileDashboard_] note sweep err: ' + sweepErr.message);
  }

  // 4b. No other changes → exit fast (note sweep above still happened)
  if (statusUpdates.length === 0 && priceUpdates.length === 0 && Object.keys(newItemsByCustomer).length === 0) {
    summary.elapsedMs = Date.now() - startedAt.getTime();
    Logger.log('[reconcileDashboard_] no diff changes (' + summary.elapsedMs + 'ms, ' +
               summary.notesRefreshed + ' source notes refreshed)');
    return summary;
  }

  // 5. Apply legacy row deletions FIRST (descending row order so
  //    indices we still need don't shift). Touches:
  //      - rows for the deprecated Sales Tax (7%) format
  //      - rows for the deprecated Payment Processing Fee (3%) format
  if (rowsToDelete.length > 0) {
    rowsToDelete.sort(function(a, b) { return b - a; });
    rowsToDelete.forEach(function(r) {
      try { dash.deleteRows(r, 1); }
      catch (e) { Logger.log('[reconcileDashboard_] delete err row ' + r + ': ' + e.message); }
    });
    // After deletions all row numbers above the deletions point have
    // shifted. statusUpdates / priceUpdates row refs are now stale —
    // safest path is to re-snapshot. Cheap on subsequent runs since
    // there should be zero legacy rows left.
    var rebuiltState = readDashboardState_();
    existingItems = rebuiltState.items;
    existingCustomers = rebuiltState.customers;
    // Re-resolve statusUpdates + priceUpdates against rebuilt state
    statusUpdates = statusUpdates.map(function(u) {
      // Find the same fingerprint in the new state. If it's gone
      // (because deletion shifted things around), skip silently.
      for (var fp in existingItems) {
        var it = existingItems[fp];
        if (it.customerEmail === u.customerEmail && it.status === u.oldStatus) {
          return Object.assign({}, u, { row: it.row });
        }
      }
      return null;
    }).filter(Boolean);
    priceUpdates = priceUpdates.map(function(u) {
      var fp = u.fresh && u.fresh.fingerprint;
      if (fp && existingItems[fp]) {
        return Object.assign({}, u, { row: existingItems[fp].row });
      }
      return null;
    }).filter(Boolean);
  }

  // 6. Apply status updates. Each cell: clear any stale validation
  //    (legacy rule might not include 'refund-needed'), write the new
  //    value, then re-apply the expanded validation rule so the
  //    dropdown still works for Erin.
  var statusRule = SpreadsheetApp.newDataValidation()
    .requireValueInList(STATUS_VALUES, true)
    .setAllowInvalid(true)  // tolerant — legacy values still accepted
    .build();
  statusUpdates.forEach(function(u) {
    dash.getRange(u.row, 7)
      .clearDataValidations()
      .setValue(u.newStatus)
      .setDataValidation(statusRule);
  });

  // 7. Apply price/total updates AND overwrite the Item cell with a
  //    HYPERLINK formula pointing to the source cell in the
  //    registration sheet (real-time provenance). Also refresh the
  //    fee-breakdown Note.
  priceUpdates.forEach(function(u) {
    dash.getRange(u.row, 3).setValue(u.newPrice);
    dash.getRange(u.row, 6).setValue(u.newTotal);
    if (u.fresh) {
      var label = bfsBuildItemLabel_(u.fresh);
      var cellB = dash.getRange(u.row, 2);
      if (u.fresh.linkToSource) {
        cellB.setFormula('=HYPERLINK("' + u.fresh.linkToSource + '","' +
                         bfsEscapeFormula_(label) + '")');
      } else {
        cellB.setValue(label);
      }
      cellB.setFontLine('none');  // strip default HYPERLINK underline
      // Note: provenance-first (source sheet + week + row + link),
      // fee breakdown, fingerprint at the bottom as internal ref
      cellB.setNote(bfsBuildItemNote_(u.fresh));
    }
  });

  // 7. Insert new tx rows beneath existing customers + new customer sections
  Object.keys(newItemsByCustomer).forEach(function(email) {
    var customer = existingCustomers[email];
    var newItems = newItemsByCustomer[email];
    if (customer && customer.txLast) {
      // Append to existing customer's section
      appendItemsToCustomerSection_(dash, customer, newItems);
      summary.newItemRows += newItems.length;
    } else {
      // Create a new customer section at the end of the sheet
      appendNewCustomerSection_(dash, email, newItems);
      summary.newItemRows += newItems.length;
      summary.newCustomers++;
    }
  });

  // 8. Refresh balance Note for every customer touched (status change,
  //    price change, or new items). Uses the items they currently
  //    have in `freshByFingerprint` grouped by email.
  var touchedEmails = {};
  statusUpdates.forEach(function(u) { touchedEmails[u.customerEmail] = true; });
  priceUpdates.forEach(function(u) {
    // Look up customer email from the row number
    Object.keys(existingItems).forEach(function(fp) {
      if (existingItems[fp].row === u.row) {
        touchedEmails[existingItems[fp].customerEmail] = true;
      }
    });
  });
  Object.keys(newItemsByCustomer).forEach(function(email) { touchedEmails[email] = true; });

  // Group fresh items by email for the note builder
  var freshByEmail = {};
  freshItems.forEach(function(it) {
    var em = (it.enrollment.email || '').toLowerCase();
    if (!em) return;
    if (!freshByEmail[em]) freshByEmail[em] = [];
    freshByEmail[em].push(it);
  });

  Object.keys(touchedEmails).forEach(function(email) {
    var customer = existingCustomers[email];
    if (!customer || !customer.customerRow) return;
    var itemsForCustomer = freshByEmail[email] || [];
    var note = buildBalanceNote_(email, itemsForCustomer);
    dash.getRange(customer.customerRow, 7).setNote(note);
  });

  summary.elapsedMs = Date.now() - startedAt.getTime();
  Logger.log('[reconcileDashboard_] ' + summary.elapsedMs + 'ms - ' +
             summary.statusUpdates + ' status changes (' + summary.refundNeeded + ' refund-needed, ' +
             summary.canceled + ' canceled), ' + summary.priceUpdates + ' price updates, ' +
             summary.newItemRows + ' new tx rows, ' + summary.newCustomers + ' new customer sections, ' +
             Object.keys(touchedEmails).length + ' balance notes refreshed, ' +
             summary.notesRefreshed + ' source notes refreshed');
  return summary;
}

/**
 * Insert new tx rows at the bottom of an existing customer's section,
 * preserving the row group and balance formula (Sheets auto-extends
 * both when rows are inserted inside the group's range).
 */
function appendItemsToCustomerSection_(dash, customer, newItems) {
  var insertPos = customer.txLast;  // insert AFTER this row
  dash.insertRowsAfter(insertPos, newItems.length);

  var firstNew = insertPos + 1;
  var matrix = newItems.map(function(it) {
    // initialStatus (from Manual Items col H) wins over 'owed' default
    // on first render; unpriced/ambiguous always trump it because those
    // flags signal the item can't be priced cleanly yet.
    var status = it.unpriced
      ? 'unpriced'
      : (it.ambiguous ? 'ambiguous' : (it.initialStatus || 'owed'));
    var label = bfsBuildItemCell_(it);  // HYPERLINK formula or plain text
    var dc = (it.enrollment && Number(it.enrollment.dayCount)) || 0;
    var daysCell  = dc > 0 ? dc : '';
    var weeksCell = (it.enrollment && it.enrollment.week) || '';
    return [
      Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyy-MM-dd'),
      label,
      Number(it.price) || 0,
      daysCell,
      weeksCell,
      Number(it.total) || 0,
      status
    ];
  });
  dash.getRange(firstNew, 1, matrix.length, 7).setValues(matrix);

  // Provenance + pricing + internal-ref Notes on each Item cell
  var noteValues = newItems.map(function(it) {
    return [bfsBuildItemNote_(it)];
  });
  dash.getRange(firstNew, 2, noteValues.length, 1).setNotes(noteValues);

  // Strip default HYPERLINK underline + number formats + status validation
  dash.getRange(firstNew, 1, matrix.length, 7).setFontLine('none');
  dash.getRange(firstNew, 3, matrix.length, 1).setNumberFormat('"$"#,##0.00');
  dash.getRange(firstNew, 6, matrix.length, 1).setNumberFormat('"$"#,##0.00');
  var statusRule = SpreadsheetApp.newDataValidation()
    .requireValueInList(STATUS_VALUES, true)
    .setAllowInvalid(true).build();
  dash.getRange(firstNew, 7, matrix.length, 1).setDataValidation(statusRule);

  // Extend the existing customer's row group to cover the inserted rows
  // so the new tx rows collapse with the rest of the section.
  //
  // Defensive: Sheets sometimes auto-extends groups when rows are
  // inserted inside an existing group, so the new rows may already be
  // at depth 1. Calling shiftRowGroupDepth(1) on already-depth-1 rows
  // pushes them to depth 2, which is what created the nested-groups
  // bug. Check current depth first.
  try {
    var depth = dash.getRowGroupDepth(firstNew);
    if (depth < 1) {
      dash.getRange(firstNew, 1, matrix.length, 1).shiftRowGroupDepth(1);
    }
  } catch (e) {
    Logger.log('[appendItemsToCustomerSection_] group extend err: ' + e.message);
  }

  // DM Sans
  dash.getRange(firstNew, 1, matrix.length, 7).setFontFamily('DM Sans');
}

/**
 * Append a brand-new customer section at the end of the sheet
 * (customer header + sub-header + tx rows + balance formula).
 */
function appendNewCustomerSection_(dash, email, newItems) {
  var lastRow = dash.getLastRow();
  var customerRow  = lastRow + 1;
  var subHeaderRow = customerRow + 1;
  var firstTx      = subHeaderRow + 1;
  var lastTx       = firstTx + newItems.length - 1;

  // Build matrix: customer header + sub-header + tx rows
  var studentSet = {};
  newItems.forEach(function(it) { studentSet[it.enrollment.student] = true; });
  var students = Object.keys(studentSet).sort().join(', ');

  var enriched = bfsEnrichCustomer_(email);
  var matrix = [
    bfsCustomerHeaderTuple_(enriched, email, students, ''),  // customer header (balance set via formula below)
    ['DATE', 'ITEM', 'UNIT PRICE (incl. tax + fee)', 'DAYS', 'WEEKS', 'TOTAL', 'STATUS']  // sub-header
  ];
  newItems.forEach(function(it) {
    var status = it.unpriced
      ? 'unpriced'
      : (it.ambiguous ? 'ambiguous' : (it.initialStatus || 'owed'));
    var label = bfsBuildItemCell_(it);  // HYPERLINK formula or plain text
    var dc = (it.enrollment && Number(it.enrollment.dayCount)) || 0;
    var daysCell  = dc > 0 ? dc : '';
    var weeksCell = (it.enrollment && it.enrollment.week) || '';
    matrix.push([
      Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyy-MM-dd'),
      label,
      Number(it.price) || 0,
      daysCell,
      weeksCell,
      Number(it.total) || 0,
      status
    ]);
  });

  dash.getRange(customerRow, 1, matrix.length, 7).setValues(matrix);

  // Styles
  dash.getRange(customerRow, 1, 1, 7)
    .setBackground('#143980').setFontColor('#FFFFFF').setFontWeight('bold').setFontSize(12);
  dash.getRange(subHeaderRow, 1, 1, 7)
    .setBackground('#4a6493').setFontColor('#FFFFFF').setFontWeight('bold').setFontSize(10);

  // Balance formula
  dash.getRange(customerRow, 7).setFormula(
    '=SUMIFS(F' + firstTx + ':F' + lastTx +
    ', G' + firstTx + ':G' + lastTx + ', "owed")'
  ).setNumberFormat('"$"#,##0.00');

  // Number formats + dropdown + notes
  dash.getRange(firstTx, 3, newItems.length, 1).setNumberFormat('"$"#,##0.00');
  dash.getRange(firstTx, 6, newItems.length, 1).setNumberFormat('"$"#,##0.00');
  var statusRule = SpreadsheetApp.newDataValidation()
    .requireValueInList(STATUS_VALUES, true)
    .setAllowInvalid(true).build();
  dash.getRange(firstTx, 7, newItems.length, 1).setDataValidation(statusRule);
  var noteValues = newItems.map(function(it) {
    return [bfsBuildItemNote_(it)];
  });
  dash.getRange(firstTx, 2, noteValues.length, 1).setNotes(noteValues);

  // Row group + collapse
  try {
    dash.getRange(subHeaderRow, 1, lastTx - subHeaderRow + 1, 1).shiftRowGroupDepth(1);
    var grp = dash.getRowGroup(subHeaderRow, 1);
    if (grp) grp.collapse();
  } catch (e) {
    Logger.log('[appendNewCustomerSection_] group create err for ' + email +
               ' (subHeaderRow=' + subHeaderRow + ', lastTx=' + lastTx + '): ' + e.message);
  }

  // DM Sans + no-underline (HYPERLINK cells would otherwise show underlined)
  dash.getRange(customerRow, 1, matrix.length, 7)
      .setFontFamily('DM Sans')
      .setFontLine('none');
}

/**
 * Build the cell-note text for a customer's balance cell. Lists every
 * "owed" item with its line total, sums to the balance. No em-dashes.
 *
 * Note format example:
 *
 *   Balance breakdown for parent@example.com:
 *
 *   Nelson Gonzalez:
 *     Camp Tuition (3 days), June 1st-5th: $293.55
 *     T-Shirt (Small), one-time: $33.00
 *
 *   Vladimir Aheyev:
 *     After care weekly, June 8th-12th: $180.25
 *
 *   Total owed: $506.80
 *
 *   Prices include the inline tax and processing fee per item; hover
 *   over each Item cell for the per-unit breakdown.
 */
function buildBalanceNote_(email, items) {
  var owedItems = items.filter(function(it) {
    var status = it.statusOverride || (it.unpriced ? 'unpriced' : (it.ambiguous ? 'ambiguous' : 'owed'));
    return status === 'owed' || status === 'unpriced' || status === 'ambiguous';
  });
  if (owedItems.length === 0) return 'No outstanding items for ' + email + '.';

  // Group by student
  var byStudent = {};
  owedItems.forEach(function(it) {
    var s = it.enrollment.student || '(no student)';
    if (!byStudent[s]) byStudent[s] = [];
    byStudent[s].push(it);
  });

  var lines = ['Balance breakdown for ' + email + ':', ''];
  var total = 0;
  Object.keys(byStudent).sort().forEach(function(student) {
    lines.push(student + ':');
    byStudent[student].forEach(function(it) {
      var amt = Number(it.total) || 0;
      total += amt;
      var period = it.enrollment.week
        ? ', ' + it.enrollment.week
        : '';
      lines.push('  ' + it.label + period + ': $' + amt.toFixed(2));
    });
    lines.push('');
  });
  lines.push('Total owed: $' + total.toFixed(2));
  lines.push('');
  lines.push('Prices include inline tax and processing fee per item. Hover over each Item cell for the per-unit breakdown.');

  return lines.join('\n');
}

/**
 * NUCLEAR RESET — wipes the Dashboard data area completely and
 * rebuilds it from registration sheets in one clean pass.
 *
 * Use when:
 *   - The Dashboard accumulated duplicates from prior reconciler runs
 *     that couldn't match legacy GHL-format fingerprints against the
 *     new email|student|week|kind|item format (a one-time migration
 *     side-effect from the architecture switch).
 *   - You want a known-clean starting point before letting the
 *     5-min reconciler maintain incremental updates from there.
 *
 * Destroys ALL status pills (marks any prior "paid" or "refund-needed"
 * back to "owed"). Only safe to run when no items have been marked
 * paid yet — confirm by checking the Dashboard for paid rows first.
 *
 * After running, every item is fingerprinted in the new format, so
 * subsequent reconciler runs will diff cleanly.
 */
function nuclearResetBilling() {
  // Hold the same script lock that buildAllBilling uses. Without
  // this, running nuclearResetBilling from two accounts at once
  // (or alongside the 5-min reconciler) corrupts the Dashboard
  // because both runs race on setValues / clearContent.
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(120000)) {
    Logger.log('[nuclearResetBilling] could not acquire lock after 2 min — another run is taking unusually long. Skipping.');
    return;
  }
  try {
    return nuclearResetBilling_();
  } finally {
    lock.releaseLock();
  }
}

function nuclearResetBilling_() {
  var startedAt = new Date();
  Logger.log('[nuclearResetBilling] start at ' + startedAt.toISOString());
  bfsClearEnrichCache_();  // fresh enrichment lookups for every full rebuild

  // 0. Snapshot existing per-fingerprint statuses so the rebuild doesn't
  //    lose paid / refunded / refund-needed flags Erin or Tom has set
  //    manually. readDashboardState_ parses both the new "Internal ref"
  //    note format and the legacy "Submission ID" format.
  var priorStatuses = {};
  try {
    var existingState = readDashboardState_();
    Object.keys(existingState.items).forEach(function(fp) {
      var s = String(existingState.items[fp].status || '').toLowerCase().trim();
      if (s) priorStatuses[fp] = s;
    });
    Logger.log('[nuclearResetBilling] snapshotted ' +
               Object.keys(priorStatuses).length + ' prior statuses');
  } catch (snapErr) {
    Logger.log('[nuclearResetBilling] status snapshot failed: ' + snapErr.message +
               ' — proceeding with all-fresh statuses');
  }

  // 1. Build fresh items from registration sheets
  var catalog = readPricingCatalog_();
  var registrationSheets = discoverRegistrationSheets_();
  registrationSheets = bfsFilterBillable_(registrationSheets, '[nuclearResetBilling]');
  var allItems = [];
  var seenShirts = {};
  registrationSheets.forEach(function(reg) {
    try {
      var enrollments = (reg.type === 'after-school')
        ? readAfterSchoolEnrollments_(reg)
        : readRegistrationEnrollments_(reg);
      enrollments.forEach(function(e) {
        var items = priceEnrollment_(e, catalog);
        items.forEach(function(it) {
          if (it.oneTimePerStudent) {
            if (seenShirts[it.fingerprint]) return;
            seenShirts[it.fingerprint] = true;
          }
          it.enrollment = e;
          allItems.push(it);
        });
      });
    } catch (e) {
      Logger.log('[nuclearResetBilling] read err for ' + reg.label + ': ' + e.message);
    }
  });

  // Manual Items tab merged in alongside reg-sheet items. Same dedup +
  // status-preservation machinery handles them downstream.
  try {
    var manualItems = readManualItems_();
    manualItems.forEach(function(it) { allItems.push(it); });
    Logger.log('[nuclearResetBilling] manual-items: ' + manualItems.length);
  } catch (e) {
    Logger.log('[nuclearResetBilling] manual-items read failed: ' + e.message);
  }

  // Dedup by fingerprint (registration data-entry duplicates)
  var byFp = {};
  allItems.forEach(function(it) {
    if (it && it.fingerprint && !byFp[it.fingerprint]) byFp[it.fingerprint] = it;
  });
  allItems = Object.keys(byFp).map(function(fp) { return byFp[fp]; });
  Logger.log('[nuclearResetBilling] ' + allItems.length + ' unique fresh items');

  // 2. Group by parent email + sort
  var byParent = {};
  allItems.forEach(function(it) {
    var email = (it.enrollment.email || '').toLowerCase();
    if (!email) return;
    if (!byParent[email]) {
      byParent[email] = {
        email:    email,
        emailRaw: it.enrollment.emailRaw || email,
        students: {},
        items:    []
      };
    }
    byParent[email].students[it.enrollment.student] = true;
    byParent[email].items.push(it);
  });

  var allPeriods = BFS_WEEK_ORDER
    .concat(AFTER_SCHOOL_MONTH_COLUMNS)
    .concat(AFTER_SCHOOL_QUARTER_COLUMNS);
  var emails = Object.keys(byParent).sort();

  // 3. Build PARALLEL matrices in one pass — data + every formatting
  //    dimension we'd otherwise set per-customer. setValues +
  //    setBackgrounds + setFontColors + etc. each take a 2D array and
  //    apply the whole sheet in ONE API call. Cuts ~108 customers ×
  //    10 per-customer calls down to ~10 batch calls total. ~30s
  //    instead of >6 min.
  var dataMatrix = [];
  var bgMatrix = [];
  var fontColorMatrix = [];
  var fontWeightMatrix = [];
  var fontSizeMatrix = [];
  var noteMatrix = [];
  var numFormatMatrix = [];

  var nowDateStr = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyy-MM-dd');
  var currentRow = 2;
  var customerGroups = [];  // [{subHeaderRow, txLast}] for the row-group pass

  function blankRow7(v) { return [v,v,v,v,v,v,v]; }

  emails.forEach(function(email) {
    var p = byParent[email];
    var studentNames = Object.keys(p.students).sort();
    p.items.sort(function(a, b) {
      var s = (a.enrollment.student || '').localeCompare(b.enrollment.student || '');
      if (s !== 0) return s;
      var w = allPeriods.indexOf(a.enrollment.week) - allPeriods.indexOf(b.enrollment.week);
      if (w !== 0) return w;
      return (a.kind || '').localeCompare(b.kind || '');
    });

    var customerRowIdx = currentRow;
    var subHeaderIdx   = currentRow + 1;
    var txFirst        = currentRow + 2;
    var txLast         = txFirst + p.items.length - 1;

    // Customer header row: enriched parent name + phone + waiver origin
    // + contact-profile link from a GHL contact lookup; email + students
    // + balance formula always present.
    var balFormula = (p.items.length > 0)
      ? '=SUMIFS(F' + txFirst + ':F' + txLast + ', G' + txFirst + ':G' + txLast + ', "owed")'
      : '';
    var enriched = bfsEnrichCustomer_(p.emailRaw);
    dataMatrix.push(bfsCustomerHeaderTuple_(
      enriched, p.emailRaw, studentNames.join(', '), balFormula
    ));
    bgMatrix.push(blankRow7('#143980'));
    fontColorMatrix.push(blankRow7('#FFFFFF'));
    fontWeightMatrix.push(blankRow7('bold'));
    fontSizeMatrix.push(blankRow7(12));
    // Balance note on col G (index 6): per-customer breakdown of every
    // owed/unpriced/ambiguous item. Hover the balance to see the math.
    var customerNoteRow = blankRow7('');
    customerNoteRow[6] = buildBalanceNote_(p.emailRaw, p.items);
    noteMatrix.push(customerNoteRow);
    numFormatMatrix.push(['','','','','','','"$"#,##0.00']);
    currentRow++;

    // Sub-header row
    dataMatrix.push(['DATE', 'ITEM', 'UNIT PRICE (incl. tax + fee)', 'DAYS', 'WEEKS', 'TOTAL', 'STATUS']);
    bgMatrix.push(blankRow7('#4a6493'));
    fontColorMatrix.push(blankRow7('#FFFFFF'));
    fontWeightMatrix.push(blankRow7('bold'));
    fontSizeMatrix.push(blankRow7(10));
    noteMatrix.push(blankRow7(''));
    numFormatMatrix.push(blankRow7(''));
    currentRow++;

    // Tx rows
    p.items.forEach(function(it) {
      // Status: prefer the prior pill if it's a user-controlled value
      // (paid/refunded/refund-needed); otherwise use the fresh pricer
      // verdict. We don't preserve 'canceled' because if the fingerprint
      // is back in fresh items, the row was re-added in the reg sheet
      // and the parent owes again. Don't preserve 'owed'/'unpriced'/
      // 'ambiguous' either — those are auto-set and should reflect
      // fresh state.
      var freshStatus = it.unpriced
        ? 'unpriced'
        : (it.ambiguous ? 'ambiguous' : 'owed');
      var prior = priorStatuses[it.fingerprint];
      var defaultStatus;
      if (prior === 'paid' || prior === 'refunded' || prior === 'refund-needed') {
        // Operator-controlled state from a prior render: never overwrite.
        defaultStatus = prior;
      } else if (!prior && it.initialStatus && !it.unpriced && !it.ambiguous) {
        // First-time render of a manual item carrying an Initial Status
        // override (Manual Items col H). Once it's on the Dashboard, the
        // prior-preserving branch above takes over.
        defaultStatus = it.initialStatus;
      } else {
        defaultStatus = freshStatus;
      }

      var label = bfsBuildItemCell_(it);  // HYPERLINK formula or plain text
      // Days: enrollment.dayCount when present (1+), else blank.
      // Weeks: enrollment.week label (e.g. "June 1st-5th" or "Q2" or
      // "March"). Always populate so the team can scan by period.
      var dc = (it.enrollment && Number(it.enrollment.dayCount)) || 0;
      var daysCell  = dc > 0 ? dc : '';
      var weeksCell = (it.enrollment && it.enrollment.week) || '';
      dataMatrix.push([
        nowDateStr,
        label,
        Number(it.price) || 0,
        daysCell,
        weeksCell,
        Number(it.total) || 0,
        defaultStatus
      ]);
      bgMatrix.push(blankRow7('#FFFFFF'));
      fontColorMatrix.push(blankRow7('#000000'));
      fontWeightMatrix.push(blankRow7('normal'));
      fontSizeMatrix.push(blankRow7(11));
      noteMatrix.push(['', bfsBuildItemNote_(it), '', '', '', '', '']);
      numFormatMatrix.push(['','','"$"#,##0.00','','','"$"#,##0.00','']);
      currentRow++;
    });

    customerGroups.push({ subHeaderRow: subHeaderIdx, txLast: txLast, email: p.emailRaw });
  });

  Logger.log('[nuclearResetBilling] matrices built: ' + dataMatrix.length + ' rows for ' +
             emails.length + ' customers');

  // 4. Wipe Dashboard data area
  var dash = getDashboardSheet();
  if (typeof resetAllRowGroups_ === 'function') {
    try { resetAllRowGroups_(dash); } catch (e) { /* fall through */ }
  }
  var oldLastRow = dash.getLastRow();
  if (oldLastRow >= 2) {
    dash.getRange(2, 1, oldLastRow - 1, dash.getMaxColumns())
        .clearContent().clearFormat().clearDataValidations().clearNote();
  }
  Logger.log('[nuclearResetBilling] wiped ' + (oldLastRow - 1) + ' old rows');

  if (dataMatrix.length === 0) {
    Logger.log('[nuclearResetBilling] no items — Dashboard left empty');
    return;
  }

  // 5. Batch-apply EVERYTHING to one big range
  var range = dash.getRange(2, 1, dataMatrix.length, 7);
  range.setValues(dataMatrix);          // includes inline balance formulas
  range.setBackgrounds(bgMatrix);
  range.setFontColors(fontColorMatrix);
  range.setFontWeights(fontWeightMatrix);
  range.setFontSizes(fontSizeMatrix);
  range.setNotes(noteMatrix);
  range.setNumberFormats(numFormatMatrix);
  range.setFontFamily('DM Sans');
  range.setFontLine('none');  // strip default underline from HYPERLINK cells (Item col B + Profile col F)

  // 6. Status validation — only on tx rows. Earlier versions applied
  //    the rule to all of col G which made Sheets flash a red "Invalid"
  //    triangle on every customer-row balance cell (a SUMIFS number is
  //    not in STATUS_VALUES). Build a parallel 2D rules matrix with
  //    statusRule for tx rows and null elsewhere, then push it all in
  //    one batch.
  var statusRule = SpreadsheetApp.newDataValidation()
    .requireValueInList(STATUS_VALUES, true)
    .setAllowInvalid(true).build();
  var validationMatrix = [];
  for (var vi = 0; vi < dataMatrix.length; vi++) validationMatrix.push([null]);
  customerGroups.forEach(function(g) {
    // dataMatrix index = sheetRow - 2. tx rows = subHeaderRow+1 .. txLast.
    var firstIdx = g.subHeaderRow - 1;  // (subHeaderRow + 1) - 2
    var lastIdx  = g.txLast - 2;
    for (var j = firstIdx; j <= lastIdx; j++) {
      if (j >= 0 && j < validationMatrix.length) {
        validationMatrix[j] = [statusRule];
      }
    }
  });
  dash.getRange(2, 7, dataMatrix.length, 1).setDataValidations(validationMatrix);

  // 7. Conditional formatting (one-shot, covers all tx rows)
  var fullDataRange = dash.getRange(2, 1, dataMatrix.length, 7);
  var statusColAll  = dash.getRange(2, 7, dataMatrix.length, 1);
  var rules = [];
  rules.push(SpreadsheetApp.newConditionalFormatRule()
    .whenFormulaSatisfied('=OR($G2="unpriced",$G2="ambiguous")')
    .setBackground('#FFF3B0').setRanges([fullDataRange]).build());
  rules.push(SpreadsheetApp.newConditionalFormatRule()
    .whenTextEqualTo('paid').setBackground('#D4EDDA').setFontColor('#155724').setBold(true)
    .setRanges([statusColAll]).build());
  rules.push(SpreadsheetApp.newConditionalFormatRule()
    .whenTextEqualTo('owed').setBackground('#FFF3CD').setFontColor('#856404')
    .setRanges([statusColAll]).build());
  rules.push(SpreadsheetApp.newConditionalFormatRule()
    .whenTextEqualTo('canceled').setBackground('#E2E3E5').setFontColor('#383D41')
    .setRanges([statusColAll]).build());
  rules.push(SpreadsheetApp.newConditionalFormatRule()
    .whenTextEqualTo('refunded').setBackground('#FFE5CC').setFontColor('#A05A00')
    .setRanges([statusColAll]).build());
  rules.push(SpreadsheetApp.newConditionalFormatRule()
    .whenTextEqualTo('refund-needed').setBackground('#FFE5CC').setFontColor('#A05A00').setBold(true)
    .setRanges([statusColAll]).build());
  rules.push(SpreadsheetApp.newConditionalFormatRule()
    .whenTextEqualTo('unpriced').setBackground('#F0AD4E').setFontColor('#5A3A00').setBold(true)
    .setRanges([statusColAll]).build());
  rules.push(SpreadsheetApp.newConditionalFormatRule()
    .whenTextEqualTo('ambiguous').setBackground('#FFD966').setFontColor('#5A3A00').setBold(true)
    .setRanges([statusColAll]).build());
  dash.clearConditionalFormatRules();
  dash.setConditionalFormatRules(rules);

  // 8. Row groups — per-customer (collapse). This is the only step we
  //    can't fully batch via a 2D array. ~108 calls but each is cheap.
  var groupErrors = 0;
  customerGroups.forEach(function(g) {
    if (g.txLast >= g.subHeaderRow) {
      try {
        dash.getRange(g.subHeaderRow, 1, g.txLast - g.subHeaderRow + 1, 1).shiftRowGroupDepth(1);
        var grp = dash.getRowGroup(g.subHeaderRow, 1);
        if (grp) grp.collapse();
      } catch (e) {
        groupErrors++;
        Logger.log('[nuclearResetBilling] group create err for ' + g.email +
                   ' (subHeaderRow=' + g.subHeaderRow + ', txLast=' + g.txLast + '): ' + e.message);
      }
    }
  });
  if (groupErrors > 0) {
    Logger.log('[nuclearResetBilling] WARNING: ' + groupErrors + '/' +
               customerGroups.length + ' customer row groups failed to create');
  }

  var elapsedMs = Date.now() - startedAt.getTime();
  Logger.log('[nuclearResetBilling] done in ' + elapsedMs + 'ms — ' +
             emails.length + ' customers, ' + (dataMatrix.length - emails.length * 2) + ' tx rows');
}

/**
 * One-shot cleanup: rip out every row group on the Dashboard, then
 * rebuild a single depth-1 group per customer (sub-header through
 * their last tx row), collapsed by default. Fixes nested-group
 * accumulation that built up across multiple reconciler runs.
 *
 * Public (no trailing underscore) so it appears in the editor's
 * function dropdown and can be invoked manually as a one-shot.
 * Also auto-called from buildAllBilling.
 */
/**
 * Keep each customer's tx rows collapsible. Runs every 5 min from the
 * buildAllBilling tail.
 *
 * INCREMENTAL + IDEMPOTENT (rewritten 2026-06-04). The previous version
 * wiped EVERY row group (`resetAllRowGroups_`) and rebuilt all of them on
 * every run — ~3 min on a full roster. Inside buildAllBilling that pushed
 * the run past the 6-min Apps Script limit, so it was killed mid-rebuild:
 * the reset had already removed every group and only the first N were
 * restored, leaving a clean cutoff (groups vanished from ~row 344 down).
 * See PROJECT.md 2026-06-04.
 *
 * Now: a correctly-grouped customer (depth === 1) is skipped with a single
 * cheap read — no structural mutation. Only customers missing a group
 * (depth 0) or carrying a corrupt/nested one (depth >= 2) are touched, via
 * applyRowGrouping (which removes any group at the row, then sets depth 1).
 * Steady state is ~N cheap depth reads and zero mutations → finishes in
 * seconds, never times out, never destroys a good group, and self-heals any
 * that go missing on the next run. Deep cleanup of orphaned/stray groups
 * still happens in the daily 3 AM dailyDashboardSelfHeal (nuclear rebuild).
 */
function fixDashboardGroups() {
  var dash = getDashboardSheet();
  var state = readDashboardState_();
  var alreadyOk = 0, regrouped = 0, errors = 0, stillUngrouped = 0;
  Object.keys(state.customers).forEach(function(email) {
    var c = state.customers[email];
    if (!c.subHeaderRow || !c.txLast || c.txLast < c.subHeaderRow) return;
    try {
      var depth = dash.getRowGroupDepth(c.subHeaderRow);
      if (depth === 1) { alreadyOk++; return; }   // already correct — skip (no mutation)
      applyRowGrouping(c.subHeaderRow, c.txLast);  // normalizes depth 0 or >=2 → exactly 1
      var grp = dash.getRowGroup(c.subHeaderRow, 1);
      if (grp) grp.collapse();
      if (dash.getRowGroupDepth(c.subHeaderRow) === 1) {
        regrouped++;
      } else {
        stillUngrouped++;
        Logger.log('[fixDashboardGroups_] WARN still ungrouped after attempt: ' + email);
      }
    } catch (e) {
      errors++;
      Logger.log('[fixDashboardGroups_] err for ' + email + ': ' + e.message);
    }
  });
  // Health-check: make silent drift visible in the log so a future cutoff
  // is caught from the logs instead of by eyeballing the sheet.
  if (stillUngrouped > 0 || errors > 0) {
    Logger.log('[fixDashboardGroups_] WARN: ' + stillUngrouped + ' still ungrouped, ' +
               errors + ' error(s) this pass');
  }
  Logger.log('[fixDashboardGroups_] groups: ' + alreadyOk + ' ok, ' + regrouped +
             ' (re)grouped, ' + errors + ' err');
  return { alreadyOk: alreadyOk, regrouped: regrouped, errors: errors, stillUngrouped: stillUngrouped };
}

/**
 * One-shot cosmetic fix: strips the default underline from every cell
 * in the Dashboard data area. HYPERLINK formulas (Item col B + Profile
 * col F + balance col G when it's a HYPERLINK) render with a default
 * blue underline; this removes that underline while keeping the link
 * clickable.
 *
 * Idempotent and fast (~3-5s). Run after a nuclear if any links look
 * underlined, or as a side-effect of any cosmetic refresh.
 */
function removeItemUnderlines() {
  var dash = getDashboardSheet();
  var lastRow = dash.getLastRow();
  if (lastRow < 2) return { ok: true, rowsTouched: 0 };
  dash.getRange(2, 1, lastRow - 1, 7).setFontLine('none');
  return { ok: true, rowsTouched: lastRow - 1 };
}

/**
 * One-shot surgical fix: clears the status-dropdown data validation
 * from customer-header rows and sub-header rows, leaving it in place
 * on tx rows. Cures the red "Invalid: Input must be an item on the
 * specified list" tooltip that appears on customer balance cells
 * when an earlier rebuild applied the rule too broadly.
 *
 * Re-applies the rule to every tx row so the dropdown still works.
 * Idempotent. Faster than a full nuclearResetBilling rebuild (~5s
 * vs ~3-5min) and doesn't touch any other cell state.
 */
function fixDashboardStatusValidation() {
  var dash = getDashboardSheet();
  var state = readDashboardState_();
  var statusRule = SpreadsheetApp.newDataValidation()
    .requireValueInList(STATUS_VALUES, true)
    .setAllowInvalid(true).build();

  var cleared = 0, applied = 0;
  Object.keys(state.customers).forEach(function(email) {
    var c = state.customers[email];
    if (!c.customerRow) return;
    // Clear validation on customer header row + sub-header row (cols G only)
    if (c.subHeaderRow && c.subHeaderRow > c.customerRow) {
      dash.getRange(c.customerRow, 7, c.subHeaderRow - c.customerRow + 1, 1)
          .clearDataValidations();
      cleared += (c.subHeaderRow - c.customerRow + 1);
    }
    // Re-apply on tx range
    if (c.txFirst && c.txLast && c.txLast >= c.txFirst) {
      dash.getRange(c.txFirst, 7, c.txLast - c.txFirst + 1, 1)
          .setDataValidation(statusRule);
      applied += (c.txLast - c.txFirst + 1);
    }
  });
  Logger.log('[fixDashboardStatusValidation] cleared ' + cleared +
             ' header cells, re-applied rule to ' + applied + ' tx cells');
  return { cleared: cleared, applied: applied };
}

/**
 * Walk all customer header rows and:
 *   1. Replace "(not found in unknown)" or similar placeholder text in
 *      the Profile column with an empty string.
 *   2. Strip any em-dashes from cell Notes on the Balance column (col
 *      G) and replace with commas — the team prefers no em-dashes.
 *
 * One-shot cleanup. Run from the editor when refreshing the look of
 * already-populated rows.
 */
function sanitizeDashboardCustomerHeaders() {
  var dash = getDashboardSheet();
  var lastRow = dash.getLastRow();
  if (lastRow < 2) return { profileCleared: 0, notesScrubbed: 0 };

  var values = dash.getRange(2, 1, lastRow - 1, 7).getValues();
  var notes  = dash.getRange(2, 7, lastRow - 1, 1).getNotes();
  var profileCleared = 0;
  var notesScrubbed  = 0;

  for (var i = 0; i < values.length; i++) {
    var b = String(values[i][1] || '').trim();
    var sheetRow = i + 2;
    if (b.indexOf('@') === -1) continue;  // not a customer header

    var profile = String(values[i][5] || '');
    if (/not\s+found/i.test(profile) || /unknown/i.test(profile)) {
      dash.getRange(sheetRow, 6).setValue('');
      profileCleared++;
    }

    var note = String(notes[i][0] || '');
    if (note.indexOf('—') !== -1) {
      dash.getRange(sheetRow, 7).setNote(note.replace(/—/g, ','));
      notesScrubbed++;
    }
  }

  Logger.log('[sanitizeDashboardCustomerHeaders_] profile cleared: ' + profileCleared +
             ', notes scrubbed: ' + notesScrubbed);
  return { profileCleared: profileCleared, notesScrubbed: notesScrubbed };
}

/**
 * Inject derived line items per parent:
 *   - Sales tax (7%) on each priced T-shirt
 *   - Payment processing fee (3%) on the customer's subtotal (incl. tax)
 *
 * Rates live in SHIRT_SALES_TAX_RATE / PAYMENT_PROCESSING_FEE constants
 * at the top of this file. Edit there to change.
 *
 * Modifies parentBucket.items in place.
 */
function bfsInjectTaxAndFee_(parentBucket) {
  var augmented = [];
  // Pass 1: keep original items + inject sales tax line after each priced shirt
  parentBucket.items.forEach(function(it) {
    augmented.push(it);
    if (it.kind === 'shirt' && !it.unpriced && Number(it.total) > 0) {
      var taxTotal = Math.round(Number(it.total) * SHIRT_SALES_TAX_RATE * 100) / 100;
      augmented.push({
        kind:        'shirt-tax',
        label:       'Sales Tax (' + Math.round(SHIRT_SALES_TAX_RATE * 100) + '%) on ' + it.label,
        price:       taxTotal,
        multiplier:  '',
        qty:         1,
        total:       taxTotal,
        unpriced:    false,
        ambiguous:   false,
        source:      'sales-tax',
        linkToSource: '',
        enrollment:  it.enrollment,
        fingerprint: it.fingerprint + '|tax-' + Math.round(SHIRT_SALES_TAX_RATE * 100) + 'pct'
      });
    }
  });

  // Pass 2: compute subtotal of all priced items + tax → append processing fee row
  var subtotal = 0;
  augmented.forEach(function(it) {
    if (!it.unpriced) subtotal += Number(it.total) || 0;
  });
  if (subtotal > 0) {
    var feeTotal = Math.round(subtotal * PAYMENT_PROCESSING_FEE * 100) / 100;
    var feeEnrollment = {
      email:    parentBucket.email,
      emailRaw: parentBucket.emailRaw,
      student:  '— ALL —',
      week:     'All weeks',
    };
    augmented.push({
      kind:        'processing-fee',
      label:       'Payment Processing Fee (' + Math.round(PAYMENT_PROCESSING_FEE * 100) + '%)',
      price:       feeTotal,
      multiplier:  '',
      qty:         1,
      total:       feeTotal,
      unpriced:    false,
      ambiguous:   false,
      source:      'processing-fee',
      linkToSource: '',
      enrollment:  feeEnrollment,
      fingerprint: 'processing-fee|' + parentBucket.email.replace(/[^a-z0-9]/g, '-')
    });
  }

  parentBucket.items = augmented;
}

/**
 * Batch renderer. Builds the entire Dashboard data area in memory then
 * writes it with a single setValues call. ~100× faster than the
 * per-row helper approach the previous version used, which was hitting
 * Apps Script's 6-min execution limit at ~441 enrollments.
 *
 * Layout matches the legacy Dashboard look:
 *   - Header (row 1, untouched)
 *   - Customer rows (dark blue background, name/email/students/balance)
 *   - Sub-header rows (mid-blue: DATE | ITEM | UNIT PRICE (incl. tax + fee) | DAYS | WEEKS | TOTAL | STATUS)
 *   - Tx rows beneath each customer (grouped + collapsed)
 *
 * Status preservation: each tx row stores its fingerprint as a cell Note
 * on col B in the form "Submission ID: <fp>". Before wipe, we snapshot
 * (fp, status) pairs by reading those notes; after rebuild, we restore.
 */
function rebuildDashboardHierarchical_(items) {
  var dash = getDashboardSheet();

  // 1. Snapshot statuses + existing customer header metadata (Name,
  //    Phone, Waiver Origin) so we don't lose what's already there.
  var existingStatus = snapshotDashboardStatusesByFingerprint_();
  var existingCustomerMeta = snapshotCustomerHeaderMeta_();

  // 2. Group items by parent email
  var byParent = {};
  items.forEach(function(it) {
    var email = (it.enrollment.email || '').toLowerCase();
    if (!email) return;
    if (!byParent[email]) {
      byParent[email] = {
        email:    email,
        emailRaw: it.enrollment.emailRaw || email,
        students: {},
        items:    []
      };
    }
    byParent[email].students[it.enrollment.student] = true;
    byParent[email].items.push(it);
  });

  // 3. (Tax + processing fee are now applied inline to each item by
  //    applyInlineFees_, called from priceEnrollment_. No separate
  //    tax / fee rows generated — keeps the Dashboard cleaner and
  //    scales when new item types are added.)

  // 4. Build the matrix
  var matrix = [];
  var customerRows = [];   // [{ email, customerRow, subHeaderRow, txFirst, txLast, fingerprints, students }]
  var allPeriods = BFS_WEEK_ORDER
    .concat(AFTER_SCHOOL_MONTH_COLUMNS)
    .concat(AFTER_SCHOOL_QUARTER_COLUMNS);

  var emails = Object.keys(byParent).sort();
  var totalUnpriced = 0, totalAmbiguous = 0;
  var nowDateStr = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyy-MM-dd');
  var currentRow = 2;  // row 1 is the header

  emails.forEach(function(email) {
    var p = byParent[email];
    var studentNames = Object.keys(p.students).sort();
    var meta = existingCustomerMeta[email] || {};

    // Sort items: student → period → kind
    p.items.sort(function(a, b) {
      var byStudent = (a.enrollment.student || '').localeCompare(b.enrollment.student || '');
      if (byStudent !== 0) return byStudent;
      var byPeriod = allPeriods.indexOf(a.enrollment.week) - allPeriods.indexOf(b.enrollment.week);
      if (byPeriod !== 0) return byPeriod;
      return (a.kind || '').localeCompare(b.kind || '');
    });

    var customerRow = currentRow;
    matrix.push([
      meta.name  || '',
      p.emailRaw,
      meta.phone || '',
      meta.waiverOrigin || '',
      studentNames.join(', '),
      meta.profile || '',
      ''  // balance — set via formula in pass 2
    ]);
    currentRow++;

    var subHeaderRow = currentRow;
    matrix.push(['DATE', 'ITEM', 'UNIT PRICE (incl. tax + fee)', 'DAYS', 'WEEKS', 'TOTAL', 'STATUS']);
    currentRow++;

    var txFirst = currentRow;
    var fingerprints = [];
    p.items.forEach(function(it) {
      var defaultStatus = it.unpriced
        ? 'unpriced'
        : (it.ambiguous ? 'ambiguous' : 'owed');
      var status = existingStatus[it.fingerprint] || defaultStatus;
      var label = bfsBuildItemCell_(it);  // HYPERLINK formula or plain text
      matrix.push([
        nowDateStr,
        label,
        Number(it.price) || 0,
        it.multiplier === '/day' ? (Number(it.qty) || '') : '',
        (it.multiplier === '/week' || it.multiplier === '/wk') ? 1 : '',
        Number(it.total) || 0,
        status
      ]);
      fingerprints.push(it.fingerprint);
      if (it.unpriced)  totalUnpriced++;
      if (it.ambiguous) totalAmbiguous++;
      currentRow++;
    });
    var txLast = currentRow - 1;

    customerRows.push({
      email:        email,
      customerRow:  customerRow,
      subHeaderRow: subHeaderRow,
      txFirst:      txFirst,
      txLast:       txLast,
      fingerprints: fingerprints,
      studentCount: studentNames.length
    });
  });

  // 5. Wipe + write. Wipe must be after we've computed everything in
  //    case of an error mid-compute (we'd hate to wipe and then crash).
  if (typeof resetAllRowGroups_ === 'function') {
    try { resetAllRowGroups_(dash); } catch (e) { /* fall through */ }
  }

  // Wipe data area without deleting rows. deleteRows(2, lastRow - 1)
  // errors with "Sorry, it is not possible to delete all non-frozen
  // rows" when maxRows == lastRow (Apps Script requires at least one
  // non-frozen row to remain). Using clear() avoids the constraint
  // and is just as effective since setValues immediately overwrites.
  var oldLastRow = dash.getLastRow();
  if (oldLastRow >= 2) {
    dash.getRange(2, 1, oldLastRow - 1, dash.getMaxColumns())
        .clearContent()
        .clearFormat()
        .clearDataValidations()
        .clearNote();
  }

  if (matrix.length === 0) {
    Logger.log('[rebuildDashboardHierarchical_] no items — Dashboard left empty');
    return;
  }

  // Belt-and-braces: clear data validation across the data area we're
  // about to write. Catches column-wide validations the row-level
  // clear above might miss (the legacy status-pill dropdown sometimes
  // is set sheet-wide on col G).
  var stretchedRows = Math.max(matrix.length + 1, dash.getMaxRows() - 1);
  dash.getRange(2, 1, stretchedRows, 7).clearDataValidations();

  dash.getRange(2, 1, matrix.length, 7).setValues(matrix);

  // 6. Pass 2: per-customer formatting (balance formula, header colors,
  //    notes, status dropdown, grouping). Each operation is one API
  //    call per customer — still fast (<1s per 100 customers).
  customerRows.forEach(function(cr) {
    // Customer header style — dark blue band
    dash.getRange(cr.customerRow, 1, 1, 7)
      .setBackground('#143980').setFontColor('#FFFFFF')
      .setFontWeight('bold').setFontSize(12);

    // Sub-header style — mid blue
    dash.getRange(cr.subHeaderRow, 1, 1, 7)
      .setBackground('#4a6493').setFontColor('#FFFFFF')
      .setFontWeight('bold').setFontSize(10);

    // Balance formula on customer row (SUMIFS over tx rows where status = "owed")
    if (cr.txFirst <= cr.txLast) {
      var balFormula = '=SUMIFS(F' + cr.txFirst + ':F' + cr.txLast + ', G' + cr.txFirst + ':G' + cr.txLast + ', "owed")';
      dash.getRange(cr.customerRow, 7).setFormula(balFormula).setNumberFormat('"$"#,##0.00');

      // Tx row: number formats on Unit Price + Total
      dash.getRange(cr.txFirst, 3, cr.txLast - cr.txFirst + 1, 1).setNumberFormat('"$"#,##0.00');
      dash.getRange(cr.txFirst, 6, cr.txLast - cr.txFirst + 1, 1).setNumberFormat('"$"#,##0.00');

      // Status dropdown
      var statusRule = SpreadsheetApp.newDataValidation()
        .requireValueInList(STATUS_VALUES, true)
        .setAllowInvalid(false).build();
      dash.getRange(cr.txFirst, 7, cr.txLast - cr.txFirst + 1, 1).setDataValidation(statusRule);

      // Fingerprint notes on col B for status preservation on next rebuild
      var noteValues = cr.fingerprints.map(function(fp) { return ['(Internal ref: ' + fp + ')']; });
      dash.getRange(cr.txFirst, 2, noteValues.length, 1).setNotes(noteValues);

      // Row grouping + collapse (subheader through last tx)
      try {
        dash.getRange(cr.subHeaderRow, 1, cr.txLast - cr.subHeaderRow + 1, 1).shiftRowGroupDepth(1);
        var grp = dash.getRowGroup(cr.subHeaderRow, 1);
        if (grp) grp.collapse();
      } catch (e) {
        Logger.log('[rebuildDashboardHierarchical_] group err for ' + cr.email + ': ' + e.message);
      }
    } else {
      // Customer with no tx rows — leave balance blank
      dash.getRange(cr.customerRow, 7).setValue('');
    }
  });

  // 7. One-shot conditional formatting for status pills across the whole
  //    tx area (much faster than per-customer rules).
  var fullDataRange = dash.getRange(2, 1, dash.getLastRow() - 1, 7);
  var statusColAll = dash.getRange(2, 7, dash.getLastRow() - 1, 1);
  var rules = [];

  // Whole-row yellow when status needs review
  rules.push(SpreadsheetApp.newConditionalFormatRule()
    .whenFormulaSatisfied('=OR($G2="unpriced",$G2="ambiguous")')
    .setBackground('#FFF3B0')
    .setRanges([fullDataRange]).build());

  // Per-status pill colors on col G
  rules.push(SpreadsheetApp.newConditionalFormatRule()
    .whenTextEqualTo('paid').setBackground('#D4EDDA').setFontColor('#155724').setBold(true)
    .setRanges([statusColAll]).build());
  rules.push(SpreadsheetApp.newConditionalFormatRule()
    .whenTextEqualTo('owed').setBackground('#FFF3CD').setFontColor('#856404')
    .setRanges([statusColAll]).build());
  rules.push(SpreadsheetApp.newConditionalFormatRule()
    .whenTextEqualTo('canceled').setBackground('#E2E3E5').setFontColor('#383D41')
    .setRanges([statusColAll]).build());
  rules.push(SpreadsheetApp.newConditionalFormatRule()
    .whenTextEqualTo('refunded').setBackground('#FFE5CC').setFontColor('#A05A00')
    .setRanges([statusColAll]).build());
  rules.push(SpreadsheetApp.newConditionalFormatRule()
    .whenTextEqualTo('unpriced').setBackground('#F0AD4E').setFontColor('#5A3A00').setBold(true)
    .setRanges([statusColAll]).build());
  rules.push(SpreadsheetApp.newConditionalFormatRule()
    .whenTextEqualTo('ambiguous').setBackground('#FFD966').setFontColor('#5A3A00').setBold(true)
    .setRanges([statusColAll]).build());

  dash.clearConditionalFormatRules();
  dash.setConditionalFormatRules(rules);

  // 8. DM Sans across everything
  dash.getRange(1, 1, dash.getLastRow(), 7).setFontFamily('DM Sans');

  Logger.log('[rebuildDashboardHierarchical_] wrote ' + emails.length + ' customer rows, ' +
             (matrix.length - emails.length * 2) + ' tx rows (' + totalUnpriced + ' unpriced, ' +
             totalAmbiguous + ' ambiguous) including sales tax + processing fee');
}

/**
 * Read existing customer header rows (those with email in col B) and
 * capture name/phone/waiverOrigin/profile so the rebuild doesn't lose
 * fields populated by the legacy GHL-driven pipeline.
 */
function snapshotCustomerHeaderMeta_() {
  var dash = getDashboardSheet();
  var lastRow = dash.getLastRow();
  if (lastRow < 2) return {};
  var values = dash.getRange(2, 1, lastRow - 1, 6).getValues();
  var out = {};
  for (var i = 0; i < values.length; i++) {
    var email = String(values[i][1] || '').trim().toLowerCase();
    if (!email || email.indexOf('@') === -1) continue;
    out[email] = {
      name:         String(values[i][0] || ''),
      phone:        String(values[i][2] || ''),
      waiverOrigin: String(values[i][3] || ''),
      profile:      values[i][5]  // may be HYPERLINK formula — preserve as value
    };
  }
  return out;
}

/**
 * One-shot cleanup: deletes the now-redundant flat "Billing" tab on
 * the central Billing Dashboard sheet (the sheet-driven output moved
 * to the Dashboard tab hierarchically). Safe to re-run.
 */
function deleteBillingFlatTab() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sh = ss.getSheetByName(BILLING_TAB_NAME);
  if (sh) {
    ss.deleteSheet(sh);
    Logger.log('[deleteBillingFlatTab] deleted flat Billing tab');
    return { deleted: true };
  }
  Logger.log('[deleteBillingFlatTab] no Billing tab to delete');
  return { deleted: false };
}

/**
 * One-shot cleanup: deletes the legacy "Manual Imports" audit tab if
 * present. That tab was populated only during the initial v1 data
 * migration and has been dormant since.
 */
function deleteManualImportsTab() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sh = ss.getSheetByName('Manual Imports');
  if (sh) {
    ss.deleteSheet(sh);
    Logger.log('[deleteManualImportsTab] deleted Manual Imports tab');
    return { deleted: true };
  }
  Logger.log('[deleteManualImportsTab] no Manual Imports tab to delete');
  return { deleted: false };
}

/**
 * Convenience: run all cleanup actions in sequence.
 */
function runCleanupPostRefactor() {
  var a = deleteBillingFlatTab();
  var b = deleteManualImportsTab();
  return { billingFlat: a, manualImports: b };
}

/**
 * One-shot cleanup: deletes the legacy per-sheet "Billing" tabs from
 * every registration sheet. Run once after the consolidation cutover
 * to remove the old per-camp Billing tabs we no longer write to.
 *
 * Safe to re-run (no-op if a sheet's Billing tab is already gone).
 */
function deleteBillingTabsFromRegistrationSheets() {
  var report = [];
  var registrationSheets = discoverRegistrationSheets_();
  registrationSheets.forEach(function(reg) {
    try {
      var ss = SpreadsheetApp.openById(reg.id);
      var sh = ss.getSheetByName(BILLING_TAB_NAME);
      if (sh) {
        ss.deleteSheet(sh);
        report.push(reg.label + ': deleted Billing tab');
      } else {
        report.push(reg.label + ': no Billing tab to delete');
      }
    } catch (e) {
      report.push(reg.label + ': ERROR ' + e.message);
    }
  });
  report.forEach(function(r) { Logger.log('[deleteBillingTabsFromRegistrationSheets] ' + r); });
  return report;
}

/**
 * One-shot diagnostic. Runs buildAllBilling once and dumps verbose
 * logs. Run from the editor as emilio@nilsdigital.com to verify the
 * whole pipeline before installing the trigger.
 */
function testBillingFromSheets() {
  Logger.log('=== testBillingFromSheets @ ' + new Date().toISOString() + ' ===');
  try {
    Logger.log('[0] effective user: ' + Session.getEffectiveUser().getEmail());
  } catch (e) {
    Logger.log('[0] effective user err (non-fatal): ' + e.message);
  }
  buildAllBilling();
  Logger.log('=== testBillingFromSheets done ===');
}

/**
 * Installs a 5-min time-driven trigger on buildAllBilling.
 * Removes any existing triggers for that handler first.
 */
function installBillingFromSheetsTrigger() {
  ScriptApp.getProjectTriggers().forEach(function(t) {
    if (t.getHandlerFunction() === 'buildAllBilling') {
      ScriptApp.deleteTrigger(t);
      Logger.log('[installBillingFromSheetsTrigger] removed old: ' + t.getUniqueId());
    }
  });
  var trigger = ScriptApp.newTrigger('buildAllBilling')
    .timeBased()
    .everyMinutes(5)
    .create();
  Logger.log('[installBillingFromSheetsTrigger] installed: ' + trigger.getUniqueId());
}

/* ═════════════════════════════════════════════════════════════════
   PRICING CATALOG
   ═════════════════════════════════════════════════════════════════ */

/**
 * Read the central Pricing tab and build a 3-way lookup structure.
 *
 * Returns {
 *   bySource: Map<lowercase Source label → entry>,
 *   byItem:   Map<lowercase Item label  → entry>,
 *   items:    Array<entry>   // for last-resort fuzzy iteration
 * }
 *
 * The 3-way structure handles the gap between registration sheet text
 * and GHL form labels. Example: GHL form option says "Small (+$30)"
 * (the Source) but the team types just "Small" in the registration
 * sheet. Source-only lookup misses; Item-keyed lookup catches it
 * because PricingGuide stripped the "(+$30)" suffix into the Item col.
 *
 * Tom-edited rows in the Pricing tab win — script never overwrites them.
 *
 * @returns {{bySource: Map, byItem: Map, items: Array}}
 */
function readPricingCatalog_() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sh = ss.getSheetByName(PRICING_SHEET_NAME);
  if (!sh) {
    throw new Error('Pricing sheet not found. Run setupPricingSheet() first.');
  }
  var lastRow = sh.getLastRow();
  if (lastRow < 2) {
    throw new Error('Pricing sheet is empty. Run setupPricingSheet() first.');
  }
  // Detect post-migration column layout: A Category | B Item | C Price |
  // D Multiplier | E Source | F Aliases | G Notes (or pre-migration
  // F Notes if Aliases hasn't been added yet).
  var headerRow = sh.getRange(1, 1, 1, Math.max(7, sh.getLastColumn())).getValues()[0];
  var aliasesColIdx = -1;
  for (var hi = 0; hi < headerRow.length; hi++) {
    if (String(headerRow[hi]).trim().toLowerCase() === 'aliases') {
      aliasesColIdx = hi;
      break;
    }
  }
  var numCols = Math.max(6, aliasesColIdx + 2);  // include Aliases if present
  var rows = sh.getRange(2, 1, lastRow - 1, numCols).getValues();
  var bySource = new Map();
  var byItem = new Map();
  var items = [];
  rows.forEach(function(r) {
    var category = String(r[0] || '').trim();
    var item     = String(r[1] || '').trim();
    var price    = Number(r[2]) || 0;
    var mult     = String(r[3] || '').trim();
    var source   = String(r[4] || '').trim();
    var aliasRaw = aliasesColIdx >= 0 ? String(r[aliasesColIdx] || '') : '';
    if (!item && !source) return;
    var aliases = aliasRaw.split(/[,;\n]+/)
      .map(function(a) { return a.trim().toLowerCase(); })
      .filter(Boolean);
    var entry = {
      category: category, item: item, price: price,
      multiplier: mult, source: source, aliases: aliases
    };
    if (source) bySource.set(source.toLowerCase(), entry);
    if (item)   byItem.set(item.toLowerCase(),     entry);
    items.push(entry);
  });
  return { bySource: bySource, byItem: byItem, items: items };
}

/**
 * Map a field-type tag to a regex that filters Pricing.Category. Used
 * by lookupPrice_ to scope candidates so a "banana" alias for the
 * breakfast row doesn't accidentally match a lunch cell that happens
 * to mention bananas.
 *
 * @param {'lunch'|'breakfast'|'care'|'shirt'|'tuition'|null} fieldType
 * @returns {RegExp|null}  null = no filter (consider all rows)
 */
function categoryFilterFor_(fieldType) {
  switch (fieldType) {
    case 'lunch':     return /lunch/i;
    case 'breakfast': return /breakfast/i;
    case 'care':      return /care/i;
    case 'shirt':     return /shirt/i;
    case 'tuition':   return /duration|tuition/i;
    default:          return null;
  }
}

/**
 * Reduce a string to a comparison-friendly form: lowercased, only
 * alphanumerics. "Small (+$30)" → "small30", "After care weekly option"
 * → "aftercareweeklyoption". Helps the substring fallback match across
 * spacing and punctuation variants ("Aftercare Weekly" ↔ "After care
 * weekly option").
 */
function bfsSquish_(s) {
  return String(s || '').toLowerCase().replace(/[^a-z0-9]/g, '');
}

/**
 * Detects whether multiple Pricing entries match the same cell at the
 * SAME deterministic stage (exact source / exact item / exact alias).
 * Used to flag rows for human review when the catalog is ambiguous.
 *
 * Returns the count of distinct matches at the highest-priority stage
 * that hit. 0 = no exact match (could still be matched fuzzily later).
 * >1 = ambiguity → caller should flag the row for review.
 */
function countExactMatches_(cellValue, catalog, fieldType) {
  var v = String(cellValue || '').trim();
  if (!v || /^(none|no|n\/a|na)$/i.test(v)) return 0;
  var vLower = v.toLowerCase();
  var catFilter = categoryFilterFor_(fieldType);
  function inScope(entry) {
    return !catFilter || catFilter.test(String(entry.category || ''));
  }

  // Try each deterministic stage; stop at the first stage with matches
  // and report the count there.
  var matches;

  // Stage 1: exact Source
  matches = catalog.items.filter(function(e) {
    return inScope(e) && (e.source || '').toLowerCase() === vLower;
  });
  if (matches.length > 0) return matches.length;

  // Stage 2: exact Item
  matches = catalog.items.filter(function(e) {
    return inScope(e) && (e.item || '').toLowerCase() === vLower;
  });
  if (matches.length > 0) return matches.length;

  // Stage 3: exact Alias
  matches = catalog.items.filter(function(e) {
    return inScope(e) && (e.aliases || []).indexOf(vLower) !== -1;
  });
  if (matches.length > 0) return matches.length;

  return 0;
}

/**
 * Look up a registration cell value in the catalog. Tries, in order:
 *   1. Exact Source match (category-scoped if fieldType given)
 *   2. Exact Item match
 *   3. Exact match against any Alias (comma-separated list per row)
 *   4. Cell contains Source as substring (raw + squished)
 *   5. Cell contains Item as substring (raw + squished)
 *   6. Cell contains any Alias as substring (or alias is contained in cell)
 *   7. Catalog Item contains cell as substring (squished)
 *
 * The category-scope filter prevents a "banana" alias on the breakfast
 * row from matching a lunch cell that mentions bananas in passing.
 *
 * @param {string} cellValue
 * @param {object} catalog  from readPricingCatalog_
 * @param {string=} fieldType  'lunch'|'breakfast'|'care'|'shirt'|'tuition'
 * @returns {object|null} matching entry, or null
 */
function lookupPrice_(cellValue, catalog, fieldType) {
  var v = String(cellValue || '').trim();
  if (!v) return null;
  if (/^(none|no|n\/a|na)$/i.test(v)) return null;

  var vLower = v.toLowerCase();
  var vSquish = bfsSquish_(v);
  var catFilter = categoryFilterFor_(fieldType);
  function inScope(entry) {
    return !catFilter || catFilter.test(String(entry.category || ''));
  }

  // 1 + 2: exact matches (still scoped)
  var src = catalog.bySource.get(vLower);
  if (src && inScope(src)) return src;
  var itm = catalog.byItem.get(vLower);
  if (itm && inScope(itm)) return itm;

  // 3: exact alias match
  var hit = null;
  catalog.items.forEach(function(entry) {
    if (hit || !inScope(entry)) return;
    for (var i = 0; i < entry.aliases.length; i++) {
      if (entry.aliases[i] === vLower) { hit = entry; return; }
    }
  });
  if (hit) return hit;

  // 4: cell contains Source
  catalog.bySource.forEach(function(meta, key) {
    if (hit || !inScope(meta)) return;
    if (vLower.indexOf(key) !== -1) hit = meta;
    else if (vSquish.indexOf(bfsSquish_(key)) !== -1) hit = meta;
  });
  if (hit) return hit;

  // 5: cell contains Item
  catalog.byItem.forEach(function(meta, key) {
    if (hit || !inScope(meta)) return;
    if (vLower.indexOf(key) !== -1) hit = meta;
    else if (vSquish.indexOf(bfsSquish_(key)) !== -1) hit = meta;
  });
  if (hit) return hit;

  // 6: alias substring match — bidirectional. Catches "Daily ($10) with
  //    fruit (banana)" cell matching breakfast alias "with fruit", and
  //    catches alias "banana" appearing in the cell.
  catalog.items.forEach(function(entry) {
    if (hit || !inScope(entry)) return;
    for (var i = 0; i < entry.aliases.length; i++) {
      var alias = entry.aliases[i];
      if (!alias || alias.length < 3) continue;
      if (vLower.indexOf(alias) !== -1) { hit = entry; return; }
      var aliasSquish = bfsSquish_(alias);
      if (aliasSquish.length >= 3 && vSquish.indexOf(aliasSquish) !== -1) {
        hit = entry; return;
      }
    }
  });
  if (hit) return hit;

  // 7: Item contains cell — covers e.g. cell="Aftercare Weekly"
  //    matching catalog item="After care weekly option"
  if (vSquish.length >= 4) {
    catalog.items.forEach(function(entry) {
      if (hit || !inScope(entry)) return;
      if (!entry.item) return;
      var itemSquish = bfsSquish_(entry.item);
      if (itemSquish.length && itemSquish.indexOf(vSquish) !== -1) hit = entry;
    });
  }
  return hit;
}

/* ═════════════════════════════════════════════════════════════════
   REGISTRATION SHEET READERS
   ═════════════════════════════════════════════════════════════════ */

/**
 * Walk a registration sheet's week tabs, extract one enrollment per
 * student row. Shape matches what readCampSheet_ / readFreeSheet_ in
 * Snapshot.js return, plus extra cells (Before/After care, T-shirt,
 * etc.) we need for billing.
 *
 * @param {{id, label, type}} reg  Registration sheet metadata
 * @returns {Array<Enrollment>}
 */
function readRegistrationEnrollments_(reg) {
  var ss = SpreadsheetApp.openById(reg.id);
  var tabs = ss.getSheets();
  var enrollments = [];

  for (var t = 0; t < tabs.length; t++) {
    var sheet = tabs[t];
    // Resolve week by tab NAME, not position. Tabs that don't look like a
    // week (Notes / Lookup / etc.) return null and are skipped entirely —
    // no positional fallback, since billing under the wrong week is worse
    // than billing nothing.
    var week = bfsResolveWeek_(sheet.getName());
    if (!week) continue;
    var range = sheet.getDataRange();
    if (!range || range.getNumRows() < 2) continue;

    var values = range.getValues();
    var header = values[0].map(function(h) {
      return String(h || '').replace(/\s+/g, ' ').trim();
    });

    // Header positions. Paid + Free sheets differ in some columns,
    // so we look up each by name and default to -1 when absent.
    var col = {
      student:   bfsCol_(header, ['Student Name']),
      email:     bfsCol_(header, ['Email', 'Email Address']),
      breakfast: bfsCol_(header, ['Breakfast']),
      lunch:     bfsCol_(header, ['Lunch']),
      care:      bfsCol_(header, ['Before / After Care', 'Before/After Care']),
      shirt:     bfsCol_(header, ['Shirt?', 'Shirt Size']),
      notes:     bfsCol_(header, ['Additional Notes']),
      mon:       bfsCol_(header, ['Mon', 'Monday']),
      tue:       bfsCol_(header, ['Tue', 'Tuesday']),
      wed:       bfsCol_(header, ['Wed', 'Wednesday']),
      thu:       bfsCol_(header, ['Thu', 'Thursday']),
      fri:       bfsCol_(header, ['Fri', 'Friday']),
    };
    if (col.student < 0) continue;  // not a recognizable enrollment tab

    var sheetGid = sheet.getSheetId();

    for (var r = 1; r < values.length; r++) {
      var row = values[r];
      var student = String(row[col.student] || '').trim();
      if (!student) continue;
      var email = col.email >= 0 ? String(row[col.email] || '').trim() : '';

      // Days attended — for FREE camp sheets without per-day columns,
      // all five default to true (kid attends every weekday).
      var days;
      if (col.mon >= 0) {
        days = {
          Mon: bfsDayChecked_(row[col.mon]),
          Tue: bfsDayChecked_(row[col.tue]),
          Wed: bfsDayChecked_(row[col.wed]),
          Thu: bfsDayChecked_(row[col.thu]),
          Fri: bfsDayChecked_(row[col.fri]),
        };
      } else {
        days = { Mon: true, Tue: true, Wed: true, Thu: true, Fri: true };
      }
      var dayCount = 0;
      ['Mon','Tue','Wed','Thu','Fri'].forEach(function(d) { if (days[d]) dayCount++; });

      var rowNumber = r + 1;  // Apps Script ranges are 1-indexed
      enrollments.push({
        sheetId:    reg.id,
        sheetLabel: reg.label,
        type:       reg.type,
        week:       week,
        student:    student,
        email:      email.toLowerCase(),
        emailRaw:   email,
        days:       days,
        dayCount:   dayCount,
        cells: {
          breakfast: col.breakfast >= 0 ? String(row[col.breakfast] || '').trim() : '',
          lunch:     col.lunch >= 0     ? String(row[col.lunch] || '').trim()     : '',
          care:      col.care >= 0      ? String(row[col.care] || '').trim()      : '',
          shirt:     col.shirt >= 0     ? String(row[col.shirt] || '').trim()     : '',
        },
        // Coordinates of the source row, used to deep-link to the
        // exact cell from the central Billing tab. cellLinks: per-item
        // type, a full URL to that cell in the registration sheet.
        sourceGid:  sheetGid,
        sourceRow:  rowNumber,
        cellLinks: {
          lunch:     col.lunch >= 0     ? bfsCellUrl_(reg.id, sheetGid, rowNumber, col.lunch + 1)     : '',
          breakfast: col.breakfast >= 0 ? bfsCellUrl_(reg.id, sheetGid, rowNumber, col.breakfast + 1) : '',
          care:      col.care >= 0      ? bfsCellUrl_(reg.id, sheetGid, rowNumber, col.care + 1)     : '',
          shirt:     col.shirt >= 0     ? bfsCellUrl_(reg.id, sheetGid, rowNumber, col.shirt + 1)    : '',
          // For tuition there's no single cell — link to the whole row
          row:       bfsRowUrl_(reg.id, sheetGid, rowNumber),
        },
        notes:      col.notes >= 0 ? String(row[col.notes] || '').trim() : '',
        incomplete: !email,
      });
    }
  }

  return enrollments;
}

/**
 * Convert a 1-indexed column number to an A1 letter. 1→A, 2→B, ...,
 * 26→Z, 27→AA, 28→AB, etc.
 */
function bfsColLetter_(n) {
  var letter = '';
  while (n > 0) {
    var rem = (n - 1) % 26;
    letter = String.fromCharCode(65 + rem) + letter;
    n = Math.floor((n - 1) / 26);
  }
  return letter;
}

/**
 * Build a deep-link URL to a specific cell in a Google Sheet.
 */
function bfsCellUrl_(spreadsheetId, gid, row, colNum) {
  var col = bfsColLetter_(colNum);
  return 'https://docs.google.com/spreadsheets/d/' + spreadsheetId +
         '/edit#gid=' + gid + '&range=' + col + row;
}

/**
 * Build a deep-link URL to an entire row in a Google Sheet.
 */
function bfsRowUrl_(spreadsheetId, gid, row) {
  return 'https://docs.google.com/spreadsheets/d/' + spreadsheetId +
         '/edit#gid=' + gid + '&range=' + row + ':' + row;
}

/* ═════════════════════════════════════════════════════════════════
   AFTER-SCHOOL READER
   ═════════════════════════════════════════════════════════════════
   After-school sheets have a totally different schema from summer
   camp: one "Enrollment" tab (not 12 weekly tabs), columns
     Student Name | Email | T Shirt | Grade
   followed by either monthly columns (January..December) or
   quarterly columns (Q1..Q4). Each filled cell = that student is
   active for that period.

   We generate one enrollment per (student × active period). The
   "program" is the sheet's title (e.g. "Linwood Holton Elementary:
   Friday 3-3:45PM"). The billing period (month/quarter) is detected
   from which column set is present.

   Pricing: looked up in the central Pricing tab using the program
   name as the source/alias key. If no Pricing row exists yet, the
   line item is generated as (unpriced) — yellow row + Fix Link
   directing the team to the right cell so Tom can add it later.
   ═══════════════════════════════════════════════════════════════ */

const AFTER_SCHOOL_MONTH_COLUMNS = [
  'January', 'February', 'March',     'April',
  'May',     'June',     'July',      'August',
  'September','October', 'November',  'December'
];
const AFTER_SCHOOL_QUARTER_COLUMNS = ['Q1', 'Q2', 'Q3', 'Q4'];

function readAfterSchoolEnrollments_(reg) {
  var ss = SpreadsheetApp.openById(reg.id);
  var sheet = ss.getSheetByName('Enrollment');
  if (!sheet) {
    // Fall back to the first tab. The APPLICATION template names it
    // "Enrollment", but any future variant just picks tab 0.
    var tabs = ss.getSheets();
    if (tabs.length === 0) return [];
    sheet = tabs[0];
  }

  var range = sheet.getDataRange();
  if (!range || range.getNumRows() < 2) return [];
  var values = range.getValues();
  var header = values[0].map(function(h) {
    return String(h || '').replace(/\s+/g, ' ').trim();
  });

  var col = {
    student: bfsCol_(header, ['Student Name']),
    email:   bfsCol_(header, ['Email', 'Email Address']),
    shirt:   bfsCol_(header, ['T Shirt', 'T-Shirt', 'Shirt Size']),
    grade:   bfsCol_(header, ['Grade']),
  };
  if (col.student < 0) return [];

  // Detect schema by which column set is present.
  var periodCols = [];
  var billingPeriod = null;
  for (var i = 0; i < AFTER_SCHOOL_MONTH_COLUMNS.length; i++) {
    var ix = bfsCol_(header, [AFTER_SCHOOL_MONTH_COLUMNS[i]]);
    if (ix >= 0) periodCols.push({ name: AFTER_SCHOOL_MONTH_COLUMNS[i], col: ix });
  }
  if (periodCols.length > 0) {
    billingPeriod = 'month';
  } else {
    for (var q = 0; q < AFTER_SCHOOL_QUARTER_COLUMNS.length; q++) {
      var qx = bfsCol_(header, [AFTER_SCHOOL_QUARTER_COLUMNS[q]]);
      if (qx >= 0) periodCols.push({ name: AFTER_SCHOOL_QUARTER_COLUMNS[q], col: qx });
    }
    if (periodCols.length > 0) billingPeriod = 'quarter';
  }
  if (!billingPeriod) return [];  // Neither monthly nor quarterly schema

  var sheetGid = sheet.getSheetId();
  var enrollments = [];

  for (var r = 1; r < values.length; r++) {
    var row = values[r];
    var student = String(row[col.student] || '').trim();
    if (!student) continue;
    var email = col.email >= 0 ? String(row[col.email] || '').trim() : '';
    var shirt = col.shirt >= 0 ? String(row[col.shirt] || '').trim() : '';
    var grade = col.grade >= 0 ? String(row[col.grade] || '').trim() : '';
    var rowNumber = r + 1;

    // One enrollment per (student × active period). A period is
    // "active" when the cell has any non-blank, non-marker value.
    periodCols.forEach(function(p) {
      var cellVal = String(row[p.col] || '').trim();
      if (!cellVal) return;
      if (isBfsYesNoMarker_(cellVal) && /^(no|n|false)$/i.test(cellVal)) return;  // explicit no = skip

      enrollments.push({
        sheetId:       reg.id,
        sheetLabel:    reg.label,
        type:          'after-school',
        billingPeriod: billingPeriod,         // 'month' | 'quarter'
        week:          p.name,                // reused as the "Period" display
        program:       reg.label,             // sheet title = school+program name
        student:       student,
        email:         email.toLowerCase(),
        emailRaw:      email,
        grade:         grade,
        days:          { Mon: true, Tue: true, Wed: true, Thu: true, Fri: true },
        dayCount:      5,
        cells: {
          breakfast: '', lunch: '', care: '',
          shirt:     shirt
        },
        sourceGid:     sheetGid,
        sourceRow:     rowNumber,
        cellLinks: {
          shirt: col.shirt >= 0 ? bfsCellUrl_(reg.id, sheetGid, rowNumber, col.shirt + 1) : '',
          period: bfsCellUrl_(reg.id, sheetGid, rowNumber, p.col + 1),
          row:    bfsRowUrl_(reg.id, sheetGid, rowNumber),
        },
        notes:      '',
        incomplete: !email,
      });
    });
  }

  return enrollments;
}

/**
 * Price an after-school enrollment. The program name (sheet title) is
 * the lookup key. If no matching Pricing row exists, the line item is
 * created as (unpriced) — yellow row + Fix Link points to the period
 * cell so Tom knows what to add to the Pricing catalog.
 */
function priceAfterSchoolEnrollment_(e, catalog) {
  var items = [];
  var fpBase = [e.email, e.student, e.program, e.week].map(bfsSlug_).join('|');

  // Find a Pricing row matching this after-school program.
  // Scope: only catalog entries whose Category contains "after school".
  var entry = null;
  var pgLower = String(e.program || '').toLowerCase();
  var pgSquish = bfsSquish_(e.program);

  catalog.items.forEach(function(m) {
    if (entry) return;
    if (!/after\s*school/i.test(String(m.category || ''))) return;
    var src = String(m.source || '').toLowerCase();
    var itm = String(m.item || '').toLowerCase();
    if (src === pgLower || itm === pgLower) { entry = m; return; }
    // Alias match
    for (var i = 0; i < (m.aliases || []).length; i++) {
      if (m.aliases[i] === pgLower) { entry = m; return; }
    }
    // Squished substring
    var srcSq = bfsSquish_(src);
    var itmSq = bfsSquish_(itm);
    if (srcSq && (pgSquish.indexOf(srcSq) !== -1 || srcSq.indexOf(pgSquish) !== -1)) entry = m;
    else if (itmSq && (pgSquish.indexOf(itmSq) !== -1 || itmSq.indexOf(pgSquish) !== -1)) entry = m;
  });

  var multStr = e.billingPeriod === 'month' ? '/month' : '/quarter';
  if (entry && entry.price > 0) {
    items.push({
      kind:       'after-school',
      label:      e.program + ' (' + e.week + ')',
      price:      entry.price,
      multiplier: entry.multiplier || multStr,
      qty:        1,
      total:      entry.price,
      unpriced:   false,
      source:     e.program,
      linkToSource: e.cellLinks ? e.cellLinks.period : '',
      fingerprint: fpBase + '|tuition'
    });
  } else {
    items.push({
      kind:       'after-school',
      label:      UNPRICED_TAG + ' After School: ' + e.program + ' (' + e.week + ')',
      price:      0,
      multiplier: multStr,
      qty:        1,
      total:      0,
      unpriced:   true,
      source:     e.program,
      linkToSource: e.cellLinks ? e.cellLinks.period : '',
      fingerprint: fpBase + '|tuition'
    });
  }

  // After-school T-shirt — flat one-time charge per student if specified
  if (e.cells.shirt && !/^none$/i.test(e.cells.shirt) && !isBfsYesNoMarker_(e.cells.shirt)) {
    var shirt = lookupPrice_(e.cells.shirt, catalog, 'shirt');
    if (shirt) {
      items.push({
        kind:       'shirt',
        label:      'T-Shirt (' + shirt.item + ')',
        price:      shirt.price,
        multiplier: shirt.multiplier || '',
        qty:        1,
        total:      shirt.price,
        unpriced:   false,
        source:     e.cells.shirt,
        linkToSource: e.cellLinks ? e.cellLinks.shirt : '',
        oneTimePerStudent: true,
        fingerprint: [e.email, e.student].map(bfsSlug_).join('|') + '|shirt|' + bfsSlug_(shirt.item)
      });
    } else {
      items.push({
        kind:       'shirt',
        label:      UNPRICED_TAG + ' T-Shirt: ' + e.cells.shirt,
        price:      0, multiplier: '', qty: 1, total: 0,
        unpriced:   true,
        source:     e.cells.shirt,
        linkToSource: e.cellLinks ? e.cellLinks.shirt : '',
        oneTimePerStudent: true,
        fingerprint: [e.email, e.student].map(bfsSlug_).join('|') + '|shirt|' + bfsSlug_(e.cells.shirt)
      });
    }
  }

  return items;
}

function bfsCol_(header, candidates) {
  for (var i = 0; i < candidates.length; i++) {
    var want = candidates[i].toLowerCase();
    for (var j = 0; j < header.length; j++) {
      if (header[j].toLowerCase() === want) return j;
    }
  }
  return -1;
}

function bfsDayChecked_(v) {
  if (v === true) return true;
  var s = String(v == null ? '' : v).trim().toLowerCase();
  if (!s) return false;
  if (s === 'no' || s === 'n' || s === 'x' || s === 'false') return false;
  if (s === 'yes' || s === 'y' || s === 'true' || s === '✓' || s === '✔') return true;
  return s.length > 0 && s !== 'no';
}

/* ═════════════════════════════════════════════════════════════════
   PRICING ENROLLMENTS → LINE ITEMS
   ═════════════════════════════════════════════════════════════════ */

/**
 * Convert one enrollment into a list of priced line items.
 * Each item: { kind, label, price, multiplier, qty, total, source, fingerprint }
 *
 * Pricing rules:
 *   - Tuition (paid camps only): Pricing.Category="Select Camp Duration",
 *     match by day count ("1 day", "2 days", ..., "5 days"). Charge per week.
 *   - Lunch: lookup the lunch cell against Pricing.Source. If /day, multiply
 *     by dayCount. If /week, charge once.
 *   - Breakfast: same as lunch
 *   - Care (before/after): same
 *   - T-shirt: flat charge once per registration
 *
 * @param {Enrollment} e
 * @param {Map} catalog
 * @returns {Array<LineItem>}
 */
function priceEnrollment_(e, catalog) {
  // Route after-school enrollments through their own pricer — they
  // have a different shape (no per-day attendance, no lunch/breakfast/
  // care, billed monthly or quarterly per program).
  if (e.type === 'after-school') {
    var afterSchoolItems = priceAfterSchoolEnrollment_(e, catalog);
    afterSchoolItems.forEach(applyInlineFees_);
    return afterSchoolItems;
  }

  // Phantom-enrollment skip: paid summer camp registrations where the
  // parent picked a shirt size etc. but never checked any Mon-Fri
  // boxes (dayCount === 0) are treated as abandoned form fills. Bill
  // nothing for them, including the shirt. Without this guard, the
  // shirt block below would still write a one-time $33 charge for
  // every phantom registration, which is what produced the
  // "shirt-only customers" the team flagged as wrong.
  if (e.type === 'summer-paid' && (!e.dayCount || Number(e.dayCount) === 0)) {
    return [];
  }

  var items = [];
  var fpBase = [e.email, e.student, e.week].map(bfsSlug_).join('|');

  // 1. Tuition (paid camps only; FREE camps are $0)
  if (e.type === 'summer-paid' && e.dayCount > 0) {
    var tuitionKey = e.dayCount === 1 ? '1 day' : (e.dayCount + ' days');
    // Find by Category + Item match (multiple variants exist as "$X")
    var tuitionPrice = null, tuitionMult = '/week', tuitionSource = '';
    catalog.items.forEach(function(m) {
      if (tuitionPrice !== null) return;
      if (/camp duration/i.test(m.category) && new RegExp('^' + tuitionKey + '$', 'i').test(m.item)) {
        tuitionPrice  = m.price;
        tuitionMult   = m.multiplier || '/week';
        tuitionSource = m.source || m.item;
      }
    });
    items.push({
      kind:       'tuition',
      label:      'Camp Tuition (' + tuitionKey + ')',
      price:      tuitionPrice == null ? 0 : tuitionPrice,
      multiplier: tuitionMult,
      qty:        1,  // one week per row
      total:      tuitionPrice == null ? 0 : tuitionPrice,
      unpriced:   tuitionPrice == null,
      source:     tuitionSource || (UNPRICED_TAG + ' ' + tuitionKey),
      linkToSource: e.cellLinks ? e.cellLinks.row : '',
      fingerprint: fpBase + '|tuition|' + bfsSlug_(tuitionKey)
    });
  }

  // 2. Lunch
  if (e.cells.lunch && !/^none$/i.test(e.cells.lunch) && !isBfsYesNoMarker_(e.cells.lunch)) {
    var lunchPrice = lookupPrice_(e.cells.lunch, catalog, 'lunch');
    if (lunchPrice) {
      var qty = lunchPrice.multiplier === '/day' ? e.dayCount : 1;
      items.push({
        kind:       'lunch',
        label:      'Lunch: ' + lunchPrice.item,
        price:      lunchPrice.price,
        multiplier: lunchPrice.multiplier,
        qty:        qty,
        total:      lunchPrice.price * qty,
        unpriced:   false,
        ambiguous:  countExactMatches_(e.cells.lunch, catalog, 'lunch') > 1,
        source:     e.cells.lunch,
        linkToSource: e.cellLinks ? e.cellLinks.lunch : '',
        fingerprint: fpBase + '|lunch|' + bfsSlug_(lunchPrice.item)
      });
    } else {
      items.push({
        kind:       'lunch',
        label:      UNPRICED_TAG + ' Lunch: ' + e.cells.lunch,
        price:      0, multiplier: '', qty: 1, total: 0,
        unpriced:   true,
        source:     e.cells.lunch,
        linkToSource: e.cellLinks ? e.cellLinks.lunch : '',
        fingerprint: fpBase + '|lunch|' + bfsSlug_(e.cells.lunch)
      });
    }
  }

  // 3. Breakfast
  if (e.cells.breakfast && !/^none$/i.test(e.cells.breakfast) && !isBfsYesNoMarker_(e.cells.breakfast)) {
    var bf = lookupPrice_(e.cells.breakfast, catalog, 'breakfast');
    if (bf) {
      var bqty = bf.multiplier === '/day' ? e.dayCount : 1;
      items.push({
        kind:       'breakfast',
        label:      'Breakfast: ' + bf.item,
        price:      bf.price,
        multiplier: bf.multiplier,
        qty:        bqty,
        total:      bf.price * bqty,
        unpriced:   false,
        ambiguous:  countExactMatches_(e.cells.breakfast, catalog, 'breakfast') > 1,
        source:     e.cells.breakfast,
        linkToSource: e.cellLinks ? e.cellLinks.breakfast : '',
        fingerprint: fpBase + '|breakfast|' + bfsSlug_(bf.item)
      });
    } else {
      items.push({
        kind:       'breakfast',
        label:      UNPRICED_TAG + ' Breakfast: ' + e.cells.breakfast,
        price:      0, multiplier: '', qty: 1, total: 0,
        unpriced:   true,
        source:     e.cells.breakfast,
        linkToSource: e.cellLinks ? e.cellLinks.breakfast : '',
        fingerprint: fpBase + '|breakfast|' + bfsSlug_(e.cells.breakfast)
      });
    }
  }

  // 4. Care (before / after)
  if (e.cells.care && !/^none$/i.test(e.cells.care) && !isBfsYesNoMarker_(e.cells.care)) {
    var care = lookupPrice_(e.cells.care, catalog, 'care');
    if (care) {
      var cqty = care.multiplier === '/day' ? e.dayCount : 1;
      items.push({
        kind:       'care',
        label:      care.item,
        price:      care.price,
        multiplier: care.multiplier,
        qty:        cqty,
        total:      care.price * cqty,
        unpriced:   false,
        source:     e.cells.care,
        linkToSource: e.cellLinks ? e.cellLinks.care : '',
        fingerprint: fpBase + '|care|' + bfsSlug_(care.item)
      });
    } else {
      items.push({
        kind:       'care',
        label:      UNPRICED_TAG + ' Care: ' + e.cells.care,
        price:      0, multiplier: '', qty: 1, total: 0,
        unpriced:   true,
        source:     e.cells.care,
        linkToSource: e.cellLinks ? e.cellLinks.care : '',
        fingerprint: fpBase + '|care|' + bfsSlug_(e.cells.care)
      });
    }
  }

  // 5. T-shirt — flat one-time charge per registration. To avoid
  // duplicating across weeks for the same student, the fingerprint
  // omits week and the caller dedupes.
  if (e.cells.shirt && !/^none$/i.test(e.cells.shirt) && !isBfsYesNoMarker_(e.cells.shirt)) {
    var shirt = lookupPrice_(e.cells.shirt, catalog, 'shirt');
    if (shirt) {
      items.push({
        kind:       'shirt',
        label:      'T-Shirt (' + shirt.item + ')',
        price:      shirt.price,
        multiplier: shirt.multiplier || '',
        qty:        1,
        total:      shirt.price,
        unpriced:   false,
        source:     e.cells.shirt,
        linkToSource: e.cellLinks ? e.cellLinks.shirt : '',
        oneTimePerStudent: true,
        fingerprint: [e.email, e.student].map(bfsSlug_).join('|') + '|shirt|' + bfsSlug_(shirt.item)
      });
    } else {
      items.push({
        kind:       'shirt',
        label:      UNPRICED_TAG + ' T-Shirt: ' + e.cells.shirt,
        price:      0, multiplier: '', qty: 1, total: 0,
        unpriced:   true,
        source:     e.cells.shirt,
        linkToSource: e.cellLinks ? e.cellLinks.shirt : '',
        oneTimePerStudent: true,
        fingerprint: [e.email, e.student].map(bfsSlug_).join('|') + '|shirt|' + bfsSlug_(e.cells.shirt)
      });
    }
  }

  // Inline tax/processing fee per item — every priced item gets its
  // unit price + total inflated by the kind-appropriate rate, with a
  // feeNote describing the breakdown.
  items.forEach(applyInlineFees_);
  return items;
}

function bfsSlug_(s) {
  return String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}

/**
 * Inflate a line item's price/total by the appropriate fees based on
 * kind. Per-kind rates live in SHIRT_SALES_TAX_RATE +
 * PAYMENT_PROCESSING_FEE constants. Sets item.feeNote describing the
 * breakdown so the renderer can put it on the Item cell as a Note.
 *
 * Skips unpriced items (no inflation, keeps total = 0).
 */
function applyInlineFees_(item) {
  if (!item || item.unpriced) return item;
  if (item.kind === 'shirt-tax' || item.kind === 'processing-fee') return item;  // legacy, shouldn't appear in new flow
  var basePrice = Number(item.price) || 0;
  if (basePrice === 0) return item;

  // Which fees apply, per item:
  //   - Reg-sheet items: 3% processing always; sales tax only for shirts.
  //     (Caller doesn't set applyProcessing / applySalesTax flags, so
  //     we fall through to the kind-based default.)
  //   - Manual items: caller sets both flags explicitly from the
  //     "Apply Processing Fee?" + "Apply Sales Tax?" columns. Either or
  //     both may be false, giving 4 combinations including "no fees".
  var includeProcessing = (item.applyProcessing === false) ? false : true;
  var includeSalesTax;
  if (item.applySalesTax === true)       includeSalesTax = true;
  else if (item.applySalesTax === false) includeSalesTax = false;
  else                                    includeSalesTax = (item.kind === 'shirt');

  var rate = 0;
  var parts = [];
  if (includeSalesTax) {
    rate += SHIRT_SALES_TAX_RATE;
    parts.push(Math.round(SHIRT_SALES_TAX_RATE * 100) + '% sales tax');
  }
  if (includeProcessing) {
    rate += PAYMENT_PROCESSING_FEE;
    parts.push(Math.round(PAYMENT_PROCESSING_FEE * 100) + '% processing fee');
  }

  // No fees → keep base price, set a friendly feeNote so the cell hover
  // still explains what the operator chose.
  if (rate === 0) {
    var qty0 = Number(item.qty) || 1;
    item.basePrice = basePrice;
    item.baseTotal = Math.round(basePrice * qty0 * 100) / 100;
    item.feeNote   = 'No tax or processing fee applied. Charged at base $' +
                     basePrice.toFixed(2) + ' per unit.';
    return item;
  }

  var inflatedUnit = Math.round(basePrice * (1 + rate) * 100) / 100;
  var qty = Number(item.qty) || 1;
  var inflatedTotal = Math.round(inflatedUnit * qty * 100) / 100;

  // Note for the Item cell (no em-dashes, plain English)
  item.feeNote = 'Base unit $' + basePrice.toFixed(2) +
                 ' includes ' + parts.join(' plus ') +
                 ' = all-in $' + inflatedUnit.toFixed(2) + ' per unit.';

  item.basePrice = basePrice;
  item.baseTotal = Math.round(basePrice * qty * 100) / 100;
  item.price = inflatedUnit;
  item.total = inflatedTotal;
  return item;
}

/**
 * Recognizes a Yes/No/marker cell value (case-insensitive). The FREE
 * camp sheets use "Yes"/"No" in Breakfast/Lunch columns to mean "kid
 * wants the free meal" — these don't correspond to a priced line item
 * and should be skipped (no row, neither priced nor unpriced).
 */
function isBfsYesNoMarker_(v) {
  var t = String(v || '').trim();
  return /^(yes|y|no|n|true|false|✓|✔|x)$/i.test(t);
}

/* ═════════════════════════════════════════════════════════════════
   MANUAL ITEMS — operator-entered line items
   ═════════════════════════════════════════════════════════════════
   The reg-sheet pipeline can't capture every billable thing: late
   fees, private lessons, custom equipment, one-off invoice items.
   The Manual Items tab is the escape hatch.

   Operator types a row into the Manual Items tab. The 5-min
   reconciler reads the tab, builds priced items in the same shape
   as reg-sheet items, and feeds them into the same diff machinery
   as everything else. Lifecycle is identical:
     - New row              -> appears as 'owed' under the customer
     - Row deleted          -> 'canceled' (or 'refund-needed' if paid)
     - Edit Base Amount     -> Dashboard row updates in place
     - Edit other columns   -> requires nuclearResetBilling to repaint

   Fingerprint is anchored to a stable UUID in col H (auto-populated
   on first sight, never edit by hand). That way price edits update
   the existing row rather than cancelling + re-creating it.

   Bootstrap with setupManualItemsTab(). The 5-min cron handles
   everything else automatically. */

/**
 * Bootstrap the Manual Items tab. Idempotent: safe to run any time;
 * if the tab already exists, only headers + validation get refreshed.
 * Returns a summary object suitable for the RemoteTrigger response.
 */
function setupManualItemsTab() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sh = ss.getSheetByName(MANUAL_ITEMS_SHEET_NAME);
  if (!sh) {
    sh = ss.insertSheet(MANUAL_ITEMS_SHEET_NAME);
  }

  var headers = [
    'Email', 'Student Name', 'Item Description',
    'Base Amount', 'Qty',
    'Apply Processing Fee?', 'Apply Sales Tax?', 'Period / Note',
    'Date Added', 'Initial Status', 'ID'
  ];
  sh.getRange(1, 1, 1, headers.length)
    .setValues([headers])
    .setBackground('#143980')
    .setFontColor('#FFFFFF')
    .setFontWeight('bold')
    .setHorizontalAlignment('left');
  sh.setFrozenRows(1);

  // Column widths (px)
  sh.setColumnWidth(1, 230);  // Email
  sh.setColumnWidth(2, 170);  // Student
  sh.setColumnWidth(3, 320);  // Description
  sh.setColumnWidth(4, 110);  // Base Amount
  sh.setColumnWidth(5, 70);   // Qty
  sh.setColumnWidth(6, 150);  // Apply Processing Fee?
  sh.setColumnWidth(7, 130);  // Apply Sales Tax?
  sh.setColumnWidth(8, 170);  // Period / Note
  sh.setColumnWidth(9, 110);  // Date Added
  sh.setColumnWidth(10, 120); // Initial Status
  sh.setColumnWidth(11, 260); // ID (UUID)

  var bodyRows = Math.max(1, sh.getMaxRows() - 1);
  sh.getRange(2, 4, bodyRows, 1).setNumberFormat('"$"#,##0.00');  // Base Amount
  sh.getRange(2, 5, bodyRows, 1).setNumberFormat('0.##');         // Qty
  sh.getRange(2, 9, bodyRows, 1).setNumberFormat('yyyy-mm-dd');   // Date Added
  // Yes/No dropdowns for both fee columns
  var yesNoRule = SpreadsheetApp.newDataValidation()
    .requireValueInList(['Yes', 'No'], true)
    .setAllowInvalid(false)
    .build();
  sh.getRange(2, 6, bodyRows, 1).setDataValidation(yesNoRule);  // Processing Fee
  sh.getRange(2, 7, bodyRows, 1).setDataValidation(yesNoRule);  // Sales Tax
  // Initial Status dropdown (only the values that make sense as a starting
  // point; refund-needed/refunded/unpriced/ambiguous are reconciler-managed)
  var statusRule = SpreadsheetApp.newDataValidation()
    .requireValueInList(['owed', 'paid', 'canceled'], true)
    .setAllowInvalid(false)
    .build();
  sh.getRange(2, 10, bodyRows, 1).setDataValidation(statusRule);
  // ID column visually de-emphasized (operators should not touch it)
  sh.getRange(2, 11, bodyRows, 1)
    .setFontColor('#999999')
    .setFontFamily('Roboto Mono');

  // Hide the tab — operators interact via the dialog, not by editing
  // rows directly. To see it again, right-click any tab in the sheet
  // -> "Show all hidden sheets" -> tick "Manual Items".
  try { sh.hideSheet(); } catch (e) { /* already hidden — fine */ }

  // Instruction note on the Description header (hover to read)
  sh.getRange(1, 3).setNote(
    'Manual Items — operator-entered billable line items.\n\n' +
    'Fields:\n' +
    '  Email                  parent email (required, must contain @)\n' +
    '  Student Name           student this charge is for (use "(none)" if N/A)\n' +
    '  Item Description       shown on the Dashboard, e.g. "Private lesson Apr 12"\n' +
    '  Base Amount            unit amount BEFORE fees; negative for credits/adjustments\n' +
    '  Qty                    multiplier (blank = 1); total = Base Amount * Qty (+fees)\n' +
    '  Apply Processing Fee?  blank or Yes adds 3% processing fee; No skips it\n' +
    '  Apply Sales Tax?       Yes adds 7% sales tax on top; blank/No skips it\n' +
    '  Period / Note          free-text period label, shown next to the item\n' +
    '  Date Added             informational; not used by the billing pipeline\n' +
    '  Initial Status         blank=owed, or paid/canceled — applied only on first render\n' +
    '  ID                     auto-generated UUID on first sight — do not edit\n\n' +
    'Lifecycle:\n' +
    '  - New row picked up within 5 min, appears under the customer\n' +
    '  - Delete the row to cancel (refund-needed if the charge was already paid)\n' +
    '  - Edit Base Amount or Qty to update the dashboard row in place\n' +
    '  - Initial Status applies ONLY at first render; later operator edits to\n' +
    '    the Dashboard status pill take precedence and are preserved\n' +
    '  - Editing Description / Period requires nuclearResetBilling to repaint\n\n' +
    'Negative amounts: enter a negative Base Amount (e.g. -20.00) for a credit\n' +
    'or adjustment. The line subtracts from the customer balance naturally.\n\n' +
    'Tip: to add two identical charges for the same customer, vary the\n' +
    'Description or Period so each row is clearly distinguishable.'
  );

  return {
    ok: true,
    sheet: sh.getName(),
    headers: headers,
    rows: sh.getLastRow()
  };
}

/**
 * Read every row from the Manual Items tab; return priced items in
 * the same shape as priceEnrollment_'s output (already inflated by
 * applyInlineFees_). Empty rows skipped silently; rows with obvious
 * data problems (no email, no amount) skipped with a Logger warning.
 *
 * Side effect: rows missing a UUID in col H get one auto-generated
 * and written back in a single batched setValues at the end.
 */
function readManualItems_() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sh = ss.getSheetByName(MANUAL_ITEMS_SHEET_NAME);
  if (!sh) {
    Logger.log('[readManualItems_] no "' + MANUAL_ITEMS_SHEET_NAME +
               '" tab — skipping. Run setupManualItemsTab() to bootstrap.');
    return [];
  }
  var lastRow = sh.getLastRow();
  if (lastRow < 2) return [];

  var data = sh.getRange(2, 1, lastRow - 1, 11).getValues();
  var spreadsheetId = ss.getId();
  var gid = sh.getSheetId();
  var idColumn = data.map(function(row) { return [row[10]]; });
  var idsChanged = false;
  var items = [];
  var ALLOWED_INITIAL_STATUS = { 'owed': 1, 'paid': 1, 'canceled': 1 };

  // Fee-flag parsing: explicit No disables; everything else (including blank)
  // uses the column's documented default. Processing defaults to YES;
  // sales tax defaults to NO.
  function parseYesDefaultYes(v) {
    var t = String(v || '').trim().toLowerCase();
    return !(t === 'no' || t === 'n' || t === 'false' || t === '0');
  }
  function parseYesDefaultNo(v) {
    var t = String(v || '').trim().toLowerCase();
    return (t === 'yes' || t === 'y' || t === 'true' || t === '1' || t === '✓' || t === '✔');
  }

  for (var i = 0; i < data.length; i++) {
    var row = data[i];
    var rowNum = i + 2;
    var emailRaw         = String(row[0] || '').trim();
    var student          = String(row[1] || '').trim();
    var label            = String(row[2] || '').trim();
    var amount           = Number(row[3]);
    var qtyRaw           = row[4];
    var qty              = (qtyRaw === '' || qtyRaw === null || qtyRaw === undefined)
                            ? 1 : Number(qtyRaw);
    var applyProcessing  = parseYesDefaultYes(row[5]);
    var applyTax         = parseYesDefaultNo(row[6]);
    var period           = String(row[7] || '').trim();
    var rawStatus        = String(row[9] || '').trim().toLowerCase();
    var initialStatus    = ALLOWED_INITIAL_STATUS[rawStatus] ? rawStatus : '';
    var existingId       = String(row[10] || '').trim();

    // Wholly-blank row: skip silently (operator's working space).
    if (!emailRaw && !label && !amount) continue;

    // Partial / invalid rows: log + skip (don't pollute the dashboard).
    if (!emailRaw || emailRaw.indexOf('@') === -1) {
      Logger.log('[readManualItems_] row ' + rowNum + ': skipped — missing/invalid email');
      continue;
    }
    if (!label) {
      Logger.log('[readManualItems_] row ' + rowNum + ': skipped — missing description');
      continue;
    }
    // Negative amounts allowed (for credits/adjustments); only reject 0 or NaN.
    if (!isFinite(amount) || amount === 0) {
      Logger.log('[readManualItems_] row ' + rowNum + ': skipped — base amount must be non-zero');
      continue;
    }
    if (!isFinite(qty) || qty <= 0) {
      Logger.log('[readManualItems_] row ' + rowNum + ': skipped — qty must be > 0');
      continue;
    }

    // Stable fingerprint anchor: existing UUID, or freshly minted.
    var id = existingId || Utilities.getUuid();
    if (!existingId) {
      idColumn[i] = [id];
      idsChanged = true;
    }

    var email = emailRaw.toLowerCase();
    var studentLabel = student || '(no student)';

    items.push({
      kind:         'manual',
      label:        label,
      price:        amount,         // pre-fee unit; applyInlineFees_ inflates below
      multiplier:   '',
      qty:          qty,
      total:        amount * qty,   // pre-fee total
      unpriced:     false,
      source:       'Manual Items row ' + rowNum,
      linkToSource: bfsCellUrl_(spreadsheetId, gid, rowNum, 3),
      fingerprint:  'manual|' + id,
      // Per-item fee flags; applyInlineFees_ consults these to skip or apply
      // each fee independently. Both can be true (10%), one (3% or 7%), or
      // neither (no inflation at all).
      applyProcessing: applyProcessing,
      applySalesTax:   applyTax,
      // Honored only at first render — once the row exists on Dashboard,
      // operator edits to the status pill take precedence (see new-row
      // writers in appendItemsToCustomerSection_, appendNewCustomerSection_,
      // and the nuclearReset matrix builder).
      initialStatus: initialStatus,
      enrollment: {
        email:      email,
        emailRaw:   emailRaw,
        student:    studentLabel,
        week:       period,
        sheetLabel: 'Manual Items',
        sourceRow:  rowNum,
        type:       'manual'
      }
    });
  }

  // Batch-write any newly-minted IDs in one call (col K = 11).
  if (idsChanged) {
    sh.getRange(2, 11, idColumn.length, 1).setValues(idColumn);
  }

  // Inflate prices (3% processing; 10% if taxed). Same pipeline reg-sheet
  // items go through, so the cell Note breakdown reads identically.
  items.forEach(applyInlineFees_);
  return items;
}

/* ═════════════════════════════════════════════════════════════════
   ADD-MANUAL-ITEM DIALOG — UI hooks
   ═════════════════════════════════════════════════════════════════
   Backend handlers for the "+ Add manual item" custom-menu dialog.
   The dialog itself is AddManualItem.html, served via HtmlService.

   Wiring:
     1. Menu.js onOpen      -> "Billing" menu -> "+ Add manual item..."
     2. menu item click     -> showAddManualItemDialog()
     3. dialog opens        -> google.script.run.manualItemDialog_listContacts()
                               fetches existing customer list for autocomplete
     4. operator submits    -> google.script.run.manualItemDialog_submit(payload)
                               writes Manual Items row + schedules buildAllBilling
                               for ~10s later (avoids lock contention with cron)
   The 5-min cron also picks the row up — the one-time trigger just
   makes the new row appear faster than waiting up to 5 minutes. */

/**
 * Open the Add Manual Item modal dialog. Called from the Billing custom
 * menu. Loads AddManualItem.html.
 */
function showAddManualItemDialog() {
  // Pre-inject the contact list via HtmlTemplate so the sidebar opens
  // with autocomplete data already in scope. ~108 contacts inlines fine.
  var template = HtmlService.createTemplateFromFile('AddManualItem');
  try {
    template.contactsJson = JSON.stringify(manualItemDialog_listContacts());
  } catch (e) {
    Logger.log('[showAddManualItemDialog] contact pre-fetch failed: ' + e.message);
    template.contactsJson = '[]';
  }
  var html = template.evaluate().setTitle('Add Manual Item');
  SpreadsheetApp.getUi().showSidebar(html);
}

/**
 * Sanity check the template parses and the contact-injection scriptlet
 * works. Invoke via clasp run before claiming a UI change is ready.
 * Returns a dump rather than logging so the result is visible.
 */
function testAddManualItemTemplate() {
  var template = HtmlService.createTemplateFromFile('AddManualItem');
  template.contactsJson = JSON.stringify([
    { name: 'Alice Tester', email: 'alice@example.com', phone: '', students: 'Foo Bar', hasProfile: false }
  ]);
  var content = template.evaluate().getContent();
  return {
    ok: true,
    length: content.length,
    injectionWorks: content.indexOf('alice@example.com') !== -1,
    head: content.substring(0, 220)
  };
}

/**
 * Return the existing customer list for autocomplete. Sources from the
 * Dashboard's customer header rows (col B contains "@"). Fast — single
 * range read, no API calls.
 *
 * Shape: [{name, email, phone, students, hasProfile}]
 */
function manualItemDialog_listContacts() {
  var dash = getDashboardSheet();
  var lastRow = dash.getLastRow();
  if (lastRow < 2) return [];
  var rng = dash.getRange(2, 1, lastRow - 1, 5).getValues();
  var profileFormulas = dash.getRange(2, 6, lastRow - 1, 1).getFormulas();

  var contacts = [];
  var seen = {};
  for (var i = 0; i < rng.length; i++) {
    var row = rng[i];
    var emailCell = String(row[1] || '').trim();
    if (emailCell.indexOf('@') === -1) continue;  // tx / sub-header rows
    var key = emailCell.toLowerCase();
    if (seen[key]) continue;
    seen[key] = true;
    contacts.push({
      name:     String(row[0] || '').trim(),
      email:    emailCell,
      phone:    String(row[2] || '').trim(),
      students: String(row[4] || '').trim(),
      hasProfile: /HYPERLINK/i.test(profileFormulas[i][0] || '')
    });
  }
  // Sort alphabetically by name (case-insensitive)
  contacts.sort(function(a, b) {
    return a.name.toLowerCase().localeCompare(b.name.toLowerCase());
  });
  return contacts;
}

/**
 * Webapp /exec URL for the dialog -> RemoteTrigger delegation. This is
 * the deployment that runs as the owner (USER_DEPLOYING). Not secret —
 * the REMOTE_TRIGGER_TOKEN Script Property is the gate. Update this
 * constant when a new webapp deployment is created (rare).
 */
var MANUAL_ITEM_DIALOG_WEBAPP_URL =
  'https://script.google.com/macros/s/AKfycbxBFLqn4a4gKV5n6LjStI18fn0KnSO7kLdlkEMBXhYCXWjoaBolobKZsbpSaD7IUEgIag/exec';

/**
 * Receive the submitted payload from the dialog and delegate the actual
 * write to the deployed RemoteTrigger webapp. The webapp runs as the
 * owner (USER_DEPLOYING = emilio@nilsdigital.com), so any editor invited
 * to the spreadsheet can submit items without needing their own write
 * grants on the sheet or trigger inventory.
 *
 * This indirection sidesteps the per-user authorization landmines that
 * the old "write directly + ScriptApp.newTrigger" path tripped on for
 * invited editors:
 *   - per-user script.scriptapp grant for trigger creation
 *   - per-user trigger quota (max 20)
 *   - per-user "this app isn't verified" friction on the sensitive
 *     scopes (script.send_mail, drive.readonly) that other functions
 *     in this project use
 *
 * Payload shape:
 *   { email, student, label, amount, qty, applyProcessing, applyTax,
 *     period, status }
 */
function manualItemDialog_submit(payload) {
  var p = payload || {};
  var email   = String(p.email   || '').trim();
  var student = String(p.student || '').trim() || '(no student)';
  var label   = String(p.label   || '').trim();
  var amount  = Number(p.amount);
  var qty     = (p.qty === '' || p.qty === null || p.qty === undefined)
                  ? 1 : Number(p.qty);
  // Dialog sends explicit booleans; default processing=ON, tax=OFF if the
  // caller didn't pass them at all (legacy / CLI usage).
  var applyProcessing = (p.applyProcessing === false) ? false : true;
  var applyTax        = !!p.applyTax;
  var period  = String(p.period  || '').trim();
  var statusRaw = String(p.status || '').trim().toLowerCase();
  var status = /^(owed|paid|canceled)$/.test(statusRaw) ? statusRaw : '';

  // Validation (cheap, do client-side too — but trust nothing on submit).
  if (!email || email.indexOf('@') === -1) {
    return { ok: false, error: 'Please enter a valid email address.' };
  }
  if (!label) {
    return { ok: false, error: 'Item description is required.' };
  }
  // Negative amounts allowed (credits/adjustments); only reject 0 or NaN.
  if (!isFinite(amount) || amount === 0) {
    return { ok: false, error: 'Amount must be non-zero (negative is OK for credits).' };
  }
  if (!isFinite(qty) || qty <= 0) {
    return { ok: false, error: 'Quantity must be greater than 0.' };
  }

  var token = PropertiesService.getScriptProperties()
    .getProperty('REMOTE_TRIGGER_TOKEN');
  if (!token) {
    return {
      ok: false,
      error: 'Remote trigger token not configured. An admin needs to set ' +
             'REMOTE_TRIGGER_TOKEN in Project Settings -> Script Properties.'
    };
  }
  var webappUrl = MANUAL_ITEM_DIALOG_WEBAPP_URL;

  // Build the GET query for the webapp's addManualItem endpoint.
  // sync=1 -> runs inside the webapp request and returns the result.
  // refresh=1 -> webapp schedules a buildAllBilling trigger ~10s out so
  //              the Dashboard reflects the new row within seconds.
  var params = {
    fn:              'addManualItem',
    token:           token,
    sync:            '1',
    refresh:         '1',
    email:           email,
    student:         student,
    label:           label,
    amount:          String(amount),
    qty:             String(qty),
    applyProcessing: applyProcessing ? 'Yes' : 'No',
    applyTax:        applyTax ? 'Yes' : 'No',
    period:          period,
    status:          status
  };
  var qs = Object.keys(params).map(function(k) {
    return encodeURIComponent(k) + '=' + encodeURIComponent(params[k]);
  }).join('&');

  var parsed;
  try {
    var res = UrlFetchApp.fetch(webappUrl + '?' + qs, {
      method:              'get',
      muteHttpExceptions:  true,
      followRedirects:     true
    });
    var code = res.getResponseCode();
    var body = res.getContentText();
    try { parsed = JSON.parse(body); }
    catch (parseErr) {
      return {
        ok: false,
        error: 'Webapp returned non-JSON (HTTP ' + code + '): ' +
               body.substring(0, 200)
      };
    }
    if (code !== 200 || !parsed || parsed.ok !== true) {
      return {
        ok: false,
        error: (parsed && (parsed.error ||
                           (parsed.result && parsed.result.error))) ||
               ('Webapp returned HTTP ' + code)
      };
    }
  } catch (e) {
    return { ok: false, error: 'Webapp call failed: ' + (e && e.message || e) };
  }

  // sync=1 wraps the dispatched function's return value under .result.
  var result = parsed.result || {};
  return {
    ok: true,
    sheet: result.sheet || MANUAL_ITEMS_SHEET_NAME,
    row: result.row || null,
    triggerId: result.refreshTriggerId || null,
    note: result.refreshTriggerId
      ? 'Saved. Dashboard refreshes in ~10 seconds.'
      : 'Saved. Dashboard refreshes within 5 minutes.'
  };
}

/* ═════════════════════════════════════════════════════════════════
   PER-SHEET BILLING TAB BUILD
   ═════════════════════════════════════════════════════════════════ */

/**
 * Build/refresh the Billing tab on one registration sheet.
 * Idempotent: status pills from a prior run are preserved by fingerprint.
 *
 * @param {{id, label, type}} reg
 * @param {Map} catalog
 * @returns {{enrollments, txRows, unpriced}}
 */
function buildBillingForSheet_(reg, catalog) {
  var ss = SpreadsheetApp.openById(reg.id);
  var billing = ss.getSheetByName(BILLING_TAB_NAME);

  // Snapshot existing status pills (by fingerprint) before clearing
  var existingStatus = {};
  if (billing) {
    var lr = billing.getLastRow();
    if (lr >= 3) {  // row 1 = title, row 2 = header, row 3+ = data
      var existing = billing.getRange(3, 1, lr - 2, 9).getValues();
      existing.forEach(function(row) {
        var fp = String(row[0] || '');
        var status = String(row[8] || '');
        if (fp && status) existingStatus[fp] = status;
      });
    }
  } else {
    billing = ss.insertSheet(BILLING_TAB_NAME);
    // Move to the END of the tab list
    var pos = ss.getNumSheets();
    ss.setActiveSheet(billing);
    ss.moveActiveSheet(pos);
  }

  // Walk enrollments → priced line items
  var enrollments = readRegistrationEnrollments_(reg);
  var allItems = [];
  var seenShirts = {};  // dedupe one-time-per-student items
  enrollments.forEach(function(e) {
    var items = priceEnrollment_(e, catalog);
    items.forEach(function(it) {
      if (it.oneTimePerStudent) {
        if (seenShirts[it.fingerprint]) return;
        seenShirts[it.fingerprint] = true;
      }
      it.enrollment = e;  // attach for the writer
      allItems.push(it);
    });
  });

  // Sort: parent email → student → week → kind
  allItems.sort(function(a, b) {
    var byEmail = (a.enrollment.email || '').localeCompare(b.enrollment.email || '');
    if (byEmail !== 0) return byEmail;
    var byStudent = (a.enrollment.student || '').localeCompare(b.enrollment.student || '');
    if (byStudent !== 0) return byStudent;
    var byWeek = BFS_WEEK_ORDER.indexOf(a.enrollment.week) - BFS_WEEK_ORDER.indexOf(b.enrollment.week);
    if (byWeek !== 0) return byWeek;
    return (a.kind || '').localeCompare(b.kind || '');
  });

  // Render
  renderBillingTab_(billing, reg, allItems, existingStatus);

  var unpricedCount = allItems.filter(function(it) { return it.unpriced; }).length;
  return {
    enrollments: enrollments.length,
    txRows: allItems.length,
    unpriced: unpricedCount
  };
}

function renderBillingTab_(billing, reg, items, existingStatus) {
  billing.clear();
  billing.clearConditionalFormatRules();

  var NUM_COLS = 10;  // includes new "Fix Link" column
  var BILLING_FONT = 'DM Sans';  // applied to every cell at the end

  // Row 1: title banner
  var title = 'Billing — ' + reg.label;
  billing.getRange(1, 1, 1, NUM_COLS).merge();
  var unpricedCount = items.filter(function(it) { return it.unpriced; }).length;
  var ambigCount    = items.filter(function(it) { return it.ambiguous && !it.unpriced; }).length;
  var reviewBlurb = unpricedCount + ' unpriced';
  if (ambigCount) reviewBlurb += ' + ' + ambigCount + ' ambiguous';
  billing.getRange(1, 1)
    .setValue(title + '   |   ' + items.length + ' line items   |   ' +
              reviewBlurb + ' need review   |   last refreshed ' +
              new Date().toISOString().replace(/\.\d{3}Z$/, 'Z'))
    .setBackground('#0F3634').setFontColor('#FFFFFF')
    .setFontWeight('bold').setFontSize(12)
    .setHorizontalAlignment('left');
  billing.setRowHeight(1, 32);

  // Row 2: column headers
  var headers = [
    'Fingerprint', 'Parent Email', 'Student', 'Week', 'Item',
    'Unit Price', 'Qty', 'Total', 'Status', 'Fix Link'
  ];
  billing.getRange(2, 1, 1, headers.length).setValues([headers])
    .setBackground('#143980').setFontColor('#FFFFFF')
    .setFontWeight('bold').setFontSize(11);
  billing.setFrozenRows(2);

  // Hide column A (fingerprint) — used internally for status preservation
  billing.hideColumns(1);

  // Build the data block. The Fix Link col is left as a string for
  // priced rows ('') and as a HYPERLINK formula for unpriced rows.
  // Mixing values + formulas in one setValues call needs the formula
  // string to be a true formula (starting with '='), which Sheets
  // recognizes and evaluates. Confirmed Apps Script behavior.
  var rows = items.map(function(it) {
    var defaultStatus = it.unpriced
      ? 'unpriced'
      : (it.ambiguous ? 'ambiguous' : 'owed');
    var status = existingStatus[it.fingerprint] || defaultStatus;
    var linkCell = '';
    // Surface a "Open cell" jump-link whenever the row needs human
    // attention (unmatched OR multiple matches) so the team can fix
    // it in the registration sheet directly.
    if ((it.unpriced || it.ambiguous) && it.linkToSource) {
      linkCell = '=HYPERLINK("' + it.linkToSource + '","Open cell")';
    }
    return [
      it.fingerprint,
      it.enrollment.emailRaw || it.enrollment.email,
      it.enrollment.student,
      it.enrollment.week,
      it.label,
      it.price,
      it.qty + (it.multiplier ? ' (' + it.multiplier.replace('/', 'per ') + ')' : ''),
      it.total,
      status,
      linkCell
    ];
  });

  if (rows.length) {
    billing.getRange(3, 1, rows.length, NUM_COLS).setValues(rows);
    billing.getRange(3, 6, rows.length, 1).setNumberFormat('"$"#,##0.00');
    billing.getRange(3, 8, rows.length, 1).setNumberFormat('"$"#,##0.00');

    // Status dropdown
    var statusRule = SpreadsheetApp.newDataValidation()
      .requireValueInList(STATUS_VALUES, true)
      .setAllowInvalid(false).build();
    billing.getRange(3, 9, rows.length, 1).setDataValidation(statusRule);

    var rules = [];

    // ENTIRE-ROW yellow highlight when status needs review (either
    // unmatched or multiple-match-ambiguous). What the team scans for.
    var allRows = billing.getRange(3, 1, rows.length, NUM_COLS);
    rules.push(SpreadsheetApp.newConditionalFormatRule()
      .whenFormulaSatisfied('=OR($I3="unpriced",$I3="ambiguous")')
      .setBackground('#FFF3B0')
      .setRanges([allRows]).build());

    // Per-status color on the Status pill column (col I)
    var statusCol = billing.getRange(3, 9, rows.length, 1);
    rules.push(SpreadsheetApp.newConditionalFormatRule()
      .whenTextEqualTo('paid').setBackground('#D4EDDA').setFontColor('#155724').setBold(true)
      .setRanges([statusCol]).build());
    rules.push(SpreadsheetApp.newConditionalFormatRule()
      .whenTextEqualTo('owed').setBackground('#FFF3CD').setFontColor('#856404')
      .setRanges([statusCol]).build());
    rules.push(SpreadsheetApp.newConditionalFormatRule()
      .whenTextEqualTo('canceled').setBackground('#E2E3E5').setFontColor('#383D41')
      .setRanges([statusCol]).build());
    rules.push(SpreadsheetApp.newConditionalFormatRule()
      .whenTextEqualTo('refunded').setBackground('#FFE5CC').setFontColor('#A05A00')
      .setRanges([statusCol]).build());
    rules.push(SpreadsheetApp.newConditionalFormatRule()
      .whenTextEqualTo('unpriced').setBackground('#F0AD4E').setFontColor('#5A3A00').setBold(true)
      .setRanges([statusCol]).build());
    rules.push(SpreadsheetApp.newConditionalFormatRule()
      .whenTextEqualTo('ambiguous').setBackground('#FFD966').setFontColor('#5A3A00').setBold(true)
      .setRanges([statusCol]).build());

    billing.setConditionalFormatRules(rules);
  }

  // Column widths
  billing.setColumnWidth(2, 220);  // Parent Email
  billing.setColumnWidth(3, 160);  // Student
  billing.setColumnWidth(4, 140);  // Week
  billing.setColumnWidth(5, 280);  // Item
  billing.setColumnWidth(6, 100);  // Unit Price
  billing.setColumnWidth(7, 120);  // Qty
  billing.setColumnWidth(8, 100);  // Total
  billing.setColumnWidth(9, 110);  // Status
  billing.setColumnWidth(10, 120); // Fix Link

  // Filter on header row
  if (billing.getFilter()) billing.getFilter().remove();
  billing.getRange(2, 1, Math.max(rows.length + 1, 2), NUM_COLS).createFilter();

  // Apply DM Sans across every cell in the rendered area. Done last so
  // it covers the banner, headers, and every data row uniformly.
  var totalRows = 2 + rows.length;
  billing.getRange(1, 1, totalRows, NUM_COLS).setFontFamily(BILLING_FONT);
}

/* ═════════════════════════════════════════════════════════════════
   FORM-SUBMISSION SHEET READERS (Vladimir, Private Lessons,
   Rent-A-Sensei, Balloons)
   ═════════════════════════════════════════════════════════════════
   Each of the 4 new form-submission sheets has the shape "one row per
   submission, raw form fields as columns" — closer to the Manual Items
   tab than to the camp registration sheets. Each reader walks its
   sheet and emits priced items in the same shape readManualItems_ uses,
   so the downstream diff/reconcile pipeline doesn't need to know about
   them at all.

   Fingerprint scheme:
     - Single-priced forms (seminar, private-lessons, babysitting):
         <kind>|<sheet_id>|<row_num>
     - Multi-priced form (decor):
         decor|<sheet_id>|<row_num>|<field_key>

   Stability assumption: operators are told NOT to delete or reorder
   submission rows once they exist. New submissions append to the
   bottom (workflow-driven), so row_num is a stable identifier across
   rebuilds for any given submission.

   Customer routing: each row has Email + Full Name + Phone in the
   first columns, written by the GHL "Add Row" workflow. The diff
   pipeline already groups items by enrollment.email, so submissions
   from the same parent (across forms) consolidate naturally under
   one Dashboard customer block.

   Status:
     - seminar / private-lessons / decor: items start as 'owed'
     - babysitting: no in-form pricing, items start as 'ambiguous'
       with the (unpriced) tag. Tom edits the cell to set the actual
       price + flips status when he sends the quote.
   ─────────────────────────────────────────────────────────────── */

/**
 * Shared meta extractor. The 4 form-submission sheets all start with
 * Contact ID (col A) | Full Name or Parent Name (col B) | Phone (col C)
 * | Email (col D). Returns null when the row is wholly blank or has no
 * usable email — caller continues to the next row.
 */
function bfsParseFormSubmissionMeta_(row) {
  var email = String(row[3] || '').trim().toLowerCase();
  if (!email || email.indexOf('@') === -1) return null;
  return {
    contactId: String(row[0] || '').trim(),
    name:      String(row[1] || '').trim(),
    phone:     String(row[2] || '').trim(),
    emailRaw:  String(row[3] || '').trim(),
    email:     email
  };
}

/**
 * Shared engine for forms with ONE priced column (Vladimir Seminar,
 * Private Lesson Booking). Both have the same prefix shape and one
 * column whose value is a priced option label like
 * "Two Day Pass, Early Bird $275 (must pay before Aug 1)".
 *
 * spec: {
 *   kind:       string,
 *   pricedCol:  { idx: number (0-based), name: string }
 * }
 */
function bfsReadSinglePricedColumnForm_(reg, spec) {
  var ss = SpreadsheetApp.openById(reg.id);
  var sh = ss.getSheets()[0];
  var lastRow = sh.getLastRow();
  if (lastRow < 2) return [];

  var lastCol = sh.getLastColumn();
  var data = sh.getRange(2, 1, lastRow - 1, lastCol).getValues();
  var spreadsheetId = reg.id;
  var gid = sh.getSheetId();
  var items = [];

  for (var i = 0; i < data.length; i++) {
    var row = data[i];
    var rowNum = i + 2;
    var meta = bfsParseFormSubmissionMeta_(row);
    if (!meta) continue;

    var raw = String(row[spec.pricedCol.idx] || '').trim();
    if (!raw) continue;

    var price = parsePrice(raw);
    var hasPrice = (price !== null && price > 0);
    var cleanLabel = stripPriceFromLabel(raw) || raw;

    items.push({
      kind:            spec.kind,
      label:           spec.pricedCol.name + ': ' + cleanLabel,
      price:           hasPrice ? price : 0,
      multiplier:      '',
      qty:             1,
      total:           hasPrice ? price : 0,
      unpriced:        !hasPrice,
      source:          reg.label + ' row ' + rowNum,
      linkToSource:    bfsCellUrl_(spreadsheetId, gid, rowNum, spec.pricedCol.idx + 1),
      fingerprint:     spec.kind + '|' + spreadsheetId + '|' + rowNum,
      applyProcessing: hasPrice,
      applySalesTax:   false,
      enrollment: {
        email:      meta.email,
        emailRaw:   meta.emailRaw,
        student:    '',
        week:       '',
        sheetLabel: reg.label,
        sourceRow:  rowNum,
        type:       spec.kind
      }
    });
  }
  items.forEach(applyInlineFees_);
  return items;
}

/**
 * Vladimir Vasiliev Seminar reader. Single priced column: Pass Selection (E).
 * Sheet columns:
 *   A Contact ID | B Full Name | C Phone | D Email | E Pass Selection
 *   | F Experience Level | G Emergency Contact Name | H Emergency Contact Phone
 *   | I T-Shirt Size | J Dietary Restrictions or Allergies
 *   | K How did you hear about the seminar?
 */
function readSeminarSubmissions_(reg) {
  return bfsReadSinglePricedColumnForm_(reg, {
    kind: 'seminar',
    pricedCol: { idx: 4, name: 'Pass Selection' }
  });
}

/**
 * Private Lesson Booking reader. Single priced column: Lesson Length & Price (G).
 * Sheet columns:
 *   A Contact ID | B Full Name | C Phone | D Email | E State | F Instructor
 *   | G Lesson Length & Price | H Number of Students | I Training Type
 *   | J Age Group | K Package | L Preferred Date | M Preferred Time
 */
function readPrivateLessonSubmissions_(reg) {
  return bfsReadSinglePricedColumnForm_(reg, {
    kind: 'private-lessons',
    pricedCol: { idx: 6, name: 'Lesson Length & Price' }
  });
}

/**
 * Rent-A-Sensei (babysitting) reader. NO in-form pricing — Tom quotes
 * manually after speaking to the customer. Each submission yields one
 * item with unpriced=true and initialStatus='ambiguous'. Tom edits the
 * Dashboard cell to set the real price + flip the status when ready.
 *
 * Sheet columns:
 *   A Contact ID | B Parent Name | C Phone | D Email | E Service Type
 *   | F Number of Children | G Duration | H Full Address | I Date
 *   | J Start Time | K End Time | L Confirm: not for parties or events
 *   | M Special instructions / extra children info
 */
function readBabysittingSubmissions_(reg) {
  var ss = SpreadsheetApp.openById(reg.id);
  var sh = ss.getSheets()[0];
  var lastRow = sh.getLastRow();
  if (lastRow < 2) return [];

  var lastCol = sh.getLastColumn();
  var data = sh.getRange(2, 1, lastRow - 1, lastCol).getValues();
  var spreadsheetId = reg.id;
  var gid = sh.getSheetId();
  var items = [];

  for (var i = 0; i < data.length; i++) {
    var row = data[i];
    var rowNum = i + 2;
    var meta = bfsParseFormSubmissionMeta_(row);
    if (!meta) continue;

    var serviceType = String(row[4] || '').trim();
    var duration    = String(row[6] || '').trim();
    var date        = String(row[8] || '').trim();

    var labelParts = ['Rent-A-Sensei booking'];
    if (serviceType) labelParts.push(serviceType);
    if (duration)    labelParts.push(duration);
    if (date)        labelParts.push('on ' + date);
    var label = labelParts.join(', ');

    items.push({
      kind:            'babysitting',
      label:           label,
      price:           0,
      multiplier:      '',
      qty:             1,
      total:           0,
      unpriced:        true,
      source:          reg.label + ' row ' + rowNum,
      linkToSource:    bfsCellUrl_(spreadsheetId, gid, rowNum, 5),
      fingerprint:     'babysitting|' + spreadsheetId + '|' + rowNum,
      applyProcessing: false,
      applySalesTax:   false,
      initialStatus:   'ambiguous',
      enrollment: {
        email:      meta.email,
        emailRaw:   meta.emailRaw,
        student:    '',
        week:       '',
        sheetLabel: reg.label,
        sourceRow:  rowNum,
        type:       'babysitting'
      }
    });
  }
  // No applyInlineFees_ pass — all items are unpriced ($0), and fee
  // inflation skips $0 items anyway.
  return items;
}

/**
 * Balloons (decor) reader. Up to 9 priced columns per submission. Each
 * non-blank priced field becomes its own tx row so the team and Emily
 * can mark each line item paid/canceled independently.
 *
 * Sheet columns:
 *   A Contact ID | B Full Name | C Phone | D Email | E Garland
 *   | F Additional Feet of Garland | G Columns | H Arch
 *   | I Balloon Wall / Backdrop | J Add-Ons (range-priced)
 *   | K Delivery Fee | L Setup Complexity | M Optional Fees
 *   | N Party Theme | O Primary Color | P Secondary Color
 *   | Q Accent Color | R Notes for Emily
 */
function readDecorSubmissions_(reg) {
  var ss = SpreadsheetApp.openById(reg.id);
  var sh = ss.getSheets()[0];
  var lastRow = sh.getLastRow();
  if (lastRow < 2) return [];

  var lastCol = sh.getLastColumn();
  var data = sh.getRange(2, 1, lastRow - 1, lastCol).getValues();
  var spreadsheetId = reg.id;
  var gid = sh.getSheetId();
  var items = [];

  var pricedCols = [
    { idx: 4,  name: 'Garland',                 key: 'garland' },
    { idx: 5,  name: 'Additional Feet',         key: 'addl-feet' },
    { idx: 6,  name: 'Columns',                 key: 'columns' },
    { idx: 7,  name: 'Arch',                    key: 'arch' },
    { idx: 8,  name: 'Balloon Wall / Backdrop', key: 'wall' },
    { idx: 9,  name: 'Add-Ons',                 key: 'addons' },
    { idx: 10, name: 'Delivery Fee',            key: 'delivery' },
    { idx: 11, name: 'Setup Complexity',        key: 'setup' },
    { idx: 12, name: 'Optional Fees',           key: 'optfees' }
  ];

  for (var i = 0; i < data.length; i++) {
    var row = data[i];
    var rowNum = i + 2;
    var meta = bfsParseFormSubmissionMeta_(row);
    if (!meta) continue;

    pricedCols.forEach(function(pc) {
      var raw = String(row[pc.idx] || '').trim();
      if (!raw) return;
      // Customer picked "None" or equivalent skip-marker — no tx row.
      if (/^(none|n\/a|no)$/i.test(raw)) return;

      var price = parsePrice(raw);
      var hasPrice = (price !== null && price > 0);
      var cleanLabel = stripPriceFromLabel(raw) || raw;

      items.push({
        kind:            'decor',
        label:           pc.name + ': ' + cleanLabel,
        price:           hasPrice ? price : 0,
        multiplier:      '',
        qty:             1,
        total:           hasPrice ? price : 0,
        unpriced:        !hasPrice,
        source:          reg.label + ' row ' + rowNum + ', ' + pc.name,
        linkToSource:    bfsCellUrl_(spreadsheetId, gid, rowNum, pc.idx + 1),
        fingerprint:     'decor|' + spreadsheetId + '|' + rowNum + '|' + pc.key,
        applyProcessing: hasPrice,
        applySalesTax:   false,
        enrollment: {
          email:      meta.email,
          emailRaw:   meta.emailRaw,
          student:    meta.name || '(no name)',
          week:       '',
          sheetLabel: reg.label,
          sourceRow:  rowNum,
          type:       'decor'
        }
      });
    });
  }
  items.forEach(applyInlineFees_);
  return items;
}

/**
 * Dispatcher used by buildAllBilling. Routes the discovered form-
 * submission sheet to the right per-category reader. Returns priced
 * items in the standard shape (enrollment already attached).
 */
function bfsReadFormSubmissionSheet_(reg) {
  switch (reg.type) {
    case 'seminar':         return readSeminarSubmissions_(reg);
    case 'private-lessons': return readPrivateLessonSubmissions_(reg);
    case 'babysitting':     return readBabysittingSubmissions_(reg);
    case 'decor':           return readDecorSubmissions_(reg);
    default:
      Logger.log('[bfsReadFormSubmissionSheet_] unknown type ' + reg.type +
                 ' for ' + reg.label);
      return [];
  }
}

/* ═════════════════════════════════════════════════════════════════
   FORM-SHEET QUICK LINKS (Dashboard header row, cols K-O)
   ═════════════════════════════════════════════════════════════════
   Discovers the 4 form-submission sheets in FORM_SUBMISSIONS_FOLDER_ID
   and writes clickable HYPERLINK chips into Dashboard row 1 cols K-N,
   with O holding a link to the folder itself. J1 stays untouched
   because the existing one-shot actions dropdown lives there.

   Idempotent: re-running rewrites the same cells. Picks up renamed
   sheets automatically (matching by FORM_SUBMISSION_SHEET_CATEGORIES
   patterns, same logic the discovery walker uses). Safe to call from
   the buildAllBilling tail every 5 min — costs 5 cell writes when
   things are stable, and self-heals if a chip gets cleared by
   accident.
   ─────────────────────────────────────────────────────────────── */

function installFormSheetQuickLinks() {
  var dash = getDashboardSheet();
  if (!dash) {
    Logger.log('[installFormSheetQuickLinks] Dashboard tab not found');
    return { ok: false, error: 'Dashboard tab missing' };
  }
  if (!FORM_SUBMISSIONS_FOLDER_ID || FORM_SUBMISSIONS_FOLDER_ID.length < 5) {
    Logger.log('[installFormSheetQuickLinks] FORM_SUBMISSIONS_FOLDER_ID not set');
    return { ok: false, error: 'FORM_SUBMISSIONS_FOLDER_ID not configured' };
  }

  var folder;
  try {
    folder = DriveApp.getFolderById(FORM_SUBMISSIONS_FOLDER_ID);
  } catch (e) {
    Logger.log('[installFormSheetQuickLinks] folder open failed: ' + e.message);
    return { ok: false, error: 'Cannot open folder: ' + e.message };
  }

  // Walk the folder, classify each Google Sheet against the same regex
  // table buildAllBilling uses, so chip wiring stays in lockstep with
  // the reader pipeline.
  var byType = {};
  var files = folder.getFiles();
  while (files.hasNext()) {
    var f = files.next();
    if (f.getMimeType() !== MimeType.GOOGLE_SHEETS) continue;
    var name = f.getName();
    for (var i = 0; i < FORM_SUBMISSION_SHEET_CATEGORIES.length; i++) {
      var rule = FORM_SUBMISSION_SHEET_CATEGORIES[i];
      if (rule.pattern.test(name)) {
        byType[rule.type] = { url: f.getUrl(), name: name };
        break;
      }
    }
  }

  // Column layout (J1 reserved for the existing one-shot actions
  // dropdown). Short labels keep the chip width manageable.
  var chips = [
    { col: 11, type: 'seminar',         label: 'Vladimir Seminar' },
    { col: 12, type: 'private-lessons', label: 'Private Lessons'  },
    { col: 13, type: 'babysitting',     label: 'Rent-A-Sensei'    },
    { col: 14, type: 'decor',           label: 'Balloons'         }
  ];

  var written = 0, missing = [];
  chips.forEach(function(chip) {
    var entry = byType[chip.type];
    var cell = dash.getRange(1, chip.col);
    if (entry) {
      cell.setFormula('=HYPERLINK("' + entry.url + '","' +
                      bfsEscapeFormula_(chip.label) + '")');
      written++;
    } else {
      cell.setValue(chip.label + ' (sheet not found)');
      missing.push(chip.type);
    }
    cell
      .setBackground('#143980')
      .setFontColor('#FFFFFF')
      .setFontWeight('bold')
      .setFontSize(11)
      .setHorizontalAlignment('center')
      .setVerticalAlignment('middle');
    dash.setColumnWidth(chip.col, 170);
  });

  // O1: link to the folder itself, darker chip so it visually reads as
  // the parent-of-the-four.
  var folderUrl = 'https://drive.google.com/drive/folders/' +
                  FORM_SUBMISSIONS_FOLDER_ID;
  dash.getRange(1, 15)
    .setFormula('=HYPERLINK("' + folderUrl + '","All Form Sheets")')
    .setBackground('#0F3634')
    .setFontColor('#FFFFFF')
    .setFontWeight('bold')
    .setFontSize(11)
    .setHorizontalAlignment('center')
    .setVerticalAlignment('middle');
  dash.setColumnWidth(15, 170);

  Logger.log('[installFormSheetQuickLinks] wrote ' + written + ' chip(s); missing: ' +
             (missing.length ? missing.join(', ') : '(none)'));

  return {
    ok: true,
    written: written,
    missing: missing,
    columns: { K: 'seminar', L: 'private-lessons', M: 'babysitting', N: 'decor', O: 'folder' }
  };
}
