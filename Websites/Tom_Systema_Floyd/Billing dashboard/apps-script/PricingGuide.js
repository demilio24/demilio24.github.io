/** ─── PricingGuide.gs ─────────────────────────────────────────
 *  Installs a "Pricing Syntax" dropdown banner at the top of the Logs
 *  sheet (row 1, merged across cols A:F) so the team has the pricing
 *  rules at hand whenever they're auditing a poll. Opening the
 *  dropdown shows every rule as a list option; picking one resets the
 *  cell to the default label (handled in Triggers.gs onEdit).
 *
 *  No em-dashes anywhere in the option strings.
 *
 *  Idempotent: re-running refreshes the dropdown options without
 *  inserting another banner row.
 */

const PRICING_GUIDE_SHEET_NAME = 'Pricing Syntax';   // legacy tab to delete on first run
const LOGS_SHEET_NAME = 'Logs';
const PRICING_BANNER_DEFAULT = 'PRICING SYNTAX (open to read)';

const PRICING_DROPDOWN_OPTIONS = [
  PRICING_BANNER_DEFAULT,
  'Per-week pricing: form answer must contain $X/week',
  'Per-day pricing: form answer must contain $X/day',
  'Flat pricing: $X with no /day or /week multiplier',
  'Item label format: <Form Question>: <Form Answer>',
  'Multi-week answers: each selected week becomes its own row',
  'Total formula: per_week = unit x weeks',
  'Total formula: per_day = unit x days x weeks',
  'Total formula: flat = unit',
  'Avoid: generic answers like Full Week (need explicit $X/week)',
  'Avoid: price in the QUESTION instead of the ANSWER',
  'Avoid: "$365 per week" (parser needs the slash, not the word per)',
  'Avoid: comma in number ($1,200 parses as $1)',
  'Legacy rows tagged "(normalized from legacy form syntax)" are pre-fix.'
];

// ─── installLogsPricingDropdown ─────────────────────────────────────
/**
 * Installs / refreshes the pricing dropdown banner on the Logs sheet.
 * Inserts a new row 1 above the existing header on first run, then
 * leaves it in place forever after. Filter view + frozen rows updated
 * accordingly. Existing log entries shift down by 1 the first time
 * (no data lost).
 *
 * @returns {{ action, lastRow }}
 */
function installLogsPricingDropdown() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName(LOGS_SHEET_NAME);
  if (!sheet) {
    return { action: 'no_logs_sheet', lastRow: 0 };
  }

  var firstCellValue = String(sheet.getRange(1, 1).getValue() || '').trim();
  var bannerAlreadyInstalled =
    PRICING_DROPDOWN_OPTIONS.indexOf(firstCellValue) !== -1 ||
    firstCellValue.indexOf('PRICING SYNTAX') === 0;

  if (!bannerAlreadyInstalled) {
    // Existing layout: row 1 = column headers, row 2+ = log entries.
    // Insert a fresh row above and shift everything down by 1.
    sheet.insertRowBefore(1);

    // Re-apply the row-1 filter that setupLogsSheet originally placed
    // on the (now) shifted header row. Any pre-existing filter has to
    // be removed first, since createFilter only allows one per sheet.
    var existingFilter = sheet.getFilter();
    if (existingFilter) existingFilter.remove();
    sheet.getRange(2, 1, 1, 6).createFilter();
  }

  // Banner row formatting + dropdown — idempotent.
  applyPricingBanner_(sheet);

  // Freeze BOTH the banner and the column-header row so they stick
  // when scrolling.
  sheet.setFrozenRows(2);

  return {
    action: bannerAlreadyInstalled ? 'refreshed' : 'inserted',
    lastRow: sheet.getLastRow()
  };
}

