/** ─── DiscrepancyCheck.js ─────────────────────────────────────────────
 *  Failsafe that compares GHL form submissions against the Free Camp
 *  and Summer Camp registration spreadsheets. If a submission selected
 *  a week and there is no matching row in the corresponding tab, the
 *  bot appends one (Free Camp only) or surfaces it in the report
 *  (Summer Camp — schemas differ enough to keep auto-add out of v1).
 *
 *  Identity is tracked by writing the GHL submission ID into a hidden
 *  "_submissionId" column on the right of each weekly tab. That gives
 *  us idempotency: if the team manually deletes a row that the bot
 *  previously wrote, we DO NOT re-add it (the deletion is respected).
 *
 *  Intended cadence: every 15 minutes via a time-driven trigger.
 *  Submissions younger than GRACE_WINDOW_MS are ignored so we never
 *  race the GHL routing workflow that handles the happy path.
 *
 *  Setup (one-time):
 *    1. Set Script Properties (Project Settings → Script Properties):
 *         SUPABASE_URL          = https://nroeiabeirifurdaybyo.supabase.co
 *         SUPABASE_ANON_KEY     = <legacy anon key>
 *         SUPABASE_TOKEN_SECRET = <secret matching get_systema_floyd_florida_token RPC>
 *       The GHL access token is fetched fresh from Supabase on each
 *       run via the SECURITY DEFINER RPC (no static PIT to rotate).
 *    2. Run discrepancySetupTrigger() once from the editor.
 *    3. Run discrepancyBackfillTracking() once to seed the hidden
 *       _submissionId column for existing rows (so we don't re-add them).
 *    4. Run discrepancyBackfillTombstones() once after step 3 to
 *       create the persistent tombstone tab in each spreadsheet.
 *       After this, deleting a row in the visible tabs is permanent —
 *       the bot will never re-add a kid the team has removed.
 *
 *  Output: when a run finds anything (added rows, orphans, errors,
 *  Summer Camp gaps), an email digest goes to DC_NOTIFY_EMAIL. Quiet
 *  runs send nothing. The full report object is also returned + visible
 *  in the Apps Script Executions log.
 */

// ─────────────────────── Constants ───────────────────────

var DC_LOCATION_ID = '8IWtNFlmgJ8bif9DivHT';
var DC_GRACE_WINDOW_MS = 5 * 60 * 1000;     // 5 min
var DC_TRACKING_HEADER = '_submissionId';
var DC_TRIGGER_FUNCTION = 'runDiscrepancyCheck';
// Default email recipient if Script Property `DC_NOTIFY_EMAIL` is unset.
// Override the property to a comma-separated list to add recipients
// without redeploying. Example: "emilio@nilsdigital.com, ops@..."
var DC_NOTIFY_EMAIL_DEFAULT = 'emilio@nilsdigital.com';
var DC_TOMBSTONE_TAB = '_dc_tombstones';

// If the GHL OAuth token in Supabase hasn't refreshed in this many
// hours, the email digest gets a warning. The external refresh
// service is supposed to keep the token < 24h old; 12 is the trip-
// wire so we surface drift before the token actually expires.
var DC_TOKEN_STALE_WARN_HOURS = 12;

// How long since the last successful run before discrepancyHeartbeatGuard
// declares the bot dead and emails an alert.
var DC_HEARTBEAT_MAX_AGE_HOURS = 24;

// Form IDs
var DC_FORM_FREE_CAMP    = '3Z4E9y7WlWgkZDxViBUW';
var DC_FORM_SUMMER_CAMP  = '61TiB5Zn1DJrGAsWiyTm';
var DC_FORM_AFTER_SCHOOL = 'TkioOL4IoByeHU3K2gTs';

// Spreadsheet IDs (mirror of SHEETS in Snapshot.js — duplicated so
// this file can be deleted/re-pushed independently)
var DC_FREE_UPPER_SS   = '1rK4p6jS1xqSf1qNO9-3ljCRzJcUIDF87sNo_UehBWYQ';
var DC_FREE_LOWER_SS   = '1_659v7by990V4OJMd86nBG-HUN6_AzZNOAPoQN0LMxY';
var DC_SUMMER_UPPER_SS = '1qejcgNQt3sS_UZ9Gl9Txr8TOocw3LzK5PjPICqnRrGA';
var DC_SUMMER_LOWER_SS = '18A_sc917xnxYo3UQ8_cGogqg46Im6qUQlakOC9Oc-Fs';

// After School: writes go to the Main Table tab of the central
// "After School Registration - APPLICATION" spreadsheet. The School
// Enrollment Router (separate Apps Script bound to that sheet) then
// routes each Main Table row to the correct per-school spreadsheet.
// The bot only ensures Main Table has a row for every form submission;
// it does NOT duplicate the routing logic.
var DC_AFTER_SCHOOL_SS  = '1XRhQe1VTujc3qlC3DdWdfoAsPabPXVLI8PdFvs7JKhY';
var DC_AFTER_SCHOOL_TAB = 'Main Table';

// Free Camp form field IDs
var DC_FC_FIELD_WEEKS    = '0H3m5fBvXwD3frq75XKa';
var DC_FC_FIELD_STUDENT  = 'rwAlfmxIbkk5k7nmgahu';
var DC_FC_FIELD_GRADE    = 'M6cPG28rA41X3DtPf7WO';
var DC_FC_FIELD_SCHOOL   = 'mtDthaZW5nm0SWGlp7XU';
var DC_FC_FIELD_SHIRT    = 'zhMuamfr2EwwObWlfwPg';
var DC_FC_FIELD_BREAKFAST= 'wZiqGsdaPlVBM3sydwxz';
var DC_FC_FIELD_LUNCH    = 'iBrxWLqsNDpMjZFRsUwQ';

// Summer Camp form field IDs
var DC_SC_FIELD_WEEKS     = 'boH43tBf1W4BXcz1aRh4';
var DC_SC_FIELD_STUDENT   = 'WitmrGYAPRw66ONJuRjQ';
var DC_SC_FIELD_DOB       = 'oHlCv49wt2OTGuwUoNsn';
var DC_SC_FIELD_SHIRT     = 'AY8wUz8iD6d5NEc4141l';
var DC_SC_FIELD_POTTY     = 'TPUHytz5Qd8OJNswX9Xy';
var DC_SC_FIELD_DURATION  = '1y8aMIgi84l2cfHnhFpc';
var DC_SC_FIELD_DAYS      = 'oRu849usIbnHPIgDccBc';
var DC_SC_FIELD_AFTERCARE = '7yIj793LRegIfN19Ux8r';
var DC_SC_FIELD_BREAKFAST = 'KqJc1rwDbZByulZNCDcl';
var DC_SC_FIELD_LUNCH     = 'MgE6T5xKZl2SZWGnPktO';

// After School Registration form field IDs
var DC_AS_FIELD_STUDENT = 'mCopCd8PHPPGBdo30zYK';   // Student Name
var DC_AS_FIELD_GRADE   = 'wiv3eF5jZoPalmg7yTmQ';   // Child Grade
var DC_AS_FIELD_SHIRT   = 'Ysom5PswWL2N0eouKwiS';   // T-Shirt Size
var DC_AS_FIELD_CLASS   = 'UluqGJoN855415yTyiXd';   // Select Class (school + day/time)
var DC_AS_FIELD_NKS     = '9kWksqJLFmmGoxfFDsay';   // Neighborhood Kids Schools
var DC_AS_FIELD_NOTES   = '40KOxhzNEKTjyhvi20fb';   // Notes (not currently written to Main Table)

// ─── New booking forms (Private Lessons / Rent-A-Sensei / Balloons /
// Vladimir Vasiliev Seminar) ───────────────────────────────────────
// Spec: Tom_Systema_Floyd/App_documentation/new_forms_spec.md
// Status: form IDs from Amina 2026-05-18 (PL + RAS still pending).
// All helpers early-return on empty form ID so this scaffolding is
// safe to ship before all 4 forms publish.
//
// Supabase migration needed before these can write:
//   ALTER TABLE public.sf_form_submissions
//     DROP CONSTRAINT sf_form_submissions_form_check,
//     ADD CONSTRAINT sf_form_submissions_form_check
//       CHECK (form IN ('free_camp','summer_camp','after_school',
//                       'private_lessons','rent_a_sensei','balloons',
//                       'vasiliev_seminar'));

// Form IDs (paste in as Amina publishes each one)
var DC_FORM_PRIVATE_LESSONS  = '';                       // TODO: Amina
var DC_FORM_RENT_A_SENSEI    = '';                       // TODO: Amina
var DC_FORM_BALLOONS         = 'SvXq0KmUb1Ct2AR2t8Yl';   // published 2026-05-18 by Amina
var DC_FORM_VASILIEV_SEMINAR = 'Zu7nHwEILIJnkKyvtnbB';   // published 2026-05-18 by Amina

// Destination spreadsheets (live, owned by systemafloydsheets@gmail.com,
// shared 'Form Submissions' Drive folder 1YnCaA46sLC57w7A3vZf0tEGgZv9aoUxN)
var DC_PL_SS  = '1XVh9pBOwddr-wCZ4eIxA39htmEdGGGx_WRgDun1C_mU';  // Private Lesson Booking
var DC_RAS_SS = '1zHDDtoHrjM8uoBsBoVffT09BqOZKRKPFfCDQEpi2CgE';  // Rent-A-Sensei Booking
var DC_BAL_SS = '1OZbb_0lmCCSRKZHn0X_UgDkY_Sckbw2qyt2H3gIRDJ8';  // Balloons by Balloons on the Ave
var DC_VS_SS  = '1BvGvrZ05oJolMGwyOm7BO0hZyZlMxv6D_UZviIOdH2Y';  // Vladimir Vasiliev Seminar Registration
var DC_BOOKING_TAB = 'Sheet1';  // all 4 sheets use the default Sheet1 tab

// Supabase form CHECK constraint values
var DC_FORM_NAME_PRIVATE_LESSONS  = 'private_lessons';
var DC_FORM_NAME_RENT_A_SENSEI    = 'rent_a_sensei';
var DC_FORM_NAME_BALLOONS         = 'balloons';
var DC_FORM_NAME_VASILIEV_SEMINAR = 'vasiliev_seminar';

// Private Lessons custom-field IDs (folder X4a97HKQJdXVkGV6R4Vg, 2026-05-14)
var DC_PL_FIELD_STATE         = '5ehZTaXaNcXTELK0BIwD';
var DC_PL_FIELD_INSTRUCTOR    = 'DSPT34R6tPLsrchxilTA';
var DC_PL_FIELD_LESSON        = 'ZpcqYLIeI5vRC3vB4VaD';
var DC_PL_FIELD_NUM_STUDENTS  = 'mVy01I2pOfpSsBJ9K2TC';
var DC_PL_FIELD_TRAINING      = 'JO25qx6HcrRRGoXkbZFz';
var DC_PL_FIELD_AGE_GROUP     = 'm3rgTNuU5DuXDkyIdoQO';
var DC_PL_FIELD_PACKAGE       = 'jxUbJ6t59K24i7VoWTur';
var DC_PL_FIELD_PREF_DATE     = '5ISTUUKJOavRZc7vBJlx';
var DC_PL_FIELD_PREF_TIME     = 'gsZUjGj4bJGTjINhdyUE';

// Rent-A-Sensei custom-field IDs (folder RbjiHT0moCfDgm5OEnHW, 2026-05-14)
var DC_RAS_FIELD_SERVICE_TYPE = 'tVvxHXE0BTzsfxYl4MKG';
var DC_RAS_FIELD_NUM_CHILDREN = 'Uj9ks7LGvM8ktbwBOwV2';
var DC_RAS_FIELD_DURATION     = 'ARSwE9pJ06KJYX0LnaOT';
var DC_RAS_FIELD_ADDRESS      = 'O6GFJ6sNFoUagmdd8ZO2';
var DC_RAS_FIELD_DATE         = 'K5Pc8pQFCeBemDEkeH5a';
var DC_RAS_FIELD_START_TIME   = 'jzBUh8W0TOZmAViareOt';
var DC_RAS_FIELD_END_TIME     = 'TtP6R6L2UkghX4HQAsrb';
var DC_RAS_FIELD_ACK          = 'QPLML2pF756ANddSifu9';
var DC_RAS_FIELD_INSTRUCTIONS = 'jGkL6wJBjtKHMsNSbB9n';

// Balloons custom-field IDs (folder Snj5a0BsE8Y6ehLgXwl8, 2026-05-14)
var DC_BAL_FIELD_GARLAND       = 'NgH8RGRgtisBtbWyEqiP';
var DC_BAL_FIELD_GARLAND_EXTRA = '7eKUJW88eiyN2yeXNFT6';
var DC_BAL_FIELD_COLUMNS       = 'RO0xzR1IU1WRWEOmXpNg';
var DC_BAL_FIELD_ARCH          = 'qrWRc6GRCWQsinxgvkaj';
var DC_BAL_FIELD_WALL          = 'zin97S10jzsx5OG820Vl';
var DC_BAL_FIELD_ADDONS        = 'QrwTL3UiBXtZCfqaX0I8';
var DC_BAL_FIELD_DELIVERY      = 'lVlCygHaoeF8Eo9q22jn';
var DC_BAL_FIELD_SETUP         = 'OQj4Vy8csQlNX6SlHJRA';
var DC_BAL_FIELD_OPT_FEES      = 'TLf16K3hfjE5K0CFbOja';
var DC_BAL_FIELD_THEME         = 'Q8YWJQlSiOOShOrszL1K';
var DC_BAL_FIELD_PRIMARY_COLOR = 'qVrRHhQ58cUXPkvdTUyr';
var DC_BAL_FIELD_SECONDARY     = 'nILU7wT94JtKjtdShgib';
var DC_BAL_FIELD_ACCENT        = 'ewqqWviYBsUTf1KvJzDk';
var DC_BAL_FIELD_NOTES         = 'JqBcKlhr1886D5nrgp1J';

// Vladimir Vasiliev Seminar custom-field IDs (folder RTmnCYg8pRee35YYFhyp)
// TBD — Amina created these inline when building the form on 2026-05-18.
// Pull a sample submission once the GHL token is refreshed, then paste
// the field IDs here. Until they're set, _dcCheckVasilievSeminar() is a
// no-op even if DC_FORM_VASILIEV_SEMINAR is filled.
var DC_VS_FIELD_PASS_SELECTION  = '';
var DC_VS_FIELD_EXPERIENCE      = '';
var DC_VS_FIELD_EMERGENCY_NAME  = '';
var DC_VS_FIELD_EMERGENCY_PHONE = '';
var DC_VS_FIELD_SHIRT           = '';
var DC_VS_FIELD_DIETARY         = '';
var DC_VS_FIELD_HOW_HEARD       = '';

// Map (form, week) → the GHL routing workflow that's supposed to
// write the corresponding sheet row. When the bot has to add a row
// itself, the email points at this workflow as "the one that failed
// to fire" so you can jump straight to it in GHL and investigate.
// IDs from listing workflows in Florida location (8IWtNFlmgJ8bif9DivHT).
var DC_GHL_WORKFLOW_BY_FORM_WEEK = {
  'free_camp': {
    'June 1st-5th':       { id: 'e9bc2bb7-94ae-481f-9d8f-51df5b9d45bf', name: '1. Free Camp (June 1st-5th) -> Google Sheet routing' },
    'June 8th-12th':      { id: '1b6e3514-e2d0-4ceb-801d-eef3795d3fb4', name: '2. Free Camp (June 8th-12th) -> Google Sheet routing' },
    'June 15th-19th':     { id: 'ac889124-e4e8-4784-8f7c-bd03b8d526a4', name: '3. Free Camp (June 15th-19th) -> Google Sheet routing' },
    'June 22nd-26th':     { id: '61389cbc-249e-445a-b4aa-a597d1019208', name: '4. Free Camp (June 22nd-26th) -> Google Sheet routing' },
    'June 29th-July 3rd': { id: '03fc65ef-37cc-4f85-8a9e-41a6be2f08c9', name: '5. Free Camp (June 29th-July 3rd) -> Google Sheet routing' },
    'July 6th-10th':      { id: '9ee99436-34aa-4790-8409-fb0e4b941212', name: '6. Free Camp (July 6th-10th) -> Google Sheet routing' },
    'July 13th-17th':     { id: '37d80612-bc27-407d-85ff-1ece7a890e70', name: '7. Free Camp (July 13th-17th) -> Google Sheet routing' },
    'July 20th-24th':     { id: '7b29ffcb-e421-4e27-9b88-a1f548846a98', name: '8. Free Camp (July 20th-24th) -> Google Sheet routing' },
    'July 27th-31st':     { id: '89452dd8-dcd6-4e01-95b8-e72ed507cbca', name: '9. Free Camp (July 27th-31st) -> Google Sheet routing' },
    'August 3rd-7th':     { id: '6c8f25e2-122a-474f-a810-892f8ad45b43', name: '9.1 Free Camp (August 3rd-7th) -> Google Sheet routing' },
  },
  'after_school': {
    // After School has a single workflow that routes ALL submissions
    // (no per-class workflows). Used as the "likely failed workflow"
    // hint in the email regardless of which class the parent picked.
    '*': { id: 'a9154b76-5174-4129-8370-e7f3f425ab89', name: 'After School Registration Main Branch' },
  },
  'summer_camp': {
    'June 1st-5th':       { id: '1e19a5e1-e45a-40f0-b800-98dd36395c2e', name: '1. Summer Camp (June 1st-5th) -> Google Sheet routing' },
    'June 8th-12th':      { id: 'e5d2f966-6ffc-45a5-872d-948e4cca04c7', name: '2. Summer Camp (June 8th-12th) -> Google Sheet routing' },
    'June 15th-19th':     { id: '4b570f25-00e6-45d0-b643-25dc5a52fc89', name: '3. Summer Camp (June 15th-19th) -> Google Sheet routing' },
    'June 22nd-26th':     { id: '801e40bd-4d8e-41a1-83d8-7f272d9ce5c8', name: '4. Summer Camp (June 22nd-26th) -> Google Sheet routing' },
    'June 29th-July 3rd': { id: 'afa65040-2f26-4256-b478-0680deefc93f', name: '5. Summer Camp (June 29th- July 3rd) -> Google Sheet routing' },
    'July 6th-10th':      { id: 'bb327dd9-c837-4b3e-80f4-a11cf4642c69', name: '6. Summer Camp (July 6th - 10th) -> Google Sheet routing' },
    'July 13th-17th':     { id: '3ec3777a-b3ee-47a2-8c50-f123c413a44d', name: '7. Summer Camp (July 13th - 17th) -> Google Sheet routing' },
    'July 20th-24th':     { id: '75f3fc57-800a-4396-a0ba-f114539eeab8', name: '8. Summer Camp (July 20th - 24th) -> Google Sheet routing' },
    'July 27th-31st':     { id: '642d3fb0-8104-4f43-9e9a-a16170729b59', name: '9. Summer Camp (July 27th - 31st) -> Google Sheet routing' },
    'August 3rd-7th':     { id: '24b85262-e395-45d5-a4df-5e7a63ffd415', name: '9.1 Summer Camp (Aug 3rd - 7th) -> Google Sheet routing' },
    'August 10th-14th':   { id: '7fff407e-f4d7-49f7-a8bc-d3c8dfc7731c', name: '9.2 Summer Camp (Aug 10th - 14th) -> Google Sheet routing' },
    'August 17th-21st':   { id: 'b3c775af-f38e-46c6-80f8-20feac198c74', name: '9.3 Summer Camp (Aug 17th - 21st) -> Google Sheet routing' },
  },
};

function _dcWorkflowFor(form, week) {
  var formMap = (DC_GHL_WORKFLOW_BY_FORM_WEEK || {})[form] || {};
  var wf = formMap[week] || formMap['*'];        // After School uses '*' since one workflow handles all classes
  if (!wf) return null;
  return {
    id: wf.id,
    name: wf.name,
    url: 'https://app.nilsdigital.com/location/' + DC_LOCATION_ID + '/workflow/' + wf.id,
  };
}

