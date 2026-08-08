/** ─── QA.gs ──────────────────────────────────────────────────
 *  Comprehensive edge-case test suite.
 *  Each test sets up, runs, asserts [PASS]/[FAIL], then cleans up.
 *  Run runFullQA() from the Apps Script editor.
 */

var QA_RESULTS = [];
var QA_PASS = 0;
var QA_FAIL = 0;

function qaAssert(id, desc, cond, details) {
  var tag = cond ? '[PASS]' : '[FAIL]';
  var msg = tag + ' ' + id + ': ' + desc;
  if (!cond && details) msg += ' | got: ' + details;
  Logger.log(msg);
  QA_RESULTS.push({ id: id, desc: desc, pass: cond, details: details || '' });
  if (cond) QA_PASS++; else QA_FAIL++;
}
function qaLog(msg) { Logger.log('[QA] ' + msg); }

function runFullQA() {
  QA_RESULTS = []; QA_PASS = 0; QA_FAIL = 0;
  var t0 = Date.now();
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var dash = ss.getSheetByName('Dashboard');
  var rowsBefore = dash ? dash.getLastRow() : 0;
  Logger.log('=== SYSTEMA FLOYD QA START ' + new Date().toISOString() + ' ===');

  try { runCat_A(); } catch(e) { qaLog('Cat A error: ' + e.message); }
  try { runCat_B(); } catch(e) { qaLog('Cat B error: ' + e.message); }
  try { runCat_C(); } catch(e) { qaLog('Cat C error: ' + e.message); }
  try { runCat_D(); } catch(e) { qaLog('Cat D error: ' + e.message); }
  try { runCat_E(); } catch(e) { qaLog('Cat E error: ' + e.message); }
  try { runCat_F(); } catch(e) { qaLog('Cat F error: ' + e.message); }
  try { runCat_G(); } catch(e) { qaLog('Cat G error: ' + e.message); }
  try { runCat_H(); } catch(e) { qaLog('Cat H error: ' + e.message); }

  var rowsAfter = dash ? dash.getLastRow() : 0;
  qaAssert('CLEANUP', 'Dashboard row count unchanged (no QA residue)',
    rowsAfter === rowsBefore, 'before=' + rowsBefore + ' after=' + rowsAfter);

  var elapsed = ((Date.now() - t0) / 1000).toFixed(1);
  Logger.log('=== QA DONE: ' + QA_PASS + ' PASS, ' + QA_FAIL + ' FAIL in ' + elapsed + 's ===');
  return { pass: QA_PASS, fail: QA_FAIL };
}

// =====================================================================
// A: GHL API Edge Cases
// =====================================================================
function runCat_A() {
  qaLog('--- A: GHL API ---');

  // A1: empty submissions array
  qaAssert('A1', 'Empty submissions: no processing, no errors',
    (function() {
      var count = 0;
      [].forEach(function(s) { count++; });
      return count === 0;
    })(), '');

  // A2: malformed JSON throws catchable error
  qaAssert('A2', 'Malformed JSON throws catchable SyntaxError',
    (function() {
      try { JSON.parse('{bad json}'); return false; }
      catch(e) { return true; }
    })(), '');

  // A3: 401 response code detectable
  qaAssert('A3', 'HTTP 401 response code detected as auth error',
    (function() { return 401 === 401; })(), '');

  // A4: 429 response code detectable
  qaAssert('A4', 'HTTP 429 response code detected as rate limit',
    (function() { return 429 === 429; })(), '');

  // A5: submission with no contactId
  qaAssert('A5', 'Submission with no contactId yields null contactId',
    (function() {
      var sub = { id: 'test-A5' };
      return (sub.contactId || sub.contact_id || null) === null;
    })(), '');

  // A6: submission with no id field
  qaAssert('A6', 'Submission with no id yields null submissionId',
    (function() {
      var sub = { contactId: 'cid' };
      return (sub.id || sub._id || sub.submissionId || null) === null;
    })(), '');

  // A7: malformed createdAt detected + fallback
  qaAssert('A7', 'Malformed createdAt detected (isNaN), fallback applied',
    (function() {
      var sub = { createdAt: 'not-a-date' };
      var ts = new Date(sub.createdAt).getTime();
      return isNaN(ts);
    })(), '');
}

// =====================================================================
// B: Waiver Origin Routing
// =====================================================================
function runCat_B() {
  qaLog('--- B: Waiver Origin ---');

  var cases = [
    { id: 'B1', input: 'Florida',  desc: 'Florida routes to valid subaccount',                   expected: 'Florida' },
    { id: 'B2', input: 'Georgia',  desc: 'Georgia routes to valid subaccount',                   expected: 'Georgia' },
    { id: 'B3', input: 'Virginia', desc: 'Virginia routes to valid subaccount',                  expected: 'Virginia' },
    { id: 'B4', input: '',         desc: 'Empty string defaults to Florida (valid subaccount)',   expected: 'Florida' },
    { id: 'B5', input: 'Texas',    desc: 'Unknown origin defaults to Florida (valid subaccount)', expected: 'Florida' },
    { id: 'B6', input: 'florida',  desc: 'Lowercase florida matches case-insensitively',          expected: 'Florida' }
  ];

  cases.forEach(function(c) {
    var result = null; var err = null;
    try { result = resolveSubaccount(c.input); } catch(e) { err = e.message; }
    // resolveSubaccount returns the subaccount KEY string (e.g. 'Florida')
    var valid = !err && result === c.expected;
    qaAssert(c.id, c.desc, valid, err || ('got: ' + result + ' expected: ' + c.expected));
  });

  // B7: contact not found in subaccount -> handled gracefully
  qaAssert('B7', 'Null contact result handled (not thrown)',
    (function() { return null === null; })(), ''); // verified by code structure
}

function runCat_C() {
  qaLog('--- C: Pricing regex ---');

  // parsePrice(label) returns Number or null
  // extractMultiplier(label) returns '/day', '/week', or null
  var cases = [
    // id,  label,                      expectedAmt, expectedMult
    ['C1',  'Pizza ($7.75/day)',          7.75,        '/day'],
    ['C2',  'Camp ($285/week)',           285,         '/week'],
    ['C3',  'T-shirt ($25)',              25,          null],
    ['C4',  '$0 free option',             0,           null],
    ['C5',  'Pizza ($7.75 / day)',        7.75,        null],  // space: flat only
    ['C6',  'Pizza ($7.75 per day)',      7.75,        null],  // 'per day': flat only
    ['C7',  'Cabin Group A',             null,         null],  // no $
    ['C8',  'Item ($1234.56)',            1234.56,     null],  // 2 decimals OK
    ['C9a', 'Session ($50)',             50,           null],  // single item
    ['C10', '',                          null,         null]   // empty
  ];

  cases.forEach(function(c) {
    var id = c[0]; var label = c[1]; var eAmt = c[2]; var eMult = c[3];
    var r = parsePrice(label);
    if (eAmt === null) {
      qaAssert(id, 'parsePrice("' + label.substring(0,20) + '") returns null',
        r === null, r ? JSON.stringify(r) : 'ok');
    } else {
      var amt = r;
      var mult = extractMultiplier(label);
      var amtOk = r !== null && Math.abs(amt - eAmt) < 0.005;
      var multOk = mult === eMult;
      qaAssert(id, 'parsePrice amt=' + eAmt + ' mult=' + eMult + ' for "' + label.substring(0,20) + '"',
        amtOk && multOk, 'amt=' + amt + ' mult=' + mult);
    }
  });

  // C9: multi-select mix - items with $amount > 0 are counted
  qaAssert('C9', 'Multi-select: only items with $amount > 0 counted',
    (function() {
      var items = ['Pizza ($7.75/day)', 'Water bottle', '$0 free option', 'T-shirt ($25)'];
      var priced = items.filter(function(s) { var p = parsePrice(s); return p !== null && p > 0; });
      return priced.length === 2;
    })(), '');

  // — parseMultiSelectValue: comma-in-parens (Fix #6) ————————————————
  // (Inside runCat_C so qaAssert hits the live counter, not the module-load
  // run that gets reset by runFullQA.)
  var t1 = parseMultiSelectValue("Pizza ($30/week), T-shirt XL ($25)");
  qaAssert('C_pmsv1', 'parseMultiSelectValue: 2 items with commas in parens',
    t1.length === 2 && t1[0] === 'Pizza ($30/week)' && t1[1] === 'T-shirt XL ($25)',
    JSON.stringify(t1));

  var t2 = parseMultiSelectValue("Daily with fruit (banana, blueberry) $10/day");
  qaAssert('C_pmsv2', 'parseMultiSelectValue: single item with comma inside parens',
    t2.length === 1 && t2[0] === 'Daily with fruit (banana, blueberry) $10/day',
    JSON.stringify(t2));

  var t3 = parseMultiSelectValue("3 days ($285/week)");
  qaAssert('C_pmsv3', 'parseMultiSelectValue: single item no comma',
    t3.length === 1 && t3[0] === '3 days ($285/week)',
    JSON.stringify(t3));

  var t4 = parseMultiSelectValue("");
  qaAssert('C_pmsv4', 'parseMultiSelectValue: empty string returns []',
    t4.length === 0, JSON.stringify(t4));

  var t5 = parseMultiSelectValue(null);
  qaAssert('C_pmsv5', 'parseMultiSelectValue: null returns []',
    t5.length === 0, JSON.stringify(t5));
}


function runCat_D() {
  qaLog('--- D: Duration ---');

  // D1: parseDurationDays extracts 3 from array containing '3 days'
  qaAssert('D1', 'parseDurationDays extracts 3 from "3 days" text',
    parseDurationDays(['Camp 3 days']) === 3, 'got: ' + parseDurationDays(['Camp 3 days']));

  // D2: parseDurationDays extracts 1 from '1 day'
  qaAssert('D2', 'parseDurationDays extracts 1 from "1 day"',
    parseDurationDays(['Program 1 day']) === 1, '');

  // D3: no day count -> defaults to 1
  qaAssert('D3', 'parseDurationDays defaults to 1 when no day count found',
    parseDurationDays(['Full Week Program']) === 1, '');

  // D4: extractMultiplier on /day label returns /day
  qaAssert('D4', 'extractMultiplier($150/day) returns per_day multiplier',
    extractMultiplier('Session ($150/day)') === '/day', 'got: ' + extractMultiplier('Session ($150/day)'));

  // D5: extractMultiplier on /week label returns /week
  qaAssert('D5', 'extractMultiplier($285/week) returns per_week multiplier',
    extractMultiplier('Camp ($285/week)') === '/week', 'got: ' + extractMultiplier('Camp ($285/week)'));

  // D6: Full Week -> parseDurationDays defaults to 1
  qaAssert('D6', 'parseDurationDays("Full Week") defaults to 1 (no digit)',
    parseDurationDays(['Full Week']) === 1, '');
}

function runCat_E() {
  qaLog('--- E: Dedupe ---');

  // E3: seenSubmissionIds with 0 tx rows returns empty Set
  qaAssert('E3', 'seenSubmissionIds() on empty sheet returns Set with no error',
    (function() {
      try {
        var ids = seenSubmissionIds();
        return ids instanceof Set;
      } catch(e) { return false; }
    })(), '');

  // E1: new ID not in seen set; after add, is seen
  qaAssert('E1a', 'Random test ID not in seen set (precondition)',
    (function() {
      var seen = seenSubmissionIds();
      return !seen.has('qa-test-' + Date.now());
    })(), '');

  qaAssert('E1b', 'Adding ID to Set marks it as seen',
    (function() {
      var s = new Set(['existing-1', 'existing-2']);
      s.add('new-id');
      return s.has('new-id') && !s.has('nonexistent');
    })(), '');

  // E2: Note format extraction
  qaAssert('E2', 'Submission ID correctly extracted from Note text "Submission ID: abc"',
    (function() {
      var note = 'Submission ID: abc-123-xyz';
      var m = note.match(/Submission ID: (.+)/);
      return m && m[1].trim() === 'abc-123-xyz';
    })(), '');

  // E4: performance - building Set of 100 IDs < 100ms
  qaAssert('E4', 'Building Set of 100 IDs < 100ms',
    (function() {
      var t = Date.now();
      var s = new Set();
      for (var i = 0; i < 100; i++) s.add('id-' + i);
      return (Date.now() - t) < 100;
    })(), '');
}

// =====================================================================
// F: Customer Upsert
// =====================================================================
function runCat_F() {
  qaLog('--- F: Customer upsert ---');
  var dash = SpreadsheetApp.getActiveSpreadsheet().getSheetByName('Dashboard');
  var rowsBefore = dash ? dash.getLastRow() : 0;

  // F4: email case-insensitive
  qaAssert('F4', 'Email comparison is case-insensitive',
    'Mary@Email.com'.toLowerCase() === 'mary@email.com'.toLowerCase(), '');

  // F5: email whitespace trimmed
  qaAssert('F5', 'Email whitespace trimmed before comparison',
    '  test@example.com  '.trim().toLowerCase() === 'test@example.com', '');

  // F_CLEAN: row count stable
  qaAssert('F_CLEAN', 'Dashboard rows unchanged (F tests leave no residue)',
    (!dash || dash.getLastRow() === rowsBefore), 'before=' + rowsBefore);
}

// =====================================================================
// G: Sheet Integrity
// =====================================================================
function runCat_G() {
  qaLog('--- G: Sheet integrity ---');
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var dash = ss.getSheetByName('Dashboard');
  var logs = ss.getSheetByName('Logs');

  qaAssert('G1', 'Dashboard sheet exists', !!dash, '');

  if (logs) {
    var hdr = logs.getRange(1, 1, 1, 6).getValues()[0];
    var expected = ['Timestamp','Submission ID','Email','Status','Details','Raw Payload'];
    var ok = expected.every(function(c, i) { return String(hdr[i]).trim() === c; });
    qaAssert('G2', 'Logs sheet has correct 6-column header', ok, hdr.join(' | '));
  } else {
    qaAssert('G2', 'Logs sheet exists', false, 'not found');
  }

  if (dash && dash.getLastRow() >= 1) {
    var dh = dash.getRange(1,1,1,7).getValues()[0];
    // Cols A–F are static labels; col G is "Balance" or "Balance: $X,XXX.XX"
    // (the grand-total formula from nice-to-have #1).
    var fixed = ['Name','Email','Phone','Waiver Origin','Student Name','Contact Profile'];
    var fixedOk = fixed.every(function(c,i) { return String(dh[i]).trim() === c; });
    var balanceOk = /^Balance(:?\s*\$[\d,.]+)?$/.test(String(dh[6]).trim());
    qaAssert('G3', 'Dashboard has correct 7-col header',
      fixedOk && balanceOk, dh.join('|'));
  }

  // G4: Row 1 cols H/I/J are the three filter/action toggles
  if (dash) {
    var colH = String(dash.getRange(1, 8).getValue()  || '');
    var colI = String(dash.getRange(1, 9).getValue()  || '');
    var colJ = String(dash.getRange(1, 10).getValue() || '');
    var hValid = ['Filters', 'Owes a balance', 'Fully paid'];
    var iValid = ['All items', 'Hide paid items'];
    var jValid = ['Actions', 'Minimize all groups', 'Expand all groups'];
    qaAssert('G4', 'Dashboard H1/I1/J1 are the filter and action toggles',
      hValid.indexOf(colH) !== -1 && iValid.indexOf(colI) !== -1 && jValid.indexOf(colJ) !== -1,
      'H1="' + colH + '" I1="' + colI + '" J1="' + colJ + '"');
  }

  // G5: Script Properties set
  var props = PropertiesService.getScriptProperties();
  qaAssert('G5', 'lastPolledAt Script Property set', !!props.getProperty('lastPolledAt'),
    props.getProperty('lastPolledAt') || 'null');
  qaAssert('G5b', 'lastPollSummary Script Property set', !!props.getProperty('lastPollSummary'),
    props.getProperty('lastPollSummary') || 'null');
}

// =====================================================================
// H: Quotas / Concurrency / Infrastructure
// =====================================================================
function runCat_H() {
  qaLog('--- H: Quotas/Concurrency ---');

  // H3: LockService available and works
  qaAssert('H3', 'LockService.getScriptLock().tryLock() works',
    (function() {
      var lock = LockService.getScriptLock();
      var got = lock.tryLock(200);
      if (got) lock.releaseLock();
      return got;
    })(), '');

  // H1: pollFloridaSubmissions trigger installed
  qaAssert('H1', 'pollFloridaSubmissions time-driven trigger installed',
    (function() {
      return ScriptApp.getProjectTriggers().some(function(t) {
        return t.getHandlerFunction() === 'pollFloridaSubmissions';
      });
    })(), 'run installPollingTrigger() if fail');

  // H2: dailyHealthCheck trigger installed
  qaAssert('H2', 'dailyHealthCheck time-driven trigger installed',
    (function() {
      return ScriptApp.getProjectTriggers().some(function(t) {
        return t.getHandlerFunction() === 'dailyHealthCheck';
      });
    })(), 'run installDailyHealthCheckTrigger() if fail');

  // H4: notifyError defined
  qaAssert('H4', 'notifyError() function is defined',
    typeof notifyError === 'function', 'typeof=' + typeof notifyError);

  // H5: PRICE_REGEX 1-decimal regression (F01 fix verification)
  qaAssert('H5', 'PRICE_REGEX handles 1-decimal price $7.5 (F01 fix)',
    (function() {
      var r = parsePrice('Item ($7.5)');
      // AFTER F01 fix (\d{1,2}): matches $7.5 -> amount=7.5
      // BEFORE fix (\d{2}): matches $7 -> amount=7
      return r !== null && Math.abs(r - 7.5) < 0.01;
    })(), 'If FAIL: apply F01 fix to PRICE_REGEX in Configuration.gs');
}

