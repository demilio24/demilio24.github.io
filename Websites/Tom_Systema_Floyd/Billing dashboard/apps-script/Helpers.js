/** ─── Helpers.gs ──────────────────────────────────────────────────
 *  Pure helper functions. No sheet writes. No side effects except
 *  ghlSearchContactByEmail which calls the GHL API.
 *  All helpers depend only on constants from Configuration.gs.
 */

// ─── parsePrice ──────────────────────────────────────────────────────
/**
 * Extract numeric price from a label string.
 * Uses PRICE_REGEX from Configuration.gs.
 * @param {string} value
 * @returns {number|null}
 */
function parsePrice(value) {
  if (typeof value !== 'string') return null;
  const m = PRICE_REGEX.exec(value);
  if (!m) return null;
  return Number(m[1]);
}

// ─── extractMultiplier ───────────────────────────────────────────────
/**
 * Returns "/day", "/week", or null.
 * @param {string} value
 * @returns {string|null}
 */
function extractMultiplier(value) {
  if (typeof value !== 'string') return null;
  const m = PRICE_REGEX.exec(value);
  if (!m || !m[2]) return null;
  return m[2];
}

// ─── stripPriceFromLabel ─────────────────────────────────────────────
/**
 * Remove the " ($N...)" suffix from a label string.
 * @param {string} label
 * @returns {string}
 */
function stripPriceFromLabel(label) {
  if (typeof label !== 'string') return String(label || '');
  return label.replace(/\s*\(\$[^)]+\)/, '').trim();
}

// ─── parseDurationDays ───────────────────────────────────────────────
/**
 * Walk an array of string values, find first DURATION_REGEX match,
 * return the integer N. Default 1 if no match.
 * @param {string[]} allValues
 * @returns {number}
 */
function parseDurationDays(allValues) {
  if (!Array.isArray(allValues)) return 1;
  for (const v of allValues) {
    if (typeof v !== 'string') continue;
    const m = DURATION_REGEX.exec(v);
    if (m) return parseInt(m[1], 10);
  }
  return 1;
}

// ─── resolveSubaccount ───────────────────────────────────────────────
/**
 * Map Waiver Origin → subaccount name. Case-insensitive.
 * Empty/null/unknown → DEFAULT_SUBACCOUNT.
 * @param {string|null} waiverOrigin
 * @returns {string}
 */
function resolveSubaccount(waiverOrigin) {
  if (!waiverOrigin) return DEFAULT_SUBACCOUNT;
  const lower = String(waiverOrigin).toLowerCase().trim();
  for (const key of Object.keys(SUBACCOUNTS)) {
    if (key.toLowerCase() === lower) return key;
  }
  return DEFAULT_SUBACCOUNT;
}

// ─── resolveKidName ──────────────────────────────────────────────────
/**
 * Return first non-empty student name from customFields array.
 * customFields: Array of {id: string, value: string}
 * @param {Array<{id:string,value:string}>} customFields
 * @returns {string}
 */
function resolveKidName(customFields) {
  if (!Array.isArray(customFields)) return '(unknown)';
  for (const fieldId of STUDENT_NAME_FIELD_IDS) {
    const field = customFields.find(f => f.id === fieldId);
    if (field && field.value && String(field.value).trim()) {
      return String(field.value).trim();
    }
  }
  return '(unknown)';
}

// ─── parseMultiSelectValue ──────────────────────────────────────────────
/**
 * Normalise GHL multi-select fields to an Array.
 * ONLY splits on commas that appear OUTSIDE balanced parens/brackets/braces.
 * This preserves labels like "Daily with fruit (banana, blueberry) $10/day".
 * @param {*} raw
 * @returns {string[]}
 */
function parseMultiSelectValue(raw) {
  if (raw === null || raw === undefined) return [];
  if (raw === '') return [];
  if (Array.isArray(raw)) return raw.map(String);
  if (typeof raw === 'string') {
    const trimmed = raw.trim();
    if (!trimmed) return [];
    // Try JSON array first
    if (trimmed.startsWith('[')) {
      try {
        const parsed = JSON.parse(trimmed);
        if (Array.isArray(parsed)) return parsed.map(String);
      } catch (e) {
        // fall through to depth-aware split
      }
    }
    // Depth-aware comma split: only split at top-level commas
    const result = [];
    let depth = 0;
    let current = '';
    for (const ch of trimmed) {
      if (ch === '(' || ch === '[' || ch === '{') depth++;
      else if (ch === ')' || ch === ']' || ch === '}') depth--;
      if (ch === ',' && depth === 0) {
        if (current.trim()) result.push(current.trim());
        current = '';
      } else {
        current += ch;
      }
    }
    if (current.trim()) result.push(current.trim());
    return result;
  }
  return [String(raw)];
}