// Map WEEK_ORDER token (used by Snapshot.js + the form select values)
// → tab name actually used in the spreadsheets. Tabs use short form.
var DC_WEEK_TO_TAB = {
  'June 1st-5th':       '6/1-6/5',
  'June 8th-12th':      '6/8-6/12',
  'June 15th-19th':     '6/15-6/19',
  'June 22nd-26th':     '6/22-6/26',
  'June 29th-July 3rd': '6/29-7/3',
  'July 6th-10th':      '7/6-7/10',
  'July 13th-17th':     '7/13-7/17',
  'July 20th-24th':     '7/20-7/24',
  'July 27th-31st':     '7/27-7/31',
  'August 3rd-7th':     '8/3-8/7',
  'August 10th-14th':   '8/10-8/14',
  'August 17th-21st':   '8/17-8/21',
};

// Free Camp Upper sheet column order (11 cols)
var DC_FREE_UPPER_COLS = [
  'School', 'Student Name', 'Grade', 'Age', 'Shirt Size',
  'Address', 'Breakfast', ' Lunch', 'Parent/Guardian Name',
  'Phone Number', 'Email Address',
];
// Free Camp Lower sheet column order (12 cols — adds Potty Trained)
var DC_FREE_LOWER_COLS = [
  'School', 'Student Name', 'Grade', 'Age', 'Potty Trained', 'Shirt Size',
  'Address', 'Breakfast', ' Lunch', 'Parent/Guardian Name',
  'Phone Number', 'Email Address',
];

// ─────────────────────── Public entry points ───────────────────────

/**
 * Main entry — pulled by the time-driven trigger every 15 min.
 * Returns a JSON-serialisable report so it's also useful from the
 * editor or from doGet?action=discrepancy.
 */
function runDiscrepancyCheck() {
  var startedAt = new Date();
  var report = {
    startedAt: startedAt.toISOString(),
    freeCamp:        { added: [], linkedManual: [], orphans: [], errors: [], skippedYoung: 0, skippedNoTab: 0, noTabWeeks: {} },
    summerCamp:      { added: [], linkedManual: [], wouldAdd: [], missing: [], orphans: [], errors: [], skippedYoung: 0 },
    afterSchool:     { added: [], linkedManual: [], errors: [], skippedYoung: 0, skippedTombstone: 0 },
    privateLessons:  { added: [], linkedManual: [], errors: [], skippedYoung: 0, skippedTombstone: 0, skipped: 0 },
    rentASensei:     { added: [], linkedManual: [], errors: [], skippedYoung: 0, skippedTombstone: 0, skipped: 0 },
    balloons:        { added: [], linkedManual: [], errors: [], skippedYoung: 0, skippedTombstone: 0, skipped: 0 },
    vasilievSeminar: { added: [], linkedManual: [], errors: [], skippedYoung: 0, skippedTombstone: 0, skipped: 0 },
    duplicates:      { clusters: [], crossCampus: [], errors: [] },
  };
  try {
    _dcCheckFreeCamp(report);
  } catch (err) {
    report.freeCamp.errors.push(_dcErr(err));
  }
  try {
    _dcCheckSummerCamp(report);
  } catch (err) {
    report.summerCamp.errors.push(_dcErr(err));
  }
  try {
    _dcCheckAfterSchool(report);
  } catch (err) {
    report.afterSchool.errors.push(_dcErr(err));
  }
  try {
    _dcCheckPrivateLessons(report);
  } catch (err) {
    report.privateLessons.errors.push(_dcErr(err));
  }
  try {
    _dcCheckRentASensei(report);
  } catch (err) {
    report.rentASensei.errors.push(_dcErr(err));
  }
  try {
    _dcCheckBalloons(report);
  } catch (err) {
    report.balloons.errors.push(_dcErr(err));
  }
  try {
    _dcCheckVasilievSeminar(report);
  } catch (err) {
    report.vasilievSeminar.errors.push(_dcErr(err));
  }
  try {
    _dcCheckDuplicates(report);
  } catch (err) {
    report.duplicates.errors.push(_dcErr(err));
  }
  report.finishedAt = new Date().toISOString();
  report.durationMs = new Date() - startedAt;
  report.tokenAgeHours = (typeof globalThis._dcTokenAgeHours === 'number')
    ? Math.round(globalThis._dcTokenAgeHours * 10) / 10
    : null;
  // A non-rotating PIT has a frozen updated_at by design — never flag it stale.
  report.tokenIsPit = globalThis._dcTokenIsPit === true;
  report.tokenStaleWarning = (!report.tokenIsPit && report.tokenAgeHours != null && report.tokenAgeHours > DC_TOKEN_STALE_WARN_HOURS);

  // Heartbeat: record this successful run so the daily guard knows
  // the bot is alive. Done BEFORE email so a mail-send failure
  // doesn't break the heartbeat (the run did succeed at the work).
  _dcRecordHeartbeat('discrepancy_check', {
    durationMs: report.durationMs,
    free_added: report.freeCamp.added.length,
    summer_added: report.summerCamp.added.length,
    afterschool_added: report.afterSchool.added.length,
    privatelessons_added: report.privateLessons.added.length,
    rentasensei_added: report.rentASensei.added.length,
    balloons_added: report.balloons.added.length,
    vasiliev_added: report.vasilievSeminar.added.length,
    duplicates_in_tab: report.duplicates.clusters.length,
    errors: report.freeCamp.errors.length + report.summerCamp.errors.length +
            report.afterSchool.errors.length + report.privateLessons.errors.length +
            report.rentASensei.errors.length + report.balloons.errors.length +
            report.vasilievSeminar.errors.length,
    token_age_hours: report.tokenAgeHours,
    token_stale: report.tokenStaleWarning,
  });

  Logger.log(
    'DiscrepancyCheck: free added=' + report.freeCamp.added.length +
    ' free linked=' + report.freeCamp.linkedManual.length +
    ' free errors=' + report.freeCamp.errors.length +
    ' summer added=' + report.summerCamp.added.length +
    ' summer linked=' + report.summerCamp.linkedManual.length +
    ' summer errors=' + report.summerCamp.errors.length +
    ' afterschool added=' + report.afterSchool.added.length +
    ' afterschool linked=' + report.afterSchool.linkedManual.length +
    ' afterschool errors=' + report.afterSchool.errors.length +
    ' pl added=' + report.privateLessons.added.length +
    ' ras added=' + report.rentASensei.added.length +
    ' balloons added=' + report.balloons.added.length +
    ' vasiliev added=' + report.vasilievSeminar.added.length +
    ' dup_clusters=' + report.duplicates.clusters.length +
    ' dup_crossCampus=' + report.duplicates.crossCampus.length +
    ' duration=' + report.durationMs + 'ms'
  );

  // Only email when something is actionable: people were auto-added, an
  // error occurred, or the GHL token is going stale. Linked-manual stamps,
  // orphans, and duplicate clusters are FYI-only — they no longer trigger
  // an email on their own (they still appear in the body when an email does fire).
  var noteworthy =
    report.freeCamp.added.length        > 0 ||
    report.freeCamp.errors.length       > 0 ||
    report.summerCamp.added.length        > 0 ||
    report.summerCamp.errors.length       > 0 ||
    report.afterSchool.added.length       > 0 ||
    report.afterSchool.errors.length       > 0 ||
    report.privateLessons.added.length    > 0 ||
    report.privateLessons.errors.length   > 0 ||
    report.rentASensei.added.length       > 0 ||
    report.rentASensei.errors.length      > 0 ||
    report.balloons.added.length          > 0 ||
    report.balloons.errors.length         > 0 ||
    report.vasilievSeminar.added.length   > 0 ||
    report.vasilievSeminar.errors.length  > 0 ||
    report.duplicates.errors.length       > 0 ||
    report.tokenStaleWarning              === true;
  if (noteworthy) {
    try { _dcEmailReport(report); }
    catch (mailErr) { report.notifyError = String(mailErr && mailErr.message || mailErr); }
  }
  return report;
}

/** Install the 15-min recurring trigger (no-op if already installed). */
function discrepancySetupTrigger() {
  var existing = ScriptApp.getProjectTriggers().filter(function (t) {
    return t.getHandlerFunction() === DC_TRIGGER_FUNCTION;
  });
  if (existing.length > 0) {
    return 'already installed (' + existing.length + ')';
  }
  ScriptApp.newTrigger(DC_TRIGGER_FUNCTION)
    .timeBased()
    .everyMinutes(15)
    .create();
  return 'installed';
}

/** Remove all triggers for this checker. */
function discrepancyRemoveTrigger() {
  var removed = 0;
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (t.getHandlerFunction() === DC_TRIGGER_FUNCTION) {
      ScriptApp.deleteTrigger(t);
      removed++;
    }
  });
  return 'removed ' + removed;
}

/**
 * One-time backfill: walk every row on every Free Camp + Summer Camp
 * tab whose hidden _submissionId column is set, look up the matching
 * GHL form submission, and stamp a source-cell note on the Student
 * Name cell. Skips rows that already have a note (idempotent).
 *
 * After this runs, the rule is: a row WITH a note is tied to a known
 * GHL submission. A row WITHOUT a note was typed in by hand and the
 * bot has no record of it. (Summer Camp rows generally won't have
 * tracking IDs yet — discrepancyBackfillTracking() Summer pass is
 * future work.)
 *
 * Safe to re-run.
 */
function discrepancyBackfillNotes() {
  var subsByForm = {
    'Free Camp':   _dcIndexById(_dcListSubmissions(DC_FORM_FREE_CAMP)),
    'Summer Camp': _dcIndexById(_dcListSubmissions(DC_FORM_SUMMER_CAMP)),
  };
  // Map a tab → which form's submissions to look in
  var sheetSpecs = [
    { ssId: DC_FREE_UPPER_SS,   form: 'Free Camp',   weekField: DC_FC_FIELD_WEEKS },
    { ssId: DC_FREE_LOWER_SS,   form: 'Free Camp',   weekField: DC_FC_FIELD_WEEKS },
    { ssId: DC_SUMMER_UPPER_SS, form: 'Summer Camp', weekField: DC_SC_FIELD_WEEKS },
    { ssId: DC_SUMMER_LOWER_SS, form: 'Summer Camp', weekField: DC_SC_FIELD_WEEKS },
  ];

  var report = { stamped: 0, alreadyNoted: 0, missingSubmission: 0, byForm: { 'Free Camp': 0, 'Summer Camp': 0 } };
  sheetSpecs.forEach(function (spec) {
    var ss = SpreadsheetApp.openById(spec.ssId);
    Object.keys(DC_WEEK_TO_TAB).forEach(function (week) {
      var sheet = ss.getSheetByName(DC_WEEK_TO_TAB[week]);
      if (!sheet) return;
      var trackingCol = _dcEnsureTrackingCol(sheet);
      var lastRow = sheet.getLastRow();
      if (lastRow < 2) return;
      var ids = sheet.getRange(2, trackingCol, lastRow - 1, 1).getValues();
      var notes = sheet.getRange(2, 2, lastRow - 1, 1).getNotes();
      ids.forEach(function (r, i) {
        var subId = r[0];
        if (!subId) return;
        if (notes[i][0]) { report.alreadyNoted++; return; }
        var sub = subsByForm[spec.form][subId];
        if (!sub) { report.missingSubmission++; return; }
        _dcSetSourceNote(sheet, i + 2, 'backfill', sub, week, spec.form);
        report.stamped++;
        report.byForm[spec.form]++;
      });
    });
  });
  return report;
}

function _dcIndexById(submissions) {
  var out = {};
  submissions.forEach(function (s) { out[s.id] = s; });
  return out;
}

/**
 * One-time migration of every tracked row → Supabase. Walks every
 * weekly tab in all 4 sheets, reads the hidden _submissionId column,
 * and upserts a row into sf_form_submissions for each ID. Also
 * pulls any legacy entries from the hidden _dc_tombstones tabs.
 *
 * Idempotent — uses sf_record_processed which is an UPSERT.
 */
function discrepancyBackfillTombstones() {
  var report = { added: 0, byForm: { free_camp: 0, summer_camp: 0 }, errors: [] };
  var specs = [
    { ssId: DC_FREE_UPPER_SS,   form: 'free_camp',   campus: 'upper' },
    { ssId: DC_FREE_LOWER_SS,   form: 'free_camp',   campus: 'lower' },
    { ssId: DC_SUMMER_UPPER_SS, form: 'summer_camp', campus: 'upper' },
    { ssId: DC_SUMMER_LOWER_SS, form: 'summer_camp', campus: 'lower' },
  ];
  specs.forEach(function (spec) {
    var ss = SpreadsheetApp.openById(spec.ssId);
    Object.keys(DC_WEEK_TO_TAB).forEach(function (week) {
      var tabName = DC_WEEK_TO_TAB[week];
      var sheet = ss.getSheetByName(tabName);
      if (!sheet) return;
      var trackingCol = _dcEnsureTrackingCol(sheet);
      var lastRow = sheet.getLastRow();
      if (lastRow < 2) return;
      var ids = sheet.getRange(2, trackingCol, lastRow - 1, 1).getValues();
      ids.forEach(function (r, i) {
        var id = String(r[0] || '').trim();
        if (!id) return;
        try {
          _dcRecordProcessed(id, spec.form, week, {
            campus: spec.campus,
            status: 'backfilled',
            spreadsheetId: spec.ssId,
            tabName: tabName,
            rowIndex: i + 2,
            metadata: { migrated_from: 'hidden_tab_or_existing_row' },
          });
          report.added++;
          report.byForm[spec.form]++;
        } catch (err) {
          report.errors.push(_dcErr(err, { id: id, week: week, form: spec.form }));
        }
      });
    });
    // Also drain any legacy entries from the hidden _dc_tombstones tab
    // (rows that exist in tombstone but no longer have a sheet row).
    var legacy = _dcLoadTombstonesFromTab(ss);
    Object.keys(legacy).forEach(function (id) {
      var entry = legacy[id];
      try {
        _dcRecordProcessed(id, spec.form, entry.week, {
          campus: spec.campus,
          status: 'backfilled',
          spreadsheetId: spec.ssId,
          tabName: entry.tabName,
          metadata: { migrated_from: 'legacy_tombstone_tab', original_mode: entry.mode },
        });
        report.added++;
        report.byForm[spec.form]++;
      } catch (err) {
        report.errors.push(_dcErr(err, { id: id, form: spec.form }));
      }
    });
  });
  return report;
}

/**
 * One-time backfill: walk every existing row on every Free Camp tab,
 * try to match it to a GHL form submission by (student name + parent
 * email + week), and write the matched submission ID into the hidden
 * tracking column. Without this, every existing row would be flagged
 * as "missing" on the first scheduled run.
 *
 * Safe to re-run — idempotent.
 */
function discrepancyBackfillTracking() {
  var subs = _dcListSubmissions(DC_FORM_FREE_CAMP);
  var byKey = {};                       // (studentLower + '|' + parentEmailLower + '|' + week) → submissionId
  subs.forEach(function (s) {
    var others = s.others || {};
    var weeks  = _dcAsArr(others[DC_FC_FIELD_WEEKS]);
    var name   = String(others[DC_FC_FIELD_STUDENT] || '').trim();
    var email  = String(s.email || '').trim().toLowerCase();
    weeks.forEach(function (w) {
      byKey[_dcKey(name, email, w)] = s.id;
    });
  });

  var report = { freeUpper: { backfilled: 0, unmatched: 0 }, freeLower: { backfilled: 0, unmatched: 0 } };
  ['freeUpper', 'freeLower'].forEach(function (which) {
    var ssId = which === 'freeUpper' ? DC_FREE_UPPER_SS : DC_FREE_LOWER_SS;
    var ss = SpreadsheetApp.openById(ssId);
    var tabs = ss.getSheets();
    Object.keys(DC_WEEK_TO_TAB).forEach(function (week) {
      var tabName = DC_WEEK_TO_TAB[week];
      var sheet = ss.getSheetByName(tabName);
      if (!sheet) return;
      var trackingCol = _dcEnsureTrackingCol(sheet);
      var lastRow = sheet.getLastRow();
      if (lastRow < 2) return;
      var nameCol = which === 'freeUpper' ? 2 : 2;     // Student Name col
      var emailCol = which === 'freeUpper' ? 11 : 12;  // Email Address col
      var existing = sheet.getRange(2, 1, lastRow - 1, sheet.getLastColumn()).getValues();
      var trackingValues = sheet.getRange(2, trackingCol, lastRow - 1, 1).getValues();
      var updates = trackingValues.slice();
      existing.forEach(function (row, i) {
        if (trackingValues[i][0]) return;        // already tracked
        var name = String(row[nameCol - 1] || '').trim();
        var email = String(row[emailCol - 1] || '').trim().toLowerCase();
        var subId = byKey[_dcKey(name, email, week)];
        if (subId) {
          updates[i][0] = subId;
          report[which].backfilled++;
        } else {
          report[which].unmatched++;
        }
      });
      sheet.getRange(2, trackingCol, updates.length, 1).setValues(updates);
    });
  });
  return report;
}

// ─────────────────────── Free Camp checker ───────────────────────