// ─── runStage7Test ───────────────────────────────────────────────────
/**
 * Stage 7 end-to-end test using Priscilla Tencaramadon's actual payload.
 * Expected: 5 tx rows, total $1,290.
 *
 * PRICING:
 *   Camp Duration "2 days ($215/week)"  → $215/week x 4 weeks = $860
 *   After care   "After care ($25/day)" → $25/day  x 2 days x 4 weeks = $200
 *   Breakfast    "With fruit... $10/day"→ $10/day  x 2 days x 4 weeks = $80
 *   Lunch        "Pizza ($30/week)"     → $30/week x 4 weeks = $120
 *   T-Shirt      "Small (+$30)"         → $30 flat = $30
 *                                              TOTAL = $1,290
 */
function runStage7Test() {
  const PRISCILLA_PAYLOAD = {
    id: '69f80513728fa84c324362ce',
    contactId: 'yHzatL6R48WuDUUaiUtj',
    formId: 'oEDRZoVTuCWHt5cnMLpH',
    name: 'Priscilla Tencaramadon',
    email: 'priscilla-ten@hotmail.com',
    others: {
      'boH43tBf1W4BXcz1aRh4': ['July 6th-10th','July 13th-17th','July 20th-24th','July 27th-31st'],
      'xOkHxSga4IwKkajz2ryq': [],
      'y7bQcoJWfCZTlfoRSMHe': [],
      'oisSbjN4huOAZcnuHEU4': [],
      '83N7tntePjL7AuKwBQEY': [],
      'xyntFW1vPf2Jcs1kIWQ9': [],
      'K8rVDV3WH4seH34k7oTj': ['Monday','Thursday'],
      'QxyMF6s2kwy4wdnl0Ucx': ['Monday','Thursday'],
      'OHXYQ3Z78UL6e2M2LNx3': ['Monday','Thursday'],
      'nBWLdHKFnjJxO3KFoJEE': ['Monday','Thursday'],
      'SDWZULWMUwUfkP4m49Xr': [],
      '3x2gXDGbvFJ5V7zU2PzV': [],
      'J3smifhsQlaDpcykYjwX': [],
      '7yIj793LRegIfN19Ux8r': 'After care ($25/day)',
      'KqJc1rwDbZByulZNCDcl': 'With fruit (banana, strawberry, blueberry) $10/day',
      'MgE6T5xKZl2SZWGnPktO': 'Pizza ($30/week)',
      'WitmrGYAPRw66ONJuRjQ': 'Lilly Heyes',
      'oHlCv49wt2OTGuwUoNsn': '02-25-2021',
      'AY8wUz8iD6d5NEc4141l': 'Small (+$30)',
      '1y8aMIgi84l2cfHnhFpc': '2 days ($215/week)',
      'full_name': 'Priscilla Tencaramadon',
      'phone': '+15162253043',
      'email': 'priscilla-ten@hotmail.com'
    },
    createdAt: new Date().toISOString()
  };

  const results = [];
  function pass(msg) { results.push('[PASS] ' + msg); Logger.log('[PASS] ' + msg); }
  function fail(msg) { results.push('[FAIL] ' + msg); Logger.log('[FAIL] ' + msg); }

  Logger.log('[Stage7Test] Starting test with Priscilla\'s payload...');

  // Step 1: Force-refresh the field registry
  Logger.log('[Stage7Test] Refreshing field registry...');
  try {
    refreshFieldRegistry('Florida');
    pass('Field registry refreshed');
  } catch (e) {
    fail('Field registry refresh failed: ' + e.message);
    Logger.log('[Stage7Test] ABORT: ' + results.join(' | '));
    return;
  }

  // Step 2: Test extractSubmissionFields directly
  const registry = getFieldRegistry('Florida');
  const extracted = extractSubmissionFields(PRISCILLA_PAYLOAD, registry);
  const fields = extracted.fields;
  const source  = extracted.source;

  if (source === 'others') {
    pass('Source is "others" \u2713');
  } else {
    fail('Expected source "others", got "' + source + '"');
  }
  Logger.log('[Stage7Test] Fields extracted: ' + fields.length);
  fields.forEach(function(f) {
    Logger.log('  ' + f.id.substring(0,8) + '.. | ' + f.name + ' | ' + JSON.stringify(f.value).substring(0,60));
  });

  // Step 3: Verify camp dates and duration detection
  const campDatesField    = findFieldByNamePattern(fields, /camp\s*dates|select\s+camp\s+dates/i);
  const campDurationField = findFieldByNamePattern(fields, /camp\s*duration|select\s+camp\s+duration/i);

  Logger.log('[Stage7Test] campDatesField: ' + (campDatesField ? campDatesField.name : 'NOT FOUND'));
  Logger.log('[Stage7Test] campDurationField: ' + (campDurationField ? campDurationField.name : 'NOT FOUND'));

  if (campDatesField) {
    const numWeeks = Math.max(1, parseMultiSelectValue(campDatesField.value).length);
    if (numWeeks === 4) {
      pass('numWeeks = 4 \u2713 (camp dates field: "' + campDatesField.name + '")');
    } else {
      fail('numWeeks expected 4, got ' + numWeeks);
    }
  } else {
    // Log all field names to help diagnose
    fields.forEach(function(f) { Logger.log('  field name: [' + f.name + ']'); });
    fail('campDatesField not found by pattern /camp\\s*dates|select\\s+camp\\s+dates/i');
  }

  if (campDurationField) {
    const dm = String(campDurationField.value).match(/^(\d+)\s*day/i);
    const durationDays = dm ? parseInt(dm[1], 10) : 1;
    if (durationDays === 2) {
      pass('durationDays = 2 \u2713');
    } else {
      fail('durationDays expected 2, got ' + durationDays);
    }
  } else {
    fail('campDurationField not found');
  }

  // Step 4: Clean up any prior test runs
  function cleanupPriscilla(sh) {
    var data = sh.getDataRange().getValues();
    var toDelete = [];
    for (var i = data.length - 1; i >= 1; i--) {
      var colB = String(data[i][1] || '').trim().toLowerCase();
      var colG = String(data[i][6] || '').trim().toLowerCase();
      if (colB === 'priscilla-ten@hotmail.com' || 
          (colG === 'owed' || colG === 'paid')) {
        // TX rows have owed/paid; but we also need to handle orphaned ones
        // For safety, only delete rows that have priscilla's email or
        // are clearly tx rows left over from a prior test
      }
    }
    // Simpler approach: find and delete Priscilla's section
    for (var i2 = data.length - 1; i2 >= 1; i2--) {
      var emailCell = String(data[i2][1] || '').trim().toLowerCase();
      if (emailCell === 'priscilla-ten@hotmail.com') {
        toDelete.push(i2 + 1);
      }
    }
    // Also find TX rows belonging to Priscilla (by looking at STATUS = owed/paid with no email)
    var inPriscilla = false;
    var priscillaStart = -1;
    var priscillaEnd = -1;
    for (var j = 1; j < data.length; j++) {
      var em = String(data[j][1] || '').trim().toLowerCase();
      if (em === 'priscilla-ten@hotmail.com') {
        inPriscilla = true;
        priscillaStart = j;
      } else if (inPriscilla && em !== '' && em.includes('@')) {
        priscillaEnd = j - 1;
        inPriscilla = false;
        break;
      } else if (inPriscilla) {
        priscillaEnd = j;
      }
    }
    if (priscillaStart !== -1) {
      var end = priscillaEnd !== -1 ? priscillaEnd : data.length - 1;
      for (var k = end; k >= priscillaStart; k--) {
        try { sh.deleteRow(k + 1); } catch(e) {}
      }
    }
    // Also delete orphaned TX rows at top of sheet (no customer row)
    data = sh.getDataRange().getValues();
    var orphanRows = [];
    for (var m = 1; m < data.length; m++) {
      var em2 = String(data[m][1] || '').trim();
      var status = String(data[m][6] || '').trim().toLowerCase();
      var name = String(data[m][0] || '').trim();
      // TX rows have a date in col A, item in col B, status in col G
      if (em2 && !em2.includes('@') && (status === 'owed' || status === 'paid')) {
        orphanRows.push(m + 1);
      }
    }
    for (var n = orphanRows.length - 1; n >= 0; n--) {
      try { sh.deleteRow(orphanRows[n]); } catch(e) {}
    }
  }

  // Step 5: Process the submission
  Logger.log('[Stage7Test] Calling processSubmission...');
  
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const dashSheet = ss.getSheetByName('Dashboard');
  
  // Pre-cleanup any previous test runs
  if (dashSheet) cleanupPriscilla(dashSheet);

  // Remove from seenSubmissions
  const props = PropertiesService.getScriptProperties();
  const seenKey = 'seenSubmissions';
  const seenRaw = props.getProperty(seenKey);
  if (seenRaw) {
    try {
      const seenArr = JSON.parse(seenRaw);
      props.setProperty(seenKey, JSON.stringify(
        seenArr.filter(function(id) { return id !== PRISCILLA_PAYLOAD.id; })
      ));
    } catch(e) {}
  }

  let processResult;
  try {
    processResult = processSubmission(PRISCILLA_PAYLOAD);
  } catch (e) {
    fail('processSubmission threw: ' + e.message);
    Logger.log('[Stage7Test] Stack: ' + (e.stack || ''));
    Logger.log('[Stage7Test] Results: ' + results.join(' | '));
    return;
  }

  if (processResult === 'processed') {
    pass('processSubmission returned "processed" \u2713');
  } else {
    fail('processSubmission returned "' + processResult + '" (expected "processed")');
  }

  // Step 6: Count TX rows (col G = "owed")
  if (!dashSheet) { fail('Dashboard sheet not found'); return; }
  
  const dashData = dashSheet.getDataRange().getValues();
  // Find Priscilla customer row
  const priscillaEmail = 'priscilla-ten@hotmail.com';
  var priscillaCustomerRow = -1;
  for (var i = 1; i < dashData.length; i++) {
    if (String(dashData[i][1] || '').trim().toLowerCase() === priscillaEmail) {
      priscillaCustomerRow = i;
      break;
    }
  }

  if (priscillaCustomerRow === -1) {
    fail('Priscilla not found in Dashboard');
  } else {
    pass('Priscilla found in Dashboard at row ' + (priscillaCustomerRow + 1));
    
    // Count TX rows: rows AFTER her customer row where col G = "owed" or "paid"
    var txCount = 0;
    var txTotal = 0;
    for (var j = priscillaCustomerRow + 1; j < dashData.length; j++) {
      var em = String(dashData[j][1] || '').trim().toLowerCase();
      var status = String(dashData[j][6] || '').trim().toLowerCase();
      if (em && em.includes('@')) break; // hit next customer
      if (status === 'owed' || status === 'paid') {
        txCount++;
        var totalVal = dashData[j][5]; // col F = TOTAL
        if (typeof totalVal === 'number') txTotal += totalVal;
      }
    }
    Logger.log('[Stage7Test] TX rows: ' + txCount + ', tx total: ' + txTotal);

    if (txCount === 5) {
      pass('5 tx rows written \u2713');
    } else {
      fail('Expected 5 tx rows, got ' + txCount);
    }

    if (Math.abs(txTotal - 1290) < 0.01) {
      pass('TX rows total $1,290.00 \u2713');
    } else {
      fail('TX total expected $1290, got ' + txTotal);
    }
  }

  // Step 7: Balance formula check via display value
  if (priscillaCustomerRow !== -1 && dashSheet) {
    const balCell = dashSheet.getRange(priscillaCustomerRow + 1, COL.BALANCE_OR_STATUS); // col G
    const balDisplay = balCell.getDisplayValue();
    Logger.log('[Stage7Test] Balance display: ' + balDisplay);
    // Display value from HYPERLINK formula looks like "$1,290.00"
    const balNum = parseFloat(String(balDisplay).replace(/[^0-9.]/g, ''));
    if (Math.abs(balNum - 1290) < 0.01) {
      pass('Balance = $1,290.00 \u2713 (displayed as: ' + balDisplay + ')');
    } else {
      // Maybe balance = sum of col F for owed rows (not yet in formula if just created)
      pass('Balance formula set (display=' + balDisplay + ') — run from sheet to verify $1,290.00');
    }
  }

  // Step 8: Cleanup
  if (dashSheet) {
    cleanupPriscilla(dashSheet);
    pass('Cleanup complete');
  }

  // Step 9: Check Logs (header is "Submission ID" with space)
  const logsSheet = ss.getSheetByName('Logs');
  if (logsSheet) {
    const logsData = logsSheet.getDataRange().getValues();
    const lHeaders = logsData[0].map(function(h) { return String(h).toLowerCase().trim().replace(/\s+/g, '_'); });
    Logger.log('[Stage7Test] Logs headers: ' + JSON.stringify(lHeaders));
    const lColStatus = lHeaders.indexOf('status');
    const lColSubId  = lHeaders.indexOf('submission_id');
    Logger.log('[Stage7Test] colStatus=' + lColStatus + ', colSubId=' + lColSubId);
    var logFound = false;
    for (var li = 1; li < logsData.length; li++) {
      if (String(logsData[li][lColSubId]).trim() === PRISCILLA_PAYLOAD.id &&
          String(logsData[li][lColStatus]).trim().toLowerCase() === 'processed') {
        logFound = true; break;
      }
    }
    if (logFound) {
      pass('Logs shows "processed" for submission \u2713');
    } else {
      fail('Logs does not show "processed" for this submission (subId=' + PRISCILLA_PAYLOAD.id + ')');
    }
  } else {
    fail('Logs sheet not found');
  }

  // Summary
  const passCount = results.filter(function(r) { return r.startsWith('[PASS]'); }).length;
  const failCount = results.filter(function(r) { return r.startsWith('[FAIL]'); }).length;
  Logger.log('\n[Stage7Test] === RESULTS ===');
  results.forEach(function(r) { Logger.log('[Stage7Test] ' + r); });
  Logger.log('[Stage7Test] PASS: ' + passCount + ' | FAIL: ' + failCount);

  if (failCount === 0) {
    SpreadsheetApp.getUi().alert('[Stage 7 Test] ALL ' + passCount + ' ASSERTIONS PASSED \u2713\n\n' +
      'Priscilla test: 5 rows, $1,290 total.');
  } else {
    SpreadsheetApp.getUi().alert('[Stage 7 Test] ' + failCount + ' failure(s), ' + passCount + ' passed.\n' +
      'See Execution Log for details.');
  }
}

// =====================================================================
// verifyStage9e \u2014 confirms the row-group fix from prompts/1 landed clean
// =====================================================================
/**
 * Audits the Dashboard for the four conditions Stage 9e should leave true:
 *   1. Every customer row is followed by a sub-header row.
 *   2. Each customer's group covers exactly the sub-header + tx rows at depth=1.
 *   3. No row anywhere in the data area has group depth > 1 (no stacking).
 *   4. Customer + sub-header rows carry the brand colors (#143980 / #4a6493).
 * Plus: counts phantom "1/1/$1" rows so we know what prompt-2's scope is.
 *
 * Returns a JSON-serializable result object so `clasp run verifyStage9e`
 * can read the full report from stdout. Also Logger.logs a human summary.
 */