// ─── ghlSearchContactByEmail ─────────────────────────────────────────
/**
 * Search GHL for a contact by email in the given subaccount.
 * Returns contact_id string or null.
 * @param {string} subaccountName  e.g. "Florida"
 * @param {string} email
 * @returns {string|null}
 */
function ghlSearchContactByEmail(subaccountName, email) {
  const meta = SUBACCOUNTS[subaccountName];
  const token = getTokenFor(subaccountName);
  const url = GHL_API_BASE + '/contacts/search';
  const body = {
    locationId: meta.locationId,
    query: email,
    pageLimit: 1
  };
  const resp = UrlFetchApp.fetch(url, {
    method: 'post',
    contentType: 'application/json',
    headers: {
      'Authorization': 'Bearer ' + token,
      'Version': GHL_API_VERSION,
      'Accept': 'application/json',
    },
    payload: JSON.stringify(body),
    muteHttpExceptions: true
  });
  if (resp.getResponseCode() !== 200) {
    Logger.log('ghlSearchContactByEmail error ' + resp.getResponseCode() + ': ' + resp.getContentText().substring(0, 200));
    return null;
  }
  try {
    const data = JSON.parse(resp.getContentText());
    const first = (data.contacts || [])[0];
    return first ? first.id : null;
  } catch (parseErr) {
    Logger.log('[ghlSearchContactByEmail] Response parse error: ' + parseErr.message + ' | raw: ' + resp.getContentText().substring(0, 200));
    return null;
  }
}

// ─── buildProfileUrl ─────────────────────────────────────────────────
/**
 * Build the GHL contact deep-link URL.
 * @param {string} locationId
 * @param {string} contactId
 * @returns {string}
 */
function buildProfileUrl(locationId, contactId) {
  return 'https://app.nilsdigital.com/v2/location/' + locationId + '/contacts/detail/' + contactId; // Fix #8: whitelabel domain
}

// ─── buildBalanceFormula ─────────────────────────────────────────────
/**
 * Return a HYPERLINK formula (or plain-text fallback) for the Balance cell.
 * @param {string|null} profileUrl   null → contact not found
 * @param {number}      firstTxRow   first data row (1-indexed) of this customer's tx block
 * @param {number}      lastTxRow    last  data row (1-indexed) of this customer's tx block
 * @param {string}      subaccount   used in fallback text
 * @returns {string}
 */
function buildBalanceFormula(profileUrl, firstTxRow, lastTxRow, subaccount) {
  if (firstTxRow > lastTxRow) {
    return 0; // numeric zero — currency format on col G renders as $0.00
  }
  // Balance = sum of owed - sum of refunded.
  //   owed     => customer owes us (positive contribution)
  //   refunded => we owe customer (negative contribution)
  //   paid / canceled => 0 contribution
  return '=SUMIFS(F' + firstTxRow + ':F' + lastTxRow +
         ',G' + firstTxRow + ':G' + lastTxRow + ',"owed")' +
         '-SUMIFS(F' + firstTxRow + ':F' + lastTxRow +
         ',G' + firstTxRow + ':G' + lastTxRow + ',"refunded")';
}

// ─── stage2HelperTests ───────────────────────────────────────────────
/**
 * Comprehensive test function for Stage 2 acceptance.
 * Logs [PASS] or [FAIL] for every assertion, plus one live API call.
 */
// ─── extractStudentNames ──────────────────────────────────────────────
/**
 * Extract and deduplicate student names from a submission's field list.
 * Looks for fields whose ID is in STUDENT_NAME_FIELD_IDS.
 * @param {Array<{id:string, value:string, name:string}>} normalizedFields
 *   as returned by extractSubmissionFields / extractSubmissionFieldsWithSelfHeal
 * @returns {string} comma-joined unique student names, or '' if none
 */
function extractStudentNames(normalizedFields) {
  if (!Array.isArray(normalizedFields)) return '';
  const names = [];
  for (const f of normalizedFields) {
    if (STUDENT_NAME_FIELD_IDS.includes(f.id)) {
      const val = String(f.value || '').trim();
      if (val) names.push(val);
    }
  }
  // Dedupe (a parent might fill two fields with the same child's name)
  return Array.from(new Set(names)).join(', ');
}