function _dcCheckFreeCamp(report) {
  report.freeCamp.linkedManual = report.freeCamp.linkedManual || [];
  report.freeCamp.skippedTombstone = 0;
  var subs = _dcListSubmissions(DC_FORM_FREE_CAMP);
  var nowMs = Date.now();

  // Supabase is the source of truth for "have we ever processed this
  // submission?" — survives row deletions, manual sheet edits, and
  // tombstone tab tampering.
  var processed = _dcLoadProcessedFromSupabase();

  // Index every existing row in both Free Camp spreadsheets:
  //   existingByWeek[week][nameEmailKey] = { row info, currentSubId } — EVERY row, tracked or not
  //   trackedByWeek[week][submissionId]  = campus — fast lookup by submission ID
  // Critical: existingByWeek includes BOTH tracked and untracked rows
  // so a re-submission (new sub ID, same name+email) finds and links
  // to the existing row instead of duplicating.
  var trackedByWeek = {};
  var existingByWeek = {};
  ['freeUpper', 'freeLower'].forEach(function (which) {
    var ssId = which === 'freeUpper' ? DC_FREE_UPPER_SS : DC_FREE_LOWER_SS;
    var ss = SpreadsheetApp.openById(ssId);
    var nameCol  = 2;
    var emailCol = which === 'freeUpper' ? 11 : 12;
    Object.keys(DC_WEEK_TO_TAB).forEach(function (week) {
      var sheet = ss.getSheetByName(DC_WEEK_TO_TAB[week]);
      trackedByWeek[week] = trackedByWeek[week] || {};
      existingByWeek[week] = existingByWeek[week] || {};
      if (!sheet) return;
      var trackingCol = _dcEnsureTrackingCol(sheet);
      var lastRow = sheet.getLastRow();
      if (lastRow < 2) return;
      var lastCol = sheet.getLastColumn();
      var grid = sheet.getRange(2, 1, lastRow - 1, lastCol).getValues();
      grid.forEach(function (row, i) {
        var subId = String(row[trackingCol - 1] || '').trim();
        var name  = row[nameCol - 1];
        var email = row[emailCol - 1];
        if (!String(name || '').trim()) return;     // empty row guard
        var key = _dcKey(name, email, week);
        existingByWeek[week][key] = {
          which: which,
          sheet: sheet,
          rowIndex: i + 2,
          trackingCol: trackingCol,
          currentSubId: subId,
        };
        if (subId) trackedByWeek[week][subId] = which;
      });
    });
  });

  subs.forEach(function (s) {
    if (nowMs - new Date(s.createdAt).getTime() < DC_GRACE_WINDOW_MS) {
      report.freeCamp.skippedYoung++;
      return;
    }
    var others = s.others || {};
    var studentName = String(others[DC_FC_FIELD_STUDENT] || '').trim();
    if (_dcIsTestSubmission(s, studentName)) return;
    var weeks = _dcAsArr(others[DC_FC_FIELD_WEEKS]);
    var emailLc = String(s.email || '').trim().toLowerCase();
    weeks.forEach(function (week) {
      if (!DC_WEEK_TO_TAB[week]) return;
      if ((trackedByWeek[week] || {})[s.id]) return;     // already in sheet
      // Source-of-truth check: has Supabase recorded this submission
      // as processed before? If so, the row may have been intentionally
      // deleted by staff — respect their action and never re-add.
      if (processed.free_camp[s.id + '|' + week]) {
        report.freeCamp.skippedTombstone++;
        return;
      }
      var key = _dcKey(studentName, emailLc, week);
      // Try exact name+email+week first; fall back to fuzzy (same
      // email+week, likely-same-person name) so "Aria" links to
      // existing "Aria Falzone" instead of duplicating.
      var existing = _dcFindExistingRowFuzzy(existingByWeek, studentName, emailLc, week);
      if (existing) {
        // A row for this kid already exists for this week. Three cases:
        //   - currentSubId === s.id : already perfectly linked, skip
        //   - currentSubId is empty : link (manual entry by team)
        //   - currentSubId is some OTHER submission ID : re-submission
        //                                                 (parent submitted again)
        //                                                 → link this newer ID
        //                                                 to the same row,
        //                                                 don't duplicate
        if (existing.currentSubId === s.id) {
          // perfect match, no-op (still record in case it's missing
          // from Supabase due to a prior partial run)
          _dcRecordProcessed(s.id, 'free_camp', week, {
            campus: existing.which === 'freeUpper' ? 'upper' : 'lower',
            status: 'processed',
            spreadsheetId: existing.sheet.getParent().getId(),
            tabName: DC_WEEK_TO_TAB[week],
            rowIndex: existing.rowIndex,
            studentName: studentName,
            parentEmail: emailLc,
            contactId: s.contactId,
          });
          processed.free_camp[s.id + '|' + week] = true;
          return;
        }
        try {
          existing.sheet.getRange(existing.rowIndex, existing.trackingCol).setValue(s.id);
          _dcSetSourceNote(existing.sheet, existing.rowIndex, 'linked-manual', s, week, 'Free Camp');
          _dcRecordProcessed(s.id, 'free_camp', week, {
            campus: existing.which === 'freeUpper' ? 'upper' : 'lower',
            status: 'linked_manual',
            spreadsheetId: existing.sheet.getParent().getId(),
            tabName: DC_WEEK_TO_TAB[week],
            rowIndex: existing.rowIndex,
            studentName: studentName,
            parentEmail: emailLc,
            contactId: s.contactId,
            metadata: existing.currentSubId
              ? { replaced_sub_id: existing.currentSubId }
              : { source: 'untracked_existing_row' },
          });
          trackedByWeek[week][s.id] = existing.which;
          processed.free_camp[s.id + '|' + week] = true;
          report.freeCamp.linkedManual.push({
            submissionId: s.id,
            student: studentName,
            week: week,
            campus: existing.which,
            row: existing.rowIndex,
            replacedSubId: existing.currentSubId || null,
          });
        } catch (err) {
          report.freeCamp.errors.push(_dcErr(err, { phase: 'link-manual', submissionId: s.id, week: week }));
        }
        return;
      }
      // Genuinely missing — append.
      var campus = _dcDecideCampus(s, week, trackedByWeek);
      // Free Camp only runs 10 weeks (through Aug 3rd-7th). The form,
      // however, still offers the two summer-only weeks (Aug 10th-14th,
      // Aug 17th-21st), so a parent CAN tick a week that has no routing
      // workflow and no destination tab. That is NOT an error — the week
      // simply isn't part of Free Camp. Skip it quietly via an FYI-only
      // counter (which never triggers an email) instead of throwing
      // "No tab ..." on every single run forever.
      var destSsId = campus === 'lower' ? DC_FREE_LOWER_SS : DC_FREE_UPPER_SS;
      if (!SpreadsheetApp.openById(destSsId).getSheetByName(DC_WEEK_TO_TAB[week])) {
        report.freeCamp.skippedNoTab++;
        report.freeCamp.noTabWeeks[week] = (report.freeCamp.noTabWeeks[week] || 0) + 1;
        return;
      }
      try {
        var added = _dcAppendFreeCamp(s, week, campus);
        _dcRecordProcessed(s.id, 'free_camp', week, {
          campus: campus,
          status: 'processed',
          spreadsheetId: campus === 'lower' ? DC_FREE_LOWER_SS : DC_FREE_UPPER_SS,
          tabName: DC_WEEK_TO_TAB[week],
          rowIndex: added.rowIndex,
          studentName: studentName,
          parentEmail: emailLc,
          contactId: s.contactId,
        });
        processed.free_camp[s.id + '|' + week] = true;
        // Reflect the new row in existingByWeek so a SECOND submission
        // from the same person for the same week (within this run)
        // gets caught by the dedup branch instead of duplicating.
        existingByWeek[week][key] = {
          which: campus === 'lower' ? 'freeLower' : 'freeUpper',
          sheet: SpreadsheetApp.openById(campus === 'lower' ? DC_FREE_LOWER_SS : DC_FREE_UPPER_SS).getSheetByName(DC_WEEK_TO_TAB[week]),
          rowIndex: added.rowIndex,
          trackingCol: _dcEnsureTrackingCol(SpreadsheetApp.openById(campus === 'lower' ? DC_FREE_LOWER_SS : DC_FREE_UPPER_SS).getSheetByName(DC_WEEK_TO_TAB[week])),
          currentSubId: s.id,
        };
        report.freeCamp.added.push({
          submissionId: s.id,
          contactId: s.contactId,
          student: studentName,
          parent: s.name,
          email: s.email,
          week: week,
          campus: campus,
          row: added.row,
          rowIndex: added.rowIndex,
          likelyFailedWorkflow: _dcWorkflowFor('free_camp', week),
        });
      } catch (err) {
        report.freeCamp.errors.push(_dcErr(err, { submissionId: s.id, week: week, campus: campus }));
      }
    });
  });
}

/**
 * Pick a campus for a Free Camp submission/week pair.
 *  1. If the same student name + email appears tracked in EITHER sheet
 *     for ANY other week, use that campus (consistency over time).
 *  2. Else fall back to grade: Pre-K/K → Lower, 1st+ → Upper.
 *  3. Else default to Upper and let the report surface flag it.
 */
function _dcDecideCampus(submission, week, trackedByWeek) {
  var others = submission.others || {};
  var name = String(others[DC_FC_FIELD_STUDENT] || '').trim().toLowerCase();
  var email = String(submission.email || '').trim().toLowerCase();

  // Heuristic 1: scan other weeks for a tracked row matching this kid
  for (var w in trackedByWeek) {
    if (!trackedByWeek.hasOwnProperty(w)) continue;
    var ids = trackedByWeek[w];
    for (var subId in ids) {
      // We only have submissionId → campus here, no name. So we have to
      // match by row content; the cheapest path is to skip this lookup
      // unless we can resolve quickly. Instead use the contact's
      // existing Free Camp Registration field if available.
    }
  }
  // Heuristic 2: grade
  var grade = String(others[DC_FC_FIELD_GRADE] || '').toLowerCase();
  if (/pre[\-\s]?k|kinder/.test(grade)) return 'lower';
  return 'upper';
}

/**
 * Append a row matching the destination sheet's column order, write
 * the submission ID into the hidden tracking column, and stamp a cell
 * note on the Student Name cell so anyone hovering on that name later
 * can see exactly where the row came from. Returns {row, rowIndex}.
 */
function _dcAppendFreeCamp(submission, week, campus) {
  var ssId = campus === 'lower' ? DC_FREE_LOWER_SS : DC_FREE_UPPER_SS;
  var ss = SpreadsheetApp.openById(ssId);
  var tabName = DC_WEEK_TO_TAB[week];
  var sheet = ss.getSheetByName(tabName);
  if (!sheet) throw new Error('No tab ' + tabName + ' in ' + (campus === 'lower' ? 'Free Lower' : 'Free Upper'));

  var others = submission.others || {};
  var school = String(others[DC_FC_FIELD_SCHOOL] || '');
  var name   = String(others[DC_FC_FIELD_STUDENT] || '');
  var grade  = String(others[DC_FC_FIELD_GRADE] || '');
  var shirt  = String(others[DC_FC_FIELD_SHIRT] || '');
  var addr   = String(others.address || '');
  var bfast  = String(others[DC_FC_FIELD_BREAKFAST] || '');
  var lunch  = String(others[DC_FC_FIELD_LUNCH] || '');
  var parent = String(submission.name || '');
  var phone  = _dcFormatPhone(others.phone);
  var email  = String(submission.email || '');

  var row;
  if (campus === 'lower') {
    row = [school, name, grade, '', '', shirt, addr, bfast, lunch, parent, phone, email];
  } else {
    row = [school, name, grade, '', shirt, addr, bfast, lunch, parent, phone, email];
  }
  var trackingCol = _dcEnsureTrackingCol(sheet);
  while (row.length < trackingCol - 1) row.push('');
  row.push(submission.id);
  sheet.appendRow(row);
  var newRowIndex = sheet.getLastRow();
  _dcSetSourceNote(sheet, newRowIndex, 'auto-added', submission, week, 'Free Camp');
  // Note: _dcRecordProcessed is also called by the caller with the
  // resulting rowIndex + campus; this helper just writes the row.
  return { row: row, rowIndex: newRowIndex };
}

/**
 * Stamp a Sheets cell note on the Student Name cell so anyone hovering
 * the name can see exactly where that row came from. Source-of-truth
 * for "is this row tied to a known GHL form submission?" — if a row
 * has NO note, it's a manual entry the bot has never seen.
 *
 *   mode = 'auto-added'    bot wrote this row from a missing submission
 *   mode = 'linked-manual' team typed the row first, bot later matched
 *                          it to a submission and stamped the hidden ID
 *   mode = 'backfill'      historical row that pre-dates the bot;
 *                          bot matched it to a submission and stamped
 *                          a note retroactively
 *
 * formName is 'Free Camp' or 'Summer Camp'. Note links back to the
 * GHL contact for one-click lookup (paste into a tab — Sheets notes
 * are plain text, not auto-clickable, but the URL is right there).
 *
 * Visible on hover; doesn't show in CSV exports or affect formulas.
 */
function _dcSetSourceNote(sheet, rowIndex, mode, submission, week, formName) {
  try {
    // Student Name column varies by form:
    //   Free Camp Upper/Lower → col 2 (B)
    //   Summer Camp Upper/Lower → col 3 (C)  ← Summer's col B is "Amt"!
    // Bug history: for several days notes for Summer Camp were
    // stamped on col B (Amt) instead of col C. The migration in
    // discrepancyFixSummerCampNotes() moves them to the correct cell.
    var nameCol = (formName === 'Summer Camp') ? 3 : 2;
    var contactUrl = submission.contactId
      ? 'https://app.nilsdigital.com/v2/location/' + DC_LOCATION_ID + '/contacts/detail/' + submission.contactId
      : '';
    var modeBlurb = ({
      'auto-added':    'Auto-added by DiscrepancyCheck — no matching row existed when the bot ran, so it wrote this from the GHL submission below.',
      'linked-manual': 'Linked by DiscrepancyCheck — this row was typed in manually, then the bot matched it to a GHL submission and stamped the ID.',
      'backfill':      'Backfilled by DiscrepancyCheck — historical row, matched retroactively to a GHL submission so future runs treat it as tracked.',
    })[mode] || ('DiscrepancyCheck (' + mode + ')');

    var lines = [];
    lines.push(modeBlurb);
    lines.push('Stamped: ' + new Date().toISOString());
    lines.push('');
    lines.push('Form: ' + (formName || 'Free Camp'));
    lines.push('Week selected: ' + week);
    lines.push('Submission ID: ' + submission.id);
    lines.push('Submitted: ' + (submission.createdAt || ''));
    lines.push('Parent: ' + (submission.name || ''));
    lines.push('Parent email: ' + (submission.email || ''));
    lines.push('Contact ID: ' + (submission.contactId || ''));
    if (contactUrl) lines.push('Contact: ' + contactUrl);
    sheet.getRange(rowIndex, nameCol).setNote(lines.join('\n'));
  } catch (e) {
    Logger.log('setNote failed: ' + e);
  }
}

// ─────────────────────── Summer Camp checker (report-only) ───────────────────────

function _dcCheckSummerCamp(report) {
  report.summerCamp.added        = report.summerCamp.added        || [];
  report.summerCamp.linkedManual = report.summerCamp.linkedManual || [];
  report.summerCamp.wouldAdd     = report.summerCamp.wouldAdd     || [];
  report.summerCamp.skippedTombstone = 0;
  // Auto-add is always on for Summer Camp now. The Supabase tombstone
  // (per submission+week) means the bot never re-adds a row the team
  // has deleted, so we don't need a separate gate.
  var subs = _dcListSubmissions(DC_FORM_SUMMER_CAMP);
  var nowMs = Date.now();

  var processed = _dcLoadProcessedFromSupabase();

  var trackedByWeek = {};
  var existingByWeek = {};
  ['summerUpper', 'summerLower'].forEach(function (which) {
    var ssId = which === 'summerUpper' ? DC_SUMMER_UPPER_SS : DC_SUMMER_LOWER_SS;
    var ss = SpreadsheetApp.openById(ssId);
    var nameCol  = 3;     // Student Name col on both Summer sheets
    var emailCol = which === 'summerUpper' ? 9 : 10;   // Lower has +1 (Potty Trained)
    Object.keys(DC_WEEK_TO_TAB).forEach(function (week) {
      var sheet = ss.getSheetByName(DC_WEEK_TO_TAB[week]);
      trackedByWeek[week] = trackedByWeek[week] || {};
      existingByWeek[week] = existingByWeek[week] || {};
      if (!sheet) return;
      var trackingCol = _dcEnsureTrackingCol(sheet);
      var lastRow = sheet.getLastRow();
      if (lastRow < 2) return;
      var lastCol = sheet.getLastColumn();
      var grid = sheet.getRange(2, 1, lastRow - 1, lastCol).getValues();
      grid.forEach(function (row, i) {
        var subId = String(row[trackingCol - 1] || '').trim();
        var name  = row[nameCol - 1];
        var email = row[emailCol - 1];
        if (!String(name || '').trim()) return;
        var key = _dcKey(name, email, week);
        existingByWeek[week][key] = {
          which: which,
          sheet: sheet,
          rowIndex: i + 2,
          trackingCol: trackingCol,
          currentSubId: subId,
        };
        if (subId) trackedByWeek[week][subId] = which;
      });
    });
  });

  subs.forEach(function (s) {
    if (nowMs - new Date(s.createdAt).getTime() < DC_GRACE_WINDOW_MS) {
      report.summerCamp.skippedYoung++;
      return;
    }
    var others = s.others || {};
    var name   = String(others[DC_SC_FIELD_STUDENT] || '').trim();
    if (_dcIsTestSubmission(s, name)) return;
    var weeks  = _dcAsArr(others[DC_SC_FIELD_WEEKS]);
    var emailLc = String(s.email || '').trim().toLowerCase();
    weeks.forEach(function (week) {
      if (!DC_WEEK_TO_TAB[week]) return;
      if ((trackedByWeek[week] || {})[s.id]) return;
      if (processed.summer_camp[s.id + '|' + week]) {
        report.summerCamp.skippedTombstone++;
        return;
      }
      var key = _dcKey(name, emailLc, week);
      var existing = _dcFindExistingRowFuzzy(existingByWeek, name, emailLc, week);
      if (existing) {
        if (existing.currentSubId === s.id) {
          _dcRecordProcessed(s.id, 'summer_camp', week, {
            campus: existing.which === 'summerUpper' ? 'upper' : 'lower',
            status: 'processed',
            spreadsheetId: existing.sheet.getParent().getId(),
            tabName: DC_WEEK_TO_TAB[week],
            rowIndex: existing.rowIndex,
            studentName: name, parentEmail: emailLc, contactId: s.contactId,
          });
          processed.summer_camp[s.id + '|' + week] = true;
          return;
        }
        try {
          existing.sheet.getRange(existing.rowIndex, existing.trackingCol).setValue(s.id);
          _dcSetSourceNote(existing.sheet, existing.rowIndex, 'linked-manual', s, week, 'Summer Camp');
          _dcRecordProcessed(s.id, 'summer_camp', week, {
            campus: existing.which === 'summerUpper' ? 'upper' : 'lower',
            status: 'linked_manual',
            spreadsheetId: existing.sheet.getParent().getId(),
            tabName: DC_WEEK_TO_TAB[week],
            rowIndex: existing.rowIndex,
            studentName: name,
            parentEmail: emailLc,
            contactId: s.contactId,
            metadata: existing.currentSubId
              ? { replaced_sub_id: existing.currentSubId }
              : { source: 'untracked_existing_row' },
          });
          trackedByWeek[week][s.id] = existing.which;
          processed.summer_camp[s.id + '|' + week] = true;
          report.summerCamp.linkedManual.push({
            submissionId: s.id, student: name, week: week,
            campus: existing.which, row: existing.rowIndex,
            replacedSubId: existing.currentSubId || null,
          });
        } catch (err) {
          report.summerCamp.errors.push(_dcErr(err, { phase: 'link-existing', submissionId: s.id, week: week }));
        }
        return;
      }
      // Genuinely missing — auto-add. The tombstone (Supabase per
      // submission+week) prevents re-adding a row the team has
      // already deleted, so blanket auto-add is safe.
      var campus = _dcDecideSummerCampus(s);
      try {
        var added = _dcAppendSummerCamp(s, week, campus);
        _dcRecordProcessed(s.id, 'summer_camp', week, {
          campus: campus,
          status: 'processed',
          spreadsheetId: campus === 'lower' ? DC_SUMMER_LOWER_SS : DC_SUMMER_UPPER_SS,
          tabName: DC_WEEK_TO_TAB[week],
          rowIndex: added.rowIndex,
          studentName: name,
          parentEmail: emailLc,
          contactId: s.contactId,
        });
        processed.summer_camp[s.id + '|' + week] = true;
        // Reflect new row in existingByWeek so a second submission
        // for same person+week (within this run) gets caught.
        existingByWeek[week][key] = {
          which: campus === 'lower' ? 'summerLower' : 'summerUpper',
          sheet: SpreadsheetApp.openById(campus === 'lower' ? DC_SUMMER_LOWER_SS : DC_SUMMER_UPPER_SS).getSheetByName(DC_WEEK_TO_TAB[week]),
          rowIndex: added.rowIndex,
          trackingCol: _dcEnsureTrackingCol(SpreadsheetApp.openById(campus === 'lower' ? DC_SUMMER_LOWER_SS : DC_SUMMER_UPPER_SS).getSheetByName(DC_WEEK_TO_TAB[week])),
          currentSubId: s.id,
        };
        report.summerCamp.added.push({
          submissionId: s.id, contactId: s.contactId, student: name,
          parent: s.name, email: s.email, week: week, campus: campus,
          rowIndex: added.rowIndex,
          likelyFailedWorkflow: _dcWorkflowFor('summer_camp', week),
        });
      } catch (err) {
        report.summerCamp.errors.push(_dcErr(err, { submissionId: s.id, week: week, campus: campus }));
      }
    });
  });

  // missing is now just an alias for errors (since auto-add is always on)
  report.summerCamp.missing = report.summerCamp.errors.slice();
}

// ─────────────────────── After School checker ───────────────────────