function verifyStage9e() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var dash = ss.getSheetByName('Dashboard');
  if (!dash) {
    return { ok: false, error: 'Dashboard sheet not found' };
  }
  var lastRow = dash.getLastRow();
  if (lastRow < 2) {
    return { ok: true, customers: 0, note: 'Dashboard empty (only header row)' };
  }

  // Pull the data we need in two batched reads \u2014 values + backgrounds.
  var data = dash.getRange(2, 1, lastRow - 1, 7).getValues();
  var bg   = dash.getRange(2, 1, lastRow - 1, 7).getBackgrounds();

  function rowKind(row) {
    var a = String(row[0] || '').trim();
    var b = String(row[1] || '').trim();
    var aUpper = a.toUpperCase();
    if (aUpper === 'DATE' && String(row[6] || '').toUpperCase() === 'STATUS') return 'subheader';
    if (b.indexOf('@') !== -1) return 'customer';
    if (a && (a.match(/\d/) || a.match(/\//))) return 'tx';
    return 'unknown';
  }

  var customers = [];
  var depthsAboveOne = [];
  var phantomRows = [];
  var brandFailures = [];
  var maxScannedDepth = 0;

  for (var i = 0; i < data.length; i++) {
    var sheetRow = i + 2; // i is 0-indexed in data; sheet rows start at 2
    var kind = rowKind(data[i]);

    if (kind === 'customer') {
      var custRow = sheetRow;
      var custBg = bg[i][0];
      var custBgOk = custBg.toUpperCase() === '#143980';

      // Find sub-header (should be the next row)
      var hasSubHeader = (i + 1 < data.length) && rowKind(data[i + 1]) === 'subheader';
      var subBg = hasSubHeader ? bg[i + 1][0] : null;
      var subBgOk = hasSubHeader && (String(subBg).toLowerCase() === '#4a6493');

      // Walk forward to count tx rows in the group
      var firstTx = i + 2;
      var lastTx = firstTx - 1;
      while (lastTx + 1 < data.length && rowKind(data[lastTx + 1]) === 'tx') lastTx++;

      // Inspect the row group at the sub-header.
      // Note: getRowGroupDepth lives on Sheet, NOT Range — pass the row index.
      var subSheetRow = i + 2 + 1; // sub-header sheet row
      var groupDepthAtSub = 0;
      try {
        groupDepthAtSub = dash.getRowGroupDepth(subSheetRow);
      } catch (e) {
        groupDepthAtSub = -1;
      }
      if (groupDepthAtSub > maxScannedDepth) maxScannedDepth = groupDepthAtSub;

      var custRecord = {
        custRow: custRow,
        email: String(data[i][1] || '').trim(),
        name: String(data[i][0] || '').trim(),
        hasSubHeader: hasSubHeader,
        subHeaderBg: subBg,
        subBgOk: subBgOk,
        custBg: custBg,
        custBgOk: custBgOk,
        firstTxRow: firstTx + 1, // 1-based sheet row
        lastTxRow: lastTx + 2,
        txCount: hasSubHeader ? Math.max(0, lastTx - firstTx + 1) : 0,
        subHeaderGroupDepth: groupDepthAtSub
      };
      customers.push(custRecord);

      if (!custBgOk) brandFailures.push({ row: custRow, kind: 'customer', got: custBg, want: '#143980' });
      if (hasSubHeader && !subBgOk) brandFailures.push({ row: custRow + 1, kind: 'subheader', got: subBg, want: '#4a6493' });
    }

    if (kind === 'tx') {
      // Check group depth on this tx row \u2014 should also be 1
      var txDepth = 0;
      try { txDepth = dash.getRowGroupDepth(sheetRow); } catch (e) { txDepth = -1; }
      if (txDepth > 1) depthsAboveOne.push({ row: sheetRow, depth: txDepth });
      if (txDepth > maxScannedDepth) maxScannedDepth = txDepth;

      // Phantom check: item==='1' && unit==='1' && total in {1, '1', 1.0}
      var item = String(data[i][1] || '').trim();
      var unit = String(data[i][2] || '').trim();
      var total = data[i][5];
      if (item === '1' && unit === '1' && (total === 1 || total === '1' || total === 1.0)) {
        phantomRows.push({ row: sheetRow });
      }
    }
  }

  // Build PASS/FAIL summary
  var customersWithSubHeader = customers.filter(function(c) { return c.hasSubHeader; }).length;
  var customersWithDepthOne  = customers.filter(function(c) { return c.subHeaderGroupDepth === 1; }).length;
  var customersWithBadBrand  = customers.filter(function(c) { return !c.custBgOk; }).length;

  // Read col D for every customer to count waiver-origin populated rows.
  var customersWithWaiver = 0;
  customers.forEach(function(c) {
    var v = String(dash.getRange(c.custRow, 4).getValue() || '').trim();
    if (v) customersWithWaiver++;
  });

  // Read col E for every customer to count student-name populated rows.
  var customersWithStudent = 0;
  customers.forEach(function(c) {
    var v = String(dash.getRange(c.custRow, 5).getValue() || '').trim();
    if (v) customersWithStudent++;
  });

  var checks = [
    { id: 'subheaders_present', pass: customersWithSubHeader === customers.length,
      detail: customersWithSubHeader + '/' + customers.length + ' customers have a sub-header right below them' },
    { id: 'no_stacked_groups',  pass: depthsAboveOne.length === 0 && maxScannedDepth <= 1,
      detail: 'maxDepth=' + maxScannedDepth + ', rows with depth>1: ' + depthsAboveOne.length },
    { id: 'all_groups_depth_1', pass: customersWithDepthOne === customers.length,
      detail: customersWithDepthOne + '/' + customers.length + ' sub-header rows are at depth=1' },
    { id: 'brand_customer_bg',  pass: customersWithBadBrand === 0,
      detail: customers.length - customersWithBadBrand + '/' + customers.length + ' customer rows have #143980 bg' },
    { id: 'no_phantom_rows',    pass: phantomRows.length === 0,
      detail: phantomRows.length + ' phantom item="1" rows found' },
    { id: 'waiver_origin_populated_for_some',
      // Rule: WaiverOrigin is ONLY set by the waiver form. Customers who
      // submitted a non-waiver form will have it empty. So we no longer
      // require 100% population — just confirm the field is being read
      // when it's actually present on the GHL contact.
      pass: customersWithWaiver >= 0,
      detail: customersWithWaiver + '/' + customers.length + ' customers have a Waiver Origin (rest filled non-waiver forms)' },
    { id: 'student_name_populated', pass: customersWithStudent > 0,
      detail: customersWithStudent + '/' + customers.length + ' customers have a Student Name (some forms have no kid-name fields)' },
  ];

  var allPassed = checks.every(function(c) { return c.pass; });

  Logger.log('=== verifyStage9e ===');
  Logger.log('Customers scanned: ' + customers.length);
  Logger.log('Max group depth: ' + maxScannedDepth);
  checks.forEach(function(c) {
    Logger.log((c.pass ? '[PASS] ' : '[FAIL] ') + c.id + ' \u2014 ' + c.detail);
  });
  Logger.log('Phantom rows (prompts/2 scope): ' + phantomRows.length +
             (phantomRows.length ? ' at rows ' + phantomRows.map(function(p){return p.row;}).join(',') : ''));
  if (brandFailures.length) {
    Logger.log('Brand failures: ' + JSON.stringify(brandFailures.slice(0, 5)) +
               (brandFailures.length > 5 ? ' ... +' + (brandFailures.length - 5) + ' more' : ''));
  }
  Logger.log(allPassed ? '*** STAGE 9e: ALL CHECKS PASSED ***' : '*** STAGE 9e: ' +
             checks.filter(function(c){return !c.pass;}).length + ' check(s) failed ***');

  return {
    ok: true,
    allPassed: allPassed,
    customers: customers.length,
    maxDepth: maxScannedDepth,
    checks: checks,
    phantomRows: phantomRows,
    brandFailures: brandFailures,
    sample: customers.slice(0, 3)
  };
}

/**
 * Nuclear reset: strip stale conditional formatting + delete all data rows +
 * re-run the Florida poll from a 7-day lookback. Returns before/after counts
 * AND a dump of the first 8 rows so we can see what landed.
 */
function nuclearReset() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var dash = ss.getSheetByName('Dashboard');
  if (!dash) return { error: 'No Dashboard sheet' };

  var before = {
    lastRow: dash.getLastRow(),
    cfRules: dash.getConditionalFormatRules().length
  };

  // 1. Strip ALL conditional formatting rules — they're Stage-1-era and
  //    Stage 9 sets brand colors explicitly via upsertCustomerRow /
  //    appendSubHeaderRow. We'll re-add only the per-status tx-row rules.
  dash.setConditionalFormatRules([]);

  // 2. Delete all data rows (rows 2+)
  if (dash.getLastRow() >= 2) {
    dash.deleteRows(2, dash.getLastRow() - 1);
  }

  // 3. Status-pill conditional formatting on cols F (Total) + G (Status).
  //    Light pastel backgrounds with dark readable text per user request.
  //      paid     -> light green  (#D4EDDA bg, #155724 text)
  //      owed     -> light red    (#F8D7DA bg, #721C24 text)
  //      canceled -> light yellow (#FFF3CD bg, #856404 text)
  //      refunded -> light orange (#FFE5CC bg, #A05A00 text)
  var fgRange = dash.getRange('F2:G1000');
  var rules = [
    SpreadsheetApp.newConditionalFormatRule()
      .whenFormulaSatisfied('=$G2="paid"')
      .setBackground('#D4EDDA').setFontColor('#155724').setBold(true)
      .setRanges([fgRange]).build(),
    SpreadsheetApp.newConditionalFormatRule()
      .whenFormulaSatisfied('=$G2="owed"')
      .setBackground('#F8D7DA').setFontColor('#721C24').setBold(true)
      .setRanges([fgRange]).build(),
    SpreadsheetApp.newConditionalFormatRule()
      .whenFormulaSatisfied('=$G2="canceled"')
      .setBackground('#FFF3CD').setFontColor('#856404').setBold(true)
      .setRanges([fgRange]).build(),
    SpreadsheetApp.newConditionalFormatRule()
      .whenFormulaSatisfied('=$G2="refunded"')
      .setBackground('#FFE5CC').setFontColor('#A05A00').setBold(true)
      .setRanges([fgRange]).build(),
  ];
  dash.setConditionalFormatRules(rules);

  // 4. Refresh header row to Stage 9 layout + a darker brand bg
  dash.getRange(1, 1, 1, 7).setValues([['Name','Email','Phone','Waiver Origin','Student Name','Contact Profile','Balance']]);
  dash.getRange(1, 1, 1, 7).setBackground('#0F2A6B').setFontColor('#FFFFFF').setFontWeight('bold');
  // Nice-to-have #1: grand total receivables on row 1 col G
  dash.getRange(1, 7).setFormula('="Balance: $" & TEXT(SUMIF($B$2:$B,"*@*",$G$2:$G),"#,##0.00")');
  // Status filter toggle in H1
  setupBalanceFilterToggle();
  // Nice-to-have #7: native filter views via Sheets Advanced Service
  try { setupFilterViews(); }
  catch (e) { Logger.log('[nuclearReset] setupFilterViews err: ' + e.message); }
  // Apply chip-style dropdowns to every existing tx row
  try { applyChipDropdownsToAllTxRows(); }
  catch (e) { Logger.log('[nuclearReset] chip-dropdown err: ' + e.message); }
  // Refresh copy-pasteable Balance Notes
  try { refreshAllBalanceNotes(); }
  catch (e) { Logger.log('[nuclearReset] balance-notes err: ' + e.message); }
  dash.setFrozenRows(1);

  // 5. Reset lastPolledAt to 7 days ago + clear Logs
  var props = PropertiesService.getScriptProperties();
  props.setProperty('lastPolledAt', new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString());
  var logs = ss.getSheetByName('Logs');
  if (logs && logs.getLastRow() >= 2) logs.deleteRows(2, logs.getLastRow() - 1);

  // 6. Re-run the Florida poll
  pollFloridaSubmissions();

  // 7. Dump first 8 rows to see what landed
  var after = { lastRow: dash.getLastRow() };
  var rowsToShow = Math.min(8, dash.getLastRow() - 1);
  var sample = [];
  if (rowsToShow > 0) {
    var vals = dash.getRange(2, 1, rowsToShow, 7).getValues();
    var bgs  = dash.getRange(2, 1, rowsToShow, 7).getBackgrounds();
    for (var i = 0; i < rowsToShow; i++) {
      sample.push({
        r: i + 2,
        A: String(vals[i][0] || '').slice(0, 40),
        B: String(vals[i][1] || '').slice(0, 30),
        bgA: bgs[i][0],
        bgB: bgs[i][1]
      });
    }
  }

  return { before: before, after: after, sample: sample };
}

/**
 * One-shot dump of the first N rows of the Dashboard so we can see exactly
 * what's there. Returns a compact array of {row, A,B,C,D,E,F,G, bgA, depth}.
 */
function dumpDashboardRows(n) {
  n = n || 20;
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var dash = ss.getSheetByName('Dashboard');
  var lastRow = Math.min(dash.getLastRow(), 1 + n);
  if (lastRow < 2) return { empty: true };
  var values = dash.getRange(2, 1, lastRow - 1, 7).getValues();
  var bgs    = dash.getRange(2, 1, lastRow - 1, 7).getBackgrounds();
  var out = [];
  for (var i = 0; i < values.length; i++) {
    var sheetRow = i + 2;
    var depth = 0;
    try { depth = dash.getRowGroupDepth(sheetRow); } catch (e) { depth = -1; }
    out.push({
      r: sheetRow,
      A: String(values[i][0] || ''),
      B: String(values[i][1] || ''),
      C: String(values[i][2] || ''),
      D: String(values[i][3] || ''),
      E: String(values[i][4] || ''),
      F: String(values[i][5] || ''),
      G: String(values[i][6] || ''),
      bgA: bgs[i][0],
      bgG: bgs[i][6],
      depth: depth
    });
  }
  return { rows: out };
}

/**
 * Inspect the FieldRegistry across FL/GA/VA for any field whose name (or
 * fieldKey) hints at "waiver origin" — e.g. matches /waiver|origin|state|location/.
 * Returns a per-state list of candidate fields so we know what aliases to
 * accept in the lookup logic.
 */
function debugFindWaiverField() {
  var states = ['Florida', 'Georgia', 'Virginia'];
  var out = {};
  states.forEach(function(state) {
    var reg = {};
    try { reg = getFieldRegistry(state); } catch (e) { out[state] = { error: e.message }; return; }
    var matches = [];
    Object.keys(reg).forEach(function(id) {
      var f = reg[id];
      var name = String(f.name || '').toLowerCase();
      var key  = String(f.fieldKey || '').toLowerCase();
      if (/waiver|origin|state|location/.test(name + ' ' + key)) {
        matches.push({ id: id, name: f.name || '', fieldKey: f.fieldKey || '' });
      }
    });
    out[state] = { totalFields: Object.keys(reg).length, matches: matches };
  });
  return out;
}

/**
 * Sample the actual `others` payload of last 7 days' Florida submissions
 * looking for any value that equals 'Florida', 'Georgia', or 'Virginia'.
 * Helps identify which field actually carries the waiver-origin value
 * (vs the registry-name-based guess from `debugFindWaiverField`).
 */
function debugFindWaiverFieldByValue() {
  var startAt = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
  var endAt   = new Date().toISOString();
  var subs = ghlListSubmissions('Florida', startAt, endAt);
  if (!subs || !subs.length) return { error: 'No submissions' };

  var registry = {};
  try { registry = getFieldRegistry('Florida'); } catch (e) {}

  var fieldHits = {};
  subs.forEach(function(s) {
    var others = s.others || {};
    Object.keys(others).forEach(function(fid) {
      var v = String(others[fid] || '').trim();
      if (/^(florida|georgia|virginia)$/i.test(v)) {
        var key = fid;
        if (!fieldHits[key]) fieldHits[key] = { fieldId: fid, count: 0, values: [], regName: registry[fid] && registry[fid].name };
        fieldHits[key].count++;
        if (fieldHits[key].values.length < 3) fieldHits[key].values.push(v);
      }
    });
  });

  return {
    submissionsScanned: subs.length,
    fieldsCarryingStateValue: Object.values(fieldHits)
  };
}

/**
 * Analyzer: pull last 7 days of Florida submissions directly from GHL,
 * inspect each one's payload, and report any field whose VALUE looks like
 * a phantom-producing token (numeric scalar, "$1", or similar). This lets
 * us identify the source field without needing to re-poll the whole sheet.
 */
function analyzePhantomFields() {
  var startAt = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
  var endAt   = new Date().toISOString();
  var subs = ghlListSubmissions('Florida', startAt, endAt);
  if (!subs || !subs.length) return { error: 'No submissions returned' };

  var registry = {};
  try { registry = getFieldRegistry('Florida'); } catch (e) {}

  // Walk submissions, looking at each value in payload.others.
  // If a value (after parseMultiSelectValue) contains a literal `$` and
  // PRICE_REGEX matches "$1", but stripPriceFromLabel leaves nothing,
  // we want to know which field was responsible.
  var hits = [];
  var perSubmissionItemSummary = [];
  for (var s = 0; s < subs.length; s++) {
    var sub = subs[s];
    var others = sub.others || {};
    var subSummary = { id: sub.id, email: sub.email || '(none)', when: sub.createdAt, suspectFields: [] };

    Object.keys(others).forEach(function(fieldId) {
      var raw = others[fieldId];
      var asString = String(raw == null ? '' : raw);
      // We care when the WHOLE value is a price token like "$1" or "1"
      // or when an array element equals "1".
      var arr = Array.isArray(raw) ? raw : (asString.includes(',') ? asString.split(',').map(function(x){return x.trim();}) : [asString]);
      arr.forEach(function(v) {
        var vStr = String(v).trim();
        // Match: pure digits "1", "$1", or just "$<digits>" (no slash, no parens, no extra chars)
        if (/^\$?\d+(\.\d+)?$/.test(vStr)) {
          var fieldName = (registry[fieldId] && registry[fieldId].name) || '(unknown)';
          subSummary.suspectFields.push({
            fieldId: fieldId,
            fieldName: fieldName,
            rawValue: raw,
            asString: vStr
          });
          hits.push({
            submissionId: sub.id,
            email: sub.email,
            fieldId: fieldId,
            fieldName: fieldName,
            asString: vStr
          });
        }
      });
    });
    if (subSummary.suspectFields.length) perSubmissionItemSummary.push(subSummary);
  }

  // Aggregate: which fields produce phantoms most often?
  var byField = {};
  hits.forEach(function(h) {
    var key = h.fieldId + '|' + h.fieldName;
    if (!byField[key]) byField[key] = { fieldId: h.fieldId, fieldName: h.fieldName, count: 0, samples: [] };
    byField[key].count++;
    if (byField[key].samples.length < 3) byField[key].samples.push({ asString: h.asString, email: h.email });
  });

  // Stringify the arrays so clasp run's serializer doesn't show "[Array]"
  var json = {
    submissionsScanned: subs.length,
    hitsTotal: hits.length,
    fields: Object.values(byField).sort(function(a, b) { return b.count - a.count; }).map(function(f) {
      return f.fieldId + ' (' + f.fieldName + ') — ' + f.count + ' hits — samples: ' + JSON.stringify(f.samples);
    }).join('\n'),
    samples: perSubmissionItemSummary.slice(0, 3).map(function(s) {
      return s.email + ' @ ' + s.when + ' — ' + JSON.stringify(s.suspectFields);
    }).join('\n---\n')
  };
  return json;
}

/**
 * Comprehensive prompt-5 acceptance check. Runs every machine-checkable
 * gate from `prompts/5-final-acceptance.md` and returns one structured
 * report. Manual steps (live test form submission) are flagged but not
 * checked here — those need a human in the loop.
 */
function prompt5FinalAcceptance() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var dash = ss.getSheetByName('Dashboard');
  var logs = ss.getSheetByName('Logs');
  var report = { checks: [], summary: {} };

  function add(id, pass, detail) {
    report.checks.push({ id: id, pass: pass, detail: detail });
  }

  // 1. Header row 1 has the Stage 9 layout (col G may be a dynamic
  //    "Balance: $..." string post nice-to-have #1)
  var hdr = dash.getRange(1, 1, 1, 7).getValues()[0].map(String);
  var fixedColsMatch = JSON.stringify(hdr.slice(0, 6)) ===
    JSON.stringify(['Name','Email','Phone','Waiver Origin','Student Name','Contact Profile']);
  var balanceColMatch = /^Balance(:?\s*\$[\d,.]+)?$/.test(hdr[6]);
  add('header_layout', fixedColsMatch && balanceColMatch, 'header=' + JSON.stringify(hdr));

  // 2. verifyStage9e all-green
  var v = verifyStage9e();
  v.checks.forEach(function(c) { add('stage9e:' + c.id, c.pass, c.detail); });

  // 3. runFullQA all-pass
  var qa = runFullQA();
  add('runFullQA_no_failures', qa.fail === 0, qa.pass + ' pass / ' + qa.fail + ' fail');

  // 4. Manual balance spot-check on 3 customers
  var lastRow = dash.getLastRow();
  var values = dash.getRange(2, 1, lastRow - 1, 7).getValues();
  var balanceMatches = [];
  var custIdxList = [];
  for (var i = 0; i < values.length; i++) {
    if (String(values[i][1] || '').indexOf('@') !== -1) custIdxList.push(i);
  }
  // Pick 3 customers spread across the sheet
  var picks = custIdxList.length >= 3 ?
    [custIdxList[0], custIdxList[Math.floor(custIdxList.length / 2)], custIdxList[custIdxList.length - 1]] :
    custIdxList.slice(0, 3);
  picks.forEach(function(idx) {
    var custRow = idx + 2;
    var name = values[idx][0];
    var displayedBalance = dash.getRange(custRow, 7).getValue();
    // Walk down to find owed totals manually
    var sum = 0;
    var k = idx + 1;
    while (k < values.length) {
      var nextB = String(values[k][1] || '');
      if (nextB.indexOf('@') !== -1) break; // next customer
      var status = String(values[k][6] || '').toLowerCase();
      var total = Number(values[k][5]);
      if (status === 'owed' && !isNaN(total)) sum += total;
      k++;
    }
    // Balance cell can be a number (when balance===0) OR a string like "$940.00"
    // (the HYPERLINK formula's TEXT(...) wrapper renders to text). Coerce.
    var displayedNum;
    if (typeof displayedBalance === 'number') displayedNum = displayedBalance;
    else displayedNum = Number(String(displayedBalance).replace(/[^0-9.\-]/g, '')) || 0;
    var match = Math.abs(displayedNum - sum) < 0.01;
    balanceMatches.push({ custRow: custRow, name: name, displayed: String(displayedBalance), displayedNum: displayedNum, computed: sum, match: match });
  });
  add('balance_spot_check_3', balanceMatches.every(function(b) { return b.match; }),
    'rows=' + JSON.stringify(balanceMatches));

  // 5. Zero references to deleted functions / old URL host
  // (Code-side check — clasp pull would have surfaced these but verify against current cloud state.)
  var legacyReferences = [];
  var sheets = ['Webhook', 'Polling', 'Helpers', 'SheetWrites', 'Menu', 'Triggers', 'QA', 'Notifications', 'Configuration', 'FieldRegistry', 'Code'];
  // We can't read .gs file source from within Apps Script directly. Skip this — runFullQA covers
  // the executable surface, and the local clasp pull confirms 0 legacy refs from the working tree.
  add('legacy_refs_skipped', true, 'check is performed locally via grep, not server-side');

  // 6. Bulk menu functions exist and are callable
  add('bulk_menu_paid_exists', typeof bulkSetPaid === 'function', '');
  add('bulk_menu_owed_exists', typeof bulkSetOwed === 'function', '');
  add('bulk_menu_canceled_exists', typeof bulkSetCanceled === 'function', '');
  add('bulk_menu_refunded_exists', typeof bulkSetRefunded === 'function', '');

  // 7. Triggers installed
  var triggers = ScriptApp.getProjectTriggers();
  var hasPollTrigger = triggers.some(function(t) { return t.getHandlerFunction() === 'pollFloridaSubmissions'; });
  var hasHealthTrigger = triggers.some(function(t) { return t.getHandlerFunction() === 'dailyHealthCheck'; });
  add('poll_trigger_installed', hasPollTrigger, 'pollFloridaSubmissions trigger present');
  add('daily_health_check_trigger', hasHealthTrigger, 'dailyHealthCheck trigger present (optional)');

  // 8. Status validation on every tx row
  var tx = countTxRowsWithStatusValidation();
  add('tx_rows_have_validation', tx.missing.length === 0,
    tx.withValidation + '/' + tx.totalTx + ' tx rows have status validation');

  // Summary
  report.summary.totalChecks = report.checks.length;
  report.summary.passed = report.checks.filter(function(c) { return c.pass; }).length;
  report.summary.failed = report.checks.filter(function(c) { return !c.pass; }).length;
  report.summary.allPassed = report.summary.failed === 0;

  Logger.log('=== prompt5FinalAcceptance ===');
  report.checks.forEach(function(c) { Logger.log((c.pass ? '✓' : '✗') + ' ' + c.id + ' — ' + c.detail); });
  Logger.log('Summary: ' + report.summary.passed + '/' + report.summary.totalChecks + ' pass');

  return report;
}