// ─── applyPricingBanner_ ───────────────────────────────────────────
function applyPricingBanner_(sheet) {
  // Merge cols A:F across row 1 so the dropdown reads as a banner.
  var bannerRange = sheet.getRange(1, 1, 1, 6);
  // Break any leftover merge before re-merging (idempotent).
  try { bannerRange.breakApart(); } catch (e) {}
  bannerRange.merge();

  var cell = sheet.getRange(1, 1);
  cell.clearDataValidations();
  cell.clearNote();

  // Keep the cell's current value if it's a valid option (e.g., the
  // user just picked one and we're refreshing); otherwise set the
  // default label.
  var current = String(cell.getValue() || '').trim();
  if (PRICING_DROPDOWN_OPTIONS.indexOf(current) === -1) {
    cell.setValue(PRICING_BANNER_DEFAULT);
  }

  var rule = SpreadsheetApp.newDataValidation()
    .requireValueInList(PRICING_DROPDOWN_OPTIONS, true)
    .setAllowInvalid(false)
    .build();
  cell.setDataValidation(rule);

  bannerRange
    .setBackground('#143980')
    .setFontColor('#FFFFFF')
    .setFontWeight('bold')
    .setFontSize(12)
    .setHorizontalAlignment('center')
    .setVerticalAlignment('middle');
  sheet.setRowHeight(1, 36);
}

// ─── resetPricingBannerCell ────────────────────────────────────────
/**
 * Reset the banner cell back to the default label after the user
 * picks a rule from the dropdown. Called from the Logs branch of
 * onEdit in Triggers.gs.
 */
function resetPricingBannerCell() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName(LOGS_SHEET_NAME);
  if (!sheet) return;
  sheet.getRange(1, 1).setValue(PRICING_BANNER_DEFAULT);
}

// ─── removeStandalonePricingSyntaxTab ──────────────────────────────
/**
 * One-shot cleanup: remove the legacy "Pricing Syntax" sheet that the
 * earlier setupPricingSyntaxSheet built. Safe to call when the sheet
 * no longer exists (no-op).
 */
function removeStandalonePricingSyntaxTab() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sh = ss.getSheetByName(PRICING_GUIDE_SHEET_NAME);
  if (!sh) return { removed: false, reason: 'sheet not found' };
  ss.deleteSheet(sh);
  return { removed: true };
}

/* ═════════════════════════════════════════════════════════════════════
   "Pricing" sheet — the team-editable price catalog
   ═════════════════════════════════════════════════════════════════════
   Built so the upcoming "registration-sheets-drive-billing" rewrite has
   a single source of truth for prices Tom can edit. The team edits
   prices here; the upcoming rewrite reads from here every poll.

   This is a one-shot setup. After the initial population, Tom curates
   the sheet manually. The script never overwrites it.
   ═══════════════════════════════════════════════════════════════════ */

const PRICING_SHEET_NAME = 'Pricing';

/**
 * Walk a subaccount's cached FieldRegistry, pull every picklist option
 * whose label has a $ in it, parse the price + multiplier, and return
 * a normalized list of priced items.
 *
 * Defensive: handles three picklistOption shapes GHL returns across
 * versions ({label, value} objects, plain strings, and {key, value}).
 *
 * @param {string} subaccountName  e.g. 'Florida'
 * @returns {Array<{fieldName, fieldId, optionLabel, cleanLabel, price, multiplier}>}
 */
function extractPricedOptionsFromRegistry(subaccountName) {
  var registry = getFieldRegistry(subaccountName);
  var out = [];
  registry.forEach(function(meta, fieldId) {
    var opts = (meta && meta.picklistOptions) || [];
    if (!opts.length) return;
    for (var i = 0; i < opts.length; i++) {
      var o = opts[i];
      var label = '';
      if (typeof o === 'string') label = o;
      else if (o && typeof o === 'object') label = o.label || o.value || o.key || '';
      label = String(label).trim();
      if (!label || label.indexOf('$') === -1) continue;
      var price = parsePrice(label);
      if (price === null) continue;
      var mult = extractMultiplier(label);
      out.push({
        fieldName:   meta.name || '(unnamed field)',
        fieldId:     fieldId,
        optionLabel: label,
        cleanLabel:  stripPriceFromLabel(label),
        price:       price,
        multiplier:  mult || ''
      });
    }
  });
  return out;
}

/**
 * Build (or refresh) the "Pricing" sheet from GHL field picklist
 * options. Idempotent. Sorts by field name, then by price.
 *
 * Columns:
 *   A Category    – the GHL form field name (Camp Duration, Lunch, etc.)
 *   B Item        – the priced option's clean label (price stripped)
 *   C Price       – numeric, currency-formatted
 *   D Multiplier  – '/day' | '/week' | '' (flat)
 *   E Source      – the raw option label as it appears in GHL forms
 *   F Notes       – left blank for the team to annotate
 *
 * Run once from the editor (as emilio@nilsdigital.com so the
 * FieldRegistry fetch lands under the Workspace quota).
 */