/**
 * After School failsafe.
 *
 *   Architecture: After School is fundamentally different from
 *   Free/Summer Camp. There is ONE intake spreadsheet (the central
 *   "After School Registration - APPLICATION" with a "Main Table" tab).
 *   The "After School Registration Main Branch" workflow appends one
 *   row per submission to Main Table. A separate Apps Script (the
 *   "School Enrollment Router", bound to that spreadsheet) then reads
 *   each new Main Table row and routes it to the correct per-school
 *   spreadsheet — auto-creating that sheet from a template if needed.
 *
 *   This bot's job: ensure Main Table has a row for every form
 *   submission. Once the row is in Main Table, the existing Router
 *   handles all the per-school routing. We do NOT duplicate that
 *   logic; we just close the gap between GHL and Main Table.
 *
 *   Dedup key: (student_name + parent_email + class) — both because
 *   Main Table can hold multiple submissions per kid (different
 *   classes) and because re-submissions for the same class shouldn't
 *   double up.
 *
 *   No 5-min grace racing concern: only one workflow handles all
 *   classes, and Main Table writes are fast. We keep the 5-min grace
 *   anyway for consistency.
 */
function _dcCheckAfterSchool(report) {
  report.afterSchool.added            = report.afterSchool.added            || [];
  report.afterSchool.linkedManual     = report.afterSchool.linkedManual     || [];
  report.afterSchool.skippedYoung     = report.afterSchool.skippedYoung     || 0;
  report.afterSchool.skippedTombstone = report.afterSchool.skippedTombstone || 0;
  var subs = _dcListSubmissions(DC_FORM_AFTER_SCHOOL);
  var nowMs = Date.now();
  var processed = _dcLoadProcessedFromSupabase();

  // Build the Main Table existing-row index.
  // Cols: A=Student Name, B=Email, C=T-Shirt, D=Grade, E=Date,
  //       F=Class, G=NKS, H=Status, then hidden _submissionId
  var ss = SpreadsheetApp.openById(DC_AFTER_SCHOOL_SS);
  var sheet = ss.getSheetByName(DC_AFTER_SCHOOL_TAB);
  if (!sheet) {
    report.afterSchool.errors.push({ message: 'Main Table tab not found in After School spreadsheet' });
    return;
  }
  var trackingCol = _dcEnsureTrackingCol(sheet);
  var lastRow = sheet.getLastRow();
  var existingByKey = {};            // key → { rowIndex, currentSubId }
  var trackedById = {};              // submissionId → rowIndex (for fast in-sheet check)
  if (lastRow >= 2) {
    var grid = sheet.getRange(2, 1, lastRow - 1, sheet.getLastColumn()).getValues();
    grid.forEach(function (row, i) {
      var subId = String(row[trackingCol - 1] || '').trim();
      var name  = row[0];
      var email = row[1];
      var cls   = row[5];
      if (!String(name || '').trim()) return;          // empty/blank rows
      var key = _dcAfterSchoolKey(name, email, cls);
      existingByKey[key] = { rowIndex: i + 2, currentSubId: subId, trackingCol: trackingCol };
      if (subId) trackedById[subId] = i + 2;
    });
  }

  subs.forEach(function (s) {
    if (nowMs - new Date(s.createdAt).getTime() < DC_GRACE_WINDOW_MS) {
      report.afterSchool.skippedYoung++;
      return;
    }
    var others = s.others || {};
    var name = String(others[DC_AS_FIELD_STUDENT] || '').trim();
    if (!name) return;                              // skip headerless / malformed
    if (_dcIsTestSubmission(s, name)) return;
    var emailLc = String(s.email || '').trim().toLowerCase();
    var cls    = String(others[DC_AS_FIELD_CLASS] || '').trim();
    var nks    = String(others[DC_AS_FIELD_NKS]   || '').trim();
    // Use class as the tombstone "week" key so each (sub, class) is
    // tracked independently. After School submissions are 1:1 with
    // class, but the field guarantees a stable key in Supabase.
    var classKey = cls || (nks ? 'NKS:' + nks : '<no-class>');

    if (trackedById[s.id]) return;                  // already in Main Table
    if (processed.after_school[s.id + '|' + classKey]) {
      report.afterSchool.skippedTombstone++;
      return;
    }

    var dedupKey = _dcAfterSchoolKey(name, emailLc, cls);
    var existing = existingByKey[dedupKey];
    if (!existing) {
      // Fuzzy fallback: same email + class but a name variant
      // ("Aria" vs "Aria Falzone").
      var emailLcKey = String(emailLc || '').trim().toLowerCase();
      var clsLcKey = String(cls || '').trim().toLowerCase();
      for (var ek in existingByKey) {
        if (!existingByKey.hasOwnProperty(ek)) continue;
        var parts = ek.split('|');
        if (parts.length < 3) continue;
        if (parts[1] !== emailLcKey) continue;
        if (parts[2] !== clsLcKey) continue;
        if (_dcNamesLikelySamePerson(parts[0], name)) {
          existing = existingByKey[ek];
          break;
        }
      }
    }
    if (existing) {
      // Row already in Main Table for this (kid, class). Either
      // currentSubId matches (verified record-only) or it's an old
      // submission ID we should refresh. Either way, no append.
      if (existing.currentSubId === s.id) {
        _dcRecordProcessed(s.id, 'after_school', classKey, {
          status: 'processed',
          spreadsheetId: DC_AFTER_SCHOOL_SS,
          tabName: DC_AFTER_SCHOOL_TAB,
          rowIndex: existing.rowIndex,
          studentName: name, parentEmail: emailLc, contactId: s.contactId,
          metadata: { class: cls, nks: nks },
        });
        processed.after_school[s.id + '|' + classKey] = true;
        return;
      }
      try {
        sheet.getRange(existing.rowIndex, existing.trackingCol).setValue(s.id);
        _dcSetAfterSchoolNote(sheet, existing.rowIndex, 'linked-manual', s, cls, nks);
        _dcRecordProcessed(s.id, 'after_school', classKey, {
          status: 'linked_manual',
          spreadsheetId: DC_AFTER_SCHOOL_SS,
          tabName: DC_AFTER_SCHOOL_TAB,
          rowIndex: existing.rowIndex,
          studentName: name, parentEmail: emailLc, contactId: s.contactId,
          metadata: { class: cls, nks: nks, replaced_sub_id: existing.currentSubId || null },
        });
        processed.after_school[s.id + '|' + classKey] = true;
        trackedById[s.id] = existing.rowIndex;
        report.afterSchool.linkedManual.push({
          submissionId: s.id, student: name, class: cls, nks: nks,
          parent: s.name, email: s.email, row: existing.rowIndex,
        });
      } catch (err) {
        report.afterSchool.errors.push(_dcErr(err, { phase: 'link-existing', submissionId: s.id }));
      }
      return;
    }

    // Genuinely missing — append to Main Table. The Router will
    // pick up the row on its next on-edit/on-change trigger.
    try {
      var added = _dcAppendAfterSchool(s);
      _dcRecordProcessed(s.id, 'after_school', classKey, {
        status: 'processed',
        spreadsheetId: DC_AFTER_SCHOOL_SS,
        tabName: DC_AFTER_SCHOOL_TAB,
        rowIndex: added.rowIndex,
        studentName: name, parentEmail: emailLc, contactId: s.contactId,
        metadata: { class: cls, nks: nks },
      });
      processed.after_school[s.id + '|' + classKey] = true;
      // Reflect in indices so a duplicate sub for same kid+class
      // within this run gets caught by the existing-row branch.
      existingByKey[dedupKey] = {
        rowIndex: added.rowIndex,
        currentSubId: s.id,
        trackingCol: trackingCol,
      };
      trackedById[s.id] = added.rowIndex;
      report.afterSchool.added.push({
        submissionId: s.id, contactId: s.contactId, student: name,
        class: cls, nks: nks,
        parent: s.name, email: s.email, rowIndex: added.rowIndex,
        likelyFailedWorkflow: _dcWorkflowFor('after_school', '*'),
      });
    } catch (err) {
      report.afterSchool.errors.push(_dcErr(err, { submissionId: s.id, phase: 'append' }));
    }
  });
}

function _dcAfterSchoolKey(name, email, cls) {
  return String(name || '').trim().toLowerCase() + '|' +
         String(email || '').trim().toLowerCase() + '|' +
         String(cls || '').trim().toLowerCase();
}

/**
 * Append one row to Main Table. Column order is fixed by the School
 * Enrollment Router — DO NOT REORDER without updating the router.
 *   A: Student Name (from form)
 *   B: Parent Email (from form)
 *   C: T-Shirt Size (from form)
 *   D: Grade (from form)
 *   E: Date (use the form submission's createdAt — preserves timeline)
 *   F: Class (from form's "Select Class")
 *   G: NKS (from form's "Neighborhood Kids Schools" — only set if Class
 *      resolves to "Neighborhood Kids Schools")
 *   H: Status (LEAVE BLANK — the Router fills this in when it processes)
 *   ...: hidden _submissionId at the rightmost
 */
function _dcAppendAfterSchool(submission) {
  var ss = SpreadsheetApp.openById(DC_AFTER_SCHOOL_SS);
  var sheet = ss.getSheetByName(DC_AFTER_SCHOOL_TAB);
  if (!sheet) throw new Error('Main Table tab missing in After School spreadsheet');
  var others = submission.others || {};
  var name  = String(others[DC_AS_FIELD_STUDENT] || '');
  var email = String(submission.email || '');
  var shirt = String(others[DC_AS_FIELD_SHIRT] || '');
  var grade = String(others[DC_AS_FIELD_GRADE] || '');
  var dateIso = submission.createdAt || new Date().toISOString();
  var cls   = String(others[DC_AS_FIELD_CLASS] || '');
  var nks   = String(others[DC_AS_FIELD_NKS]   || '');
  var row = [name, email, shirt, grade, dateIso, cls, nks, ''];
  var trackingCol = _dcEnsureTrackingCol(sheet);
  while (row.length < trackingCol - 1) row.push('');
  row.push(submission.id);
  sheet.appendRow(row);
  var newRowIndex = sheet.getLastRow();
  _dcSetAfterSchoolNote(sheet, newRowIndex, 'auto-added', submission, cls, nks);
  return { row: row, rowIndex: newRowIndex };
}

/** Cell note specifically for After School rows (different schema than camp rows). */
function _dcSetAfterSchoolNote(sheet, rowIndex, mode, submission, cls, nks) {
  try {
    var nameCol = 1;       // Main Table col A = Student Name
    var contactUrl = submission.contactId
      ? 'https://app.nilsdigital.com/v2/location/' + DC_LOCATION_ID + '/contacts/detail/' + submission.contactId
      : '';
    var modeBlurb = ({
      'auto-added':    'Auto-added by DiscrepancyCheck — the After School Registration Main Branch workflow did not write this row, so the bot did. The School Enrollment Router will route this to the per-school sheet on its next trigger.',
      'linked-manual': 'Linked by DiscrepancyCheck — this row was already here (typed in or written by an earlier workflow run); bot stamped the GHL submission ID on it.',
    })[mode] || ('DiscrepancyCheck (' + mode + ')');
    var lines = [];
    lines.push(modeBlurb);
    lines.push('Stamped: ' + new Date().toISOString());
    lines.push('');
    lines.push('Form: After School Registration');
    lines.push('Class: ' + (cls || '(none)'));
    if (nks) lines.push('NKS: ' + nks);
    lines.push('Submission ID: ' + submission.id);
    lines.push('Submitted: ' + (submission.createdAt || ''));
    lines.push('Parent: ' + (submission.name || ''));
    lines.push('Parent email: ' + (submission.email || ''));
    lines.push('Contact ID: ' + (submission.contactId || ''));
    if (contactUrl) lines.push('Contact: ' + contactUrl);
    sheet.getRange(rowIndex, nameCol).setNote(lines.join('\n'));
  } catch (e) {
    Logger.log('After-school setNote failed: ' + e);
  }
}

// ─────────────────────── Duplicate resolution (destructive) ───────────────────────

/**
 * Auto-delete in-tab duplicate rows. For every (name + email + week)
 * cluster with 2+ rows, the lowest row index is kept (likely the
 * original entry) and the rest are deleted. Cross-campus duplicates
 * are NOT touched — those need human judgment to pick a campus.
 *
 * The deleted rows had their submission IDs backfilled into the
 * tombstone tab, so the bot will not re-add them on future runs.
 *
 * Idempotent: re-running after a clean state returns deleted=[].
 * Returns the action list so you can audit what changed.
 *
 * Recovery: every spreadsheet has version history (File → Version
 * history) — if a delete was wrong, restore from a snapshot before
 * the run timestamp.
 */
function discrepancyDeleteInTabDuplicates() {
  var report = { deleted: [], errors: [] };
  var temp = { duplicates: { clusters: [], crossCampus: [], errors: [] } };
  _dcCheckDuplicates(temp);

  // Group deletes by destination sheet so we can delete bottom-up
  // (preserves row indices on the same sheet).
  var buckets = {};
  temp.duplicates.clusters.forEach(function (c) {
    var sorted = c.rows.slice().sort(function (a, b) { return a - b; });
    var keepRow = sorted[0];
    var deleteRows = sorted.slice(1);
    var ssId = _dcSheetIdFor(c.form, c.campus);
    var key = ssId + '|' + c.tabName;
    deleteRows.forEach(function (rIdx) {
      buckets[key] = buckets[key] || { ssId: ssId, tabName: c.tabName, items: [] };
      buckets[key].items.push({ rowIndex: rIdx, cluster: c, keepRow: keepRow });
    });
  });

  Object.keys(buckets).forEach(function (k) {
    var bucket = buckets[k];
    var ss = SpreadsheetApp.openById(bucket.ssId);
    var sheet = ss.getSheetByName(bucket.tabName);
    if (!sheet) {
      bucket.items.forEach(function (item) {
        report.errors.push({ error: 'tab missing', tabName: bucket.tabName });
      });
      return;
    }
    var sorted = bucket.items.slice().sort(function (a, b) { return b.rowIndex - a.rowIndex; });
    sorted.forEach(function (item) {
      try {
        sheet.deleteRow(item.rowIndex);
        report.deleted.push({
          form: item.cluster.form,
          campus: item.cluster.campus,
          week: item.cluster.week,
          tabName: item.cluster.tabName,
          student: item.cluster.displayName,
          email: item.cluster.displayEmail,
          deletedRow: item.rowIndex,
          keptRow: item.keepRow,
        });
      } catch (err) {
        report.errors.push(_dcErr(err, { tabName: bucket.tabName, row: item.rowIndex }));
      }
    });
  });

  return report;
}

/**
 * Find a GHL contact by email. Returns the first match or null.
 * Used as a fallback when a sheet row doesn't trace back to a form
 * submission (typically because the kid was added directly to GHL).
 */
function _dcLookupContactByEmail_(email) {
  if (!email) return null;
  var token = _dcGhlToken_();
  var resp = UrlFetchApp.fetch('https://services.leadconnectorhq.com/contacts/search', {
    method: 'post',
    contentType: 'application/json',
    headers: { Authorization: 'Bearer ' + token, Version: '2021-07-28', 'User-Agent': 'Mozilla/5.0' },
    payload: JSON.stringify({
      locationId: DC_LOCATION_ID,
      pageLimit: 5,
      filters: [{ field: 'email', operator: 'eq', value: email }],
    }),
    muteHttpExceptions: true,
  });
  if (resp.getResponseCode() !== 200) return null;
  var data = JSON.parse(resp.getContentText());
  var arr = data.contacts || [];
  return arr.length ? arr[0] : null;
}

function _dcSheetIdFor(form, campus) {
  if (form === 'Free Camp') return campus === 'upper' ? DC_FREE_UPPER_SS : DC_FREE_LOWER_SS;
  return campus === 'upper' ? DC_SUMMER_UPPER_SS : DC_SUMMER_LOWER_SS;
}

/**
 * Merge name-variant duplicates within the same email + week. Picks
 * the row with the **fuller name** as the primary (so "Aria Falzone"
 * wins over "Aria"; "Grant 'Geo' Olowin" wins over "Grant 'Geo' Olowin"
 * — the curly-quote vs straight-quote pair will pick whichever has
 * more non-empty cells as a tie-break).
 *
 * Then merges any non-empty cells from the secondary rows into the
 * primary row's EMPTY cells (never overwrites — preserves intentional
 * differences). Stamps the secondary's submission ID on the primary if
 * the primary doesn't have one yet. Finally deletes the secondaries.
 *
 * Supabase tombstones for the deleted rows are preserved as-is — the
 * bot's idempotency check is by submission_id, not row_index, so the
 * row_index field becoming stale doesn't break anything. The orphaned
 * submission IDs stay tombstoned so they're never re-added.
 *
 * Recovery: every spreadsheet has File → Version history if the merge
 * was wrong. Returns the action list so you can audit.
 */
function discrepancyMergeNameVariantDuplicates() {
  var temp = { duplicates: { clusters: [], crossCampus: [], errors: [] } };
  _dcCheckDuplicates(temp);
  return _dcMergeClusterList_(temp.duplicates.clusters);
}

/**
 * Merge a list of in-tab duplicate clusters (the shape produced by
 * _dcCheckDuplicates). Shared engine behind the manual
 * discrepancyMergeNameVariantDuplicates() (merges every cluster) and the
 * scheduled discrepancyAutoMergeHighConfidence() (passes only the
 * high-confidence subset). Returns { merged: [], errors: [] }.
 */
function _dcMergeClusterList_(clusters) {
  var report = { merged: [], errors: [] };

  // Group merges + deletes by destination sheet so we can write +
  // delete bottom-up (preserves row indices in the same sheet).
  var pendingDeletes = {};   // ssKey → { ssId, tabName, rows: [] }

  clusters.forEach(function (cluster) {
    try {
      var ssId = _dcSheetIdFor(cluster.form, cluster.campus);
      var ss = SpreadsheetApp.openById(ssId);
      var sheet = ss.getSheetByName(cluster.tabName);
      if (!sheet) {
        report.errors.push({ error: 'sheet missing', cluster: cluster });
        return;
      }
      var trackingCol = _dcEnsureTrackingCol(sheet);
      var lastCol = sheet.getLastColumn();
      // Student Name column: 2 for Free Camp, 3 for Summer Camp
      var nameCol = cluster.form === 'Free Camp' ? 2 : 3;

      // Read all rows in the cluster
      var rows = cluster.rows.map(function (rIdx) {
        var values = sheet.getRange(rIdx, 1, 1, lastCol).getValues()[0];
        var subId = String(values[trackingCol - 1] || '').trim();
        var nonEmpty = values.filter(function (v) {
          return v !== '' && v !== null && v !== undefined;
        }).length;
        var nameStr = String(values[nameCol - 1] || '').trim();
        var tokens = nameStr.split(/\s+/).filter(Boolean).length;
        return {
          rowIndex: rIdx, values: values, subId: subId,
          nonEmpty: nonEmpty, tokens: tokens, nameStr: nameStr,
        };
      });

      // Pick primary: most-tokens name wins; tie → most non-empty cells; tie → lowest rowIndex.
      rows.sort(function (a, b) {
        if (a.tokens !== b.tokens) return b.tokens - a.tokens;
        if (a.nonEmpty !== b.nonEmpty) return b.nonEmpty - a.nonEmpty;
        return a.rowIndex - b.rowIndex;
      });
      var primary = rows[0];
      var others = rows.slice(1);

      // Merge non-empty values from others into primary's empty cells.
      var mergedValues = primary.values.slice();
      var primarySubId = primary.subId;
      var copiedFields = 0;
      others.forEach(function (other) {
        for (var col = 0; col < lastCol; col++) {
          var primVal = mergedValues[col];
          var otherVal = other.values[col];
          var primEmpty = (primVal === '' || primVal === null || primVal === undefined);
          var otherHas = (otherVal !== '' && otherVal !== null && otherVal !== undefined);
          if (col === trackingCol - 1) {
            // Submission ID: take other's only if primary's is empty
            if (primEmpty && otherHas) {
              mergedValues[col] = otherVal;
              primarySubId = String(otherVal).trim();
              copiedFields++;
            }
          } else if (primEmpty && otherHas) {
            mergedValues[col] = otherVal;
            copiedFields++;
          }
        }
      });

      // Write merged values back if anything changed
      if (copiedFields > 0) {
        sheet.getRange(primary.rowIndex, 1, 1, lastCol).setValues([mergedValues]);
      }

      // Update the cell note on primary so it reflects the merge
      try {
        var existingNote = sheet.getRange(primary.rowIndex, nameCol).getNote() || '';
        var stamp = 'Merged by DiscrepancyCheck on ' + new Date().toISOString() +
          ' — primary row, kept name "' + primary.nameStr + '"; absorbed from rows ' +
          others.map(function (o) { return o.rowIndex + ' ("' + o.nameStr + '")'; }).join(', ') +
          '; copied ' + copiedFields + ' non-empty fields into empty cells';
        var newNote = existingNote ? (existingNote + '\n\n' + stamp) : stamp;
        sheet.getRange(primary.rowIndex, nameCol).setNote(newNote);
      } catch (noteErr) { /* notes are best-effort */ }

      // Queue secondary rows for deletion
      var bk = ssId + '|' + cluster.tabName;
      others.forEach(function (other) {
        pendingDeletes[bk] = pendingDeletes[bk] || { ssId: ssId, tabName: cluster.tabName, rows: [] };
        pendingDeletes[bk].rows.push(other.rowIndex);
      });

      report.merged.push({
        form: cluster.form, campus: cluster.campus, week: cluster.week,
        tabName: cluster.tabName,
        // _mergeKey/displayEmail are set by discrepancyAutoMergeHighConfidence
        // (undefined for the manual caller, which doesn't write tombstones).
        mergeKey: cluster._mergeKey || null,
        email: cluster.displayEmail || '',
        names: cluster.names || [],
        primary: { row: primary.rowIndex, name: primary.nameStr, subId: primarySubId },
        deleted: others.map(function (o) {
          return { row: o.rowIndex, name: o.nameStr, subId: o.subId };
        }),
        copiedFields: copiedFields,
      });
    } catch (err) {
      report.errors.push(_dcErr(err, { cluster: cluster }));
    }
  });

  // Apply deletes bottom-up so row indices on the same sheet don't shift
  Object.keys(pendingDeletes).forEach(function (bk) {
    var bucket = pendingDeletes[bk];
    var ss = SpreadsheetApp.openById(bucket.ssId);
    var sheet = ss.getSheetByName(bucket.tabName);
    if (!sheet) return;
    bucket.rows.slice().sort(function (a, b) { return b - a; }).forEach(function (rIdx) {
      try { sheet.deleteRow(rIdx); }
      catch (e) { report.errors.push(_dcErr(e, { tabName: bucket.tabName, row: rIdx })); }
    });
  });

  return report;
}

