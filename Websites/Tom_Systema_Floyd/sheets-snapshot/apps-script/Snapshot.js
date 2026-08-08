/**
 * Floyd Roster Snapshot API
 *
 * Reads the four canonical registration spreadsheets owned by
 * systemafloydsheets@gmail.com and emits a snapshot in the exact shape
 * Tom_Systema_Floyd/dashboard/index.html consumes from snapshot.json.
 *
 * Tab N in each sheet maps to WEEK_ORDER[N-1]. Tab order = chronological week order.
 *
 * Sheets:
 *   Upper Campus: Systema Summer Camp 2026          → roster.upper, type=summer, campus=Upper
 *   Lower Campus: Systema Summer Camp 2026          → roster.lower, type=summer, campus=Lower
 *   FREE Summer Camp 2026 - Higher Campus: Systema  → roster.free,  type=free,   campus=Upper
 *   FREE Summer Camp 2026 - Lower Campus: Systema   → roster.free,  type=free,   campus=Lower
 *
 * Web app endpoint:
 *   GET → JSON snapshot
 *   GET ?key=<token> → same; key is optional read-protection if SECRET_KEY is set
 */

const SHEETS = {
  upper:      '1qejcgNQt3sS_UZ9Gl9Txr8TOocw3LzK5PjPICqnRrGA',
  lower:      '18A_sc917xnxYo3UQ8_cGogqg46Im6qUQlakOC9Oc-Fs',
  freeUpper:  '1rK4p6jS1xqSf1qNO9-3ljCRzJcUIDF87sNo_UehBWYQ',
  freeLower:  '1_659v7by990V4OJMd86nBG-HUN6_AzZNOAPoQN0LMxY',
};

const WEEK_ORDER = [
  'June 1st-5th',
  'June 8th-12th',
  'June 15th-19th',
  'June 22nd-26th',
  'June 29th-July 3rd',
  'July 6th-10th',
  'July 13th-17th',
  'July 20th-24th',
  'July 27th-31st',
  'August 3rd-7th',
  'August 10th-14th',
  'August 17th-21st',
  'August 24th-28th',
];

// Free Summer Camp (Related Ross Foundation scholarship) runs 10 weeks
// from June 1 to August 7, 2026 per Tom (2026-05-26). The paid camp sheets
// have extra tabs through August (Aug 10+), and the free-camp workbooks
// mirror that tab structure, but those weeks aren't actually free-camp
// weeks. Capping freeWeekOrder here keeps the dashboard's seasonCap
// (= weeklyCap × numWeeks) at the correct 350 spots instead of 420.
const FREE_PROGRAM_WEEKS = WEEK_ORDER.slice(0, 10);

const PROGRAM_ORDER = [
  'Foundations Block',
  'School Pickup Track',
  'Homework & Discipline Lab',
  'Minis Movement',
  'Leadership Apprentice',
];
const DAY_ORDER = ['Monday','Tuesday','Wednesday','Thursday','Friday'];

const CUTOFF_ISO = '2026-06-01';
const LOCATION_ID = '8IWtNFlmgJ8bif9DivHT';

function doGet(e) {
  try {
    const params = (e && e.parameter) || {};
    const expected = PropertiesService.getScriptProperties().getProperty('SECRET_KEY');
    if (expected && params.key !== expected) {
      return ContentService.createTextOutput(JSON.stringify({ error: 'unauthorized' }))
        .setMimeType(ContentService.MimeType.JSON);
    }
    const snap = buildSnapshot();
    const clean = stripInternalFields_(snap);
    redactRosterPii_(clean);
    const out = ContentService.createTextOutput(JSON.stringify(clean))
      .setMimeType(ContentService.MimeType.JSON);
    return out;
  } catch (err) {
    return ContentService.createTextOutput(JSON.stringify({
      error: String(err && err.message || err),
      stack: String(err && err.stack || ''),
    })).setMimeType(ContentService.MimeType.JSON);
  }
}

/* ───────────────────────── Core builder ───────────────────────── */

function buildSnapshot() {
  const summerWeeksSeen = {};
  const freeWeeksSeen   = {};
  const summerEnrollments = readCampSheet_(SHEETS.upper, 'Upper Campus', summerWeeksSeen);
  const lowerEnrollments  = readCampSheet_(SHEETS.lower, 'Lower Campus', summerWeeksSeen);
  const freeUpperEnrolls  = readFreeSheet_(SHEETS.freeUpper, 'Upper Campus', freeWeeksSeen);
  const freeLowerEnrolls  = readFreeSheet_(SHEETS.freeLower, 'Lower Campus', freeWeeksSeen);

  const allSummer = summerEnrollments.concat(lowerEnrollments);
  const allFree   = freeUpperEnrolls.concat(freeLowerEnrolls);

  const summerWeekOrder = WEEK_ORDER.filter(w => summerWeeksSeen[w]);
  // Free camp is fixed at 10 weeks (Jun 1 - Aug 7); ignore the extra Aug
  // tabs that mirror the paid-camp workbook structure.
  const freeWeekOrder   = FREE_PROGRAM_WEEKS.filter(w => freeWeeksSeen[w]);

  const summer   = aggregate_(allSummer, 'summer');
  const free     = aggregate_(allFree,   'free');
  // Combined dedup: a kid in both summer + free counts once toward unique
  // totals, so re-run the aggregator over the merged list rather than
  // adding the two slice totals (that would double-count crossover kids).
  const combined = aggregate_(allSummer.concat(allFree), 'combined');

  const lunches = {
    summer: aggregateLunches_(allSummer),
    free:   aggregateLunches_(allFree),
  };

  const roster = buildRoster_(allSummer, allFree);
  const bySchool = {};
  allFree.forEach(e => {
    if (e.school) bySchool[e.school] = (bySchool[e.school] || 0) + 1;
  });

  const snap = {
    _allSummer: allSummer,
    _allFree:   allFree,
    generatedAt: new Date().toISOString().replace(/\.\d{3}Z$/, 'Z'),
    locationId:  LOCATION_ID,
    cutoff:      CUTOFF_ISO,
    source:      'sheets',
    totals: {
      contacts:        0,
      summer:          summer.total,
      free:            free.total,
      afterSchool:     0,
      leadOnly:        0,
      newLast7Days:    0,
      newLast30Days:   0,
    },
    weekOrder:    WEEK_ORDER,
    programOrder: PROGRAM_ORDER,
    dayOrder:     DAY_ORDER,
    afterSchool: emptyAfterSchool_(),
    summer: {
      total:        summer.total,
      byCampus:     summer.byCampus,
      byWeek:       summer.byWeek,
      byWeekCampus: summer.byWeekCampus,
      weekOrder:    summerWeekOrder,
    },
    free: {
      total:        free.total,
      byCampus:     free.byCampus,
      byWeek:       free.byWeek,
      byWeekCampus: free.byWeekCampus,
      bySchool:     sortDesc_(bySchool),
      weekOrder:    freeWeekOrder,
    },
    combined: combined,
    lunches:  lunches,
    interest: {},
    sources:  {},
    roster:   roster,
  };
  return snap;
}