function setupPricingSheet() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sh = ss.getSheetByName(PRICING_SHEET_NAME);
  if (!sh) {
    sh = ss.insertSheet(PRICING_SHEET_NAME);
  } else {
    // Preserve existing data on re-run unless explicitly nuked.
    var existingRows = sh.getLastRow();
    if (existingRows > 1) {
      Logger.log('[setupPricingSheet] Pricing sheet already has ' +
                 (existingRows - 1) + ' rows. Skipping refresh to avoid ' +
                 'clobbering Tom\'s edits. To force-refresh, delete the ' +
                 'sheet and re-run.');
      return { action: 'skipped_existing', rows: existingRows - 1 };
    }
    sh.clearContents();
    sh.clearFormats();
  }

  // Header
  var headers = ['Category', 'Item', 'Price', 'Multiplier', 'Source (raw GHL label)', 'Notes'];
  sh.getRange(1, 1, 1, headers.length).setValues([headers])
    .setBackground('#0F3634').setFontColor('#FFFFFF')
    .setFontWeight('bold').setFontSize(11);
  sh.setFrozenRows(1);

  // Pull priced options. Florida is the polling subaccount; other states
  // are routed via WaiverOrigin but use the same form catalog.
  var priced = extractPricedOptionsFromRegistry('Florida');

  // Sort by field name then price asc
  priced.sort(function(a, b) {
    var byField = String(a.fieldName).localeCompare(String(b.fieldName));
    if (byField !== 0) return byField;
    return Number(a.price) - Number(b.price);
  });

  var rows = priced.map(function(p) {
    return [
      p.fieldName,
      p.cleanLabel || p.optionLabel,
      p.price,
      p.multiplier,
      p.optionLabel,
      ''
    ];
  });

  if (rows.length) {
    sh.getRange(2, 1, rows.length, 6).setValues(rows);
    sh.getRange(2, 3, rows.length, 1).setNumberFormat('"$"#,##0.00');
  }

  // Column widths
  sh.setColumnWidth(1, 200);  // Category
  sh.setColumnWidth(2, 300);  // Item
  sh.setColumnWidth(3, 90);   // Price
  sh.setColumnWidth(4, 100);  // Multiplier
  sh.setColumnWidth(5, 350);  // Source raw label
  sh.setColumnWidth(6, 260);  // Notes

  // Filter on header row
  if (sh.getFilter()) sh.getFilter().remove();
  sh.getRange(1, 1, Math.max(rows.length + 1, 2), 6).createFilter();

  // Apply DM Sans across every cell in the rendered area for consistency
  // with the Billing tab.
  sh.getRange(1, 1, Math.max(rows.length + 1, 2), 6).setFontFamily('DM Sans');

  Logger.log('[setupPricingSheet] Wrote ' + rows.length + ' priced items from GHL Florida field registry.');
  return { action: 'created', rows: rows.length };
}

/**
 * Force-rebuild: wipes the Pricing sheet and repopulates from the GHL
 * registry. Use only when you want to throw away Tom's manual edits.
 */
function forceRebuildPricingSheet() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sh = ss.getSheetByName(PRICING_SHEET_NAME);
  if (sh) ss.deleteSheet(sh);
  return setupPricingSheet();
}

/* ═════════════════════════════════════════════════════════════════
   "Pretty" Pricing layout — table per program type
   ═════════════════════════════════════════════════════════════════
   Reorganizes the Pricing tab from one flat table into multiple
   labeled sections, one per program type. Existing rows are kept;
   they just get grouped under section headers + spacing for
   readability. New section headers added for currently-empty
   program types so Tom has a clear place to add after-school rates.

   Section layout (top to bottom):
     ▌ SUMMER CAMP — PAID
       (all rows whose Category contains "summer" but NOT "free")
     ▌ SUMMER CAMP — FREE
       (rows whose Category contains "free")
     ▌ AFTER SCHOOL — MONTHLY
       (Category contains "after school" + "monthly")
     ▌ AFTER SCHOOL — QUARTERLY
       (Category contains "after school" + "quarterly")
     ▌ OTHER
       (anything that didn't classify)

   Idempotent: re-running rebuilds the layout from the source rows
   without losing Tom's per-row aliases / notes.
   ═══════════════════════════════════════════════════════════════ */