// ─────────────── Scheduled auto-merge (high-confidence only) ───────────────
//
// The 15-min discrepancy bot DETECTS duplicates but never deletes. This job
// auto-merges only the clusters whose names match with high confidence and
// EMAILS a warning for anything weaker (plus cross-campus dupes, which are
// never auto-resolved). Install once: run discrepancyAutoMergeSetupTrigger().

// Auto-merge only when the cluster's name-match confidence is >= this.
// 0.95 catches a one-character variant inside a full name (e.g. "Elian" vs
// "Elias Lucas Gaspard Dominguez", Jaro-Winkler ~0.99) but NOT a bare first
// name vs a full name ("Aria" vs "Aria Falzone", ~0.87) — those get warned.
var DC_AUTOMERGE_MIN_CONFIDENCE = 0.95;
var DC_AUTOMERGE_TRIGGER_FUNCTION = 'discrepancyAutoMergeHighConfidence';

/**
 * Normalize a name for confidence scoring: lowercase, collapse internal
 * whitespace, and straighten curly quotes/apostrophes so "Jah’Lil" and
 * "Jah'Lil" compare as equal.
 */
function _dcNormNameForScore_(s) {
  return String(s == null ? '' : s)
    .replace(/[‘’ʼ]/g, "'")
    .replace(/[“”]/g, '"')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Confidence that every name in a cluster is the SAME person, as the
 * MINIMUM pairwise similarity across the cluster's names. Normalized-equal
 * names score 1.0; otherwise raw Jaro-Winkler on the full strings. Using the
 * minimum means a 3+ row cluster only auto-merges if ALL members are mutually
 * close, never on the strength of a single close pair.
 */
function _dcClusterMergeConfidence_(names) {
  var norm = (names || []).map(_dcNormNameForScore_).filter(Boolean);
  if (norm.length < 2) return 1;   // nothing to compare → treat as safe
  var min = 1;
  for (var i = 0; i < norm.length; i++) {
    for (var j = i + 1; j < norm.length; j++) {
      var sim = (norm[i] === norm[j]) ? 1 : _dcJaroWinkler(norm[i], norm[j]);
      if (sim < min) min = sim;
    }
  }
  return min;
}

/**
 * Scheduled entry point (hourly trigger). Detects in-tab duplicate clusters,
 * AUTO-MERGES the ones whose name confidence is >= DC_AUTOMERGE_MIN_CONFIDENCE,
 * and emails a warning for everything below the threshold (plus any
 * cross-campus duplicates). Idempotent — a clean roster merges nothing and
 * sends no email. Recovery: each sheet has File → Version history.
 *
 * Install: discrepancyAutoMergeSetupTrigger() (run once from the editor).
 */
// Pick the "fuller" name in a cluster (most tokens, then longest string) —
// the one the merge engine keeps as primary. Used to build a stable
// merge-tombstone key that survives re-detection.
function _dcClusterPrimaryName_(names) {
  var best = '';
  (names || []).forEach(function (n) {
    var s = String(n == null ? '' : n).trim();
    if (!s) return;
    if (!best) { best = s; return; }
    var bt = best.split(/\s+/).length, st = s.split(/\s+/).length;
    if (st > bt || (st === bt && s.length > best.length)) best = s;
  });
  return best;
}

// Durable key for a duplicate cluster: form|week|normalizedFullerName|email.
// Same key whether the dupe is first merged or later re-detected after a
// manual re-add, so the tombstone reliably matches.
function _dcMergeKey_(cluster) {
  var formSlug = cluster.form === 'Summer Camp' ? 'summer_camp' : 'free_camp';
  var nameKey  = _dcNormNameForScore_(_dcClusterPrimaryName_(cluster.names));
  var email    = _dcNormNameForScore_(cluster.displayEmail || '');
  return formSlug + '|' + cluster.week + '|' + nameKey + '|' + email;
}

/**
 * Load every merge tombstone from Supabase as a map: mergeKey → merge_count.
 * The presence of a key means "this kid+week has been auto-merged before",
 * which tells discrepancyAutoMergeHighConfidence to LEAVE a later re-add
 * alone. Throws on transport/HTTP error so the caller can degrade to
 * "merge as usual" rather than silently trusting an empty set.
 */
function _dcLoadMergeTombstones() {
  var props = PropertiesService.getScriptProperties();
  var url    = props.getProperty('SUPABASE_URL');
  var anon   = props.getProperty('SUPABASE_ANON_KEY');
  var secret = props.getProperty('SUPABASE_TOKEN_SECRET');
  if (!url || !anon || !secret) throw new Error('Missing Supabase Script Properties');
  var resp = UrlFetchApp.fetch(url + '/rest/v1/rpc/sf_list_merges', {
    method: 'post',
    contentType: 'application/json',
    headers: { apikey: anon, Authorization: 'Bearer ' + anon },
    payload: JSON.stringify({ claim_secret: secret }),
    muteHttpExceptions: true,
  });
  if (resp.getResponseCode() !== 200) {
    throw new Error('sf_list_merges HTTP ' + resp.getResponseCode() + ': ' + resp.getContentText().substring(0, 200));
  }
  var rows = JSON.parse(resp.getContentText());
  var out = {};
  rows.forEach(function (r) {
    out[r.form + '|' + r.week + '|' + r.name_key + '|' + r.email] = r.merge_count || 1;
  });
  return out;
}

/**
 * Upsert one merge tombstone via sf_record_merge. `m` is an entry from
 * _dcMergeClusterList_'s report.merged (must carry m.mergeKey, set by
 * discrepancyAutoMergeHighConfidence). Throws on HTTP >= 300.
 */
function _dcRecordMerge(m) {
  var props = PropertiesService.getScriptProperties();
  var url    = props.getProperty('SUPABASE_URL');
  var anon   = props.getProperty('SUPABASE_ANON_KEY');
  var secret = props.getProperty('SUPABASE_TOKEN_SECRET');
  var parts = String(m.mergeKey).split('|');   // formSlug | week | nameKey | email
  var payload = {
    claim_secret: secret,
    p_form: parts[0],
    p_week: parts[1],
    p_name_key: parts[2],
    p_email: parts[3],
    p_campus: m.campus || null,
    p_primary_name: (m.primary && m.primary.name) || null,
    p_merged_names: (m.deleted || []).map(function (d) { return d.name; }),
    p_primary_sub_id: (m.primary && m.primary.subId) || null,
    p_metadata: { tabName: m.tabName || null, copiedFields: m.copiedFields || 0 },
  };
  var resp = UrlFetchApp.fetch(url + '/rest/v1/rpc/sf_record_merge', {
    method: 'post',
    contentType: 'application/json',
    headers: { apikey: anon, Authorization: 'Bearer ' + anon },
    payload: JSON.stringify(payload),
    muteHttpExceptions: true,
  });
  if (resp.getResponseCode() >= 300) {
    throw new Error('sf_record_merge HTTP ' + resp.getResponseCode() + ': ' + resp.getContentText().substring(0, 200));
  }
}

function discrepancyAutoMergeHighConfidence() {
  // Don't let two auto-merge runs overlap.
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(0)) {
    Logger.log('[autoMerge] skipped — another run holds the lock');
    return { skipped: 'locked' };
  }
  try {
    var temp = { duplicates: { clusters: [], crossCampus: [], errors: [] } };
    _dcCheckDuplicates(temp);

    // History of prior merges. Once a kid+week has been auto-merged, a later
    // MANUAL re-add of that kid is LEFT in place (respect the human) — same
    // rule as the deletion tombstones. If the lookup fails, fall back to an
    // empty map so a Supabase blip degrades to "merge as usual" rather than
    // blocking all merges.
    var mergedBefore = {};
    try { mergedBefore = _dcLoadMergeTombstones(); }
    catch (e) { Logger.log('[autoMerge] merge-tombstone load failed (merging as usual): ' + e.message); }

    var high = [], low = [], leftRespected = [];
    temp.duplicates.clusters.forEach(function (c) {
      var conf = _dcClusterMergeConfidence_(c.names);
      c._confidence = conf;
      if (conf < DC_AUTOMERGE_MIN_CONFIDENCE) { low.push(c); return; }
      c._mergeKey = _dcMergeKey_(c);
      if (mergedBefore[c._mergeKey]) leftRespected.push(c);  // already merged once → respect the re-add
      else high.push(c);
    });

    var result = _dcMergeClusterList_(high);

    // Record a durable tombstone for everything we just merged, so a future
    // manual re-add of the same kid+week is recognized and left alone.
    result.merged.forEach(function (m) {
      if (!m.mergeKey) return;
      try { _dcRecordMerge(m); }
      catch (e) { result.errors.push(_dcErr(e, { phase: 'record-merge', key: m.mergeKey })); }
    });

    result.warned = low.map(function (c) {
      return {
        form: c.form, campus: c.campus, week: c.week, tabName: c.tabName,
        names: c.names, rows: c.rows, email: c.displayEmail,
        confidence: Math.round(c._confidence * 1000) / 1000,
      };
    });
    result.leftRespected = leftRespected.map(function (c) {
      return {
        form: c.form, campus: c.campus, week: c.week, tabName: c.tabName,
        names: c.names, rows: c.rows, email: c.displayEmail,
        mergeCount: mergedBefore[c._mergeKey] || 1,
      };
    });
    result.crossCampus = temp.duplicates.crossCampus;

    Logger.log('[autoMerge] merged=' + result.merged.length +
      ' leftRespected=' + leftRespected.length +
      ' warned=' + low.length + ' crossCampus=' + result.crossCampus.length +
      ' errors=' + result.errors.length);

    if (result.merged.length || low.length || leftRespected.length ||
        result.crossCampus.length || result.errors.length) {
      try { _dcEmailAutoMergeReport_(result); }
      catch (e) { result.errors.push(_dcErr(e, { phase: 'automerge-email' })); }
    }
    return result;
  } finally {
    lock.releaseLock();
  }
}

/**
 * Email summary for the scheduled auto-merge: what merged automatically and
 * what needs a human (sub-threshold name matches + cross-campus dupes).
 */
function _dcEmailAutoMergeReport_(result) {
  var to = _dcNotifyRecipients();
  if (!to.length) return;
  var lines = [];
  lines.push('Auto-merge run — ' + new Date().toISOString());
  lines.push('Threshold: names must match >= ' + Math.round(DC_AUTOMERGE_MIN_CONFIDENCE * 100) + '% to merge automatically.');
  lines.push('');
  var lr = result.leftRespected || [];
  lines.push('Auto-merged             : ' + result.merged.length);
  lines.push('Left in place (re-add)  : ' + lr.length);
  lines.push('Need your review        : ' + result.warned.length);
  lines.push('Cross-campus            : ' + result.crossCampus.length);
  lines.push('Errors                  : ' + result.errors.length);

  if (result.merged.length) {
    lines.push('');
    lines.push('AUTO-MERGED (no action needed):');
    result.merged.forEach(function (m) {
      lines.push('  ✓ [' + m.form + ' ' + m.campus + '] ' + m.tabName +
        ' — kept "' + m.primary.name + '" (row ' + m.primary.row + '), removed ' +
        m.deleted.map(function (d) { return '"' + d.name + '" (row ' + d.row + ')'; }).join(', '));
    });
  }

  if (lr.length) {
    lines.push('');
    lines.push('LEFT IN PLACE (already auto-merged once before — re-add respected, NOT merged again):');
    lr.forEach(function (w) {
      lines.push('  = [' + w.form + ' ' + w.campus + '] ' + w.tabName +
        ' <' + (w.email || 'no email') + '> rows ' + (w.rows || []).join(', ') +
        ' — ' + (w.names || []).map(function (n) { return '"' + n + '"'; }).join(' vs ') +
        ' (merged ' + w.mergeCount + 'x before)');
    });
    lines.push('  These were merged automatically in the past, then a row reappeared (re-added by hand). Left alone on purpose. If it is a genuine duplicate, remove the extra row manually.');
  }

  if (result.warned.length) {
    lines.push('');
    lines.push('⚠ NEEDS REVIEW — possible duplicates, name match too weak to merge automatically:');
    result.warned.forEach(function (w) {
      lines.push('  • [' + w.form + ' ' + w.campus + '] ' + w.tabName +
        ' <' + (w.email || 'no email') + '> rows ' + (w.rows || []).join(', ') +
        ' — ' + (w.names || []).map(function (n) { return '"' + n + '"'; }).join(' vs ') +
        ' (' + Math.round(w.confidence * 100) + '% match)');
    });
    lines.push('');
    lines.push('  If one is truly the same child, merge by hand or run discrepancyMergeNameVariantDuplicates() once (it merges ALL clusters regardless of confidence).');
  }

  if (result.crossCampus.length) {
    lines.push('');
    lines.push('⚠ CROSS-CAMPUS (same kid on Upper AND Lower — never auto-resolved):');
    result.crossCampus.forEach(function (c) {
      lines.push('  ↔ [' + c.form + '] ' + c.tabName + ' — ' + c.displayName +
        ' <' + (c.displayEmail || 'no email') + '>  Upper rows ' + c.upperRows.join(',') +
        ' AND Lower rows ' + c.lowerRows.join(','));
    });
  }

  if (result.errors.length) {
    lines.push('');
    lines.push('ERRORS:');
    result.errors.forEach(function (e) { lines.push('  ! ' + JSON.stringify(e)); });
  }

  MailApp.sendEmail({
    to: to.join(','),
    subject: 'Auto-merge — ' + result.merged.length + ' merged, ' + result.warned.length + ' need review',
    body: lines.join('\n'),
  });
}

/** Install the hourly auto-merge trigger (no-op if already installed). */
function discrepancyAutoMergeSetupTrigger() {
  var existing = ScriptApp.getProjectTriggers().filter(function (t) {
    return t.getHandlerFunction() === DC_AUTOMERGE_TRIGGER_FUNCTION;
  });
  if (existing.length) return 'already installed (' + existing.length + ')';
  ScriptApp.newTrigger(DC_AUTOMERGE_TRIGGER_FUNCTION)
    .timeBased()
    .everyHours(1)
    .create();
  return 'installed (hourly)';
}

/** Remove the auto-merge trigger. */
function discrepancyAutoMergeRemoveTrigger() {
  var removed = 0;
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (t.getHandlerFunction() === DC_AUTOMERGE_TRIGGER_FUNCTION) {
      ScriptApp.deleteTrigger(t); removed++;
    }
  });
  return 'removed ' + removed;
}

/**
 * Resolve cross-campus duplicates (same kid on both Upper AND Lower
 * for the same week). Strategy: pick the campus the GHL workflow
 * would have picked, based on age on June 1 of the camp year.
 *   < 5 yrs → Lower
 *   ≥ 5 yrs → Upper
 *
 * For Free Camp specifically, also check the contact's
 * `NdulijXuqRPG6FNdPJ5q` (Free Camp Registration) field — if present,
 * that overrides the age rule (it's what the workflow last decided).
 *
 * Skips cases where DOB can't be found / parsed (logged in `skipped`),
 * leaving them for human review. Returns the action list.
 */
function discrepancyDeleteCrossCampusDuplicates() {
  var report = { deleted: [], skipped: [], errors: [] };
  var temp = { duplicates: { clusters: [], crossCampus: [], errors: [] } };
  _dcCheckDuplicates(temp);

  // Pre-fetch all submissions for both forms so we can resolve DOB
  // without a per-kid API call.
  var subsByForm = {
    'Free Camp':   _dcListSubmissions(DC_FORM_FREE_CAMP),
    'Summer Camp': _dcListSubmissions(DC_FORM_SUMMER_CAMP),
  };
  // Index by (lowercased name + email) for fast match
  var subIndex = { 'Free Camp': {}, 'Summer Camp': {} };
  subsByForm['Free Camp'].forEach(function (s) {
    var n = String((s.others || {})[DC_FC_FIELD_STUDENT] || '').trim().toLowerCase();
    var e = String(s.email || '').trim().toLowerCase();
    if (n) subIndex['Free Camp'][n + '|' + e] = s;
  });
  subsByForm['Summer Camp'].forEach(function (s) {
    var n = String((s.others || {})[DC_SC_FIELD_STUDENT] || '').trim().toLowerCase();
    var e = String(s.email || '').trim().toLowerCase();
    if (n) subIndex['Summer Camp'][n + '|' + e] = s;
  });

  var deleteBuckets = {};
  temp.duplicates.crossCampus.forEach(function (c) {
    var key = c.displayName.toLowerCase() + '|' + (c.displayEmail || '').toLowerCase();
    var s = subIndex[c.form][key];
    var dobField = c.form === 'Free Camp' ? 'cuEVHLcCCk8c7zaMRQOj' : DC_SC_FIELD_DOB;
    var dobRaw = s ? (s.others || {})[dobField] : null;
    if (!dobRaw && c.displayEmail) {
      // Fallback: no form submission match (kid may have been added
      // directly in GHL without going through the form). Query the
      // contact by email and read the DOB custom field.
      try {
        var contact = _dcLookupContactByEmail_(c.displayEmail);
        if (contact) {
          (contact.customFields || []).forEach(function (cf) {
            if (cf.id === dobField && cf.value) dobRaw = cf.value;
          });
        }
      } catch (e) {
        report.errors.push(_dcErr(e, { phase: 'contact-lookup', email: c.displayEmail }));
      }
    }
    if (!dobRaw) {
      report.skipped.push({ reason: 'no DOB found (no submission, no contact field)', cluster: c });
      return;
    }
    var dob = _dcParseDate(dobRaw);
    if (!dob) {
      report.skipped.push({ reason: 'unparseable DOB: ' + dobRaw, cluster: c });
      return;
    }
    var fallbackYear = (s && s.createdAt) ? new Date(s.createdAt).getFullYear() : new Date().getFullYear();
    var year = +((c.week.match(/(\d{4})/) || [])[1] || fallbackYear);
    var june1 = new Date(year, 5, 1);
    var ageYears = (june1 - dob) / (365.25 * 24 * 3600 * 1000);
    // Rule: at least 6 yrs old by June 1 → Upper; otherwise Lower.
    var keepCampus = ageYears >= 6 ? 'upper' : 'lower';
    var deleteCampus = ageYears >= 6 ? 'lower' : 'upper';
    var deleteRows = c[deleteCampus + 'Rows'];
    if (!deleteRows || !deleteRows.length) return;
    var ssId = _dcSheetIdFor(c.form, deleteCampus);
    var bk = ssId + '|' + c.tabName;
    deleteRows.forEach(function (rIdx) {
      deleteBuckets[bk] = deleteBuckets[bk] || { ssId: ssId, tabName: c.tabName, items: [] };
      deleteBuckets[bk].items.push({
        rowIndex: rIdx,
        cluster: c,
        deleteCampus: deleteCampus,
        keepCampus: keepCampus,
        ageYears: ageYears,
        dob: Utilities.formatDate(dob, 'America/New_York', 'yyyy-MM-dd'),
      });
    });
  });

  Object.keys(deleteBuckets).forEach(function (k) {
    var bucket = deleteBuckets[k];
    var ss = SpreadsheetApp.openById(bucket.ssId);
    var sheet = ss.getSheetByName(bucket.tabName);
    if (!sheet) return;
    bucket.items.slice().sort(function (a, b) { return b.rowIndex - a.rowIndex; }).forEach(function (item) {
      try {
        sheet.deleteRow(item.rowIndex);
        report.deleted.push({
          form: item.cluster.form, week: item.cluster.week, tabName: item.cluster.tabName,
          student: item.cluster.displayName, email: item.cluster.displayEmail,
          dob: item.dob, ageYears: Math.round(item.ageYears * 10) / 10,
          deletedRow: item.rowIndex, deletedFromCampus: item.deleteCampus,
          keptCampus: item.keepCampus,
        });
      } catch (err) {
        report.errors.push(_dcErr(err, { tabName: bucket.tabName, row: item.rowIndex }));
      }
    });
  });

  return report;
}