/** Strip non-serializable internal fields (prefix _) before writing JSON. */
function stripInternalFields_(snap) {
  const out = {};
  Object.keys(snap).forEach(function(k) { if (k.charAt(0) !== '_') out[k] = snap[k]; });
  return out;
}

/** Blank child PII (email, allergy, notes) from the roster before it is written to
 *  the PUBLIC snapshot.json / web endpoint. This repo is served publicly via GitHub
 *  Pages, so these fields must NOT ship in the file. The full values stay in Supabase
 *  (sf_camp_enrollments, upserted from the raw _allSummer/_allFree rows), where the
 *  dashboard reads them via the staff-gated sf_camp_roster_pii RPC. Names/schedule/
 *  lunch are kept so the dashboard roster, attendance, and lunch views still work. */
function redactRosterPii_(snap) {
  if (!snap || !snap.roster) return;
  Object.keys(snap.roster).forEach(function(week) {
    ['upper', 'lower', 'free'].forEach(function(bucket) {
      (snap.roster[week][bucket] || []).forEach(function(entry) {
        entry.email = null;
        entry.allergy = null;
        entry.notes = null;
      });
    });
  });
}

/* ───────────────────────── Sheet readers ───────────────────────── */

function readCampSheet_(spreadsheetId, campusLabel, weeksSeen) {
  const ss = SpreadsheetApp.openById(spreadsheetId);
  const tabs = ss.getSheets();
  const enrollments = [];
  for (let i = 0; i < tabs.length; i++) {
    const sheet = tabs[i];
    const week = resolveWeek_(sheet.getName(), i);
    if (!week) continue;
    if (weeksSeen) weeksSeen[week] = true;
    const range = sheet.getDataRange();
    if (!range || range.getNumRows() < 2) continue;
    const values = range.getValues();
    const header = values[0].map(h => normalizeHeader_(h));
    const idx = headerIndex_(header, [
      'Student Name', 'Age', 'Breakfast', 'Lunch',
      'Before / After Care', 'Shirt?', 'Email', 'Additional Notes',
      'Mon', 'Tue', 'Wed', 'Thu', 'Fri',
    ]);
    for (let r = 1; r < values.length; r++) {
      const row = values[r];
      const name = String(row[idx['Student Name']] || '').trim();
      if (!name) continue;
      const email = String(row[idx['Email']] || '').trim();
      const ageVal = idx['Age'] >= 0 ? String(row[idx['Age']] || '').trim() : '';
      const shirtVal = idx['Shirt?'] >= 0 ? String(row[idx['Shirt?']] || '').trim() : '';
      const lunchVal = idx['Lunch'] >= 0 ? String(row[idx['Lunch']] || '').trim() : '';
      const breakfastVal = idx['Breakfast'] >= 0 ? String(row[idx['Breakfast']] || '').trim() : '';
      const notes = idx['Additional Notes'] >= 0 ? String(row[idx['Additional Notes']] || '').trim() : '';
      const days = ['Mon','Tue','Wed','Thu','Fri'].map(d => isDayChecked_(row[idx[d]]));
      const anyDayPicked = days.some(Boolean);
      const missingFields = [];
      if (!email)         missingFields.push('Email');
      if (!ageVal)        missingFields.push('Age');
      if (!lunchVal)      missingFields.push('Lunch');
      if (!anyDayPicked)  missingFields.push('Days attending');
      enrollments.push({
        type: 'summer',
        week: week,
        campus: campusLabel,
        name: name,
        email: email || null,
        lunch: hasLunch_(lunchVal),
        lunchRaw: lunchVal || null,
        breakfastRaw: breakfastVal || null,
        allergy: extractAllergy_(notes),
        notes: notes || null,
        days: days,
        incomplete: missingFields.length > 0,
        missingFields: missingFields,
        sourceSheetId: spreadsheetId,
        sourceGid: sheet.getSheetId(),
        sourceTabName: sheet.getName(),
        sourceRow: r + 1,
      });
    }
  }
  return enrollments;
}

function readFreeSheet_(spreadsheetId, campusLabel, weeksSeen) {
  const ss = SpreadsheetApp.openById(spreadsheetId);
  const tabs = ss.getSheets();
  const enrollments = [];
  for (let i = 0; i < tabs.length; i++) {
    const sheet = tabs[i];
    const week = resolveWeek_(sheet.getName(), i);
    if (!week) continue;
    if (weeksSeen) weeksSeen[week] = true;
    const range = sheet.getDataRange();
    if (!range || range.getNumRows() < 2) continue;
    const values = range.getValues();
    const header = values[0].map(h => normalizeHeader_(h));
    const idx = headerIndex_(header, [
      'School', 'Student Name', 'Grade', 'Age', 'Shirt Size',
      'Breakfast', 'Lunch', 'Email Address', 'Parent/Guardian Name',
    ]);
    for (let r = 1; r < values.length; r++) {
      const row = values[r];
      const name = String(row[idx['Student Name']] || '').trim();
      if (!name) continue;
      const email = idx['Email Address'] >= 0 ? String(row[idx['Email Address']] || '').trim() : '';
      const lunchVal = idx['Lunch'] >= 0 ? String(row[idx['Lunch']] || '').trim() : '';
      const breakfastVal = idx['Breakfast'] >= 0 ? String(row[idx['Breakfast']] || '').trim() : '';
      const school = idx['School'] >= 0 ? String(row[idx['School']] || '').trim() : '';
      const parentName = idx['Parent/Guardian Name'] >= 0 ? String(row[idx['Parent/Guardian Name']] || '').trim() : '';
      const ageVal = idx['Age'] >= 0 ? String(row[idx['Age']] || '').trim() : '';
      const gradeVal = idx['Grade'] >= 0 ? String(row[idx['Grade']] || '').trim() : '';
      // Free sheets currently have no per-day attendance columns, so assume
      // a kid attends every weekday they're registered for that week.
      const days = [true, true, true, true, true];
      const missingFields = [];
      if (!email)       missingFields.push('Email');
      if (!school)      missingFields.push('School');
      if (!parentName)  missingFields.push('Parent/Guardian name');
      if (!gradeVal)    missingFields.push('Grade');
      if (!ageVal)      missingFields.push('Age');
      enrollments.push({
        type: 'free',
        week: week,
        campus: campusLabel,
        name: name,
        email: email || null,
        lunch: hasLunch_(lunchVal),
        lunchRaw: lunchVal || null,
        breakfastRaw: breakfastVal || null,
        allergy: null,
        school: school || null,
        days: days,
        incomplete: missingFields.length > 0,
        missingFields: missingFields,
        sourceSheetId: spreadsheetId,
        sourceGid: sheet.getSheetId(),
        sourceTabName: sheet.getName(),
        sourceRow: r + 1,
      });
    }
  }
  return enrollments;
}