function prettifyPricingSheet() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sh = ss.getSheetByName(PRICING_SHEET_NAME);
  if (!sh) throw new Error('Pricing sheet not found. Run setupPricingSheet first.');
  var lastRow = sh.getLastRow();
  if (lastRow < 2) throw new Error('Pricing sheet is empty.');

  // Snapshot every existing data row (skip headers + any section-banner rows)
  var headerRow = sh.getRange(1, 1, 1, 7).getValues()[0];
  var hasAliases = headerRow.indexOf('Aliases') !== -1;
  var numCols = hasAliases ? 7 : 6;
  var allRows = sh.getRange(2, 1, lastRow - 1, numCols).getValues();

  // Filter out section banner rows (col A starts with a triangle or all-uppercase section name)
  var dataRows = allRows.filter(function(r) {
    var a = String(r[0] || '').trim();
    if (!a) return false;
    // Banner rows are styled but their col A starts with these markers
    if (/^▌|^═|^Section:|^SECTION:/i.test(a)) return false;
    return true;
  });

  // Classify each row
  function classify(category) {
    var c = String(category || '').toLowerCase();
    if (/after\s*school/i.test(c) && /quarter/i.test(c)) return 'after-school-quarterly';
    if (/after\s*school/i.test(c) && /month/i.test(c))   return 'after-school-monthly';
    if (/after\s*school/i.test(c))                        return 'after-school-monthly'; // default monthly
    if (/free/i.test(c))                                  return 'summer-free';
    if (/camp|summer|lunch|breakfast|care|shirt|duration/i.test(c)) return 'summer-paid';
    return 'other';
  }

  var sections = {
    'summer-paid':           { title: 'SUMMER CAMP — PAID',         color: '#0F3634', rows: [] },
    'summer-free':           { title: 'SUMMER CAMP — FREE',         color: '#143980', rows: [] },
    'after-school-monthly':  { title: 'AFTER SCHOOL — MONTHLY',     color: '#5B2C6F', rows: [] },
    'after-school-quarterly':{ title: 'AFTER SCHOOL — QUARTERLY',   color: '#7D3C98', rows: [] },
    'other':                 { title: 'OTHER',                       color: '#555555', rows: [] }
  };
  var sectionOrder = ['summer-paid', 'summer-free', 'after-school-monthly', 'after-school-quarterly', 'other'];

  dataRows.forEach(function(r) {
    var key = classify(r[0]);
    sections[key].rows.push(r);
  });

  // Sort within each section: category asc, then price asc
  sectionOrder.forEach(function(k) {
    sections[k].rows.sort(function(a, b) {
      var byCat = String(a[0]).localeCompare(String(b[0]));
      if (byCat !== 0) return byCat;
      return Number(a[2]) - Number(b[2]);
    });
  });

  // Now wipe + rebuild
  sh.clear();
  sh.clearConditionalFormatRules();

  // Header row 1
  var headers = ['Category', 'Item', 'Price', 'Multiplier', 'Source (raw GHL label)'];
  if (hasAliases) headers.push('Aliases');
  headers.push('Notes');
  sh.getRange(1, 1, 1, headers.length).setValues([headers])
    .setBackground('#000000').setFontColor('#FFFFFF')
    .setFontWeight('bold').setFontSize(11)
    .setHorizontalAlignment('left');
  sh.setFrozenRows(1);
  sh.setRowHeight(1, 28);

  // Walk each section, write banner row + data rows + spacer
  var currentRow = 2;
  sectionOrder.forEach(function(k) {
    var s = sections[k];
    var emptyTag = s.rows.length === 0 ? '   (no rows yet — add prices here)' : '';

    // Section banner: merge across all cols, color-coded
    sh.getRange(currentRow, 1, 1, headers.length).merge();
    sh.getRange(currentRow, 1)
      .setValue('▌  ' + s.title + '   (' + s.rows.length + ' items)' + emptyTag)
      .setBackground(s.color).setFontColor('#FFFFFF')
      .setFontWeight('bold').setFontSize(12)
      .setHorizontalAlignment('left')
      .setVerticalAlignment('middle');
    sh.setRowHeight(currentRow, 32);
    currentRow++;

    if (s.rows.length > 0) {
      sh.getRange(currentRow, 1, s.rows.length, headers.length).setValues(s.rows);
      sh.getRange(currentRow, 3, s.rows.length, 1).setNumberFormat('"$"#,##0.00');
      // Subtle banding within the section for readability
      sh.getRange(currentRow, 1, s.rows.length, headers.length).applyRowBanding(SpreadsheetApp.BandingTheme.LIGHT_GREY)
        .setHeaderRowColor(null);
      currentRow += s.rows.length;
    }

    // Spacer row between sections
    sh.setRowHeight(currentRow, 12);
    currentRow++;
  });

  // Column widths
  sh.setColumnWidth(1, 230);  // Category
  sh.setColumnWidth(2, 320);  // Item
  sh.setColumnWidth(3, 90);   // Price
  sh.setColumnWidth(4, 100);  // Multiplier
  sh.setColumnWidth(5, 350);  // Source
  if (hasAliases) {
    sh.setColumnWidth(6, 360);  // Aliases
    sh.setColumnWidth(7, 240);  // Notes
  } else {
    sh.setColumnWidth(6, 240);  // Notes
  }

  // Font — DM Sans across the whole rebuilt range
  sh.getRange(1, 1, currentRow, headers.length).setFontFamily('DM Sans');

  // Drop the data-validation filter — section banners would break it
  if (sh.getFilter()) sh.getFilter().remove();

  Logger.log('[prettifyPricingSheet] Rebuilt Pricing tab with ' + sectionOrder.length + ' sections, ' +
             dataRows.length + ' data rows total.');
  return {
    sections: sectionOrder.map(function(k) {
      return { type: k, title: sections[k].title, count: sections[k].rows.length };
    })
  };
}