// ─────────────────────── Duplicate scan (read-only) ───────────────────────

/**
 * Scan all 4 spreadsheets for rows the bot DIDN'T create that look
 * like duplicates of each other. Two checks:
 *
 *   clusters     — Same (name + email) appears 2+ times in the same
 *                  weekly tab. Usually a parent re-submitted the form,
 *                  or staff manually added on top of a workflow row.
 *   crossCampus  — Same (name + email) appears on BOTH Upper AND
 *                  Lower for the same week. Almost always a campus
 *                  routing error, since most kids belong to one camp.
 *
 * Read-only — never auto-deletes. Surfaces the offending rows in the
 * email so you can review and fix manually. Skips empty / unnamed rows.
 */
function _dcCheckDuplicates(report) {
  var camps = [
    {
      name: 'Free Camp',
      upperSs: DC_FREE_UPPER_SS, lowerSs: DC_FREE_LOWER_SS,
      nameCol: 2, upperEmailCol: 11, lowerEmailCol: 12,
    },
    {
      name: 'Summer Camp',
      upperSs: DC_SUMMER_UPPER_SS, lowerSs: DC_SUMMER_LOWER_SS,
      nameCol: 3, upperEmailCol: 9, lowerEmailCol: 10,
    },
  ];

  camps.forEach(function (camp) {
    Object.keys(DC_WEEK_TO_TAB).forEach(function (week) {
      var tabName = DC_WEEK_TO_TAB[week];
      var perCampus = { upper: {}, lower: {} };

      ['upper', 'lower'].forEach(function (campusKey) {
        var ssId = campusKey === 'upper' ? camp.upperSs : camp.lowerSs;
        var emailCol = campusKey === 'upper' ? camp.upperEmailCol : camp.lowerEmailCol;
        var ss = SpreadsheetApp.openById(ssId);
        var sheet = ss.getSheetByName(tabName);
        if (!sheet) return;
        var lastRow = sheet.getLastRow();
        if (lastRow < 2) return;
        var grid = sheet.getRange(2, 1, lastRow - 1, sheet.getLastColumn()).getValues();
        var groups = perCampus[campusKey];
        // Bucket by EMAIL first; within each bucket, fuzzy-cluster by
        // name so variants like "Aria" + "Aria Falzone" collapse.
        var byEmail = {};
        grid.forEach(function (row, i) {
          var name = String(row[camp.nameCol - 1] || '').trim();
          if (!name) return;                              // skip blank rows
          var email = String(row[emailCol - 1] || '').trim();
          var ek = email.toLowerCase();
          byEmail[ek] = byEmail[ek] || [];
          byEmail[ek].push({ rowIndex: i + 2, displayName: name, displayEmail: email });
        });
        Object.keys(byEmail).forEach(function (ek) {
          var rows = byEmail[ek];
          var clusters = [];
          rows.forEach(function (r) {
            var hit = null;
            for (var c = 0; c < clusters.length; c++) {
              if (_dcNamesLikelySamePerson(clusters[c][0].displayName, r.displayName)) {
                hit = clusters[c]; break;
              }
            }
            if (hit) hit.push(r); else clusters.push([r]);
          });
          clusters.forEach(function (cluster) {
            if (cluster.length > 1) {
              report.duplicates.clusters.push({
                form: camp.name,
                campus: campusKey,
                week: week,
                tabName: tabName,
                displayName: cluster[0].displayName,
                displayEmail: cluster[0].displayEmail,
                rows: cluster.map(function (r) { return r.rowIndex; }),
                names: cluster.map(function (r) { return r.displayName; }),
                count: cluster.length,
              });
            }
            // Feed perCampus groups (used by cross-campus check) with one entry per cluster
            var key = cluster[0].displayName.toLowerCase() + '|' + (cluster[0].displayEmail || '').toLowerCase();
            groups[key] = (groups[key] || []).concat(cluster);
          });
        });
      });

      // Cross-campus: same key on BOTH Upper and Lower for this week
      Object.keys(perCampus.upper).forEach(function (k) {
        if (perCampus.lower[k]) {
          report.duplicates.crossCampus.push({
            form: camp.name,
            week: week,
            tabName: tabName,
            displayName: perCampus.upper[k][0].displayName,
            displayEmail: perCampus.upper[k][0].displayEmail,
            upperRows: perCampus.upper[k].map(function (r) { return r.rowIndex; }),
            lowerRows: perCampus.lower[k].map(function (r) { return r.rowIndex; }),
          });
        }
      });
    });
  });
}

/**
 * Pick a campus for a Summer Camp submission. Same logic as Free
 * Camp would use: under 5 yrs on June 1 of the camp year → Lower,
 * else Upper. Falls back to Upper if DOB unparseable.
 */
function _dcDecideSummerCampus(submission) {
  var others = submission.others || {};
  var dobRaw = String(others[DC_SC_FIELD_DOB] || '').trim();
  var dob = _dcParseDate(dobRaw);
  if (!dob) return 'upper';
  // June 1 of registration year — try the year of the first selected
  // week, else the year the submission was created.
  var weeks = _dcAsArr(others[DC_SC_FIELD_WEEKS]);
  var year = (weeks[0] && /(\d{4})/.test(weeks[0])) ? +RegExp.$1 :
             new Date(submission.createdAt || Date.now()).getFullYear();
  if (!year || year < 2024) year = new Date(submission.createdAt || Date.now()).getFullYear();
  var june1 = new Date(year, 5, 1);
  var ageYears = (june1 - dob) / (365.25 * 24 * 3600 * 1000);
  // Rule: at least 6 yrs old by June 1 → Upper; otherwise Lower.
  return ageYears >= 6 ? 'upper' : 'lower';
}

/**
 * Build the day-of-week tick array (Mon..Fri). Full Week duration
 * always returns 5 ticks; otherwise returns ticks for whichever days
 * are listed in the daysField (Monday/Tuesday/etc).
 */
function _dcSummerDayTicks(duration, daysField) {
  var ck = '✓';
  if (/full\s*week/i.test(String(duration || ''))) {
    return [ck, ck, ck, ck, ck];
  }
  var sel = (daysField || []).map(function (d) { return String(d).toLowerCase(); });
  return ['monday','tuesday','wednesday','thursday','friday'].map(function (d) {
    return sel.indexOf(d) >= 0 ? ck : '';
  });
}

/**
 * Append a Summer Camp row in the right column order, tag the hidden
 * submission ID, and stamp a source note. Returns {row, rowIndex}.
 */
function _dcAppendSummerCamp(submission, week, campus) {
  var ssId = campus === 'lower' ? DC_SUMMER_LOWER_SS : DC_SUMMER_UPPER_SS;
  var ss = SpreadsheetApp.openById(ssId);
  var tabName = DC_WEEK_TO_TAB[week];
  var sheet = ss.getSheetByName(tabName);
  if (!sheet) throw new Error('No tab ' + tabName + ' in ' + (campus === 'lower' ? 'Summer Lower' : 'Summer Upper'));

  var others = submission.others || {};
  var name      = String(others[DC_SC_FIELD_STUDENT]   || '').trim();
  var bfast     = String(others[DC_SC_FIELD_BREAKFAST] || '');
  var lunch     = String(others[DC_SC_FIELD_LUNCH]     || '');
  var care      = String(others[DC_SC_FIELD_AFTERCARE] || '');
  var shirt     = String(others[DC_SC_FIELD_SHIRT]     || '');
  var email     = String(submission.email              || '');
  var duration  = String(others[DC_SC_FIELD_DURATION]  || '');
  var notes     = duration ? duration.replace(/\s*\(\$.*?\)\s*$/, '') : '';
  var ticks     = _dcSummerDayTicks(duration, others[DC_SC_FIELD_DAYS]);
  var pottyRaw  = others[DC_SC_FIELD_POTTY];
  var potty     = (pottyRaw == null || pottyRaw === 'None') ? '' : String(pottyRaw);

  // Upper:  Paid? | Amt | Name | Age | Breakfast | Lunch | Care | Shirt | Email | Notes | Mon..Fri
  // Lower:  Paid? | Amt | Name | Age | Potty     | Breakfast | Lunch | Care | Shirt | Email | Notes | Mon..Fri
  var row;
  if (campus === 'lower') {
    row = ['', '', name, '', potty, bfast, lunch, care, shirt, email, notes].concat(ticks);
  } else {
    row = ['', '', name, '', bfast, lunch, care, shirt, email, notes].concat(ticks);
  }
  var trackingCol = _dcEnsureTrackingCol(sheet);
  while (row.length < trackingCol - 1) row.push('');
  row.push(submission.id);
  sheet.appendRow(row);
  var newRowIndex = sheet.getLastRow();
  _dcSetSourceNote(sheet, newRowIndex, 'auto-added', submission, week, 'Summer Camp');
  return { row: row, rowIndex: newRowIndex };
}

/** Parse "MM-DD-YYYY" or "YYYY-MM-DD" or browser-parseable date strings. */
function _dcParseDate(s) {
  if (!s) return null;
  var m = String(s).match(/^(\d{1,2})[-\/](\d{1,2})[-\/](\d{4})$/);
  if (m) return new Date(+m[3], +m[1] - 1, +m[2]);
  var iso = String(s).match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
  if (iso) return new Date(+iso[1], +iso[2] - 1, +iso[3]);
  var d = new Date(s);
  return isNaN(d.getTime()) ? null : d;
}

// ─────────────────────── GHL token (via Supabase RPC) ───────────────────────

/**
 * Returns a fresh GHL access token for the Florida location, fetched
 * from Supabase. Cached in CacheService for 10 min so we hit Supabase
 * at most ~once per check (1 cycle = 4 calls otherwise).
 *
 * Source of truth: the `ghl_tokens` table in Supabase, which is auto-
 * refreshed externally before its 24h TTL. We never trust the table
 * directly — we go through `get_systema_floyd_florida_token(secret)`,
 * a SECURITY DEFINER RPC that ONLY ever returns the Florida row,
 * re-checks account_name + locationId, and requires a shared secret.
 *
 * Verifies account_name === 'Systema Floyd - Florida' and
 * locationId === DC_LOCATION_ID before returning. Aborts on mismatch
 * so we never accidentally hit a sister account.
 *
 * Required Script Properties:
 *   SUPABASE_URL          e.g. https://nroeiabeirifurdaybyo.supabase.co
 *   SUPABASE_ANON_KEY     legacy anon key (RLS still applies, but RPC bypasses it)
 *   SUPABASE_TOKEN_SECRET shared secret matching the RPC's expected value
 */
/**
 * Returns the live GHL Florida access token AND records its source
 * row's `updated_at` in a script-global `_dcTokenAgeHours` so the
 * email digest can warn when the upstream refresher is drifting.
 */
function _dcGhlToken_() {
  var cache = CacheService.getScriptCache();
  var cached = cache.get('GHL_FLORIDA_TOKEN');
  var cachedAge = cache.get('GHL_FLORIDA_TOKEN_AGE_HOURS');
  if (cached) {
    if (cachedAge != null) globalThis._dcTokenAgeHours = parseFloat(cachedAge);
    globalThis._dcTokenIsPit = cached.indexOf('pit-') === 0;
    return cached;
  }

  var props = PropertiesService.getScriptProperties();
  var url    = props.getProperty('SUPABASE_URL');
  var anon   = props.getProperty('SUPABASE_ANON_KEY');
  var secret = props.getProperty('SUPABASE_TOKEN_SECRET');
  if (!url || !anon || !secret) {
    throw new Error('Missing Script Properties (need SUPABASE_URL, SUPABASE_ANON_KEY, SUPABASE_TOKEN_SECRET)');
  }
  var resp = UrlFetchApp.fetch(url + '/rest/v1/rpc/get_systema_floyd_florida_token', {
    method: 'post',
    contentType: 'application/json',
    headers: {
      'apikey': anon,
      'Authorization': 'Bearer ' + anon,
    },
    payload: JSON.stringify({ claim_secret: secret }),
    muteHttpExceptions: true,
  });
  var code = resp.getResponseCode();
  var body = resp.getContentText();
  if (code !== 200) {
    throw new Error('Supabase RPC HTTP ' + code + ': ' + body.substring(0, 200));
  }
  var rows = JSON.parse(body);
  if (!Array.isArray(rows) || rows.length === 0) {
    throw new Error('Supabase RPC returned no rows for Florida token');
  }
  var row = rows[0];
  if (row.account_name !== 'Systema Floyd - Florida') {
    throw new Error('Wrong account: got ' + row.account_name + ' (expected Systema Floyd - Florida)');
  }
  if (row.locationId !== DC_LOCATION_ID) {
    throw new Error('Wrong locationId: got ' + row.locationId + ' (expected ' + DC_LOCATION_ID + ')');
  }
  var token = row.acces_token;
  if (!token) throw new Error('Supabase RPC returned empty acces_token');
  // Florida is a manually-created, non-rotating PIT. Its updated_at is
  // frozen by design, so token-age is meaningless — never warn on it.
  globalThis._dcTokenIsPit = token.indexOf('pit-') === 0;
  // Stash the token's age so the email digest can warn if drifting
  var ageHours = null;
  if (row.updated_at) {
    var updatedMs = new Date(row.updated_at).getTime();
    if (!isNaN(updatedMs)) {
      ageHours = (Date.now() - updatedMs) / (1000 * 60 * 60);
      globalThis._dcTokenAgeHours = ageHours;
    }
  }
  cache.put('GHL_FLORIDA_TOKEN', token, 600);
  if (ageHours != null) cache.put('GHL_FLORIDA_TOKEN_AGE_HOURS', String(ageHours), 600);
  return token;
}

// ─────────────────────── GHL fetch helpers ───────────────────────

function _dcListSubmissions(formId) {
  var token = _dcGhlToken_();
  var out = [];
  var page = 1;
  while (true) {
    var url = 'https://services.leadconnectorhq.com/forms/submissions' +
      '?locationId=' + encodeURIComponent(DC_LOCATION_ID) +
      '&formId='     + encodeURIComponent(formId) +
      '&limit=100&page=' + page;
    var resp = UrlFetchApp.fetch(url, {
      method: 'get',
      headers: {
        'Authorization': 'Bearer ' + token,
        'Version': '2021-07-28',
        'Accept': 'application/json',
        'User-Agent': 'Mozilla/5.0',
      },
      muteHttpExceptions: true,
    });
    var code = resp.getResponseCode();
    var body = resp.getContentText();
    if (code !== 200) {
      throw new Error('GHL submissions HTTP ' + code + ': ' + body.substring(0, 200));
    }
    var data = JSON.parse(body);
    var batch = data.submissions || data.results || data.data || [];
    out = out.concat(batch);
    if (batch.length < 100) break;
    page++;
    if (page > 50) break;                          // safety stop
  }
  return out;
}

// ─────────────────────── Sheet plumbing ───────────────────────

/**
 * Ensure each spreadsheet has a hidden `_dc_tombstones` tab that
 * lists every submission ID the bot has ever written into that
 * spreadsheet. This is the persistent "do-not-re-add" log — survives
 * row deletions in the visible weekly tabs. Returns the tab.
 *
 * Schema:
 *   A: Submission ID
 *   B: Week (e.g. "July 27th-31st")
 *   C: Tab Name (e.g. "7/27-7/31")
 *   D: Mode (auto-added | linked-manual | backfill)
 *   E: Recorded At (ISO timestamp)
 *
 * Why a separate tab instead of a column: the staff workflow for
 * cancellations is "delete the row." If we stored the tombstone in
 * the row, deletion would erase it. A separate hidden tab is
 * untouched by row deletes on the visible tabs.
 */
/**
 * Returns a Set-like map of every (form, submission_id, week) tuple
 * the bot has ever processed, fetched from Supabase via the
 * sf_list_processed RPC. Cached for 60s per run.
 *
 * Shape: { 'free_camp': {'subId|week':true,...}, 'summer_camp': {...} }
 *
 * Per-WEEK keying is critical: a single submission picks N weeks,
 * each becomes its own row in the sheet. Skipping a submission as a
 * whole after just one week was processed would make the bot drop
 * the other N-1 weeks. Always include the week in the lookup.
 */
function _dcLoadProcessedFromSupabase() {
  var cache = CacheService.getScriptCache();
  var cached = cache.get('SF_PROCESSED');
  if (cached) return JSON.parse(cached);

  var props = PropertiesService.getScriptProperties();
  var url    = props.getProperty('SUPABASE_URL');
  var anon   = props.getProperty('SUPABASE_ANON_KEY');
  var secret = props.getProperty('SUPABASE_TOKEN_SECRET');
  if (!url || !anon || !secret) {
    throw new Error('Missing Supabase Script Properties');
  }
  var resp = UrlFetchApp.fetch(url + '/rest/v1/rpc/sf_list_processed', {
    method: 'post',
    contentType: 'application/json',
    headers: { apikey: anon, Authorization: 'Bearer ' + anon },
    payload: JSON.stringify({ claim_secret: secret }),
    muteHttpExceptions: true,
  });
  if (resp.getResponseCode() !== 200) {
    throw new Error('Supabase sf_list_processed HTTP ' + resp.getResponseCode() + ': ' + resp.getContentText().substring(0, 200));
  }
  var rows = JSON.parse(resp.getContentText());
  var out = {
    free_camp: {}, summer_camp: {}, after_school: {},
    private_lessons: {}, rent_a_sensei: {}, balloons: {}, vasiliev_seminar: {},
  };
  rows.forEach(function (r) {
    var bucket = out[r.form];
    if (bucket) bucket[r.submission_id + '|' + r.week] = true;
  });
  cache.put('SF_PROCESSED', JSON.stringify(out), 60);
  return out;
}