/* ───────────────────────── Week resolver ─────────────────────────
 * Map a sheet tab name to one of WEEK_ORDER. Tabs are often named
 * loosely ("Jun 8-12", "June 8 - 12", "6/8-6/12", "June 8th-12th").
 * We extract the month + first day number and match against the canonical
 * WEEK_ORDER labels. Falls back to tab position if the name can't be parsed
 * (preserves legacy behavior). Returns null if no week can be resolved.
 */
const WEEK_KEY_MAP = (function() {
  const m = {};
  WEEK_ORDER.forEach(function(w) {
    const k = weekKey_(w);
    if (k) m[k] = w;
  });
  return m;
})();

function weekKey_(label) {
  if (!label) return null;
  const months = { jan:1,feb:2,mar:3,apr:4,may:5,jun:6,jul:7,aug:8,sep:9,oct:10,nov:11,dec:12 };
  const s = String(label).toLowerCase().replace(/(\d+)(st|nd|rd|th)/g, '$1');
  // Try "<month> <day>" pattern (e.g. "june 8 12", "jun 8-12")
  let m = s.match(/(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\s*(\d{1,2})/);
  if (m) return months[m[1]] + '-' + parseInt(m[2], 10);
  // Try "M/D" pattern (e.g. "6/8")
  m = s.match(/(\d{1,2})\/(\d{1,2})/);
  if (m) return parseInt(m[1], 10) + '-' + parseInt(m[2], 10);
  return null;
}

function resolveWeek_(tabName, fallbackIndex) {
  const key = weekKey_(tabName);
  if (key && WEEK_KEY_MAP[key]) return WEEK_KEY_MAP[key];
  if (fallbackIndex < WEEK_ORDER.length) return WEEK_ORDER[fallbackIndex];
  return null;
}

/* ───────────────────────── Aggregation ───────────────────────── */

/**
 * Aggregate raw rows into the dashboard's expected slice shape.
 *
 *   total          = unique students across all weeks (kpi-num "total" card)
 *   byCampus       = unique students per campus (kpi-num "upper"/"lower")
 *   byWeek         = enrollments per week, intra-week deduped
 *                    (subtitle "X enrollments in total" = sum of byWeek)
 *   byWeekCampus   = enrollments per week × campus (stacked bar input)
 *
 * Intra-week dedup: if the same student has two rows in the same week's tab
 * (re-submission, manual paste, etc), it counts as one enrollment for that
 * week. Across weeks, each week-attendance still counts once toward
 * enrollments — that's what makes total < enrollments for multi-week kids.
 */
function aggregate_(enrollments, type) {
  const byWeek = WEEK_ORDER.reduce((m, w) => { m[w] = 0; return m; }, {});
  const byWeekCampus = WEEK_ORDER.reduce((m, w) => {
    m[w] = { 'Upper Campus': 0, 'Lower Campus': 0, 'Unknown': 0 };
    return m;
  }, {});

  const seenInWeek = {};       // weekKey -> { nameKey: true }
  const primaryCampus = {};    // nameKey -> first-seen campus (so a kid is
                               // counted once globally toward exactly one
                               // campus, byCampus.* sums to total cleanly)

  enrollments.forEach(e => {
    if (!byWeek.hasOwnProperty(e.week)) return;
    const nameKey = nameKey_(e.name);
    if (!nameKey) return;
    const ck = (e.campus === 'Upper Campus' || e.campus === 'Lower Campus') ? e.campus : 'Unknown';

    if (!seenInWeek[e.week]) seenInWeek[e.week] = {};
    if (seenInWeek[e.week][nameKey]) return;      // intra-week dup, skip
    seenInWeek[e.week][nameKey] = true;

    byWeek[e.week]++;
    byWeekCampus[e.week][ck]++;

    if (!primaryCampus[nameKey]) primaryCampus[nameKey] = ck;
  });

  const byCampus = { 'Upper Campus': 0, 'Lower Campus': 0, 'Unknown': 0 };
  Object.keys(primaryCampus).forEach(k => { byCampus[primaryCampus[k]]++; });

  return {
    total:        Object.keys(primaryCampus).length,
    enrollments:  Object.values(byWeek).reduce((a, b) => a + b, 0),
    byCampus,
    byWeek,
    byWeekCampus,
  };
}

function nameKey_(s) {
  return String(s == null ? '' : s).trim().toLowerCase().replace(/\s+/g, ' ');
}

function buildRoster_(allSummer, allFree) {
  const roster = WEEK_ORDER.reduce((m, w) => {
    m[w] = { upper: [], lower: [], free: [] };
    return m;
  }, {});
  // Per-week dedup so a kid appearing twice in the same tab shows once.
  const seenSummer = {};   // weekKey -> { nameKey: true }
  const seenFree   = {};
  allSummer.forEach(e => {
    if (!roster[e.week]) return;
    const k = nameKey_(e.name);
    if (!k) return;
    if (!seenSummer[e.week]) seenSummer[e.week] = {};
    if (seenSummer[e.week][k]) return;
    seenSummer[e.week][k] = true;
    const bucket = e.campus === 'Upper Campus' ? 'upper' : 'lower';
    roster[e.week][bucket].push({
      name: e.name,
      campus: e.campus,
      lunch: e.lunch,
      lunchRaw: e.lunchRaw || null,
      breakfastRaw: e.breakfastRaw || null,
      allergy: e.allergy,
      notes: e.notes || null,
      email: e.email || null,
      incomplete: e.incomplete,
      missingFields: e.missingFields || [],
      sourceSheetId: e.sourceSheetId || null,
      sourceGid: (e.sourceGid != null ? e.sourceGid : null),
      sourceTabName: e.sourceTabName || null,
      sourceRow: e.sourceRow || null,
      days: e.days || [true,true,true,true,true],
      type: 'summer',
    });
  });
  allFree.forEach(e => {
    if (!roster[e.week]) return;
    const k = nameKey_(e.name);
    if (!k) return;
    if (!seenFree[e.week]) seenFree[e.week] = {};
    if (seenFree[e.week][k]) return;
    seenFree[e.week][k] = true;
    roster[e.week].free.push({
      name: e.name,
      campus: e.campus || 'Unknown',
      lunch: e.lunch,
      lunchRaw: e.lunchRaw || null,
      breakfastRaw: e.breakfastRaw || null,
      allergy: null,
      notes: null,
      email: e.email || null,
      incomplete: e.incomplete,
      missingFields: e.missingFields || [],
      sourceSheetId: e.sourceSheetId || null,
      sourceGid: (e.sourceGid != null ? e.sourceGid : null),
      sourceTabName: e.sourceTabName || null,
      sourceRow: e.sourceRow || null,
      days: [true,true,true,true,true],
      type: 'free',
      school: e.school || null,
    });
  });
  WEEK_ORDER.forEach(w => {
    ['upper','lower','free'].forEach(b => {
      roster[w][b].sort((a, b2) => a.name.toLowerCase().localeCompare(b2.name.toLowerCase()));
    });
  });
  return roster;
}

/* ───────────────── Lunch parsing + aggregation ─────────────────
 *
 * Lunch column values are free-text and messy. We parse them into a
 * structured order so the kitchen-prep dashboard (lunches.html) can
 * group by camp → week → day → category → sub-type and show counts.
 *
 * Order shape:
 *   {
 *     category:   'pizza' | 'celis' | 'breakfast' | 'none' | 'other',
 *     subtypeKey: 'pizza-weekly' | 'pizza-daily' | 'pizza-specific' |
 *                 'celis-melt-belt' | 'celis-wrap-trap' | 'celis-other' |
 *                 'breakfast-daily' | 'none' | 'other-<hash>',
 *     label:      human-readable display string ("Melt Belt grilled cheese"),
 *     sandwich:   parsed sandwich type (or null),
 *     sides:      parsed sides description (or null),
 *     smoothie:   parsed smoothie name (or null),
 *     specificDays: array of weekday names ['Monday','Friday'] or null,
 *     priceModel: 'weekly' | 'daily' | 'unknown',
 *     hasBreakfastAddon: boolean,    // "Pizza ($30/week) + Breakfast Daily"
 *     raw:        original text (for the "Other" category when classification fails)
 *   }
 */

const DAY_NAMES = ['Monday','Tuesday','Wednesday','Thursday','Friday'];
const DAY_ABBR  = { Mon:'Monday', Tue:'Tuesday', Wed:'Wednesday', Thu:'Thursday', Fri:'Friday',
                    Tues:'Tuesday', Thur:'Thursday', Thurs:'Thursday',
                    Mo:'Monday', Tu:'Tuesday', We:'Wednesday', Th:'Thursday', Fr:'Friday' };

function parseLunch_(raw) {
  const txt = String(raw == null ? '' : raw).trim();
  if (!txt || /^none$/i.test(txt) || /^no\s*lunch$/i.test(txt) || /^n\/a$/i.test(txt) || /^no$/i.test(txt)) {
    return { category: 'none', subtypeKey: 'none', label: 'No lunch', priceModel: 'unknown',
             specificDays: null, sandwich: null, sides: null, smoothie: null,
             hasBreakfastAddon: false, raw: txt || null };
  }

  const lower = txt.toLowerCase();
  const specificDays = extractDays_(txt);
  const hasBreakfastAddon = /\bbreakfast\b/i.test(txt) && /pizza/i.test(txt);

  // Pizza family
  if (/\bpizza\b/i.test(lower)) {
    let priceModel = 'unknown';
    if (/\$30\s*\/\s*week/i.test(txt) || /per\s*week/i.test(txt)) priceModel = 'weekly';
    else if (/\$7\.75\s*\/\s*day/i.test(txt) || /per\s*day/i.test(txt) || /\/day\b/i.test(txt)) priceModel = 'daily';

    let subtypeKey, label;
    if (specificDays && specificDays.length > 0 && specificDays.length < 5) {
      subtypeKey = 'pizza-specific';
      label = 'Pizza specific days (' + specificDays.map(shortDay_).join('/') + ')';
    } else if (priceModel === 'weekly') {
      subtypeKey = 'pizza-weekly';
      label = 'Pizza weekly ($30/wk)';
    } else if (priceModel === 'daily') {
      subtypeKey = 'pizza-daily';
      label = 'Pizza daily ($7.75/day)';
    } else {
      subtypeKey = 'pizza-other';
      label = 'Pizza (unspecified pricing)';
    }
    return { category: 'pizza', subtypeKey, label, priceModel,
             specificDays: specificDays || null,
             sandwich: null, sides: null, smoothie: null,
             hasBreakfastAddon, raw: txt };
  }

  // Celis specialty (sandwich/wrap + sides + smoothie)
  if (/\bcelis\b/i.test(lower) || /\bmelt\s*belt\b/i.test(lower) ||
      /\bwrap\s*trap\b/i.test(lower) || /\bsmoothie\b/i.test(lower) ||
      /\bsandwich\s*:/i.test(lower) || /\bsides?\s*:/i.test(lower)) {
    const sandwich = detectSandwich_(txt);
    const sides    = detectSides_(txt);
    const smoothie = detectSmoothie_(txt);
    let subtypeKey, label;
    if (/melt\s*belt/i.test(txt)) {
      subtypeKey = 'celis-melt-belt';
      label = 'Celis: Melt Belt grilled cheese';
    } else if (/wrap\s*trap/i.test(txt)) {
      subtypeKey = 'celis-wrap-trap';
      label = 'Celis: Wrap Trap turkey wrap';
    } else {
      subtypeKey = 'celis-other';
      label = 'Celis: specialty (unspecified)';
    }
    // Append side+smoothie to label so different combos appear as
    // distinct rows in the kitchen-prep table.
    const combo = [];
    if (sides)    combo.push(sides);
    if (smoothie) combo.push(smoothie);
    if (combo.length) label += ' + ' + combo.join(' + ');
    return { category: 'celis', subtypeKey: subtypeKey + '|' + (sides || '') + '|' + (smoothie || ''),
             label, priceModel: /\$15\s*\/\s*day/i.test(txt) ? 'daily' : 'unknown',
             specificDays: specificDays || null,
             sandwich, sides, smoothie,
             hasBreakfastAddon: false, raw: txt };
  }

  // Anything else — keep the raw text as the sub-type so we can spot
  // miscategorisations and tighten the parser later.
  return { category: 'other', subtypeKey: 'other|' + txt.slice(0, 60).toLowerCase(),
           label: txt.length > 80 ? txt.slice(0, 77) + '…' : txt,
           priceModel: 'unknown', specificDays: specificDays || null,
           sandwich: null, sides: null, smoothie: null,
           hasBreakfastAddon: false, raw: txt };
}

function parseBreakfast_(raw) {
  const txt = String(raw == null ? '' : raw).trim();
  if (!txt || /^none$/i.test(txt) || /^no$/i.test(txt) || /^n\/a$/i.test(txt)) {
    return { category: 'none', subtypeKey: 'none', label: 'No breakfast', raw: txt || null };
  }
  if (/^yes$/i.test(txt)) {
    return { category: 'breakfast', subtypeKey: 'breakfast-daily', label: 'Breakfast (yes)', raw: txt };
  }
  // Anything else — likely the long Celis-style breakfast description.
  return { category: 'breakfast', subtypeKey: 'breakfast-' + txt.slice(0, 30).toLowerCase().replace(/\s+/g,'-'),
           label: txt.length > 60 ? txt.slice(0, 57) + '…' : txt, raw: txt };
}

function extractDays_(txt) {
  const found = {};
  // Full names + common abbreviations. Skip "May" (month) but allow Mo/Tu/We/Th/Fr.
  const re = /\b(Mondays?|Mon|Mo|Tuesdays?|Tues|Tue|Tu|Wednesdays?|Wed|We|Thursdays?|Thurs|Thur|Thu|Th|Fridays?|Fri|Fr)\b/gi;
  let m;
  while ((m = re.exec(txt)) !== null) {
    const tok = m[1];
    const norm = normalizeDayToken_(tok);
    if (norm) found[norm] = true;
  }
  const days = Object.keys(found);
  return days.length ? days.sort((a,b) => DAY_NAMES.indexOf(a) - DAY_NAMES.indexOf(b)) : null;
}

function normalizeDayToken_(tok) {
  const t = String(tok).trim();
  const tl = t.toLowerCase();
  if (tl.startsWith('mon')) return 'Monday';
  if (tl === 'mo')          return 'Monday';
  if (tl.startsWith('tue')) return 'Tuesday';
  if (tl === 'tu')          return 'Tuesday';
  if (tl.startsWith('wed')) return 'Wednesday';
  if (tl === 'we')          return 'Wednesday';
  if (tl.startsWith('thu')) return 'Thursday';
  if (tl === 'th')          return 'Thursday';
  if (tl.startsWith('fri')) return 'Friday';
  if (tl === 'fr')          return 'Friday';
  return null;
}

function shortDay_(name) {
  const m = { Monday:'Mon', Tuesday:'Tue', Wednesday:'Wed', Thursday:'Thu', Friday:'Fri' };
  return m[name] || name;
}

function detectSandwich_(txt) {
  if (/melt\s*belt[^,]*grilled\s*cheese/i.test(txt)) return 'Melt Belt grilled cheese';
  if (/melt\s*belt/i.test(txt))                       return 'Melt Belt';
  if (/wrap\s*trap[^,]*turkey/i.test(txt))            return 'Wrap Trap turkey & cheese';
  if (/wrap\s*trap/i.test(txt))                       return 'Wrap Trap';
  if (/grilled\s*cheese/i.test(txt))                  return 'Grilled cheese';
  return null;
}

function detectSides_(txt) {
  // Sides come after "Sides:" or are mentioned standalone (chips, fruit cup).
  const sides = [];
  if (/chips?\s*\(?\s*deep\s*river/i.test(txt))    sides.push('Chips (Deep River)');
  else if (/chips?/i.test(txt))                    sides.push('Chips');
  if (/small\s*fruit\s*cup/i.test(txt))            sides.push('Small fruit cup');
  else if (/fruit\s*cup/i.test(txt))               sides.push('Fruit cup');
  return sides.length ? sides.join(' + ') : null;
}

function detectSmoothie_(txt) {
  if (/smooth\s*moves[^,]*very\s*berry/i.test(txt)) return 'Smooth Moves: Very Berry';
  if (/shake\s*break[^,]*el\s*tropical/i.test(txt)) return 'Shake Break: El Tropical';
  if (/smooth\s*moves/i.test(txt))                  return 'Smooth Moves';
  if (/shake\s*break/i.test(txt))                   return 'Shake Break';
  if (/smoothie\s*:/i.test(txt))                    return 'Smoothie (unspecified)';
  return null;
}

/**
 * Aggregate lunches across enrollments into the dashboard-ready shape:
 *
 *   {
 *     "<weekLabel>": {
 *       rows: [
 *         { category, subtypeKey, label, byDay: { Mon: n, Tue: n, ... }, total }
 *       ],
 *       totals: { byDay: { Mon: n, ... }, all: n },
 *     },
 *     ...
 *   }
 */
function aggregateLunches_(enrollments) {
  const out = {};
  WEEK_ORDER.forEach(w => {
    out[w] = { rows: [], rowsByKey: {}, totals: { byDay: zeroDay_(), all: 0 } };
  });
  // Track per-week intra-week dedup so two duplicate rows for the same kid
  // don't double-count their lunch order.
  const seen = {};
  enrollments.forEach(e => {
    if (!out[e.week]) return;
    const nk = nameKey_(e.name);
    if (!nk) return;
    const dedupKey = e.week + '|' + nk;
    if (seen[dedupKey]) return;
    seen[dedupKey] = true;

    const order = parseLunch_(e.lunchRaw);
    const days = applicableDays_(order, e.days);
    if (!days.length) return;

    const slice = out[e.week];
    let row = slice.rowsByKey[order.subtypeKey];
    if (!row) {
      row = {
        category:   order.category,
        subtypeKey: order.subtypeKey,
        label:      order.label,
        byDay:      zeroDay_(),
        total:      0,
        students:   [],
      };
      slice.rowsByKey[order.subtypeKey] = row;
      slice.rows.push(row);
    }
    row.students.push({
      name: e.name,
      campus: e.campus || 'Unknown',
      type: e.type,
      days: days.slice(),
      lunchRaw: e.lunchRaw || null,
    });
    days.forEach(dShort => {
      row.byDay[dShort] = (row.byDay[dShort] || 0) + 1;
      row.total++;
      slice.totals.byDay[dShort] = (slice.totals.byDay[dShort] || 0) + 1;
      slice.totals.all++;
    });
  });
  // Sort rows: pizza first, then celis, then breakfast, then none, other last
  const order = { pizza:1, celis:2, breakfast:3, none:4, other:5 };
  WEEK_ORDER.forEach(w => {
    out[w].rows.sort((a,b) => {
      const oa = order[a.category] || 9;
      const ob = order[b.category] || 9;
      if (oa !== ob) return oa - ob;
      return a.label.localeCompare(b.label);
    });
    // Sort each row's students alphabetically so the dropdown is scannable
    out[w].rows.forEach(r => {
      if (r.students) r.students.sort((a,b) => a.name.toLowerCase().localeCompare(b.name.toLowerCase()));
    });
    delete out[w].rowsByKey;
  });
  return out;
}

function zeroDay_() { return { Mon: 0, Tue: 0, Wed: 0, Thu: 0, Fri: 0 }; }

/** Days the lunch order applies to: explicit days from the order text if
 *  any, otherwise the kid's attendance days (Mon-Fri checks). */
function applicableDays_(order, days) {
  const SHORT = ['Mon','Tue','Wed','Thu','Fri'];
  if (order.specificDays && order.specificDays.length) {
    return order.specificDays.map(shortDay_);
  }
  const out = [];
  for (let i = 0; i < SHORT.length; i++) {
    if (days[i]) out.push(SHORT[i]);
  }
  // Some kids in the sheet have no day-checks set but still ordered lunch.
  // Default to all-five so their lunch shows up at least once that week.
  if (!out.length) return SHORT.slice();
  return out;
}

function emptyAfterSchool_() {
  const dayZero = DAY_ORDER.reduce((m, d) => { m[d] = 0; return m; }, {});
  return {
    total: 0,
    byCampus: { 'Upper Campus': 0, 'Lower Campus': 0, 'Unknown': 0 },
    byProgram: PROGRAM_ORDER.reduce((m, p) => { m[p] = 0; return m; }, {}),
    byDayOfWeek: Object.assign({}, dayZero),
    byProgramDay: PROGRAM_ORDER.reduce((m, p) => {
      m[p] = Object.assign({}, dayZero);
      return m;
    }, {}),
    byCommitmentTier: { Monthly: 0, Semester: 0, Annual: 0 },
    waitlist: 0,
    roster: [],
  };
}

/* ───────────────────────── Helpers ───────────────────────── */

function normalizeHeader_(h) {
  return String(h || '').replace(/\s+/g, ' ').trim();
}

function headerIndex_(header, names) {
  const out = {};
  names.forEach(n => { out[n] = -1; });
  header.forEach((h, i) => {
    names.forEach(n => {
      if (out[n] === -1 && h.toLowerCase() === n.toLowerCase()) out[n] = i;
    });
  });
  return out;
}

function isDayChecked_(v) {
  if (v === true) return true;
  const s = String(v == null ? '' : v).trim().toLowerCase();
  if (!s) return false;
  if (s === 'no' || s === 'n' || s === 'x' || s === 'false') return false;
  if (s === 'yes' || s === 'y' || s === 'true' || s === '✓' || s === '✔') return true;
  return s.length > 0 && s !== 'no';
}

function hasLunch_(v) {
  const s = String(v == null ? '' : v).trim().toLowerCase();
  return !!s && s !== 'none' && s !== 'no' && s !== 'n/a' && s !== 'no lunch';
}

function extractAllergy_(notes) {
  if (!notes) return null;
  const m = notes.toLowerCase();
  if (m.indexOf('allerg') >= 0) return notes;
  return null;
}

function sortDesc_(obj) {
  const entries = Object.keys(obj).map(k => [k, obj[k]]);
  entries.sort((a, b) => b[1] - a[1]);
  const out = {};
  entries.forEach(([k, v]) => { out[k] = v; });
  return out;
}

/* ───────────────────────── Manual smoke test ─────────────────────────
   In the Apps Script editor, run runSmokeTest() once to confirm the
   builder reads all four sheets without errors. Output goes to
   View → Logs / Executions. */
function runSmokeTest() {
  const snap = buildSnapshot();
  Logger.log(JSON.stringify({
    summer: snap.summer.total,
    summerByCampus: snap.summer.byCampus,
    free: snap.free.total,
    weekKeys: Object.keys(snap.summer.byWeek).length,
    rosterWeekKeys: Object.keys(snap.roster).length,
  }, null, 2));
}

/* ═════════════════════════════════════════════════════════════════════
   Direct-to-GitHub snapshot push
   ═════════════════════════════════════════════════════════════════════
   Replaces the .github/workflows/refresh-systema-snapshot.yml cron path,
   which suffered from GitHub Actions free-tier delays (configured every
   5 min, ran roughly hourly in practice). Apps Script time-driven
   triggers fire reliably on schedule, so we drive snapshot refreshes
   from here instead and PUT the JSON straight to the repo via the
   GitHub Contents API.

   Setup once:
     1. Generate a fine-grained PAT scoped to demilio24/Websites with
        Contents: Read and write
     2. Project Settings → Script Properties → add GITHUB_PAT
     3. Run testSnapshotPush() to verify auth + writes
     4. Run installSnapshotPushTrigger() to start the 5-min cadence
   ═══════════════════════════════════════════════════════════════════ */

const GH_REPO_OWNER = 'demilio24';
const GH_REPO_NAME  = 'Websites';
const GH_BRANCH     = 'main';
const GH_API_BASE   = 'https://api.github.com';

const SNAPSHOT_PATH    = 'Tom_Systema_Floyd/dashboard/snapshot.json';
const HISTORY_DIR_PATH = 'Tom_Systema_Floyd/dashboard/history';
const COMMIT_AUTHOR    = {
  name:  'github-actions[bot]',
  email: 'github-actions[bot]@users.noreply.github.com'
};

function getGithubPat_() {
  const pat = PropertiesService.getScriptProperties().getProperty('GITHUB_PAT');
  if (!pat) {
    throw new Error(
      'GITHUB_PAT not set in Script Properties. ' +
      'Add a fine-grained PAT scoped to ' + GH_REPO_OWNER + '/' + GH_REPO_NAME +
      ' with Contents: read+write before installing the trigger.'
    );
  }
  return pat;
}

/**
 * GET the current SHA of a file in the repo.
 * 200 → returns SHA. 404 → returns null. Anything else throws.
 */
function ghGetFileSha_(path) {
  const url = GH_API_BASE + '/repos/' + GH_REPO_OWNER + '/' + GH_REPO_NAME +
              '/contents/' + encodeURI(path) + '?ref=' + encodeURIComponent(GH_BRANCH);
  const resp = UrlFetchApp.fetch(url, {
    method: 'get',
    headers: {
      'Authorization': 'Bearer ' + getGithubPat_(),
      'Accept': 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28'
    },
    muteHttpExceptions: true
  });
  const code = resp.getResponseCode();
  if (code === 200) return JSON.parse(resp.getContentText()).sha;
  if (code === 404) return null;
  throw new Error('GET ' + path + ' → HTTP ' + code + ': ' +
                  resp.getContentText().substring(0, 300));
}

/**
 * PUT (create or update) a file via the Contents API.
 * Auto-fetches the current SHA. Retries once on 409/422 conflict
 * (SHA mismatch from a concurrent commit), then surfaces the error.
 */
function ghPutFile_(path, contentString, commitMessage) {
  const url = GH_API_BASE + '/repos/' + GH_REPO_OWNER + '/' + GH_REPO_NAME +
              '/contents/' + encodeURI(path);

  function attempt(sha) {
    const body = {
      message:   commitMessage,
      content:   Utilities.base64Encode(contentString, Utilities.Charset.UTF_8),
      branch:    GH_BRANCH,
      committer: COMMIT_AUTHOR,
      author:    COMMIT_AUTHOR
    };
    if (sha) body.sha = sha;

    return UrlFetchApp.fetch(url, {
      method: 'put',
      headers: {
        'Authorization': 'Bearer ' + getGithubPat_(),
        'Accept': 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28'
      },
      contentType: 'application/json',
      payload: JSON.stringify(body),
      muteHttpExceptions: true
    });
  }

  let sha = ghGetFileSha_(path);
  let resp = attempt(sha);
  let code = resp.getResponseCode();

  if (code === 409 || code === 422) {
    Logger.log('[ghPutFile_] ' + path + ' got HTTP ' + code + ', retrying with fresh SHA');
    sha = ghGetFileSha_(path);
    resp = attempt(sha);
    code = resp.getResponseCode();
  }

  if (code !== 200 && code !== 201) {
    throw new Error('PUT ' + path + ' → HTTP ' + code + ': ' +
                    resp.getContentText().substring(0, 400));
  }
  return JSON.parse(resp.getContentText());
}

/**
 * List filenames in a repo directory matching a regex.
 * Returns [] if the directory doesn't exist.
 */
function ghListDir_(dirPath, filenameRegex) {
  const url = GH_API_BASE + '/repos/' + GH_REPO_OWNER + '/' + GH_REPO_NAME +
              '/contents/' + encodeURI(dirPath) + '?ref=' + encodeURIComponent(GH_BRANCH);
  const resp = UrlFetchApp.fetch(url, {
    method: 'get',
    headers: {
      'Authorization': 'Bearer ' + getGithubPat_(),
      'Accept': 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28'
    },
    muteHttpExceptions: true
  });
  const code = resp.getResponseCode();
  if (code === 404) return [];
  if (code !== 200) throw new Error('GET dir ' + dirPath + ' → HTTP ' + code);
  const items = JSON.parse(resp.getContentText());
  return items
    .filter(function(it) { return it.type === 'file' && filenameRegex.test(it.name); })
    .map(function(it) { return it.name; });
}

/**
 * Main worker: build a fresh snapshot, write it to GitHub, also write
 * today's history file, also refresh history/index.json.
 *
 * Uses LockService so a slow run can't overlap with the next 5-min tick.
 */
function pushSnapshotToGitHub() {
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(0)) {
    Logger.log('[pushSnapshotToGitHub] Skipping: previous run still in progress');
    return;
  }
  try {
    const startedAt = new Date();
    Logger.log('[pushSnapshotToGitHub] Building snapshot at ' + startedAt.toISOString());

    const snap = buildSnapshot();
    const cleanSnap = stripInternalFields_(snap);
    redactRosterPii_(cleanSnap);   // blank child PII before it hits the public repo
    const snapJson = JSON.stringify(cleanSnap, null, 2);
    const message = 'snapshot: refresh systema floyd dashboard [skip ci]';

    // 0. Mirror enrollments + snapshot to Supabase. Non-fatal — log and
    // continue if the call fails so the GitHub push still happens.
    try {
      pushEnrollmentsToSupabase_(snap._allSummer, snap._allFree, cleanSnap);
    } catch (e) {
      Logger.log('[pushSnapshotToGitHub] Supabase push failed: ' + e.message);
    }

    // 1. Live snapshot.json
    ghPutFile_(SNAPSHOT_PATH, snapJson, message);
    Logger.log('[pushSnapshotToGitHub] Wrote ' + SNAPSHOT_PATH);

    // 2. Today's history archive (UTC date — matches the old python script)
    const todayUtc = Utilities.formatDate(startedAt, 'UTC', 'yyyy-MM-dd');
    const historyPath = HISTORY_DIR_PATH + '/' + todayUtc + '.json';
    ghPutFile_(historyPath, snapJson, message);
    Logger.log('[pushSnapshotToGitHub] Wrote ' + historyPath);

    // 3. history/index.json — list every YYYY-MM-DD.json present in the dir
    const dateFiles = ghListDir_(HISTORY_DIR_PATH, /^\d{4}-\d{2}-\d{2}\.json$/);
    const dates = dateFiles
      .map(function(n) { return n.replace(/\.json$/, ''); })
      .sort();
    const indexJson = JSON.stringify({
      dates: dates,
      latest: dates.length ? dates[dates.length - 1] : null
    }, null, 2);
    ghPutFile_(HISTORY_DIR_PATH + '/index.json', indexJson, message);
    Logger.log('[pushSnapshotToGitHub] Wrote history/index.json (' + dates.length + ' dates)');

    const elapsedMs = Date.now() - startedAt.getTime();
    Logger.log('[pushSnapshotToGitHub] Done in ' + elapsedMs + 'ms');
  } finally {
    lock.releaseLock();
  }
}

/**
 * One-shot diagnostic: runs pushSnapshotToGitHub once and prints rich
 * status. Run this before installing the trigger to verify auth + writes.
 */
function testSnapshotPush() {
  Logger.log('=== testSnapshotPush @ ' + new Date().toISOString() + ' ===');
  try {
    Logger.log('[1] effective user: ' + Session.getEffectiveUser().getEmail());
  } catch (e) { Logger.log('[1] effective user err: ' + e.message); }
  try {
    const pat = getGithubPat_();
    Logger.log('[2] PAT present: yes (length=' + pat.length + ')');
  } catch (e) { Logger.log('[2] PAT err: ' + e.message); return; }

  Logger.log('[3] running pushSnapshotToGitHub...');
  try {
    pushSnapshotToGitHub();
    Logger.log('[3] success');
  } catch (e) {
    Logger.log('[3] ERROR: ' + e.message + '\n' + (e.stack || ''));
    return;
  }
  Logger.log('=== testSnapshotPush done ===');
}

/**
 * Installs a 5-minute time-driven trigger on pushSnapshotToGitHub.
 * Removes any existing triggers for that handler first.
 * Run from the Apps Script editor as the account that should own the
 * trigger (recommended: emilio@nilsdigital.com for Workspace quota
 * consistency with the billing dashboard).
 */
function installSnapshotPushTrigger() {
  ScriptApp.getProjectTriggers().forEach(function(t) {
    if (t.getHandlerFunction() === 'pushSnapshotToGitHub') {
      ScriptApp.deleteTrigger(t);
      Logger.log('[installSnapshotPushTrigger] Removed old trigger: ' + t.getUniqueId());
    }
  });
  const trigger = ScriptApp.newTrigger('pushSnapshotToGitHub')
    .timeBased()
    .everyMinutes(5)
    .create();
  Logger.log('[installSnapshotPushTrigger] Installed trigger: ' + trigger.getUniqueId());
}

/* ═════════════════════════════════════════════════════════════════════
   Supabase mirror
   ═════════════════════════════════════════════════════════════════════
   Each snapshot also pushes raw enrollment rows + the full JSON payload
   to Supabase, so other tools (billing dashboard, queries, future apps)
   can read the same source of truth without re-parsing snapshot.json.

   Auth pattern matches DiscrepancyCheck.js: SECURITY DEFINER RPCs gated
   by a shared SUPABASE_TOKEN_SECRET, called with the existing anon key.
   No new credentials required.

   Required Script Properties:
     SUPABASE_URL          https://nroeiabeirifurdaybyo.supabase.co
     SUPABASE_ANON_KEY     legacy anon key (already set)
     SUPABASE_TOKEN_SECRET shared RPC secret (already set)
   ═══════════════════════════════════════════════════════════════════ */

// Hardcoded calendar dates for the 13 known weeks. Used to populate
// week_start_date so SQL can sort by real chronology instead of label text.
const WEEK_START_DATES = {
  'June 1st-5th':         '2026-06-01',
  'June 8th-12th':        '2026-06-08',
  'June 15th-19th':       '2026-06-15',
  'June 22nd-26th':       '2026-06-22',
  'June 29th-July 3rd':   '2026-06-29',
  'July 6th-10th':        '2026-07-06',
  'July 13th-17th':       '2026-07-13',
  'July 20th-24th':       '2026-07-20',
  'July 27th-31st':       '2026-07-27',
  'August 3rd-7th':       '2026-08-03',
  'August 10th-14th':     '2026-08-10',
  'August 17th-21st':     '2026-08-17',
  'August 24th-28th':     '2026-08-24',
};

function sheetIdForEnrollment_(e) {
  if (e.type === 'free') {
    return e.campus === 'Upper Campus' ? SHEETS.freeUpper : SHEETS.freeLower;
  }
  return e.campus === 'Upper Campus' ? SHEETS.upper : SHEETS.lower;
}

function enrollmentRow_(e, idx) {
  const order = parseLunch_(e.lunchRaw);
  const days = e.days || [true,true,true,true,true];
  return {
    type:            e.type,
    campus:          e.campus || 'Unknown',
    week_label:      e.week,
    week_start_date: WEEK_START_DATES[e.week] || null,
    student_name:    e.name,
    name_key:        nameKey_(e.name),
    email:           e.email || null,
    parent_name:     null,
    school:          e.school || null,
    grade:           null,
    age:             null,
    lunch_raw:       e.lunchRaw || null,
    lunch_category:  order.category,
    lunch_label:     order.label,
    breakfast_raw:   e.breakfastRaw || null,
    shirt_size:      null,
    days_mon:        !!days[0],
    days_tue:        !!days[1],
    days_wed:        !!days[2],
    days_thu:        !!days[3],
    days_fri:        !!days[4],
    allergy_notes:   e.allergy || null,
    notes:           e.notes || null,
    source_sheet_id: sheetIdForEnrollment_(e),
    source_row:      idx + 2, // header is row 1
  };
}

function pushEnrollmentsToSupabase_(allSummer, allFree, cleanSnap) {
  const props = PropertiesService.getScriptProperties();
  const url    = props.getProperty('SUPABASE_URL');
  const anon   = props.getProperty('SUPABASE_ANON_KEY');
  const secret = props.getProperty('SUPABASE_TOKEN_SECRET');
  if (!url || !anon || !secret) {
    throw new Error('Missing Supabase Script Properties (SUPABASE_URL, SUPABASE_ANON_KEY, SUPABASE_TOKEN_SECRET)');
  }

  // Dedup (type,campus,week,name_key) within the batch so the upsert's
  // ON CONFLICT clause never sees two conflicting incoming rows.
  const seen = {};
  const rows = [];
  function addRow(e, idx) {
    const r = enrollmentRow_(e, idx);
    if (!r.name_key || !r.week_label) return;
    const k = r.type + '|' + r.campus + '|' + r.week_label + '|' + r.name_key;
    if (seen[k]) return;
    seen[k] = true;
    rows.push(r);
  }
  allSummer.forEach(addRow);
  allFree.forEach(addRow);

  const headers = {
    'apikey': anon,
    'Authorization': 'Bearer ' + anon,
    'Content-Type': 'application/json',
  };

  // 1. Upsert enrollments in batches of 500 to stay under URL/payload limits
  const BATCH = 500;
  let totalInserted = 0, totalUpdated = 0;
  for (let i = 0; i < rows.length; i += BATCH) {
    const slice = rows.slice(i, i + BATCH);
    const resp = UrlFetchApp.fetch(url + '/rest/v1/rpc/sf_upsert_camp_enrollments', {
      method: 'post',
      headers: headers,
      payload: JSON.stringify({ claim_secret: secret, rows: slice }),
      muteHttpExceptions: true,
    });
    const code = resp.getResponseCode();
    if (code !== 200) {
      throw new Error('sf_upsert_camp_enrollments HTTP ' + code + ': ' +
                      resp.getContentText().substring(0, 300));
    }
    const result = JSON.parse(resp.getContentText());
    if (Array.isArray(result) && result.length) {
      totalInserted += (result[0].inserted || 0);
      totalUpdated  += (result[0].updated  || 0);
    }
  }
  Logger.log('[pushEnrollmentsToSupabase_] upserted ' + rows.length +
             ' rows (inserted=' + totalInserted + ', updated=' + totalUpdated + ')');

  // 2. Archive full snapshot payload
  const snapResp = UrlFetchApp.fetch(url + '/rest/v1/rpc/sf_insert_camp_snapshot', {
    method: 'post',
    headers: headers,
    payload: JSON.stringify({
      claim_secret: secret,
      payload:      cleanSnap,
      summer_total: cleanSnap.totals.summer || 0,
      free_total:   cleanSnap.totals.free   || 0,
    }),
    muteHttpExceptions: true,
  });
  const sCode = snapResp.getResponseCode();
  if (sCode !== 200) {
    throw new Error('sf_insert_camp_snapshot HTTP ' + sCode + ': ' +
                    snapResp.getContentText().substring(0, 300));
  }
  Logger.log('[pushEnrollmentsToSupabase_] archived snapshot id=' + snapResp.getContentText());
}

/** One-shot smoke test: build a snapshot and push to Supabase only. */
function testSupabasePush() {
  const snap = buildSnapshot();
  const cleanSnap = stripInternalFields_(snap);
  pushEnrollmentsToSupabase_(snap._allSummer, snap._allFree, cleanSnap);
  Logger.log('testSupabasePush done');
}