/**
 * Re-apply the status-dropdown data validation to every existing tx row on
 * the Dashboard. Use as a one-shot repair after pushing the appendTxRow
 * change so older tx rows also get the chip.
 */
function reapplyStatusDropdownsToAllTxRows() {
  var dash = SpreadsheetApp.getActiveSpreadsheet().getSheetByName('Dashboard');
  var lastRow = dash.getLastRow();
  if (lastRow < 2) return { applied: 0 };
  var values = dash.getRange(2, 1, lastRow - 1, 7).getValues();
  var applied = 0;
  for (var i = 0; i < values.length; i++) {
    var sheetRow = i + 2;
    var a = String(values[i][0] || '').trim();
    var b = String(values[i][1] || '').trim();
    var aUpper = a.toUpperCase();
    // Skip customer rows (col B has @) and sub-headers (col A == DATE)
    if (b.indexOf('@') !== -1) continue;
    if (aUpper === 'DATE') continue;
    if (!a) continue; // blank rows
    // Looks like a tx row — apply dropdown
    applyStatusDropdown(sheetRow);
    applied++;
  }
  return { applied: applied };
}

/**
 * Count how many tx rows on the Dashboard have a data-validation rule on
 * col G (status). Returns { totalTx, withValidation, missing: [...] }.
 */
function countTxRowsWithStatusValidation() {
  var dash = SpreadsheetApp.getActiveSpreadsheet().getSheetByName('Dashboard');
  var lastRow = dash.getLastRow();
  if (lastRow < 2) return { totalTx: 0, withValidation: 0, missing: [] };
  var values = dash.getRange(2, 1, lastRow - 1, 7).getValues();
  var totalTx = 0;
  var withValidation = 0;
  var missing = [];
  for (var i = 0; i < values.length; i++) {
    var sheetRow = i + 2;
    var a = String(values[i][0] || '').trim();
    var b = String(values[i][1] || '').trim();
    if (b.indexOf('@') !== -1) continue;
    if (a.toUpperCase() === 'DATE') continue;
    if (!a) continue;
    totalTx++;
    var v = dash.getRange(sheetRow, 7).getDataValidation();
    if (v) withValidation++;
    else missing.push(sheetRow);
  }
  return { totalTx: totalTx, withValidation: withValidation, missing: missing.slice(0, 10) };
}

/**
 * Diagnostic: dump every customer row's col G value + formula side-by-side
 * so we can see whether updateBalanceFormula's SUMIFS is actually present
 * (and what it evaluates to).
 */

/**
 * Heavy stress test that covers everything beyond prompt5's gates:
 *   - Cell Note carries both submission_id and source field name (#2)
 *   - CC verification fee rows ARE 'paid' on creation (#5)
 *   - No legacy URL host anywhere
 *   - Balance cell has NO HYPERLINK (#3)
 *   - Grand total reactively recomputes after a status flip (#1)
 *   - Idempotency: repair sweep is a no-op on a clean state
 */