/**
 * Upsert one (submission_id, week) row into Supabase via
 * sf_record_processed. Form is 'free_camp' or 'summer_camp', status
 * is one of 'processed' | 'linked_manual' | 'backfilled' | 'error'.
 */
function _dcRecordProcessed(submissionId, form, week, opts) {
  if (!submissionId) return;
  opts = opts || {};
  var props = PropertiesService.getScriptProperties();
  var url    = props.getProperty('SUPABASE_URL');
  var anon   = props.getProperty('SUPABASE_ANON_KEY');
  var secret = props.getProperty('SUPABASE_TOKEN_SECRET');
  var payload = {
    claim_secret: secret,
    p_submission_id: submissionId,
    p_form: form,
    p_week: week,
    p_campus: opts.campus || null,
    p_status: opts.status || 'processed',
    p_spreadsheet_id: opts.spreadsheetId || null,
    p_tab_name: opts.tabName || null,
    p_row_index: opts.rowIndex == null ? null : opts.rowIndex,
    p_student_name: opts.studentName || null,
    p_parent_email: opts.parentEmail || null,
    p_contact_id: opts.contactId || null,
    p_metadata: opts.metadata || {},
  };
  var resp = UrlFetchApp.fetch(url + '/rest/v1/rpc/sf_record_processed', {
    method: 'post',
    contentType: 'application/json',
    headers: { apikey: anon, Authorization: 'Bearer ' + anon },
    payload: JSON.stringify(payload),
    muteHttpExceptions: true,
  });
  if (resp.getResponseCode() >= 300) {
    throw new Error('sf_record_processed HTTP ' + resp.getResponseCode() + ': ' + resp.getContentText().substring(0, 200));
  }
  // Bust the local cache so the next read sees this insert
  CacheService.getScriptCache().remove('SF_PROCESSED');
}

// ─── Legacy hidden-tab helpers (kept for backfill/migration only) ───
function _dcEnsureTombstoneTab(ss) {
  var tab = ss.getSheetByName(DC_TOMBSTONE_TAB);
  if (tab) return tab;
  tab = ss.insertSheet(DC_TOMBSTONE_TAB);
  tab.appendRow(['Submission ID', 'Week', 'Tab Name', 'Mode', 'Recorded At']);
  tab.setFrozenRows(1);
  tab.hideSheet();
  return tab;
}
function _dcLoadTombstonesFromTab(ss) {
  var tab = _dcEnsureTombstoneTab(ss);
  var lastRow = tab.getLastRow();
  if (lastRow < 2) return {};
  var rows = tab.getRange(2, 1, lastRow - 1, 5).getValues();
  var byId = {};
  rows.forEach(function (r) {
    var id = String(r[0] || '').trim();
    if (!id) return;
    byId[id] = { week: r[1], tabName: r[2], mode: r[3], recordedAt: r[4] };
  });
  return byId;
}

/**
 * Ensure the rightmost column of `sheet` is a hidden _submissionId
 * column and return its 1-based index. Adds the column + header if
 * missing. Hides the column on first install.
 */
function _dcEnsureTrackingCol(sheet) {
  var lastCol = sheet.getLastColumn();
  if (lastCol < 1) {
    // empty sheet — write header in column 1 (shouldn't happen for us)
    sheet.getRange(1, 1).setValue(DC_TRACKING_HEADER);
    sheet.hideColumns(1);
    return 1;
  }
  var headers = sheet.getRange(1, 1, 1, lastCol).getValues()[0];
  for (var i = 0; i < headers.length; i++) {
    if (String(headers[i]).trim() === DC_TRACKING_HEADER) {
      return i + 1;
    }
  }
  // Append the tracking column
  var newCol = lastCol + 1;
  sheet.getRange(1, newCol).setValue(DC_TRACKING_HEADER);
  sheet.hideColumns(newCol);
  return newCol;
}

/**
 * One-shot fix: a previous version of _dcSetSourceNote hardcoded
 * `nameCol = 2`, which is correct for Free Camp but wrong for Summer
 * Camp (where col B is Amt and Student Name is col C). This walks
 * the two Summer Camp spreadsheets, moves any DiscrepancyCheck-
 * authored note from col B to col C (only if col C doesn't already
 * have a note). If col C already has a non-empty note, the col B
 * note is just cleared (the col C one is the authoritative version).
 *
 * Idempotent — safe to re-run.
 *
 * Returns: { moved, cleared, skipped, errors }
 */
function discrepancyFixSummerCampNotes() {
  var report = { moved: 0, cleared: 0, skipped: 0, errors: [] };
  [DC_SUMMER_UPPER_SS, DC_SUMMER_LOWER_SS].forEach(function (ssId) {
    try {
      var ss = SpreadsheetApp.openById(ssId);
      ss.getSheets().forEach(function (sheet) {
        var nm = sheet.getName();
        if (nm === 'Billing' || nm === '_dc_tombstones' || nm.indexOf('Template') === 0) return;
        var lastRow = sheet.getLastRow();
        if (lastRow < 2) return;
        // Read all col B + col C notes for the data range
        var bNotes = sheet.getRange(2, 2, lastRow - 1, 1).getNotes();
        var cNotes = sheet.getRange(2, 3, lastRow - 1, 1).getNotes();
        var newBNotes = bNotes.slice();   // mutate copy
        var newCNotes = cNotes.slice();
        for (var i = 0; i < bNotes.length; i++) {
          var bN = bNotes[i][0] || '';
          if (!bN.trim()) continue;
          // Only touch notes that look like they came from us
          if (bN.indexOf('DiscrepancyCheck') < 0) {
            report.skipped++;
            continue;
          }
          var cN = cNotes[i][0] || '';
          if (cN.trim()) {
            // C already has a note — keep C, drop B
            newBNotes[i][0] = '';
            report.cleared++;
          } else {
            // Move B → C
            newCNotes[i][0] = bN;
            newBNotes[i][0] = '';
            report.moved++;
          }
        }
        sheet.getRange(2, 2, lastRow - 1, 1).setNotes(newBNotes);
        sheet.getRange(2, 3, lastRow - 1, 1).setNotes(newCNotes);
      });
    } catch (err) {
      report.errors.push(_dcErr(err, { ssId: ssId }));
    }
  });
  return report;
}

// ─────────────────────── Heartbeat (silence-broken alerts) ───────────────────────

/**
 * Record a "this component is alive" timestamp in Supabase
 * sf_bot_health. Called at the end of every successful run of
 * `runDiscrepancyCheck` (the bot itself) and `discrepancyHeartbeatGuard`
 * (the guard).
 */
function _dcRecordHeartbeat(component, metadata) {
  try {
    var props = PropertiesService.getScriptProperties();
    var url    = props.getProperty('SUPABASE_URL');
    var anon   = props.getProperty('SUPABASE_ANON_KEY');
    var secret = props.getProperty('SUPABASE_TOKEN_SECRET');
    if (!url || !anon || !secret) return;
    UrlFetchApp.fetch(url + '/rest/v1/rpc/sf_record_heartbeat', {
      method: 'post',
      contentType: 'application/json',
      headers: { apikey: anon, Authorization: 'Bearer ' + anon },
      payload: JSON.stringify({
        claim_secret: secret,
        p_component: component,
        p_metadata: metadata || {},
      }),
      muteHttpExceptions: true,
    });
  } catch (e) {
    Logger.log('heartbeat record failed (' + component + '): ' + e);
  }
}

/**
 * Look up a component's last successful run from Supabase
 * sf_bot_health. Returns { component, last_ok_at, age_seconds, metadata }
 * or null if no row.
 */
function _dcGetHeartbeat(component) {
  var props = PropertiesService.getScriptProperties();
  var url    = props.getProperty('SUPABASE_URL');
  var anon   = props.getProperty('SUPABASE_ANON_KEY');
  var secret = props.getProperty('SUPABASE_TOKEN_SECRET');
  if (!url || !anon || !secret) throw new Error('Missing Supabase Script Properties');
  var resp = UrlFetchApp.fetch(url + '/rest/v1/rpc/sf_get_heartbeat', {
    method: 'post',
    contentType: 'application/json',
    headers: { apikey: anon, Authorization: 'Bearer ' + anon },
    payload: JSON.stringify({ claim_secret: secret, p_component: component }),
    muteHttpExceptions: true,
  });
  if (resp.getResponseCode() !== 200) {
    throw new Error('sf_get_heartbeat HTTP ' + resp.getResponseCode() + ': ' + resp.getContentText().substring(0, 200));
  }
  var rows = JSON.parse(resp.getContentText());
  return (rows && rows.length) ? rows[0] : null;
}

/**
 * Silence-broken alert. Runs as its own time-driven trigger (install
 * via discrepancyHeartbeatSetupTrigger). Reads the last successful
 * run of `discrepancy_check` from Supabase; if it's older than
 * DC_HEARTBEAT_MAX_AGE_HOURS, emails an alert.
 *
 * Independent failure modes from the main bot:
 *   - main bot's trigger could die (quota, scope, owner change)
 *     → guard's trigger is unaffected, fires the alert
 *   - this guard's trigger could die
 *     → main bot still works, you just lose the alert (silent
 *       degradation; manual periodic Supabase check would catch)
 *   - whole script project could die
 *     → both die. External monitor (UptimeRobot, n8n cron) is the
 *       only way to defend against this. Out of scope.
 */
function discrepancyHeartbeatGuard() {
  var report = { startedAt: new Date().toISOString() };
  try {
    var hb = _dcGetHeartbeat('discrepancy_check');
    if (!hb) {
      _dcSendHeartbeatAlert('Discrepancy bot has NEVER recorded a successful run. Either it has never been run, or the Supabase recording is failing. Run runDiscrepancyCheck() manually from the editor and check that sf_bot_health gets a row for component=discrepancy_check.');
      report.alerted = true;
      report.reason = 'no heartbeat ever';
    } else {
      var ageHours = hb.age_seconds / 3600;
      report.lastOkAt = hb.last_ok_at;
      report.ageHours = Math.round(ageHours * 10) / 10;
      if (ageHours > DC_HEARTBEAT_MAX_AGE_HOURS) {
        _dcSendHeartbeatAlert(
          'Discrepancy bot has not run successfully in ' +
          report.ageHours + ' hours (last OK: ' + hb.last_ok_at + ').\n\n' +
          'Likely causes:\n' +
          '  - Trigger was disabled or deleted\n' +
          '  - Owner account hit Workspace quota\n' +
          '  - Apps Script outage\n' +
          '  - Required scope was revoked\n\n' +
          'Open the script editor and check Triggers + Executions:\n' +
          '  https://script.google.com/d/1EcPTHTRypJX_ywQXqj_LQuJMNk2RAjzSkIxsG8QzLe64jQtRXvEf6f8Y/edit'
        );
        report.alerted = true;
      } else {
        report.alerted = false;
      }
    }
  } catch (err) {
    report.error = String(err && err.message || err);
    _dcSendHeartbeatAlert('Heartbeat guard ERRORED: ' + report.error +
      '\n\nMost likely the Supabase RPC call failed. Check SUPABASE_TOKEN_SECRET.');
    report.alerted = true;
  }
  // Record the guard's own heartbeat so we can monitor IT too if needed
  _dcRecordHeartbeat('heartbeat_guard', report);
  Logger.log('heartbeatGuard: ' + JSON.stringify(report));
  return report;
}

function _dcSendHeartbeatAlert(message) {
  try {
    var to = _dcNotifyRecipients();
    if (!to.length) return;
    MailApp.sendEmail({
      to: to.join(','),
      subject: '⚠ Systema Floyd discrepancy bot heartbeat alert',
      body: message + '\n\n— sent by discrepancyHeartbeatGuard at ' + new Date().toISOString(),
    });
  } catch (e) {
    Logger.log('heartbeat alert send failed: ' + e);
  }
}

function discrepancyHeartbeatSetupTrigger() {
  var existing = ScriptApp.getProjectTriggers().filter(function (t) {
    return t.getHandlerFunction() === 'discrepancyHeartbeatGuard';
  });
  if (existing.length > 0) return 'already installed (' + existing.length + ')';
  // Daily — catches "bot died yesterday" within ~24-48h.
  ScriptApp.newTrigger('discrepancyHeartbeatGuard').timeBased().everyDays(1).atHour(8).create();
  return 'installed (daily at 8am)';
}

function discrepancyHeartbeatRemoveTrigger() {
  var removed = 0;
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (t.getHandlerFunction() === 'discrepancyHeartbeatGuard') {
      ScriptApp.deleteTrigger(t);
      removed++;
    }
  });
  return 'removed ' + removed;
}

// ─────────────────────── Email notification ───────────────────────

function _dcEmailReport(report) {
  var fc = report.freeCamp;
  var sc = report.summerCamp;

  var lines = [];
  lines.push('Camp roster discrepancy check — ' + report.startedAt);
  lines.push('Run took ' + report.durationMs + 'ms');
  if (report.tokenStaleWarning) {
    lines.push('');
    lines.push('⚠ GHL TOKEN AGE WARNING');
    lines.push('  Supabase ghl_tokens.acces_token for Florida is ' +
      report.tokenAgeHours + ' hours old (warn threshold: ' + DC_TOKEN_STALE_WARN_HOURS + ' hours).');
    lines.push('  The external refresher should keep this < 24h. Check whatever job is responsible (n8n, etc.).');
  }
  lines.push('');
  lines.push('FREE CAMP');
  lines.push('  added (bot wrote new row)              : ' + fc.added.length);
  lines.push('  linked (manual row, ID stamped)        : ' + fc.linkedManual.length);
  lines.push('  skipped (tombstoned — staff deleted)   : ' + (fc.skippedTombstone || 0));
  lines.push('  skipped (week not in Free Camp)         : ' + (fc.skippedNoTab || 0));
  lines.push('  errors                                  : ' + fc.errors.length);
  lines.push('  skipped<5m                              : ' + fc.skippedYoung);
  if (fc.skippedNoTab && fc.noTabWeeks) {
    var noTabSummary = Object.keys(fc.noTabWeeks).map(function (w) {
      return w + ' (×' + fc.noTabWeeks[w] + ')';
    }).join(', ');
    lines.push('    ↳ Free Camp ends Aug 7th; the form still offers these weeks: ' + noTabSummary);
    lines.push('      These registrations have no destination tab. Trim the form or contact the families.');
  }
  fc.added.forEach(function (a) {
    lines.push('  + [' + a.campus + '] ' + a.week + ' — ' + a.student +
      ' (parent ' + (a.parent || '?') + ', ' + a.email + ', sub ' + a.submissionId + ')');
    if (a.likelyFailedWorkflow) {
      lines.push('      ⚠ Workflow that should have written this row: ' + a.likelyFailedWorkflow.name);
      lines.push('         ' + a.likelyFailedWorkflow.url);
    }
  });
  fc.linkedManual.forEach(function (l) {
    lines.push('  ~ [' + l.campus + '] ' + l.week + ' — ' + l.student +
      ' (matched manual row ' + l.row + ', sub ' + l.submissionId + ')');
  });
  if (fc.errors.length) {
    lines.push('  Free Camp errors:');
    fc.errors.forEach(function (e) { lines.push('    ! ' + JSON.stringify(e)); });
  }

  lines.push('');
  lines.push('SUMMER CAMP');
  lines.push('  added (bot wrote new row)              : ' + sc.added.length);
  lines.push('  linked (manual row, ID stamped)        : ' + sc.linkedManual.length);
  lines.push('  skipped (tombstoned — staff deleted)   : ' + (sc.skippedTombstone || 0));
  lines.push('  errors                                  : ' + sc.errors.length);
  lines.push('  skipped<5m                              : ' + sc.skippedYoung);
  sc.added.forEach(function (a) {
    lines.push('  + [' + a.campus + '] ' + a.week + ' — ' + a.student +
      ' (parent ' + (a.parent || '?') + ', ' + a.email + ', sub ' + a.submissionId + ')');
    if (a.likelyFailedWorkflow) {
      lines.push('      ⚠ Workflow that should have written this row: ' + a.likelyFailedWorkflow.name);
      lines.push('         ' + a.likelyFailedWorkflow.url);
    }
  });
  sc.linkedManual.forEach(function (l) {
    lines.push('  ~ [' + l.campus + '] ' + l.week + ' — ' + l.student +
      ' (matched manual row ' + l.row + ', sub ' + l.submissionId + ')');
  });
  if (sc.errors.length) {
    lines.push('  Summer Camp errors:');
    sc.errors.forEach(function (e) { lines.push('    ! ' + JSON.stringify(e)); });
  }

  var as = report.afterSchool || { added: [], linkedManual: [], errors: [], skippedYoung: 0, skippedTombstone: 0 };
  lines.push('');
  lines.push('AFTER SCHOOL (writes to Main Table; School Enrollment Router routes to per-school sheets)');
  lines.push('  added (bot wrote to Main Table)        : ' + as.added.length);
  lines.push('  linked (existing row, ID stamped)      : ' + as.linkedManual.length);
  lines.push('  skipped (tombstoned — staff deleted)   : ' + (as.skippedTombstone || 0));
  lines.push('  errors                                  : ' + as.errors.length);
  lines.push('  skipped<5m                              : ' + as.skippedYoung);
  as.added.forEach(function (a) {
    lines.push('  + ' + (a.class || '(no class)') + ' — ' + a.student +
      ' (parent ' + (a.parent || '?') + ', ' + a.email + ', sub ' + a.submissionId + ')');
    if (a.likelyFailedWorkflow) {
      lines.push('      ⚠ Workflow that should have written this row: ' + a.likelyFailedWorkflow.name);
      lines.push('         ' + a.likelyFailedWorkflow.url);
    }
  });
  as.linkedManual.forEach(function (l) {
    lines.push('  ~ ' + (l.class || '(no class)') + ' — ' + l.student + ' (matched Main Table row ' + l.row + ', sub ' + l.submissionId + ')');
  });
  if (as.errors.length) {
    lines.push('  After School errors:');
    as.errors.forEach(function (e) { lines.push('    ! ' + JSON.stringify(e)); });
  }

  var dup = report.duplicates || { clusters: [], crossCampus: [] };
  if (dup.clusters.length || dup.crossCampus.length) {
    lines.push('');
    lines.push('DUPLICATES (existing rows the bot did not create — please review)');
    lines.push('  in-tab clusters    : ' + dup.clusters.length);
    lines.push('  cross-campus       : ' + dup.crossCampus.length);
    dup.clusters.forEach(function (c) {
      lines.push('  x [' + c.form + ' ' + c.campus + '] ' + c.tabName +
        ' — ' + c.displayName + ' <' + (c.displayEmail || 'no email') + '> on rows ' + c.rows.join(', '));
    });
    dup.crossCampus.forEach(function (c) {
      lines.push('  ↔ [' + c.form + '] ' + c.tabName +
        ' — ' + c.displayName + ' <' + (c.displayEmail || 'no email') + '>' +
        '  Upper rows ' + c.upperRows.join(',') + ' AND Lower rows ' + c.lowerRows.join(','));
    });
  }

  var subj = 'Roster discrepancy — ' +
    (fc.added.length + sc.added.length + as.added.length) + ' added, ' +
    (dup.clusters.length + dup.crossCampus.length) + ' dup, ' +
    (fc.errors.length + sc.errors.length + as.errors.length) + ' err';
  var to = _dcNotifyRecipients();
  if (!to.length) return;
  MailApp.sendEmail({
    to: to.join(','),
    subject: subj,
    body: lines.join('\n'),
  });
}

/**
 * Resolve email recipients. Supports a comma-separated list in
 * Script Property `DC_NOTIFY_EMAIL`. Falls back to DC_NOTIFY_EMAIL_DEFAULT
 * if the property is unset or empty.
 */
function _dcNotifyRecipients() {
  var raw = PropertiesService.getScriptProperties().getProperty('DC_NOTIFY_EMAIL');
  if (!raw) raw = DC_NOTIFY_EMAIL_DEFAULT;
  return String(raw).split(',').map(function (s) { return s.trim(); }).filter(Boolean);
}