function stage2HelperTests() {
  const results = [];

  function assert(label, actual, expected) {
    const pass = JSON.stringify(actual) === JSON.stringify(expected);
    results.push((pass ? '[PASS]' : '[FAIL]') + ' ' + label +
      (pass ? '' : '  got=' + JSON.stringify(actual) + '  want=' + JSON.stringify(expected)));
  }

  // ── parsePrice ──────────────────────────────────────────────────
  assert('parsePrice pizza',    parsePrice('Pizza ($7.75/day)'),   7.75);
  assert('parsePrice tshirt',   parsePrice('T-shirt ($25)'),       25);
  assert('parsePrice no match', parsePrice('Cabin Group A'),       null);
  assert('parsePrice zero',     parsePrice('$0'),                  0);

  // ── extractMultiplier ───────────────────────────────────────────
  assert('extractMultiplier /day',  extractMultiplier('Pizza ($7.75/day)'),  '/day');
  assert('extractMultiplier /week', extractMultiplier('Camp ($285/week)'),   '/week');
  assert('extractMultiplier null1', extractMultiplier('T-shirt ($25)'),      null);
  assert('extractMultiplier null2', extractMultiplier('No price here'),      null);

  // ── stripPriceFromLabel ─────────────────────────────────────────
  assert('strip pizza',      stripPriceFromLabel('Pizza ($7.75/day)'),      'Pizza');
  assert('strip camp',       stripPriceFromLabel('Camp 3-day ($285/week)'), 'Camp 3-day');
  assert('strip tshirt',     stripPriceFromLabel('T-shirt — XL ($25)'),     'T-shirt — XL');
  assert('strip no price',   stripPriceFromLabel('No price field'),         'No price field');

  // ── parseDurationDays ───────────────────────────────────────────
  assert('duration 3 days',   parseDurationDays(['3 days ($285/week)', 'Pizza ($7.75/day)']), 3);
  assert('duration fallback', parseDurationDays(['Pizza ($7.75/day)']),                       1);
  assert('duration 1 day',    parseDurationDays(['1 day ($125/week)']),                       1);
  assert('duration no digit', parseDurationDays(['Full Week ($365/week)']),                   1);

  // ── resolveSubaccount ───────────────────────────────────────────
  assert('subaccount Florida',  resolveSubaccount('Florida'),  'Florida');
  assert('subaccount Georgia',  resolveSubaccount('Georgia'),  'Georgia');
  assert('subaccount VIRGINIA', resolveSubaccount('VIRGINIA'), 'Virginia');
  assert('subaccount empty',    resolveSubaccount(''),         'Florida');
  assert('subaccount null',     resolveSubaccount(null),       'Florida');
  assert('subaccount Texas',    resolveSubaccount('Texas'),    'Florida');

  // ── resolveKidName ──────────────────────────────────────────────
  const cf1 = [
    { id: 'NzRxGhIZJ0RZclSGprrF', value: 'Alice' },
    { id: 'yKxmNI57yrPozW0Zd3cA', value: 'Bob' }
  ];
  assert('kidName first match', resolveKidName(cf1), 'Alice');

  const cf2 = [
    { id: 'NzRxGhIZJ0RZclSGprrF', value: '' },
    { id: 'yKxmNI57yrPozW0Zd3cA', value: 'Bob' }
  ];
  assert('kidName skip empty', resolveKidName(cf2), 'Bob');

  const cf3 = [];
  assert('kidName unknown', resolveKidName(cf3), '(unknown)');

  // ── parseMultiSelectValue ───────────────────────────────────────
  assert('multisel json',    parseMultiSelectValue('["a","b"]'),  ['a', 'b']);
  assert('multisel csv',     parseMultiSelectValue('a, b'),       ['a', 'b']);
  assert('multisel single',  parseMultiSelectValue('a'),          ['a']);
  assert('multisel array',   parseMultiSelectValue(['a','b']),    ['a', 'b']);
  assert('multisel null',    parseMultiSelectValue(null),         []);
  assert('multisel empty',   parseMultiSelectValue(''),           []);

  // ── buildProfileUrl ─────────────────────────────────────────────
  const pUrl = buildProfileUrl('8IWtNFlmgJ8bif9DivHT', 'abc123');
  assert('buildProfileUrl', pUrl,
    'https://app.nilsdigital.com/v2/location/8IWtNFlmgJ8bif9DivHT/contacts/detail/abc123');

  // ── buildBalanceFormula ─────────────────────────────────────────
  const fUrl = 'https://app.nilsdigital.com/v2/location/LOC/contacts/detail/CID';
  assert('formula with url',
    buildBalanceFormula(fUrl, 3, 5, 'Florida'),
    '=HYPERLINK("' + fUrl + '","$" & TEXT(SUMIFS(F3:F5,G3:G5,"owed"),"0.00"))');

  assert('formula null url',
    buildBalanceFormula(null, 3, 5, 'Florida'),
    '(not found in Florida)');

  assert('formula no tx rows',
    buildBalanceFormula(fUrl, 6, 5, 'Florida'),
    '$0.00');

  // ── Live API test ────────────────────────────────────────────────
  results.push('--- Live API test ---');
  try {
    const contactId = ghlSearchContactByEmail('Florida', 'tomfloyd@example.com');
    results.push('[LIVE] ghlSearchContactByEmail("Florida","tomfloyd@example.com") => ' +
      (contactId !== null ? contactId : 'null (no match or not in CRM)'));
  } catch(e) {
    results.push('[LIVE-ERROR] ' + e.message);
  }

  Logger.log(results.join('\n'));
  return results;
}