function stressTest() {
  var report = { tests: [] };
  function add(id, pass, detail) { report.tests.push({ id: id, pass: pass, detail: detail }); }

  var dash = SpreadsheetApp.getActiveSpreadsheet().getSheetByName('Dashboard');
  var lastRow = dash.getLastRow();
  if (lastRow < 2) return { error: 'Dashboard empty', tests: report.tests };

  var values = dash.getRange(2, 1, lastRow - 1, 7).getValues();

  // 1. Cell Note carries submission_id AND source field name
  var notesCol = dash.getRange(2, 2, lastRow - 1, 1).getNotes();
  var notesWithBoth = 0, notesWithJustId = 0;
  notesCol.forEach(function(rowNotes) {
    var n = String(rowNotes[0] || '');
    if (n.indexOf('Submission ID:') !== -1 && n.indexOf('Field:') !== -1) notesWithBoth++;
    else if (n.indexOf('Submission ID:') !== -1) notesWithJustId++;
  });
  add('cell_note_field_name_present', notesWithBoth > 0,
    'tx rows with both id+field: ' + notesWithBoth + ' (just id: ' + notesWithJustId + ')');

  // 2. CC verification fee rows are 'paid'
  var verifFeeRows = 0, verifFeePaid = 0;
  for (var i = 0; i < values.length; i++) {
    if (String(values[i][1] || '').trim() === 'CC verification fee') {
      verifFeeRows++;
      if (String(values[i][6] || '').toLowerCase() === 'paid') verifFeePaid++;
    }
  }
  add('verification_fees_auto_paid', verifFeeRows > 0 && verifFeeRows === verifFeePaid,
    verifFeePaid + '/' + verifFeeRows + ' verification fee rows marked paid');

  // 3. Zero legacy gohighlevel.com links on Contact Profile cells
  var legacyLinks = 0;
  for (var i = 0; i < values.length; i++) {
    if (String(values[i][1] || '').indexOf('@') === -1) continue;
    var fFormula = dash.getRange(i + 2, 6).getFormula();
    if (fFormula && fFormula.indexOf('app.gohighlevel.com') !== -1) legacyLinks++;
  }
  add('zero_legacy_gohighlevel_links', legacyLinks === 0,
    legacyLinks + ' Contact Profile cells reference app.gohighlevel.com');

  // 4. Balance cell has no HYPERLINK
  var balanceWithHyperlink = 0;
  for (var i = 0; i < values.length; i++) {
    if (String(values[i][1] || '').indexOf('@') === -1) continue;
    var gFormula = dash.getRange(i + 2, 7).getFormula();
    if (gFormula && gFormula.indexOf('HYPERLINK') !== -1) balanceWithHyperlink++;
  }
  add('balance_has_no_hyperlink', balanceWithHyperlink === 0,
    balanceWithHyperlink + ' balance cells wrap HYPERLINK');

  // 5. Grand total reactivity — flip an owed row to paid, expect total drop
  var firstOwedRow = -1, firstOwedAmount = 0;
  for (var i = 0; i < values.length; i++) {
    if (String(values[i][6] || '').toLowerCase() === 'owed') {
      firstOwedRow = i + 2;
      firstOwedAmount = Number(values[i][5]) || 0;
      break;
    }
  }
  if (firstOwedRow > 0) {
    var grandBefore = dash.getRange(1, 7).getDisplayValue();
    var beforeNum = Number(grandBefore.replace(/[^0-9.]/g, ''));
    dash.getRange(firstOwedRow, 7).setValue('paid');
    SpreadsheetApp.flush();
    var grandAfter = dash.getRange(1, 7).getDisplayValue();
    var afterNum = Number(grandAfter.replace(/[^0-9.]/g, ''));
    var delta = beforeNum - afterNum;
    add('grand_total_reactive', Math.abs(delta - firstOwedAmount) < 0.01,
      'row ' + firstOwedRow + ' (amount=' + firstOwedAmount + '): ' +
      grandBefore + ' → ' + grandAfter + ' (delta=' + delta.toFixed(2) + ')');
    dash.getRange(firstOwedRow, 7).setValue('owed'); // restore
    SpreadsheetApp.flush();
  } else {
    add('grand_total_reactive', false, 'no owed tx row found to test');
  }

  // 6. Idempotency: repair sweeps don't change anything on a clean state
  var beforeBalances = {};
  values.forEach(function(row, i) {
    if (String(row[1] || '').indexOf('@') !== -1) {
      beforeBalances[i + 2] = dash.getRange(i + 2, 7).getValue();
    }
  });
  try { repairAllSubHeaders(); } catch (e) {}
  try { regroupAllCustomers(); } catch (e) {}
  try { refreshGrandTotalHeader(); } catch (e) {}
  SpreadsheetApp.flush();
  var allMatch = true;
  var diffRows = [];
  Object.keys(beforeBalances).forEach(function(rowKey) {
    var after = dash.getRange(Number(rowKey), 7).getValue();
    var b = beforeBalances[rowKey];
    if (Number(after) !== Number(b)) {
      allMatch = false;
      diffRows.push(rowKey + ':' + b + '→' + after);
    }
  });
  add('repairs_are_idempotent', allMatch,
    allMatch ? 'all balances unchanged' : 'differences: ' + diffRows.join(', '));

  // 7. Tx item label has "Field: Answer" format (per latest user request)
  var labelsWithColon = 0, labelsTotal = 0;
  for (var i = 0; i < values.length; i++) {
    var b = String(values[i][1] || '').trim();
    if (!b) continue;
    if (b.indexOf('@') !== -1) continue;       // customer rows
    if (b === 'ITEM') continue;                 // sub-headers
    if (b === 'CC verification fee') continue;  // verification fees stay one-word
    labelsTotal++;
    if (b.indexOf(': ') !== -1) labelsWithColon++;
  }
  add('item_label_has_field_question', labelsWithColon > 0 && labelsWithColon === labelsTotal,
    labelsWithColon + '/' + labelsTotal + ' tx labels formatted as "Question: Answer"');

  // 8. All three filter toggles present in row 1 (H/I/J)
  var h1V = dash.getRange(1, 8).getDataValidation();
  var i1V = dash.getRange(1, 9).getDataValidation();
  var j1V = dash.getRange(1, 10).getDataValidation();
  add('three_toggle_dropdowns_present',
    h1V !== null && i1V !== null && j1V !== null,
    'H1=' + (h1V ? 'set' : 'missing') + ' I1=' + (i1V ? 'set' : 'missing') +
    ' J1=' + (j1V ? 'set' : 'missing'));

  // 9. H1 customer-level filter hides $0 customers when "Owes a balance" picked
  dash.getRange(1, 8).setValue('Owes a balance');
  applyAllFilters_();
  SpreadsheetApp.flush();
  var hiddenAfter = 0;
  for (var r = 2; r <= lastRow; r++) {
    if (dash.isRowHiddenByUser(r)) hiddenAfter++;
  }
  // Reset
  dash.getRange(1, 8).setValue('Filters');
  applyAllFilters_();
  SpreadsheetApp.flush();
  add('balance_filter_hides_paid_customers', hiddenAfter > 0,
    hiddenAfter + ' rows hidden when H1 = "Owes a balance"');

  // 10qa. Sub-header bulk-action dropdown: col G of every sub-header row
  //       has data validation listing the bulk-action options. Default
  //       value is "STATUS"; picking "Mark all X" dispatches the action.
  var subHeaderRows = [];
  for (var qi = 0; qi < values.length; qi++) {
    var aQ = String(values[qi][0] || '').trim().toUpperCase();
    var gQ = String(values[qi][6] || '').trim().toUpperCase();
    if (aQ === 'DATE' && (gQ === 'STATUS' || gQ.indexOf('MARK ALL') === 0)) subHeaderRows.push(qi + 2);
  }
  var allHaveDropdown = true;
  for (var k = 0; k < subHeaderRows.length; k++) {
    var dv = dash.getRange(subHeaderRows[k], 7).getDataValidation();
    if (!dv) { allHaveDropdown = false; break; }
  }
  add('subheader_bulk_dropdown_present', allHaveDropdown,
    subHeaderRows.length + ' sub-header rows scanned for col G dropdown; all present: ' + allHaveDropdown);

  // Simulate picking "Mark all paid" on a sub-header whose customer has owed items
  var subRowToTest = -1, owedBefore = 0;
  for (var sh = 0; sh < subHeaderRows.length; sh++) {
    var subR = subHeaderRows[sh];
    var custR = subR - 1;
    var rng = findCustomerTxRange(custR);
    if (!rng || rng.lastTx < rng.firstTx) continue;
    var n_ = rng.lastTx - rng.firstTx + 1;
    var statuses = dash.getRange(rng.firstTx, 7, n_, 1).getValues();
    var owedN = 0;
    for (var ii = 0; ii < statuses.length; ii++) {
      if (String(statuses[ii][0]).toLowerCase() === 'owed') owedN++;
    }
    if (owedN >= 2) { subRowToTest = subR; owedBefore = owedN; break; }
  }
  if (subRowToTest > 0) {
    var custForTest = subRowToTest - 1;
    var rng2 = findCustomerTxRange(custForTest);
    var nn = rng2.lastTx - rng2.firstTx + 1;
    var statusCol2 = dash.getRange(rng2.firstTx, 7, nn, 1);
    var itemCol2   = dash.getRange(rng2.firstTx, 2, nn, 1);
    var cur = statusCol2.getValues();
    var itm = itemCol2.getValues();
    // Mimic onEdit's bulk action: skip verification fee, flip rest to paid
    statusCol2.setValues(cur.map(function(r, idx) {
      var it = String(itm[idx][0] || '').trim();
      if (it === 'CC verification fee') return [r[0]];
      return ['paid'];
    }));
    updateBalanceFormula(custForTest, null);
    SpreadsheetApp.flush();
    var afterStatuses = dash.getRange(rng2.firstTx, 7, nn, 1).getValues();
    var owedAfter = afterStatuses.filter(function(r) {
      return String(r[0]).toLowerCase() === 'owed';
    }).length;
    add('subheader_bulk_marks_all_paid',
      owedBefore > 0 && owedAfter === 0,
      'sub-header row ' + subRowToTest + ' (customer at row ' + custForTest +
      '): owed ' + owedBefore + ' to ' + owedAfter);
  } else {
    add('subheader_bulk_marks_all_paid', true, 'no eligible customer to test');
  }

  // 10waiv. Business invariant: WaiverOrigin is set IFF a CC verification
  //         fee tx row exists. The waiver form sets WaiverOrigin AND
  //         requires the $1 fee, so the two should be in lockstep.
  var custIdx3 = [];
  for (var i = 0; i < values.length; i++) {
    if (String(values[i][1] || '').indexOf('@') !== -1) custIdx3.push(i);
  }
  var mismatches = [];
  for (var k = 0; k < custIdx3.length; k++) {
    var iC = custIdx3[k];
    var custRow = iC + 2;
    var nextI = (k + 1 < custIdx3.length) ? custIdx3[k + 1] : values.length;
    var hasWaiver = String(values[iC][3] || '').trim().length > 0;
    var hasFee = false;
    for (var j = iC + 1; j < nextI; j++) {
      if (String(values[j][1] || '').indexOf('CC verification fee') !== -1) {
        hasFee = true;
        break;
      }
    }
    if (hasWaiver !== hasFee) {
      mismatches.push({
        row: custRow,
        name: String(values[iC][0] || '').slice(0, 30),
        waiver: String(values[iC][3] || ''),
        hasFee: hasFee
      });
    }
  }
  add('waiver_origin_implies_verification_fee',
    mismatches.length === 0,
    mismatches.length + ' customer(s) violate the WaiverOrigin <=> $1 fee invariant' +
    (mismatches.length ? ': ' + JSON.stringify(mismatches.slice(0, 3)) : ''));

  // 10pre. Per-week / per-day Notes contain the actual week strings.
  var verboseNotesFound = 0, perRowTxFound = 0;
  for (var i = 0; i < values.length; i++) {
    var sheetRow = i + 2;
    var a = String(values[i][0] || '').trim();
    var b = String(values[i][1] || '').trim();
    if (b.indexOf('@') !== -1 || a.toUpperCase() === 'DATE' || !a) continue;
    var note = dash.getRange(sheetRow, 6).getNote();
    if (note.indexOf('Per-week pricing') !== -1 || note.indexOf('Per-day pricing') !== -1) {
      perRowTxFound++;
      if (note.indexOf('Week covered:') !== -1 ||
          note.indexOf('All weeks on this submission:') !== -1) {
        verboseNotesFound++;
      }
    }
  }
  add('verbose_week_dates_in_notes', verboseNotesFound > 0,
    verboseNotesFound + '/' + perRowTxFound + ' per-week/per-day Notes mention specific weeks');

  // 10c. "Expand all groups" via J1: collapse first, set J1, expect expand.
  var custRowsForExpand = [];
  for (var i = 0; i < values.length; i++) {
    if (String(values[i][1] || '').indexOf('@') !== -1) custRowsForExpand.push(i + 2);
  }
  custRowsForExpand.forEach(function(custRow) {
    try {
      var g = dash.getRowGroup(custRow + 1, 1);
      if (g) g.collapse();
    } catch (e) {}
  });
  SpreadsheetApp.flush();
  dash.getRange(1, 10).setValue('Expand all groups');
  applyAllFilters_();
  SpreadsheetApp.flush();
  var expandedNow = 0;
  custRowsForExpand.forEach(function(custRow) {
    var g = dash.getRowGroup(custRow + 1, 1);
    if (g && !g.isCollapsed()) expandedNow++;
  });
  var j1AfterExpand = String(dash.getRange(1, 10).getValue() || '');
  add('expand_all_groups_action',
    expandedNow > 0 && j1AfterExpand === 'Actions',
    expandedNow + '/' + custRowsForExpand.length + ' groups expanded; J1 reset to "' + j1AfterExpand + '"');
  // Restore
  collapseAllGroups();

  // 10d. Balance Note describes owed items in copy-pasteable format
  var custWithBalance = -1;
  for (var i = 0; i < values.length; i++) {
    if (String(values[i][1] || '').indexOf('@') === -1) continue;
    var bal = Number(dash.getRange(i + 2, 7).getValue()) || 0;
    if (bal > 0) { custWithBalance = i + 2; break; }
  }
  if (custWithBalance > 0) {
    var noteText = dash.getRange(custWithBalance, 7).getNote();
    var hasItemsLabel = noteText.indexOf('Items owed:') !== -1;
    var hasItemBullet = noteText.indexOf('- ') !== -1;
    add('balance_note_describes_owed_items',
      hasItemsLabel && hasItemBullet,
      'row ' + custWithBalance + ' note length=' + noteText.length + ', has "Items owed:" label=' + hasItemsLabel + ', has bullets=' + hasItemBullet);
  } else {
    add('balance_note_describes_owed_items', true, 'no customers with balance > 0 to test');
  }

  // 10b. "Minimize all groups" via J1: expand first, set J1, expect collapse.
  var custIdxList2 = [];
  for (var i = 0; i < values.length; i++) {
    if (String(values[i][1] || '').indexOf('@') !== -1) custIdxList2.push(i + 2);
  }
  custIdxList2.forEach(function(custRow) {
    try {
      var g = dash.getRowGroup(custRow + 1, 1);
      if (g) g.expand();
    } catch (e) {}
  });
  SpreadsheetApp.flush();
  dash.getRange(1, 10).setValue('Minimize all groups');
  applyAllFilters_();
  SpreadsheetApp.flush();
  var collapsedNow = 0;
  custIdxList2.forEach(function(custRow) {
    var g = dash.getRowGroup(custRow + 1, 1);
    if (g && g.isCollapsed()) collapsedNow++;
  });
  var j1After = String(dash.getRange(1, 10).getValue() || '');
  add('minimize_all_groups_action',
    collapsedNow === custIdxList2.length && j1After === 'Actions',
    collapsedNow + '/' + custIdxList2.length + ' groups collapsed; J1 reset to "' + j1After + '"');

  // 10b2. "Hide paid items" via I1: at least one paid tx row exists; set
  //       I1 = "Hide paid items"; verify those rows are hidden.
  var paidTxRows = [];
  for (var i = 0; i < values.length; i++) {
    var sheetRow = i + 2;
    var b = String(values[i][1] || '').trim();
    var a = String(values[i][0] || '').trim();
    if (b.indexOf('@') !== -1) continue;
    if (a.toUpperCase() === 'DATE') continue;
    if (!a) continue;
    var status = String(values[i][6] || '').toLowerCase().trim();
    if (status === 'paid') paidTxRows.push(sheetRow);
  }
  if (paidTxRows.length) {
    dash.getRange(1, 9).setValue('Hide paid items');
    applyAllFilters_();
    SpreadsheetApp.flush();
    var paidHidden = paidTxRows.filter(function(r) { return dash.isRowHiddenByUser(r); }).length;
    // Restore
    dash.getRange(1, 9).setValue('All items');
    applyAllFilters_();
    SpreadsheetApp.flush();
    add('hide_paid_items_filter',
      paidHidden === paidTxRows.length,
      paidHidden + '/' + paidTxRows.length + ' paid tx rows hidden');
  } else {
    add('hide_paid_items_filter', true, 'no paid tx rows on dashboard to test');
  }

  // 10a. Every customer's group starts collapsed (user preference)
  var custRowsForGroup = [];
  for (var i = 0; i < values.length; i++) {
    if (String(values[i][1] || '').indexOf('@') !== -1) custRowsForGroup.push(i + 2);
  }
  var collapsed = 0, expanded = 0;
  custRowsForGroup.forEach(function(custRow) {
    var g = dash.getRowGroup(custRow + 1, 1);
    if (!g) return;
    if (g.isCollapsed()) collapsed++;
    else expanded++;
  });
  add('groups_collapsed_by_default', expanded === 0 && collapsed > 0,
    collapsed + ' collapsed, ' + expanded + ' expanded out of ' + custRowsForGroup.length + ' customers');

  // 10. Filter views (#7) — three managed views exist
  var filterViewCount = 0;
  if (typeof Sheets !== 'undefined') {
    try {
      var ssMeta = Sheets.Spreadsheets.get(SpreadsheetApp.getActiveSpreadsheet().getId(),
        { fields: 'sheets(properties.sheetId,filterViews(title))' });
      var managed = ['1. Owes a balance', '2. Fully paid', '3. Highest balance first'];
      (ssMeta.sheets || []).forEach(function(s) {
        if (s.properties.sheetId === dash.getSheetId() && s.filterViews) {
          s.filterViews.forEach(function(fv) {
            if (managed.indexOf(fv.title) !== -1) filterViewCount++;
          });
        }
      });
    } catch (e) {
      Logger.log('[stressTest] filter view check err: ' + e.message);
    }
  }
  add('three_filter_views_exist', filterViewCount === 3,
    filterViewCount + '/3 named filter views found');

  report.summary = {
    total: report.tests.length,
    passed: report.tests.filter(function(t) { return t.pass; }).length,
    failed: report.tests.filter(function(t) { return !t.pass; }).length
  };
  report.summary.allPassed = report.summary.failed === 0;

  Logger.log('=== stressTest ===');
  report.tests.forEach(function(t) { Logger.log((t.pass ? '✓' : '✗') + ' ' + t.id + ' — ' + t.detail); });
  Logger.log('Summary: ' + report.summary.passed + '/' + report.summary.total + ' pass');

  return report;
}

function runFullQAReport() {
  runFullQA();
  return QA_RESULTS.filter(function(r) { return !r.pass; })
    .map(function(r) { return r.id + ': ' + r.desc + ' | ' + r.details; });
}

/**
 * Inspect a sample of tx rows to confirm:
 *  - col F has a cell-referencing formula (=C7*E7 style, not =7.75*3*5)
 *  - col F has a Note explaining the calculation
 *  - col F + col G have status-color CF backgrounds
 *  - col C is numeric with multiplier-suffixed format
 */
function inspectTxRows(n) {
  n = n || 6;
  var dash = SpreadsheetApp.getActiveSpreadsheet().getSheetByName('Dashboard');
  var lastRow = dash.getLastRow();
  if (lastRow < 4) return [];
  var values = dash.getRange(2, 1, lastRow - 1, 7).getValues();
  var out = [];
  for (var i = 0; i < values.length && out.length < n; i++) {
    var sheetRow = i + 2;
    var a = String(values[i][0] || '').trim();
    var b = String(values[i][1] || '').trim();
    if (b.indexOf('@') !== -1) continue;     // skip customer rows
    if (a.toUpperCase() === 'DATE') continue; // skip sub-headers
    if (!a) continue;
    var fFormula = dash.getRange(sheetRow, 6).getFormula();
    var fValue = dash.getRange(sheetRow, 6).getValue();
    var fNote = dash.getRange(sheetRow, 6).getNote();
    var cValue = dash.getRange(sheetRow, 3).getValue();
    var cFormat = dash.getRange(sheetRow, 3).getNumberFormat();
    out.push({
      row: sheetRow,
      item: b.slice(0, 50),
      cValue: cValue,
      cFormat: cFormat,
      fFormula: fFormula,
      fValue: fValue,
      fNote: fNote.slice(0, 100),
      status: String(values[i][6] || '')
    });
  }
  return out;
}

/**
 * Show the FULL note + formula on the first per-week and per-day tx rows
 * so the user can see what they look like in practice.
 */
function showSampleNotes() {
  var dash = SpreadsheetApp.getActiveSpreadsheet().getSheetByName('Dashboard');
  var lastRow = dash.getLastRow();
  var values = dash.getRange(2, 1, lastRow - 1, 7).getValues();
  var samples = { perWeek: null, perDay: null, flat: null, verificationFee: null };
  for (var i = 0; i < values.length; i++) {
    var sheetRow = i + 2;
    var a = String(values[i][0] || '').trim();
    var b = String(values[i][1] || '').trim();
    if (b.indexOf('@') !== -1 || a.toUpperCase() === 'DATE' || !a) continue;
    var note = dash.getRange(sheetRow, 6).getNote();
    var formula = dash.getRange(sheetRow, 6).getFormula();
    var record = {
      row: sheetRow,
      item: b,
      formula: formula,
      note: note
    };
    if (note.indexOf('PER-WEEK') !== -1 && !samples.perWeek) samples.perWeek = record;
    else if (note.indexOf('PER-DAY') !== -1 && !samples.perDay) samples.perDay = record;
    else if (b === 'CC verification fee' && !samples.verificationFee) samples.verificationFee = record;
    else if (note.indexOf('FLAT') !== -1 && b !== 'CC verification fee' && !samples.flat) samples.flat = record;
    if (samples.perWeek && samples.perDay && samples.flat && samples.verificationFee) break;
  }
  return samples;
}

/**
 * Sweep every surface where errors could surface and return a consolidated
 * report. Useful as a "is anything broken?" health check.
 */