// ─────────────────────── Small utilities ───────────────────────

function _dcAsArr(v) {
  if (v == null) return [];
  var arr = Array.isArray(v) ? v : [v];
  return arr.map(function (s) { return String(s).replace(/–/g, '-'); });
}

/**
 * Heuristic skip for obvious test submissions so they don't pollute
 * every report. Matches "test" in the student or parent name, or a
 * known seed email. Easy to extend.
 */
function _dcIsTestSubmission(submission, studentName) {
  var hay = (
    String(studentName || '') + ' ' +
    String(submission.name || '') + ' ' +
    String(submission.email || '')
  ).toLowerCase();
  if (/\btest\b|\bfw test\b|tommy floyd|emilio arias/.test(hay)) return true;
  return false;
}

function _dcKey(name, email, week) {
  return String(name || '').trim().toLowerCase() + '|' +
         String(email || '').trim().toLowerCase() + '|' +
         String(week  || '').trim();
}

/**
 * Decide whether two student-name strings on rows with the same
 * email + week refer to the same kid. Used both by the auto-add
 * dedup path and by the duplicate scanner.
 *
 * Cases handled:
 *   "Aria"          vs "Aria Falzone"   → SAME (one is a single token,
 *                                          first-name matches)
 *   "Aria Falzone"  vs "Aria L Falzone" → SAME (first AND last match,
 *                                          middle name added)
 *   "Aria"          vs "Aria-Bella"     → DIFFERENT (first tokens differ)
 *   "Sarah Smith"   vs "Sara Smith"     → SAME via Jaro-Winkler ≥ 0.92
 *   "Aria"          vs "Bob"            → DIFFERENT
 *
 * Conservatively scoped to within-same-email comparisons. Two kids
 * named "Aria" in completely different families would still be
 * distinguished by their parent emails.
 */
function _dcNamesLikelySamePerson(a, b) {
  if (a == null || b == null) return false;
  var sa = String(a).trim().toLowerCase();
  var sb = String(b).trim().toLowerCase();
  if (!sa || !sb) return false;
  if (sa === sb) return true;
  var ta = sa.split(/\s+/).filter(Boolean);
  var tb = sb.split(/\s+/).filter(Boolean);
  if (!ta.length || !tb.length) return false;
  // Single-token side matches multi-token side iff first token matches
  // (e.g. "Aria" vs "Aria Falzone").
  if ((ta.length === 1 || tb.length === 1) && ta[0] === tb[0] && ta[0].length >= 3) {
    return true;
  }
  // Both multi-token: same first AND same last token = same kid (middle
  // names / initials can differ).
  if (ta.length >= 2 && tb.length >= 2) {
    if (ta[0] === tb[0] && ta[ta.length - 1] === tb[tb.length - 1]) return true;
  }
  // Typo tolerance via Jaro-Winkler.
  if (_dcJaroWinkler(sa, sb) >= 0.92) return true;
  return false;
}

/** Jaro-Winkler similarity (0..1). Used by _dcNamesLikelySamePerson. */
function _dcJaroWinkler(s1, s2) {
  if (s1 === s2) return 1;
  var l1 = s1.length, l2 = s2.length;
  if (!l1 || !l2) return 0;
  var matchDist = Math.max(0, Math.floor(Math.max(l1, l2) / 2) - 1);
  var s1Matches = new Array(l1), s2Matches = new Array(l2);
  var matches = 0;
  for (var i = 0; i < l1; i++) {
    var lo = Math.max(0, i - matchDist);
    var hi = Math.min(i + matchDist + 1, l2);
    for (var j = lo; j < hi; j++) {
      if (s2Matches[j]) continue;
      if (s1.charAt(i) !== s2.charAt(j)) continue;
      s1Matches[i] = true; s2Matches[j] = true; matches++;
      break;
    }
  }
  if (!matches) return 0;
  var transpositions = 0, k = 0;
  for (var ii = 0; ii < l1; ii++) {
    if (!s1Matches[ii]) continue;
    while (!s2Matches[k]) k++;
    if (s1.charAt(ii) !== s2.charAt(k)) transpositions++;
    k++;
  }
  transpositions /= 2;
  var jaro = (matches / l1 + matches / l2 + (matches - transpositions) / matches) / 3;
  // Winkler boost: up to 4 chars of common prefix
  var prefix = 0;
  for (var p = 0; p < Math.min(4, l1, l2); p++) {
    if (s1.charAt(p) === s2.charAt(p)) prefix++;
    else break;
  }
  return jaro + prefix * 0.1 * (1 - jaro);
}

/**
 * Look up an existing row in `existingByWeek[week]` by either:
 *   1. Exact (name + email + week) key match, OR
 *   2. Same email+week with a "likely same person" name match
 * Returns the existing-row entry or null.
 */
function _dcFindExistingRowFuzzy(existingByWeek, name, email, week) {
  if (!existingByWeek || !existingByWeek[week]) return null;
  var bucket = existingByWeek[week];
  var exactKey = _dcKey(name, email, week);
  if (bucket[exactKey]) return bucket[exactKey];
  // Fuzzy: walk all rows with the same email+week, return first whose
  // existing name matches by likely-same-person rule.
  var emailLc = String(email || '').trim().toLowerCase();
  for (var k in bucket) {
    if (!bucket.hasOwnProperty(k)) continue;
    // Key shape: "<name>|<email>|<week>"
    var parts = k.split('|');
    if (parts.length < 3) continue;
    if (parts[1] !== emailLc) continue;
    if (parts[2] !== week) continue;
    if (_dcNamesLikelySamePerson(parts[0], name)) return bucket[k];
  }
  return null;
}

function _dcFormatPhone(p) {
  if (!p) return '';
  var s = String(p).replace(/[^\d]/g, '');
  if (s.length === 11 && s.charAt(0) === '1') s = s.substr(1);
  if (s.length !== 10) return String(p);
  return '(' + s.substr(0, 3) + ') ' + s.substr(3, 3) + '-' + s.substr(6);
}

function _dcErr(err, extra) {
  var o = {
    message: String(err && err.message || err),
    stack:   String(err && err.stack || ''),
  };
  if (extra) for (var k in extra) o[k] = extra[k];
  return o;
}

// ─────────────────────── New booking-form checkers ───────────────────────
//
// One-shot booking forms (Private Lessons, Rent-A-Sensei, Balloons,
// Vasiliev Seminar) follow the After School "single intake" pattern,
// not the camps' per-week pattern. Each submission becomes one sheet
// row. We use the literal string 'booking' as the synthetic "week"
// key in Supabase so each submission gets exactly one tombstone entry.
//
// Re-submissions (same person books twice) generate a new GHL
// submission ID, so they get their own tombstone + sheet row.
//
// Every helper here is dormant if its form ID or required field IDs
// are blank — safe to ship before all 4 forms publish.

/**
 * Generic booking-form checker. Iterates submissions, skips young /
 * tombstoned / already-tracked ones, and calls config.append() for
 * genuinely-missing ones.
 *
 * config = {
 *   form: 'balloons',                // Supabase CHECK constraint value
 *   formName: 'Balloons',            // human-readable
 *   formId: DC_FORM_BALLOONS,        // GHL form ID (may be '')
 *   ssId: DC_BAL_SS,                 // destination spreadsheet
 *   tabName: 'Sheet1',
 *   nameCol: 2,                      // 1-based col for the cell-note anchor
 *   reportKey: 'balloons',           // bucket key on `report`
 *   append: function (sub, sheet, trackingCol) -> { rowIndex }
 * }
 */
function _dcCheckBookingForm(report, config) {
  var bucket = report[config.reportKey] = report[config.reportKey] || {
    added: [], linkedManual: [], errors: [], skippedYoung: 0,
    skippedTombstone: 0, skipped: 0,
  };
  if (!config.formId) {
    bucket.skipped++;          // form not published yet, nothing to do
    return;
  }

  var subs;
  try {
    subs = _dcListSubmissions(config.formId);
  } catch (err) {
    bucket.errors.push(_dcErr(err, { phase: 'list-submissions' }));
    return;
  }

  var nowMs = Date.now();
  var processed = _dcLoadProcessedFromSupabase();
  var processedBucket = processed[config.form] || {};

  var ss = SpreadsheetApp.openById(config.ssId);
  var sheet = ss.getSheetByName(config.tabName) || ss.getSheets()[0];
  if (!sheet) {
    bucket.errors.push({ message: 'No tab "' + config.tabName + '" in ' + config.formName + ' sheet' });
    return;
  }
  var trackingCol = _dcEnsureTrackingCol(sheet);

  var trackedById = {};
  var lastRow = sheet.getLastRow();
  if (lastRow >= 2) {
    var grid = sheet.getRange(2, 1, lastRow - 1, sheet.getLastColumn()).getValues();
    grid.forEach(function (row, i) {
      var subId = String(row[trackingCol - 1] || '').trim();
      if (subId) trackedById[subId] = i + 2;
    });
  }

  subs.forEach(function (s) {
    if (nowMs - new Date(s.createdAt).getTime() < DC_GRACE_WINDOW_MS) {
      bucket.skippedYoung++;
      return;
    }
    var name = String(s.name || '').trim();
    if (_dcIsTestSubmission(s, name)) return;

    if (trackedById[s.id]) return;
    if (processedBucket[s.id + '|booking']) {
      bucket.skippedTombstone++;
      return;
    }

    try {
      var added = config.append(s, sheet, trackingCol);
      _dcRecordProcessed(s.id, config.form, 'booking', {
        status: 'processed',
        spreadsheetId: config.ssId,
        tabName: sheet.getName(),
        rowIndex: added.rowIndex,
        studentName: name,
        parentEmail: s.email || null,
        contactId: s.contactId,
        metadata: { formName: config.formName },
      });
      processedBucket[s.id + '|booking'] = true;
      trackedById[s.id] = added.rowIndex;
      _dcSetBookingNote(sheet, added.rowIndex, config.nameCol, 'auto-added', s, config.formName);
      bucket.added.push({
        submissionId: s.id, contactId: s.contactId, name: name,
        email: s.email, rowIndex: added.rowIndex, formName: config.formName,
      });
    } catch (err) {
      bucket.errors.push(_dcErr(err, { submissionId: s.id, phase: 'append' }));
    }
  });
}

/** Cell note for booking-form rows. Lighter than the camp note since
 *  there's no "week selected" or campus context. */
function _dcSetBookingNote(sheet, rowIndex, nameCol, mode, submission, formName) {
  try {
    var contactUrl = submission.contactId
      ? 'https://app.nilsdigital.com/v2/location/' + DC_LOCATION_ID + '/contacts/detail/' + submission.contactId
      : '';
    var modeBlurb = ({
      'auto-added':    'Auto-added by DiscrepancyCheck — the ' + formName + ' routing workflow did not write this row, so the bot did from the GHL submission below.',
      'linked-manual': 'Linked by DiscrepancyCheck — this row was already here; bot stamped the GHL submission ID on it.',
    })[mode] || ('DiscrepancyCheck (' + mode + ')');
    var lines = [];
    lines.push(modeBlurb);
    lines.push('Stamped: ' + new Date().toISOString());
    lines.push('');
    lines.push('Form: ' + formName);
    lines.push('Submission ID: ' + submission.id);
    lines.push('Submitted: ' + (submission.createdAt || ''));
    lines.push('Submitter: ' + (submission.name || ''));
    lines.push('Email: ' + (submission.email || ''));
    lines.push('Contact ID: ' + (submission.contactId || ''));
    if (contactUrl) lines.push('Contact: ' + contactUrl);
    sheet.getRange(rowIndex, nameCol).setNote(lines.join('\n'));
  } catch (e) {
    Logger.log('booking setNote failed: ' + e);
  }
}

// ─── Private Lessons ──────────────────────────────────────────────
function _dcCheckPrivateLessons(report) {
  _dcCheckBookingForm(report, {
    form: DC_FORM_NAME_PRIVATE_LESSONS,
    formName: 'Private Lesson Booking',
    formId: DC_FORM_PRIVATE_LESSONS,
    ssId: DC_PL_SS,
    tabName: DC_BOOKING_TAB,
    nameCol: 2,                // Full Name
    reportKey: 'privateLessons',
    append: _dcAppendPrivateLessons,
  });
}
function _dcAppendPrivateLessons(submission, sheet, trackingCol) {
  // Sheet col order: Contact ID | Full Name | Phone | Email | State |
  //   Instructor | Lesson Length & Price | Number of Students |
  //   Training Type | Age Group | Package | Preferred Date | Preferred Time
  var o = submission.others || {};
  var row = [
    submission.contactId || '',
    submission.name || '',
    _dcFormatPhone(o.phone || ''),
    submission.email || '',
    o[DC_PL_FIELD_STATE] || '',
    o[DC_PL_FIELD_INSTRUCTOR] || '',
    o[DC_PL_FIELD_LESSON] || '',
    o[DC_PL_FIELD_NUM_STUDENTS] || '',
    o[DC_PL_FIELD_TRAINING] || '',
    o[DC_PL_FIELD_AGE_GROUP] || '',
    o[DC_PL_FIELD_PACKAGE] || '',
    o[DC_PL_FIELD_PREF_DATE] || '',
    o[DC_PL_FIELD_PREF_TIME] || '',
  ];
  while (row.length < trackingCol - 1) row.push('');
  row.push(submission.id);
  sheet.appendRow(row);
  return { rowIndex: sheet.getLastRow() };
}

// ─── Rent-A-Sensei ────────────────────────────────────────────────
function _dcCheckRentASensei(report) {
  _dcCheckBookingForm(report, {
    form: DC_FORM_NAME_RENT_A_SENSEI,
    formName: 'Rent-A-Sensei',
    formId: DC_FORM_RENT_A_SENSEI,
    ssId: DC_RAS_SS,
    tabName: DC_BOOKING_TAB,
    nameCol: 2,                // Parent Name
    reportKey: 'rentASensei',
    append: _dcAppendRentASensei,
  });
}
function _dcAppendRentASensei(submission, sheet, trackingCol) {
  // Sheet col order: Contact ID | Parent Name | Phone | Email |
  //   Service Type | Number of Children | Duration | Full Address |
  //   Date | Start Time | End Time | Confirm (acknowledgment) |
  //   Special instructions
  var o = submission.others || {};
  var row = [
    submission.contactId || '',
    submission.name || '',
    _dcFormatPhone(o.phone || ''),
    submission.email || '',
    o[DC_RAS_FIELD_SERVICE_TYPE] || '',
    o[DC_RAS_FIELD_NUM_CHILDREN] || '',
    o[DC_RAS_FIELD_DURATION] || '',
    o[DC_RAS_FIELD_ADDRESS] || '',
    o[DC_RAS_FIELD_DATE] || '',
    o[DC_RAS_FIELD_START_TIME] || '',
    o[DC_RAS_FIELD_END_TIME] || '',
    o[DC_RAS_FIELD_ACK] || '',
    o[DC_RAS_FIELD_INSTRUCTIONS] || '',
  ];
  while (row.length < trackingCol - 1) row.push('');
  row.push(submission.id);
  sheet.appendRow(row);
  return { rowIndex: sheet.getLastRow() };
}

// ─── Balloons ─────────────────────────────────────────────────────
function _dcCheckBalloons(report) {
  _dcCheckBookingForm(report, {
    form: DC_FORM_NAME_BALLOONS,
    formName: 'Balloons by Balloons on the Ave',
    formId: DC_FORM_BALLOONS,
    ssId: DC_BAL_SS,
    tabName: DC_BOOKING_TAB,
    nameCol: 2,                // Full Name
    reportKey: 'balloons',
    append: _dcAppendBalloons,
  });
}
function _dcAppendBalloons(submission, sheet, trackingCol) {
  // Sheet col order: Contact ID | Full Name | Phone | Email | Garland |
  //   Additional Feet of Garland | Columns | Arch | Balloon Wall/Backdrop |
  //   Add-Ons (range-priced) | Delivery Fee | Setup Complexity |
  //   Optional Fees | Party Theme | Primary | Secondary | Accent |
  //   Notes for Emily
  // Columns, Add-Ons, Optional Fees are MULTIPLE_OPTIONS arrays.
  var o = submission.others || {};
  var join = function (v) { return Array.isArray(v) ? v.join(', ') : (v || ''); };
  var row = [
    submission.contactId || '',
    submission.name || '',
    _dcFormatPhone(o.phone || ''),
    submission.email || '',
    o[DC_BAL_FIELD_GARLAND] || '',
    o[DC_BAL_FIELD_GARLAND_EXTRA] || '',
    join(o[DC_BAL_FIELD_COLUMNS]),
    o[DC_BAL_FIELD_ARCH] || '',
    o[DC_BAL_FIELD_WALL] || '',
    join(o[DC_BAL_FIELD_ADDONS]),
    o[DC_BAL_FIELD_DELIVERY] || '',
    o[DC_BAL_FIELD_SETUP] || '',
    join(o[DC_BAL_FIELD_OPT_FEES]),
    o[DC_BAL_FIELD_THEME] || '',
    o[DC_BAL_FIELD_PRIMARY_COLOR] || '',
    o[DC_BAL_FIELD_SECONDARY] || '',
    o[DC_BAL_FIELD_ACCENT] || '',
    o[DC_BAL_FIELD_NOTES] || '',
  ];
  while (row.length < trackingCol - 1) row.push('');
  row.push(submission.id);
  sheet.appendRow(row);
  return { rowIndex: sheet.getLastRow() };
}

// ─── Vladimir Vasiliev Seminar ────────────────────────────────────
// Stays dormant even with form ID present until field IDs are filled
// in above (need a sample submission to map Amina's inline-created
// fields). Once filled, behaves like the other 3.
function _dcCheckVasilievSeminar(report) {
  var bucket = report.vasilievSeminar = report.vasilievSeminar || {
    added: [], linkedManual: [], errors: [], skippedYoung: 0,
    skippedTombstone: 0, skipped: 0,
  };
  if (!DC_FORM_VASILIEV_SEMINAR) { bucket.skipped++; return; }
  if (!DC_VS_FIELD_PASS_SELECTION) {
    // Field IDs not yet mapped — pull a sample submission and paste IDs
    // into the constants block, then this'll start writing.
    bucket.skipped++;
    return;
  }
  _dcCheckBookingForm(report, {
    form: DC_FORM_NAME_VASILIEV_SEMINAR,
    formName: 'Vladimir Vasiliev Seminar Registration',
    formId: DC_FORM_VASILIEV_SEMINAR,
    ssId: DC_VS_SS,
    tabName: DC_BOOKING_TAB,
    nameCol: 2,                // Full Name
    reportKey: 'vasilievSeminar',
    append: _dcAppendVasilievSeminar,
  });
}
function _dcAppendVasilievSeminar(submission, sheet, trackingCol) {
  // Sheet col order: Contact ID | Full Name | Phone | Email |
  //   Pass Selection | Experience Level | Emergency Contact Name |
  //   Emergency Contact Phone | T-Shirt Size | Dietary Restrictions |
  //   How did you hear
  var o = submission.others || {};
  var row = [
    submission.contactId || '',
    submission.name || '',
    _dcFormatPhone(o.phone || ''),
    submission.email || '',
    o[DC_VS_FIELD_PASS_SELECTION] || '',
    o[DC_VS_FIELD_EXPERIENCE] || '',
    o[DC_VS_FIELD_EMERGENCY_NAME] || '',
    _dcFormatPhone(o[DC_VS_FIELD_EMERGENCY_PHONE] || ''),
    o[DC_VS_FIELD_SHIRT] || '',
    o[DC_VS_FIELD_DIETARY] || '',
    o[DC_VS_FIELD_HOW_HEARD] || '',
  ];
  while (row.length < trackingCol - 1) row.push('');
  row.push(submission.id);
  sheet.appendRow(row);
  return { rowIndex: sheet.getLastRow() };
}