/* ─── Pricing sheet — Aliases column migration ──────────────────────
   Inserts an Aliases column at position F, shifting Notes to G.
   Seeds each row with auto-derived alias suggestions so the team
   doesn't start from zero. Tom can then edit any cell to add
   typed variants the team uses ("banana", "fruit daily", etc.) and
   the next billing rebuild picks them up automatically.

   Idempotent — running again after the column exists just refreshes
   any blank rows' suggested aliases without overwriting Tom's edits.
   ──────────────────────────────────────────────────────────────── */
function migratePricingSheetAddAliases() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sh = ss.getSheetByName(PRICING_SHEET_NAME);
  if (!sh) {
    throw new Error('Pricing sheet not found. Run setupPricingSheet() first.');
  }
  var lastRow = sh.getLastRow();
  if (lastRow < 2) {
    throw new Error('Pricing sheet is empty.');
  }

  // Detect whether Aliases column already exists by checking header F
  var headers = sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0];
  var hasAliases = false;
  for (var i = 0; i < headers.length; i++) {
    if (String(headers[i]).trim().toLowerCase() === 'aliases') {
      hasAliases = true;
      break;
    }
  }

  if (!hasAliases) {
    // Insert column F (between Source at E and Notes at F → G)
    sh.insertColumnAfter(5);  // shift everything right of col 5
    sh.getRange(1, 6).setValue('Aliases')
      .setBackground('#0F3634').setFontColor('#FFFFFF')
      .setFontWeight('bold').setFontSize(11);
    sh.setColumnWidth(6, 320);
    Logger.log('[migratePricingSheetAddAliases] inserted Aliases column at F');
  } else {
    Logger.log('[migratePricingSheetAddAliases] Aliases column already exists, refreshing blanks');
  }

  // Walk every row, seed aliases where the cell is blank
  var rows = sh.getRange(2, 1, lastRow - 1, 6).getValues();
  var updates = 0;
  for (var r = 0; r < rows.length; r++) {
    var existing = String(rows[r][5] || '').trim();
    if (existing) continue;  // Tom-edited; leave alone
    var category = String(rows[r][0] || '');
    var item     = String(rows[r][1] || '');
    var source   = String(rows[r][4] || '');
    var aliases  = deriveAliasesForItem_(category, item, source);
    if (aliases.length === 0) continue;
    sh.getRange(r + 2, 6).setValue(aliases.join(', '));
    updates++;
  }

  // Filter on row 1 across all 7 columns
  if (sh.getFilter()) sh.getFilter().remove();
  sh.getRange(1, 1, lastRow, 7).createFilter();

  Logger.log('[migratePricingSheetAddAliases] seeded ' + updates + ' alias cells');
  return { aliasesColumnAdded: !hasAliases, rowsSeeded: updates };
}