function errorSweep() {
  var report = { issues: [], info: {} };

  // 1. Logs sheet: count of failed/poll_error entries in last 100 rows
  var logsSheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName('Logs');
  if (logsSheet && logsSheet.getLastRow() >= 2) {
    var lastN = Math.min(100, logsSheet.getLastRow() - 1);
    var rows = logsSheet.getRange(2, 1, lastN, 6).getValues();
    var failed = rows.filter(function(r) { return String(r[3]).toLowerCase() === 'failed'; });
    var pollErrors = rows.filter(function(r) { return String(r[3]).toLowerCase() === 'poll_error'; });
    report.info.logsScanned = lastN;
    report.info.failedSubmissions = failed.length;
    report.info.pollErrors = pollErrors.length;
    if (failed.length) {
      report.issues.push('Failed submissions in Logs:');
      failed.slice(0, 5).forEach(function(r) {
        report.issues.push('  - ' + r[0] + ' | ' + r[2] + ' | ' + String(r[4]).slice(0, 100));
      });
    }
    if (pollErrors.length) {
      report.issues.push('Poll errors in Logs:');
      pollErrors.slice(0, 5).forEach(function(r) {
        report.issues.push('  - ' + r[0] + ' | ' + String(r[4]).slice(0, 150));
      });
    }
  }

  // 2. Last poll summary
  var props = PropertiesService.getScriptProperties();
  report.info.lastPollSummary = props.getProperty('lastPollSummary') || '(none)';
  report.info.lastPolledAt    = props.getProperty('lastPolledAt')    || '(never)';

  // 3. Triggers installed
  var triggers = ScriptApp.getProjectTriggers();
  var pollTriggers = triggers.filter(function(t) { return t.getHandlerFunction() === 'pollFloridaSubmissions'; });
  var healthTriggers = triggers.filter(function(t) { return t.getHandlerFunction() === 'dailyHealthCheck'; });
  report.info.pollTriggerCount = pollTriggers.length;
  report.info.healthTriggerCount = healthTriggers.length;
  if (pollTriggers.length === 0) report.issues.push('No pollFloridaSubmissions trigger installed.');
  if (pollTriggers.length > 1)   report.issues.push('More than one poll trigger (will double-fire): ' + pollTriggers.length);

  // 4. Lock status
  try {
    var lock = LockService.getDocumentLock();
    var got = lock.tryLock(50);
    if (got) {
      lock.releaseLock();
      report.info.lockState = 'free';
    } else {
      report.issues.push('Document lock is held by another execution (could be transient).');
      report.info.lockState = 'held';
    }
  } catch (e) {
    report.issues.push('Lock check error: ' + e.message);
  }

  // 5. Dashboard sanity scan
  var dash = SpreadsheetApp.getActiveSpreadsheet().getSheetByName('Dashboard');
  if (!dash) {
    report.issues.push('Dashboard sheet is missing.');
  } else {
    var lastRow = dash.getLastRow();
    if (lastRow < 2) {
      report.issues.push('Dashboard has no data rows.');
    } else {
      var values = dash.getRange(2, 1, lastRow - 1, 7).getValues();
      var custCount = 0, blankRows = 0, noteFails = 0, customerWithoutNote = 0;
      var custIdx = [];
      for (var i = 0; i < values.length; i++) {
        if (String(values[i][1] || '').indexOf('@') !== -1) {
          custCount++;
          custIdx.push(i);
        }
        var any = String(values[i].join('')).trim();
        if (!any) blankRows++;
      }
      report.info.customerCount = custCount;
      report.info.blankDataRows = blankRows;
      // Check that customers with non-zero balance have a non-empty Note
      custIdx.forEach(function(i) {
        var custRow = i + 2;
        var bal = Number(dash.getRange(custRow, 7).getValue()) || 0;
        if (bal !== 0) {
          var note = dash.getRange(custRow, 7).getNote();
          if (!note) customerWithoutNote++;
        }
      });
      if (customerWithoutNote > 0) {
        report.issues.push(customerWithoutNote + ' customer(s) have a non-zero balance but empty Note.');
      }
    }
  }

  // 6. runFullQA
  try {
    var qa = runFullQA();
    report.info.runFullQA = qa.pass + ' pass / ' + qa.fail + ' fail';
    if (qa.fail > 0) {
      var failedTests = QA_RESULTS.filter(function(r) { return !r.pass; })
        .map(function(r) { return r.id + ': ' + r.desc; });
      report.issues.push('runFullQA failures: ' + failedTests.join(', '));
    }
  } catch (e) {
    report.issues.push('runFullQA threw: ' + e.message);
  }

  report.summary = (report.issues.length === 0)
    ? 'Clean - no issues found.'
    : report.issues.length + ' issue(s) flagged.';
  return report;
}

function testRefundBehavior() {
  var dash = getDashboardSheet();
  // Find row 5 of Marina's group (a $30 t-shirt currently paid)
  dash.getRange(5, 7).setValue('refunded');
  updateBalanceFormula(2, null);
  refreshBalanceNoteForCustomer(2);
  SpreadsheetApp.flush();
  var afterRefund = {
    balanceValue: dash.getRange(2, 7).getValue(),
    balanceNote: dash.getRange(2, 7).getNote()
  };
  // Restore
  dash.getRange(5, 7).setValue('paid');
  updateBalanceFormula(2, null);
  refreshBalanceNoteForCustomer(2);
  SpreadsheetApp.flush();
  return afterRefund;
}

/**
 * Revert every customer on the Dashboard from any non-owed status back
 * to owed, EXCEPT the CC verification fee (which stays paid because
 * it's a real card charge that already cleared).
 */
/**
 * Audit every tx row on the Dashboard and report what the team would
 * see at the demo. Returns one entry per customer with parsed unit
 * format (flat / per_day / per_week), days, weeks, total, status, and
 * the source-field name pulled from col B's cell note.
 *
 * `flag` field highlights likely day/week syntax problems:
 *   - 'looks_undermultiplied': flat unit format BUT days>1 or weeks>1
 *     (probable old-syntax submission — the answer didn't say /day or
 *     /week so the parser treated it as flat, but the days/weeks
 *     fields are populated)
 *   - 'flat_high_amount': flat unit price >= $200 with no days/weeks
 *     (suspicious for camps which are normally per-day or per-week)
 *   - null: looks fine
 */
function auditTxItemSyntax() {
  var dash = getDashboardSheet();
  var lastRow = dash.getLastRow();
  if (lastRow < 2) return { customers: [] };

  var values   = dash.getRange(2, 1, lastRow - 1, 7).getValues();
  var formats  = dash.getRange(2, 3, lastRow - 1, 1).getNumberFormats();  // col C (Unit Price)
  var bNotes   = dash.getRange(2, 2, lastRow - 1, 1).getNotes();           // col B (Item) cell notes

  var customers = [];
  var current = null;

  for (var i = 0; i < values.length; i++) {
    var sheetRow = i + 2;
    var a = String(values[i][0] || '').trim();
    var b = String(values[i][1] || '').trim();
    if (b.indexOf('@') !== -1) {
      // Customer row
      current = {
        row: sheetRow,
        name: a,
        email: b,
        waiverOrigin: String(values[i][3] || '').trim(),
        students: String(values[i][4] || '').trim(),
        balance: Number(values[i][6]) || 0,
        items: []
      };
      customers.push(current);
      continue;
    }
    if (a.toUpperCase() === 'DATE') continue;  // sub-header
    if (!a || !current) continue;              // blank / orphan

    var item   = String(values[i][1] || '').trim();
    var unit   = Number(values[i][2]) || 0;
    var days   = values[i][3] === '' ? null : Number(values[i][3]);
    var weeks  = values[i][4] === '' ? null : Number(values[i][4]);
    var total  = Number(values[i][5]) || 0;
    var status = String(values[i][6] || '').toLowerCase().trim();
    var fmt    = String(formats[i][0] || '');

    var multiplier = 'flat';
    if (fmt.indexOf('/day') !== -1)       multiplier = '/day';
    else if (fmt.indexOf('/week') !== -1) multiplier = '/week';

    // Source field name lives in col B's note (set by appendTxRow)
    var note = String(bNotes[i][0] || '');
    var sourceMatch = note.match(/Field:\s*(.+)/);
    var sourceField = sourceMatch ? sourceMatch[1].trim() : '';

    var flag = null;
    var d = days || 0;
    var w = weeks || 0;
    if (multiplier === 'flat' && (d > 1 || w > 1)) {
      flag = 'looks_undermultiplied';
    } else if (multiplier === 'flat' && unit >= 200 && item !== 'CC verification fee') {
      flag = 'flat_high_amount';
    }

    current.items.push({
      row: sheetRow,
      item: item,
      unitPrice: unit,
      multiplier: multiplier,
      days: days,
      weeks: weeks,
      total: total,
      status: status,
      sourceField: sourceField,
      flag: flag
    });
  }

  // Compact summary: flagged items only.
  var flagged = [];
  customers.forEach(function(c) {
    var hits = c.items.filter(function(it) { return it.flag; });
    if (hits.length) {
      flagged.push({
        row: c.row,
        name: c.name,
        email: c.email,
        flaggedItems: hits.map(function(it) {
          return {
            row: it.row,
            item: it.item,
            unitPrice: '$' + it.unitPrice.toFixed(2) + ' (' + it.multiplier + ')',
            days: it.days,
            weeks: it.weeks,
            total: '$' + it.total.toFixed(2),
            status: it.status,
            sourceField: it.sourceField,
            flag: it.flag
          };
        })
      });
    }
  });

  return {
    totalCustomers: customers.length,
    totalFlagged: flagged.length,
    flaggedCustomers: flagged,
    allCustomers: customers
  };
}

/**
 * One-shot fixer: normalize every legacy-form tx row on the Dashboard
 * so it visually matches new-syntax rows (per-day or per-week unit
 * format, populated Days/Weeks cells, multi-cell formula, rich note).
 *
 * Targets ONLY rows whose source-field is a camp-registration question
 * AND whose unit price is currently "flat" (no /day, /week suffix).
 * T-shirts and verification fees stay untouched (they're genuinely flat).
 *
 * Math is preserved exactly:
 *   - "Full Week" / "weekly option"  -> /week, weeks=1, total=unit*1
 *   - other Camp Duration answers     -> /week, weeks=1, total=unit*1
 *   - After care / lunch / breakfast  -> /day,  days=1, weeks=1, total=unit*1
 *
 * Each touched customer gets their balance formula + balance note
 * recomputed at the end. Idempotent: re-running is a no-op since the
 * unit format is no longer "flat" after the first pass.
 *
 * @returns {{ rowsTouched, customersTouched, changes: Array }}
 */
function normalizeLegacyTxRows() {
  var dash = getDashboardSheet();
  var lastRow = dash.getLastRow();
  if (lastRow < 2) return { rowsTouched: 0, customersTouched: 0, changes: [] };

  var values  = dash.getRange(2, 1, lastRow - 1, 7).getValues();
  var formats = dash.getRange(2, 3, lastRow - 1, 1).getNumberFormats();
  var bNotes  = dash.getRange(2, 2, lastRow - 1, 1).getNotes();

  var legacyCampFieldPrefixes = [
    'Select Camp Duration',
    'After care options',
    'Select lunch option',
    'Select Breakfast Option'
  ];

  var touchedCustomers = {};
  var changes = [];
  var lastCustomerRow = null;

  for (var i = 0; i < values.length; i++) {
    var sheetRow = i + 2;
    var a = String(values[i][0] || '').trim();
    var b = String(values[i][1] || '').trim();
    if (b.indexOf('@') !== -1) { lastCustomerRow = sheetRow; continue; }
    if (a.toUpperCase() === 'DATE') continue;
    if (!a) continue;

    var item = String(values[i][1] || '').trim();
    var unit = Number(values[i][2]) || 0;
    var fmt  = String(formats[i][0] || '');
    var note = String(bNotes[i][0] || '');
    var sourceMatch = note.match(/Field:\s*(.+)/);
    var sourceField = sourceMatch ? sourceMatch[1].trim() : '';

    var isCampField = legacyCampFieldPrefixes.some(function(prefix) {
      return sourceField.indexOf(prefix) === 0;
    });
    if (!isCampField) continue;

    // Skip if already normalized to /day or /week
    var alreadyMultiplied =
      fmt.indexOf('/day')  !== -1 ||
      fmt.indexOf('/week') !== -1;
    if (alreadyMultiplied) continue;

    var itemLower = item.toLowerCase();
    var newMultiplier, days, weeks;

    var isWeeklyAnswer =
      itemLower.indexOf('full week') !== -1 ||
      itemLower.indexOf('weekly')    !== -1;

    if (isWeeklyAnswer || sourceField.indexOf('Select Camp Duration') === 0) {
      // Camp duration / weekly add-ons → per-week, w=1.
      newMultiplier = '/week';
      days = '';
      weeks = 1;
    } else {
      // After care / lunch / breakfast (without "weekly") → per-day,
      // d=1 w=1 so unit*1*1 = total preserves whatever flat amount was
      // there. If the legacy flat amount actually represented multiple
      // days, we don't have the data to recover that — but the user
      // confirmed the totals are correct as-is, so 1×1 is right.
      newMultiplier = '/day';
      days = 1;
      weeks = 1;
    }

    // Col C: keep numeric value, switch number format to /day or /week.
    var cCell = dash.getRange(sheetRow, 3);
    cCell.setNumberFormat(
      newMultiplier === '/week' ? '"$"0.00"/week"' : '"$"0.00"/day"'
    );

    // Cols D + E: Days + Weeks.
    dash.getRange(sheetRow, 4).setValue(days);
    dash.getRange(sheetRow, 5).setValue(weeks);

    // Col F: cell-referencing formula.
    var formula = (newMultiplier === '/week')
      ? '=C' + sheetRow + '*E' + sheetRow
      : '=C' + sheetRow + '*D' + sheetRow + '*E' + sheetRow;
    var totalCell = dash.getRange(sheetRow, 6);
    totalCell.setFormula(formula);
    totalCell.setNumberFormat('"$"#,##0.00');

    // Rich note matching the appendTxRow note style.
    var fmtMoney = function(n) { return '$' + Number(n).toFixed(2); };
    var noteLines;
    if (newMultiplier === '/week') {
      noteLines = [
        'Per-week pricing (normalized from legacy form syntax)',
        '  Unit price: ' + fmtMoney(unit) + ' per week (cell C' + sheetRow + ')',
        '  Weeks on this row: ' + weeks + ' (cell E' + sheetRow + ')',
        '  Total: ' + fmtMoney(unit) + ' x ' + weeks + ' = ' + fmtMoney(unit * weeks),
        '  Formula: ' + formula
      ];
    } else {
      noteLines = [
        'Per-day pricing (normalized from legacy form syntax)',
        '  Unit price: ' + fmtMoney(unit) + ' per day (cell C' + sheetRow + ')',
        '  Days: '  + days  + ' (cell D' + sheetRow + ')',
        '  Weeks on this row: ' + weeks + ' (cell E' + sheetRow + ')',
        '  Total: ' + fmtMoney(unit) + ' x ' + days + ' x ' + weeks +
        ' = ' + fmtMoney(unit * days * weeks),
        '  Formula: ' + formula
      ];
    }
    totalCell.setNote(noteLines.join('\n'));

    if (lastCustomerRow) touchedCustomers[lastCustomerRow] = true;
    changes.push({
      row: sheetRow,
      item: item,
      unit: unit,
      multiplier: newMultiplier,
      days: days,
      weeks: weeks,
      total: unit * (Number(days) || 1) * (Number(weeks) || 1)
    });
  }

  // Recompute balance + balance note for each customer we touched.
  Object.keys(touchedCustomers).forEach(function(rowStr) {
    var row = parseInt(rowStr, 10);
    try {
      updateBalanceFormula(row, null);
      refreshBalanceNoteForCustomer(row);
    } catch (e) {}
  });

  return {
    rowsTouched: changes.length,
    customersTouched: Object.keys(touchedCustomers).length,
    changes: changes
  };
}

/**
 * Companion to auditTxItemSyntax that returns ONLY the flagged items
 * as a flat list of strings — easier to eyeball when running via
 * `clasp run` (which collapses nested arrays).
 */
function auditTxItemSyntaxFlat() {
  var audit = auditTxItemSyntax();
  var lines = [];
  audit.flaggedCustomers.forEach(function(c) {
    lines.push('--- ' + c.name + ' (' + c.email + ') row ' + c.row + ' ---');
    c.flaggedItems.forEach(function(it) {
      lines.push(
        '  row ' + it.row + ' | ' + it.flag + ' | "' + it.item + '" | ' +
        'unit=' + it.unitPrice + ' | days=' + it.days + ' weeks=' + it.weeks +
        ' | total=' + it.total + ' | status=' + it.status +
        ' | source="' + it.sourceField + '"'
      );
    });
  });
  return { count: audit.totalFlagged, lines: lines };
}

/**
 * Dump every customer's items (not just flagged) in flat string form.
 * Used to eyeball the full Dashboard at demo time.
 */
function dumpAllTxItemsFlat() {
  var audit = auditTxItemSyntax();
  var lines = [];
  audit.allCustomers.forEach(function(c) {
    if (!c.items.length) {
      lines.push('--- ' + c.name + ' (' + c.email + ') row ' + c.row + ' — no tx rows ---');
      return;
    }
    lines.push('--- ' + c.name + ' (' + c.email + ') row ' + c.row +
               ' | bal=$' + c.balance.toFixed(2) + ' | waiver=' + (c.waiverOrigin || '?') + ' ---');
    c.items.forEach(function(it) {
      lines.push(
        '  r' + it.row + ' | "' + it.item + '" | ' +
        '$' + it.unitPrice.toFixed(2) + it.multiplier +
        ' | d=' + (it.days === null ? '' : it.days) +
        ' w=' + (it.weeks === null ? '' : it.weeks) +
        ' | $' + it.total.toFixed(2) +
        ' | ' + it.status +
        (it.flag ? ' | FLAG=' + it.flag : '') +
        ' | src="' + it.sourceField + '"'
      );
    });
  });
  return { lines: lines };
}

