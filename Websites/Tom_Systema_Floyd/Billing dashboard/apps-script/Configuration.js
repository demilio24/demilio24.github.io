/** ─── Subaccount routing config ─────────────────────────────────
 *  Tokens are stored in Script Properties (Project Settings → Script
 *  Properties), NOT inlined in code. Use getTokenFor(subaccount).
 */
const SUBACCOUNTS = {
  Florida:  { locationId: '8IWtNFlmgJ8bif9DivHT', tokenKey: 'GHL_TOKEN_FLORIDA' },
  Georgia:  { locationId: 'ufcwXlTuemk8qbAZQPT6', tokenKey: 'GHL_TOKEN_GEORGIA' },
  Virginia: { locationId: '19PYgF6rAz20w4ZyLEGX', tokenKey: 'GHL_TOKEN_VIRGINIA' },
};
const DEFAULT_SUBACCOUNT = 'Florida';

const GHL_API_BASE = 'https://services.leadconnectorhq.com';
const GHL_API_VERSION = '2021-07-28';

/** ─── Pricing convention regexes ────────────────────────────────── */
const PRICE_REGEX = /\$(\d+(?:\.\d{1,2})?)(\/day|\/week)?/;
const DURATION_REGEX = /(\d+)\s+days?/i;

/** ─── Student name field IDs (in priority order) ───────────────── */
const STUDENT_NAME_FIELD_IDS = [
  'NzRxGhIZJ0RZclSGprrF',  // Student 1 - Name
  'yKxmNI57yrPozW0Zd3cA',  // Student 2 - Name
  'eyNFkL0qAZug3mMnQBvk',  // Student 3 - Name
  'nPhA81OMvPttlnwQtujH',  // Student 4 - Name
  'WitmrGYAPRw66ONJuRjQ',  // Summer Name (legacy)
  'rwAlfmxIbkk5k7nmgahu',  // Free Camp Name (legacy)
  'mCopCd8PHPPGBdo30zYK',  // After School Name (legacy)
];

/** ─── Sheet column constants ────────────────────────────────────── */
const SHEET_NAME = 'Dashboard';
const COL = {
  NAME_OR_DATE:             1,  // A — customer name / tx date
  EMAIL_OR_ITEM:            2,  // B — email / item label
  PHONE_OR_UNIT_PRICE:      3,  // C — phone / unit price display
  WAIVER_OR_DAYS:           4,  // D — waiver origin / days
  STUDENT_NAME_OR_WEEKS:    5,  // E — student names (customer row) / weeks (tx row)
  CONTACT_OR_TOTAL:         6,  // F — contact profile link (customer row) / total (tx row)
  BALANCE_OR_STATUS:        7,  // G — balance HYPERLINK (customer row) / status pill (tx row)
  // Convenience aliases
  BALANCE:  7,
  STATUS:   7,
  TOTAL:    6,
  BALANCE_OR_WEEKS:  5,  // legacy alias — kept so old callers referencing BALANCE_OR_WEEKS still compile

  // Invoicing (one-click GHL invoicing — see Invoicing.js).
  // Row-1 H/I/J are existing filter/action toggles and K-O are form-sheet
  // quick-link chips, so the hidden invoiceId is parked at col P to avoid
  // hiding a live toggle. H/I are written ONLY on customer header rows.
  INVOICE_CHECKBOX:  8,   // H — Invoice checkbox on customer header rows
  INVOICE_STATUS:    9,   // I — "Draft ✓ open in GHL" hyperlink on customer header rows
  ITEM_INVOICE_ID:  16,   // P — hidden: invoiceId stamp on item rows (idempotency)
};

/** ─── Read a token from Script Properties ──────────────────────── */
function getTokenFor(subaccountName) {
  const meta = SUBACCOUNTS[subaccountName];
  if (!meta) throw new Error('Unknown subaccount: ' + subaccountName);
  const token = PropertiesService.getScriptProperties().getProperty(meta.tokenKey);
  if (!token) throw new Error('Missing Script Property: ' + meta.tokenKey);
  return token;
}

/** ─── Smoke test for Stage 1 ────────────────────────────────────── */
function stage1SmokeTest() {
  const results = [];
  // 1. Verify all three tokens are accessible
  for (const sub of Object.keys(SUBACCOUNTS)) {
    try {
      const t = getTokenFor(sub);
      results.push('[OK] ' + sub + ' token loaded (' + t.substring(0, 10) + '...)');
    } catch (e) {
      results.push('[FAIL] ' + sub + ': ' + e.message);
    }
  }
  // 2. Verify the Dashboard sheet exists with the right header
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName(SHEET_NAME);
  if (!sheet) {
    results.push('[FAIL] Dashboard sheet not found');
  } else {
    const headers = sheet.getRange(1, 1, 1, 7).getValues()[0];
    const expected = ['Name', 'Email', 'Phone', 'Waiver Origin', 'Balance', '', ''];
    const match = headers.every((h, i) => h === expected[i]);
    results.push(match
      ? '[OK] Dashboard headers match'
      : '[FAIL] Headers mismatch: got ' + JSON.stringify(headers));
  }
  Logger.log(results.join('\n'));
  return results;
}