/**
 * Auto-derive a starter alias list for one Pricing row.
 * Strategy: tokenize the Item label, strip price/punctuation, also pull
 * in any tokens inside parentheses (which often hold the ingredient
 * list or the brand). Add explicit common variants for known shapes.
 *
 * @returns {Array<string>}
 */
function deriveAliasesForItem_(category, item, source) {
  var cat = String(category || '').toLowerCase();
  var aliases = [];
  function add(a) {
    a = String(a || '').toLowerCase().trim();
    if (!a) return;
    if (aliases.indexOf(a) === -1) aliases.push(a);
  }

  // The stripped item name is always a useful alias
  var itemClean = String(item || '').replace(/\s*\(\$[^)]+\)/g, '').trim();
  if (itemClean) add(itemClean);

  // Words inside parens — often comma-separated ingredient lists
  var parens = String(item || '').match(/\(([^)]+)\)/g) || [];
  parens.forEach(function(p) {
    var inside = p.replace(/^\(|\)$/g, '').replace(/\$[^,)\s]+/g, '');
    inside.split(/,/).forEach(function(t) {
      var tok = t.replace(/[^a-z0-9\s]/gi, ' ').trim();
      if (tok && tok.length >= 3) add(tok);
    });
  });

  // Drop-the-price variants of the clean item name
  add(itemClean.replace(/\$\d+(\.\d+)?\s*\/?\s*(day|week|wk|month|quarter|qt)?/gi, '').trim());

  // Category-specific known synonyms
  if (/breakfast/i.test(cat)) {
    if (/with\s+fruit/i.test(item)) {
      ['with fruit', 'fruit daily', 'daily fruit', 'fruit', 'banana', 'strawberry', 'blueberry']
        .forEach(add);
    }
    if (/without\s+fruit/i.test(item)) {
      ['without fruit', 'no fruit', 'plain', 'overnight oats'].forEach(add);
    }
  }
  if (/lunch/i.test(cat)) {
    if (/celis/i.test(item) || /celis/i.test(source)) {
      ['celis', 'celis special', 'celis lunch', 'melt belt', 'wrap trap',
       'grilled cheese', 'turkey wrap', 'special'].forEach(add);
    }
    if (/pizza/i.test(item)) {
      add('pizza');
      if (/week|wk/i.test(source)) add('pizza weekly');
      if (/day/i.test(source))     add('pizza daily');
    }
  }
  if (/care/i.test(cat)) {
    if (/before/i.test(item)) ['before care', 'before-care', 'morning care'].forEach(add);
    if (/after/i.test(item) && /weekly/i.test(item)) {
      ['aftercare weekly', 'after care weekly', 'aftercare', 'after care weekly option']
        .forEach(add);
    }
    if (/after/i.test(item) && !/weekly/i.test(item) && !/same/i.test(item)) {
      ['after care', 'aftercare', 'aftercare daily', 'after care daily'].forEach(add);
    }
    if (/same\s+day/i.test(item)) {
      ['same day', 'before and after', 'before+after', 'full day care'].forEach(add);
    }
  }
  if (/shirt/i.test(cat)) {
    if (/extra\s+small/i.test(item)) ['extra small', 'xs', 'xsmall'].forEach(add);
    else if (/small/i.test(item))     ['small', 's'].forEach(add);
    if (/medium/i.test(item))         ['medium', 'm', 'md'].forEach(add);
    if (/extra\s+large/i.test(item))  ['extra large', 'xl', 'xlarge'].forEach(add);
    else if (/large/i.test(item))     ['large', 'l', 'lg'].forEach(add);
  }
  if (/duration/i.test(cat)) {
    // "1 day" → already covered by itemClean. Add bare numeric.
    var dm = item.match(/^(\d+)\s*day/i);
    if (dm) add(dm[1] + ' day');
  }

  return aliases;
}