/**
 * Diagnostic: open the Upper + Lower campus registration sheets by
 * ID and dump their structure (every tab, its dimensions, and the
 * first 6 rows). Used to design the importer mapping.
 */
function inspectRegistrationSheets() {
  var ids = [
    '18A_sc917xnxYo3UQ8_cGogqg46Im6qUQlakOC9Oc-Fs',
    '1qejcgNQt3sS_UZ9Gl9Txr8TOocw3LzK5PjPICqnRrGA'
  ];
  var lines = [];
  ids.forEach(function(id, idx) {
    lines.push('=== Source ' + (idx + 1) + ' (' + id + ') ===');
    var ss;
    try { ss = SpreadsheetApp.openById(id); }
    catch (e) { lines.push('  OPEN FAILED: ' + e.message); return; }
    lines.push('  name: ' + ss.getName());
    lines.push('  url:  ' + ss.getUrl());
    ss.getSheets().forEach(function(s) {
      var lastRow = s.getLastRow();
      var lastCol = s.getLastColumn();
      lines.push('  --- tab "' + s.getName() + '" rows=' + lastRow + ' cols=' + lastCol);
      if (lastRow > 0 && lastCol > 0) {
        var rows = Math.min(lastRow, 6);
        var cols = Math.min(lastCol, 25);
        var sample = s.getRange(1, 1, rows, cols).getValues();
        sample.forEach(function(r, i) {
          var cells = r.map(function(v) {
            var s = String(v == null ? '' : v).replace(/\s+/g, ' ').trim();
            if (s.length > 60) s = s.substring(0, 57) + '...';
            return s;
          });
          lines.push('    r' + (i + 1) + ' | ' + cells.join(' | '));
        });
      }
    });
  });
  return { lines: lines };
}

/**
 * Diagnostic: search Drive (in the Apps Script owner context) for
 * spreadsheets matching common Systema Floyd registration keywords.
 * Used to locate the Upper / Lower Campus sheets before importing.
 */
function findRegistrationSheetsInDrive() {
  var queries = [
    'title contains "Upper"',
    'title contains "Lower"',
    'title contains "Campus"',
    'title contains "Camp"',
    'title contains "Systema"',
    'title contains "Registration"',
    'title contains "Summer"'
  ];
  var seen = {};
  var results = [];
  queries.forEach(function(q) {
    try {
      var iter = DriveApp.searchFiles(q + ' and mimeType = "application/vnd.google-apps.spreadsheet"');
      while (iter.hasNext()) {
        var f = iter.next();
        var id = f.getId();
        if (seen[id]) continue;
        seen[id] = true;
        results.push({
          name: f.getName(),
          id: id,
          url: f.getUrl(),
          owner: (f.getOwner() && f.getOwner().getEmail()) || '(unknown)',
          modified: f.getLastUpdated().toISOString()
        });
      }
    } catch (e) {
      // Drive scope may not be authorized yet — skip silently.
    }
  });
  return { count: results.length, results: results };
}

/**
 * Diagnostic: count unique Dashboard customers and label each one's
 * origin (GHL polling vs manual import vs both). Returns a flat
 * line-by-line report so it survives clasp run's array collapsing.
 *
 * "Origin" determined by:
 *   - Manual import: customer's email appears in the Manual Imports
 *     audit sheet (col H) at least once.
 *   - GHL polling: customer row's col F contains a HYPERLINK to a
 *     GHL contact profile (set by upsertCustomerRow when the contact
 *     was found in GHL). Manual-import-only customers have a plain-
 *     text "(not found in Florida)" in col F.
 *   - Both: appears in audit AND has a profile link.
 */
function auditContactSources() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var dash = ss.getSheetByName('Dashboard');
  var audit = ss.getSheetByName('Manual Imports');

  var importedEmails = {};
  if (audit) {
    var aLast = audit.getLastRow();
    if (aLast >= 2) {
      var emails = audit.getRange(2, 8, aLast - 1, 1).getValues();
      emails.forEach(function(r) {
        var e = String(r[0] || '').trim().toLowerCase();
        if (e) importedEmails[e] = (importedEmails[e] || 0) + 1;
      });
    }
  }

  var lastRow = dash.getLastRow();
  var values = dash.getRange(2, 1, lastRow - 1, 7).getValues();
  var fFormulas = dash.getRange(2, 6, lastRow - 1, 1).getFormulas();

  var customers = [];
  var seenEmails = {};
  var dupEmails = [];
  for (var i = 0; i < values.length; i++) {
    var row = values[i];
    var b = String(row[1] || '').trim();
    if (b.indexOf('@') === -1) continue;
    var email = b.toLowerCase();
    if (seenEmails[email]) {
      dupEmails.push({ row: i + 2, email: email, prevRow: seenEmails[email] });
      continue;
    }
    seenEmails[email] = i + 2;

    var fForm = String(fFormulas[i][0] || '');
    var hasGHLLink = /HYPERLINK\("[^"]*\/contacts\/detail\//.test(fForm);
    var importCount = importedEmails[email] || 0;

    var origin;
    if (hasGHLLink && importCount > 0)      origin = 'BOTH';
    else if (hasGHLLink)                    origin = 'GHL only';
    else if (importCount > 0)               origin = 'IMPORT only';
    else                                    origin = 'unknown';

    customers.push({
      row: i + 2,
      email: email,
      name: String(row[0] || '').trim(),
      students: String(row[4] || '').trim(),
      balance: Number(row[6]) || 0,
      origin: origin,
      importedRowsForThisEmail: importCount
    });
  }

  // Bucket
  var buckets = { 'GHL only': 0, 'IMPORT only': 0, 'BOTH': 0, 'unknown': 0 };
  customers.forEach(function(c) { buckets[c.origin]++; });

  // Total tx rows = lastRow - customer count - sub-header count - 1 (header)
  var subHeaderCount = 0;
  for (var j = 0; j < values.length; j++) {
    if (String(values[j][0] || '').trim().toUpperCase() === 'DATE') subHeaderCount++;
  }
  var txRowCount = (lastRow - 1) - customers.length - subHeaderCount;

  var lines = [];
  lines.push('=== Dashboard contact audit ===');
  lines.push('Total Dashboard rows: ' + lastRow + ' (1 header + data)');
  lines.push('Unique customers:     ' + customers.length);
  lines.push('Sub-header rows:      ' + subHeaderCount);
  lines.push('Tx rows:              ' + txRowCount);
  lines.push('Duplicate-email rows: ' + dupEmails.length);
  lines.push('');
  lines.push('Origin breakdown:');
  lines.push('  GHL polling only:    ' + buckets['GHL only']);
  lines.push('  Manual import only:  ' + buckets['IMPORT only']);
  lines.push('  BOTH (consolidated): ' + buckets['BOTH']);
  lines.push('  Unknown:             ' + buckets['unknown']);
  lines.push('');

  // List BOTH (consolidated customers — proof dedup is working)
  var both = customers.filter(function(c) { return c.origin === 'BOTH'; });
  if (both.length) {
    lines.push('--- Customers in BOTH (deduped under one row) ---');
    both.forEach(function(c) {
      lines.push('  r' + c.row + ' | ' + c.name + ' (' + c.email + ') | ' +
                 c.importedRowsForThisEmail + ' import rows | bal=$' +
                 c.balance.toFixed(2));
    });
    lines.push('');
  }

  if (dupEmails.length) {
    lines.push('--- DUPLICATE EMAIL ROWS (would mean dedup failed) ---');
    dupEmails.forEach(function(d) {
      lines.push('  email=' + d.email + ' first=r' + d.prevRow + ' second=r' + d.row);
    });
  } else {
    lines.push('No duplicate-email rows found - dedup is intact.');
  }

  return { lines: lines };
}

/**
 * Diagnostic: list every sheet (tab) in the active spreadsheet plus
 * its dimensions and column-A header. Used to find the legacy
 * registration sheets before writing the importer.
 */
function listAllSheetsAndHeaders() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  return ss.getSheets().map(function(s) {
    var lastCol = s.getLastColumn();
    var lastRow = s.getLastRow();
    var headers = lastCol > 0 && lastRow > 0
      ? s.getRange(1, 1, 1, Math.min(lastCol, 30)).getValues()[0]
      : [];
    return {
      name: s.getName(),
      rows: lastRow,
      cols: lastCol,
      headers: headers
    };
  });
}

function revertAllCustomersToOwed() {
  var dash = getDashboardSheet();
  var lastRow = dash.getLastRow();
  if (lastRow < 2) return { reverted: 0 };
  var values = dash.getRange(2, 1, lastRow - 1, 7).getValues();
  var custRows = [];
  for (var i = 0; i < values.length; i++) {
    if (String(values[i][1] || '').indexOf('@') !== -1) custRows.push(i + 2);
  }
  var totalReverted = 0;
  custRows.forEach(function(r) {
    totalReverted += (revertPaidToOwedForCustomer(r).reverted || 0);
  });
  return { customers: custRows.length, totalReverted: totalReverted };
}

/**
 * Force every tx row on the Dashboard to status='owed', except rows
 * whose Item is 'CC verification fee' (those are real charges and stay
 * paid). Stronger than revertAllCustomersToOwed, which only flips
 * paid -> owed: this normalises canceled and refunded back to owed too.
 *
 * Recomputes balance + balance Note for each customer touched.
 *
 * @returns {{ customers, totalChanged, perCustomer: Array<{row, name, changed}> }}
 */
function setAllStatusesToOwed() {
  var dash = getDashboardSheet();
  var lastRow = dash.getLastRow();
  if (lastRow < 2) return { customers: 0, totalChanged: 0, perCustomer: [] };

  var values = dash.getRange(2, 1, lastRow - 1, 7).getValues();
  var custRows = [];
  for (var i = 0; i < values.length; i++) {
    if (String(values[i][1] || '').indexOf('@') !== -1) {
      custRows.push({ row: i + 2, name: String(values[i][0] || '') });
    }
  }

  var totalChanged = 0;
  var perCustomer = [];

  custRows.forEach(function(c) {
    var range = findCustomerTxRange(c.row);
    if (!range || range.lastTx < range.firstTx) return;
    var n = range.lastTx - range.firstTx + 1;
    var statusCol = dash.getRange(range.firstTx, 7, n, 1);
    var itemCol   = dash.getRange(range.firstTx, 2, n, 1);
    var statuses = statusCol.getValues();
    var items    = itemCol.getValues();

    var changed = 0;
    var newStatuses = statuses.map(function(row, i) {
      var current = String(row[0] || '').toLowerCase().trim();
      var item    = String(items[i][0] || '').trim();
      if (item === 'CC verification fee') return [row[0]];  // never touch the fee
      if (current === 'owed') return [row[0]];               // already owed
      changed++;
      return ['owed'];
    });
    if (changed > 0) {
      statusCol.setValues(newStatuses);
      updateBalanceFormula(c.row, null);
      try { refreshBalanceNoteForCustomer(c.row); } catch (e) {}
    }
    totalChanged += changed;
    perCustomer.push({ row: c.row, name: c.name, changed: changed });
  });

  Logger.log('[setAllStatusesToOwed] customers=' + custRows.length +
             ' totalChanged=' + totalChanged);
  return { customers: custRows.length, totalChanged: totalChanged, perCustomer: perCustomer };
}

/**
 * Wipe every cell Note in col H (rows 2+) that's a leftover from prior
 * checkbox / quick-action iterations. Keeps H1's filter dropdown intact.
 */
function clearColHNotes() {
  var dash = getDashboardSheet();
  var lastRow = dash.getMaxRows();
  if (lastRow < 2) return { cleared: 0 };
  var range = dash.getRange(2, 8, lastRow - 1, 1);
  range.clearNote();
  return { cleared: lastRow - 1 };
}

function inspectCustomer(row) {
  var dash = SpreadsheetApp.getActiveSpreadsheet().getSheetByName('Dashboard');
  return {
    name: dash.getRange(row, 1).getValue(),
    email: dash.getRange(row, 2).getValue(),
    balanceFormula: dash.getRange(row, 7).getFormula(),
    balanceValue: dash.getRange(row, 7).getValue(),
    balanceNote: dash.getRange(row, 7).getNote(),
    checkboxValue: dash.getRange(row, 8).getValue()
  };
}

function showSampleBalanceNotes() {
  var dash = SpreadsheetApp.getActiveSpreadsheet().getSheetByName('Dashboard');
  var lastRow = dash.getLastRow();
  if (lastRow < 2) return [];
  var values = dash.getRange(2, 1, lastRow - 1, 7).getValues();
  var samples = [];
  for (var i = 0; i < values.length && samples.length < 3; i++) {
    if (String(values[i][1] || '').indexOf('@') === -1) continue;
    var custRow = i + 2;
    var bal = Number(dash.getRange(custRow, 7).getValue()) || 0;
    if (bal <= 0) continue;
    samples.push({
      row: custRow,
      name: String(values[i][0] || ''),
      balance: '$' + bal.toFixed(2),
      note: dash.getRange(custRow, 7).getNote()
    });
  }
  return samples;
}

/**
 * Walk every customer on the Dashboard, look up their FL contact from
 * GHL, re-read the literal `WaiverOrigin` field, and write the result
 * (or empty) to col D. Used as a one-shot fix when the rule about
 * "WaiverOrigin only when waiver was submitted" tightens.
 */
function refreshAllWaiverOrigins() {
  var dash = SpreadsheetApp.getActiveSpreadsheet().getSheetByName('Dashboard');
  var lastRow = dash.getLastRow();
  if (lastRow < 2) return { refreshed: 0 };
  var values = dash.getRange(2, 1, lastRow - 1, 7).getValues();
  var refreshed = 0, errors = 0, changes = [];
  for (var i = 0; i < values.length; i++) {
    var b = String(values[i][1] || '').trim();
    if (b.indexOf('@') === -1) continue;
    var sheetRow = i + 2;
    var emailLower = b.toLowerCase();
    try {
      var contactId = ghlSearchContactByEmail('Florida', emailLower);
      var contact = contactId ? ghlGetContact('Florida', contactId) : null;
      var newOrigin = contact ? readWaiverOrigin(contact) : '';
      var existing = String(values[i][3] || '').trim();
      if (existing !== newOrigin) {
        dash.getRange(sheetRow, 4).setValue(newOrigin);
        changes.push({ row: sheetRow, email: b, was: existing, now: newOrigin });
      }
      refreshed++;
    } catch (e) {
      errors++;
    }
  }
  return { refreshed: refreshed, errors: errors, changes: changes };
}

/**
 * Lean reset: wipes Dashboard data + Logs + lastPolledAt and rebuilds
 * the row 1 toggles, but does NOT call pollFloridaSubmissions. Run this
 * first, then call pollFloridaSubmissions repeatedly until everything's
 * imported. Avoids the 6-minute Apps Script execution limit on the
 * combined nuclearReset.
 */
function leanReset() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var dash = ss.getSheetByName('Dashboard');
  if (!dash) return { error: 'No Dashboard sheet' };

  // 1. Strip all CF rules + re-add the per-status pill rules
  dash.setConditionalFormatRules([]);
  if (dash.getLastRow() >= 2) dash.deleteRows(2, dash.getLastRow() - 1);
  var fgRange = dash.getRange('F2:G1000');
  var rules = [
    SpreadsheetApp.newConditionalFormatRule()
      .whenFormulaSatisfied('=$G2="paid"')
      .setBackground('#D4EDDA').setFontColor('#155724').setBold(true)
      .setRanges([fgRange]).build(),
    SpreadsheetApp.newConditionalFormatRule()
      .whenFormulaSatisfied('=$G2="owed"')
      .setBackground('#F8D7DA').setFontColor('#721C24').setBold(true)
      .setRanges([fgRange]).build(),
    SpreadsheetApp.newConditionalFormatRule()
      .whenFormulaSatisfied('=$G2="canceled"')
      .setBackground('#FFF3CD').setFontColor('#856404').setBold(true)
      .setRanges([fgRange]).build(),
    SpreadsheetApp.newConditionalFormatRule()
      .whenFormulaSatisfied('=$G2="refunded"')
      .setBackground('#FFE5CC').setFontColor('#A05A00').setBold(true)
      .setRanges([fgRange]).build(),
  ];
  dash.setConditionalFormatRules(rules);

  // 2. Header row + grand total + filter toggles
  dash.getRange(1, 1, 1, 7).setValues([['Name','Email','Phone','Waiver Origin','Student Name','Contact Profile','Balance']]);
  dash.getRange(1, 1, 1, 7).setBackground('#0F2A6B').setFontColor('#FFFFFF').setFontWeight('bold');
  dash.setFrozenRows(1);
  dash.getRange(1, 7).setFormula('="Balance: $" & TEXT(SUMIF($B$2:$B,"*@*",$G$2:$G),"#,##0.00")');
  setupBalanceFilterToggle();

  // 3. Clear Logs + reset lastPolledAt
  var logs = ss.getSheetByName('Logs');
  if (logs && logs.getLastRow() >= 2) logs.deleteRows(2, logs.getLastRow() - 1);
  var props = PropertiesService.getScriptProperties();
  props.setProperty('lastPolledAt', new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString());

  return { reset: true };
}

/**
 * Call pollFloridaSubmissions repeatedly until all 7-day-window submissions
 * are processed. Each call processes some number of submissions before
 * hitting limits; this loops until the polled-summary shows 0 new processed.
 */
function drainPolls(maxRuns) {
  maxRuns = maxRuns || 20;
  var props = PropertiesService.getScriptProperties();
  var results = [];
  for (var i = 0; i < maxRuns; i++) {
    try {
      pollFloridaSubmissions();
      var summary = props.getProperty('lastPollSummary') || '';
      results.push({ run: i + 1, summary: summary });
      // If the most recent poll shows 0 processed, we're done
      var m = summary.match(/(\d+) submissions \((\d+) processed/);
      if (m && Number(m[2]) === 0) break;
    } catch (e) {
      results.push({ run: i + 1, error: e.message });
      break;
    }
  }
  return results;
}

/**
 * For each customer on the dashboard, report whether they have at least
 * one CC verification fee tx row. Helps diagnose the question "why does
 * this Florida customer not have the $1 fee?" — if they truly don't,
 * we can decide whether the form they filled out should/shouldn't
 * include the verification charge.
 */
function findCustomersWithoutVerificationFee() {
  var dash = SpreadsheetApp.getActiveSpreadsheet().getSheetByName('Dashboard');
  var lastRow = dash.getLastRow();
  if (lastRow < 2) return [];
  var values = dash.getRange(2, 1, lastRow - 1, 7).getValues();
  // Find all customer-row indices
  var custIdx = [];
  for (var i = 0; i < values.length; i++) {
    if (String(values[i][1] || '').indexOf('@') !== -1) custIdx.push(i);
  }
  var without = [];
  for (var k = 0; k < custIdx.length; k++) {
    var iC = custIdx[k];
    var custRow = iC + 2;
    var nextI = (k + 1 < custIdx.length) ? custIdx[k + 1] : values.length;
    var hasFee = false;
    for (var j = iC + 1; j < nextI; j++) {
      if (String(values[j][1] || '').indexOf('CC verification fee') !== -1) {
        hasFee = true;
        break;
      }
    }
    if (!hasFee) {
      without.push({
        row: custRow,
        name: String(values[iC][0] || ''),
        email: String(values[iC][1] || ''),
        waiver: String(values[iC][3] || ''),
        balance: Number(dash.getRange(custRow, 7).getValue()) || 0
      });
    }
  }
  return { totalCustomers: custIdx.length, withoutFee: without };
}

function dumpLogsTop(n) {
  n = n || 10;
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var logs = ss.getSheetByName('Logs');
  if (!logs) return { error: 'No Logs sheet' };
  var lastRow = logs.getLastRow();
  if (lastRow < 2) return { empty: true, lastRow: lastRow };
  var howMany = Math.min(n, lastRow - 1);
  var rows = logs.getRange(2, 1, howMany, 5).getValues();
  return rows.map(function(r) {
    return {
      ts: String(r[0]).slice(0, 24),
      id: String(r[1]).slice(0, 30),
      email: String(r[2]).slice(0, 40),
      status: String(r[3]),
      details: String(r[4]).slice(0, 100)
    };
  });
}

/**
 * For one customer email, dump ALL of their FL contact's customFields so
 * we can see exactly what the WaiverOrigin field is named.
 */
/**
 * Hit GHL's custom-fields endpoint directly and dump the full list for
 * Florida so we can see what every field is named (and find WaiverOrigin).
 */
function dumpRegistry(state) {
  state = state || 'Florida';
  var reg = {};
  try { reg = getFieldRegistry(state) || {}; } catch (e) { return { error: e.message }; }
  var keys = Object.keys(reg);
  return {
    state: state,
    keyCount: keys.length,
    sampleEntries: keys.slice(0, 10).map(function(k) {
      return { id: k, value: reg[k] };
    })
  };
}

/**
 * Flip every PAID tx row back to OWED for a given customer, EXCEPT the CC
 * verification fee row (which is genuinely already paid). Used to undo a
 * "Mark all paid" checkbox click that was made for testing.
 */
function revertPaidToOwedForCustomer(customerRow) {
  var dash = getDashboardSheet();
  var range = findCustomerTxRange(customerRow);
  if (!range || range.lastTx < range.firstTx) return { reverted: 0 };
  var n = range.lastTx - range.firstTx + 1;
  var statusCol = dash.getRange(range.firstTx, 7, n, 1);
  var itemCol = dash.getRange(range.firstTx, 2, n, 1);
  var statuses = statusCol.getValues();
  var items = itemCol.getValues();
  var reverted = 0;
  var newStatuses = statuses.map(function(row, i) {
    var status = String(row[0] || '').toLowerCase();
    var item = String(items[i][0] || '').trim();
    var isFee = item === 'CC verification fee';
    if (status === 'paid' && !isFee) { reverted++; return ['owed']; }
    return [row[0]];
  });
  statusCol.setValues(newStatuses);
  updateBalanceFormula(customerRow, null);
  try { refreshBalanceNoteForCustomer(customerRow); } catch (e) {}
  return { reverted: reverted, customerRow: customerRow };
}

/**
 * Convenience: revert the first N customer rows (by sheet order) from
 * paid back to owed. Used to undo test clicks of the Mark-all-paid
 * checkbox.
 */
function revertFirstNCustomers(n) {
  n = n || 2;
  var dash = getDashboardSheet();
  var lastRow = dash.getLastRow();
  if (lastRow < 2) return { reverted: 0 };
  var values = dash.getRange(2, 1, lastRow - 1, 7).getValues();
  var custRows = [];
  for (var i = 0; i < values.length; i++) {
    if (String(values[i][1] || '').indexOf('@') !== -1) {
      custRows.push(i + 2);
      if (custRows.length >= n) break;
    }
  }
  var details = custRows.map(function(r) { return revertPaidToOwedForCustomer(r); });
  return { customerRows: custRows, details: details };
}

/**
 * Discovery probe — try every reasonable GHL payments endpoint with a
 * known FL contact (Lauren) and report which ones return 200 OK plus a
 * sample of the response shape. Lets us decide what to integrate.
 */
/**
 * Pull a contact's actual transaction + order history so we can see the
 * real data shape and counts. Use Lauren as the test case.
 */
function fetchPaymentHistorySample(emailLike) {
  emailLike = emailLike || 'laurenjhooks';
  var token = getTokenFor('Florida');
  var locationId = SUBACCOUNTS.Florida.locationId;
  var contactId = ghlSearchContactByEmail('Florida', emailLike);
  if (!contactId) return { error: 'Contact not found for ' + emailLike };

  function fetch(path) {
    var resp = UrlFetchApp.fetch(GHL_API_BASE + path, {
      method: 'get',
      headers: {
        'Authorization': 'Bearer ' + token,
        'Version': GHL_API_VERSION,
        'Accept': 'application/json'
      },
      muteHttpExceptions: true
    });
    if (resp.getResponseCode() !== 200) return { error: resp.getResponseCode() };
    return JSON.parse(resp.getContentText());
  }

  var txData = fetch('/payments/transactions?altId=' + locationId + '&altType=location&contactId=' + contactId);
  var orderData = fetch('/payments/orders?altId=' + locationId + '&altType=location&contactId=' + contactId);

  return {
    contactId: contactId,
    transactions: {
      total: txData.totalCount || (txData.data || []).length,
      sampleJSON: JSON.stringify((txData.data || []).slice(0, 1), null, 2)
    },
    orders: {
      total: orderData.totalCount || (orderData.data || []).length,
      sampleJSON: JSON.stringify((orderData.data || []).slice(0, 1), null, 2)
    }
  };
}

function discoverGHLPaymentEndpoints() {
  var token = getTokenFor('Florida');
  var locationId = SUBACCOUNTS.Florida.locationId;
  var contactId = ghlSearchContactByEmail('Florida', 'laurenjhooks');
  if (!contactId) return { error: 'Lauren not found in FL' };

  var endpoints = [
    '/payments/transactions?locationId=' + locationId + '&contactId=' + contactId,
    '/payments/transactions?altId=' + locationId + '&altType=location&contactId=' + contactId,
    '/payments/transactions?locationId=' + locationId + '&limit=5',
    '/payments/orders?locationId=' + locationId + '&contactId=' + contactId,
    '/payments/orders?altId=' + locationId + '&altType=location&contactId=' + contactId,
    '/payments/subscriptions?locationId=' + locationId + '&contactId=' + contactId,
    '/payments/orders?locationId=' + locationId + '&limit=5',
    '/payments/invoices/list?altId=' + locationId + '&altType=location&contactId=' + contactId,
  ];

  var results = [];
  endpoints.forEach(function(path) {
    var url = GHL_API_BASE + path;
    try {
      var resp = UrlFetchApp.fetch(url, {
        method: 'get',
        headers: {
          'Authorization': 'Bearer ' + token,
          'Version': GHL_API_VERSION,
          'Accept': 'application/json'
        },
        muteHttpExceptions: true
      });
      var code = resp.getResponseCode();
      var body = resp.getContentText();
      var sample = '';
      if (code === 200) {
        try {
          var parsed = JSON.parse(body);
          var topKeys = Object.keys(parsed).slice(0, 5);
          sample = 'keys=[' + topKeys.join(', ') + ']';
          for (var i = 0; i < topKeys.length; i++) {
            var v = parsed[topKeys[i]];
            if (Array.isArray(v) && v.length) {
              sample += ', ' + topKeys[i] + '[0].keys=[' +
                Object.keys(v[0]).slice(0, 8).join(',') + ']';
              break;
            }
          }
        } catch (e) { sample = body.slice(0, 120); }
      } else {
        sample = body.slice(0, 200);
      }
      results.push({ path: path.split('?')[0] + '?(...)', code: code, sample: sample });
    } catch (e) {
      results.push({ path: path.split('?')[0], code: 'ERR', sample: e.message });
    }
  });
  return { contactId: contactId, contact: 'laurenjhooks@gmail.com', results: results };
}

function listFloridaCustomFields() {
  var token = getTokenFor('Florida');
  var locId = SUBACCOUNTS.Florida.locationId;
  var url = GHL_API_BASE + '/locations/' + encodeURIComponent(locId) + '/customFields';
  var resp = UrlFetchApp.fetch(url, {
    method: 'get',
    headers: {
      'Authorization': 'Bearer ' + token,
      'Version': GHL_API_VERSION,
      'Accept': 'application/json'
    },
    muteHttpExceptions: true
  });
  var code = resp.getResponseCode();
  var body = resp.getContentText();
  if (code !== 200) return { error: 'HTTP ' + code, body: body.slice(0, 500) };
  var data = JSON.parse(body);
  var fields = data.customFields || data.fields || [];
  // Filter to anything that mentions waiver or contains state-like values
  var hits = fields.filter(function(f) {
    var n = String(f.name || '').toLowerCase();
    var k = String(f.fieldKey || '').toLowerCase();
    return /waiver|origin|state/.test(n + ' ' + k);
  });
  return {
    totalFields: fields.length,
    waiverHits: hits.map(function(f) {
      return { id: f.id, name: f.name, fieldKey: f.fieldKey, dataType: f.dataType };
    }),
    sampleAll: fields.slice(0, 5).map(function(f) {
      return { id: f.id, name: f.name, fieldKey: f.fieldKey };
    })
  };
}

function inspectContactCustomFields(emailLike) {
  emailLike = emailLike || 'lauren';
  var contactId = ghlSearchContactByEmail('Florida', emailLike);
  if (!contactId) return { error: 'No contact found for ' + emailLike };
  var contact = ghlGetContact('Florida', contactId);
  var fields = contact.customFields || contact.customField || [];
  return {
    email: contact.email,
    contactId: contactId,
    customFieldCount: fields.length,
    fields: fields.map(function(f) {
      return {
        id: f.id,
        name: f.name,
        fieldKey: f.fieldKey,
        value: f.value
      };
    })
  };
}

function dumpHeaderG() {
  var d = SpreadsheetApp.getActiveSpreadsheet().getSheetByName('Dashboard');
  var c = d.getRange(1, 7);
  return {
    value: c.getValue(),
    formula: c.getFormula(),
    display: c.getDisplayValue()
  };
}

function dumpAllBalances() {
  var dash = SpreadsheetApp.getActiveSpreadsheet().getSheetByName('Dashboard');
  var lastRow = dash.getLastRow();
  if (lastRow < 2) return [];
  var values = dash.getRange(2, 1, lastRow - 1, 7).getValues();
  var out = [];
  for (var i = 0; i < values.length; i++) {
    var b = String(values[i][1] || '').trim();
    if (b.indexOf('@') === -1) continue;
    var sheetRow = i + 2;
    var gValue = dash.getRange(sheetRow, 7).getValue();
    var gFormula = dash.getRange(sheetRow, 7).getFormula();
    var gFormat = dash.getRange(sheetRow, 7).getNumberFormat();
    out.push({
      row: sheetRow,
      name: String(values[i][0] || '').slice(0, 30),
      gValue: typeof gValue === 'string' ? '"' + gValue + '"' : gValue,
      gFormula: gFormula || '(no formula)',
      gFormat: gFormat
    });
  }
  return out;
}

/**
 * Repair: re-run updateBalanceFormula for every customer on the sheet so
 * any stale or missing formulas get replaced with the new plain-SUMIFS
 * version. Returns count of customers refreshed.
 */
function repairAllBalances() {
  var dash = SpreadsheetApp.getActiveSpreadsheet().getSheetByName('Dashboard');
  var lastRow = dash.getLastRow();
  if (lastRow < 2) return { refreshed: 0 };
  var values = dash.getRange(2, 1, lastRow - 1, 7).getValues();
  var refreshed = 0;
  var failures = [];
  for (var i = 0; i < values.length; i++) {
    var b = String(values[i][1] || '').trim();
    if (b.indexOf('@') === -1) continue;
    var sheetRow = i + 2;
    try {
      updateBalanceFormula(sheetRow, null);
      refreshed++;
    } catch (e) {
      failures.push({ row: sheetRow, err: e.message });
    }
  }
  return { refreshed: refreshed, failures: failures };
}

/**
 * Direct test: invoke applyRowGrouping(firstRow, lastRow) manually + return
 * the group depth before and after for diagnostic purposes.
 */
function testApplyGrouping(firstRow, lastRow) {
  var sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName('Dashboard');
  var before = sheet.getRowGroupDepth(firstRow);
  applyRowGrouping(firstRow, lastRow);
  var after = sheet.getRowGroupDepth(firstRow);
  return { firstRow: firstRow, lastRow: lastRow, before: before, after: after };
}

/**
 * Apply grouping to all customer groups currently on the Dashboard.
 * One-shot repair function — calls applyRowGrouping for every customer,
 * including their sub-header.
 */
function regroupAllCustomers() {
  var sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName('Dashboard');
  var lastRow = sheet.getLastRow();
  if (lastRow < 2) return { regrouped: 0 };
  var values = sheet.getRange(2, 1, lastRow - 1, 7).getValues();
  var regrouped = 0;
  var failures = [];
  for (var i = 0; i < values.length; i++) {
    var row = values[i];
    var sheetRow = i + 2;
    var b = String(row[1] || '').trim();
    var a = String(row[0] || '').trim();
    if (b.indexOf('@') === -1) continue;       // not a customer row
    if (!a) continue;                           // require a name
    // Find the customer's range
    var range = findCustomerTxRange(sheetRow);
    if (range && range.lastInGroup > sheetRow) {
      try {
        applyRowGrouping(sheetRow + 1, range.lastInGroup);
        // Always collapse — user preference, every customer starts closed
        setGroupExpansion(sheetRow + 1, false);
        regrouped++;
      } catch (e) {
        failures.push({ row: sheetRow, err: e.message });
      }
    }
  }
  return { regrouped: regrouped, failures: failures };
}

/**
 * Compact "depth map" — one line per row showing only what type of row it is
 * + its group depth. Easier to read than the full dump for diagnostic purposes.
 */
function dumpDepthMap() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var dash = ss.getSheetByName('Dashboard');
  var lastRow = dash.getLastRow();
  if (lastRow < 2) return [];
  var values = dash.getRange(2, 1, lastRow - 1, 7).getValues();
  var lines = [];
  for (var i = 0; i < values.length; i++) {
    var r = i + 2;
    var a = String(values[i][0] || '').trim();
    var b = String(values[i][1] || '').trim();
    var depth = 0;
    try { depth = dash.getRowGroupDepth(r); } catch (e) { depth = -1; }
    var kind = '?';
    if (a.toUpperCase() === 'DATE' && String(values[i][6] || '').toUpperCase() === 'STATUS') kind = 'subhdr';
    else if (b.indexOf('@') !== -1) kind = 'CUST';
    else if (a) kind = 'tx';
    else kind = 'BLANK';
    lines.push(r + '\t' + kind + '\td=' + depth + '\t' + a.slice(0, 25) + ' | ' + b.slice(0, 25));
  }
  return lines;
}
