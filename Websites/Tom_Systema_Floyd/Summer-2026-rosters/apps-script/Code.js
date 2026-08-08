/**
 * Systema Floyd Summer 2026 — append updated CSV rows into Upper/Lower campus sheets.
 *
 * Web app endpoints (all require ?token=...):
 *   ?op=tabs       → list tab names + sizes for both spreadsheets
 *   ?op=dryrun     → compute what would be appended (no writes)
 *   ?op=apply      → actually append missing rows
 */

var SHEETS = {
  upper: '1qejcgNQt3sS_UZ9Gl9Txr8TOocw3LzK5PjPICqnRrGA',
  lower: '18A_sc917xnxYo3UQ8_cGogqg46Im6qUQlakOC9Oc-Fs'
};

var SECRET = 'roster2026-OLN5kLs23nVxqEbm';

function doGet(e) {
  if (!e || !e.parameter || e.parameter.token !== SECRET) {
    return jsonResponse({ error: 'unauthorized' });
  }
  var op = (e.parameter.op || 'tabs').toLowerCase();
  try {
    if (op === 'tabs') return jsonResponse(getTabs());
    if (op === 'dryrun') return jsonResponse(applyContacts({ apply: false }));
    if (op === 'apply') return jsonResponse(applyContacts({ apply: true }));
    if (op === 'verify') return jsonResponse(verifyHighlights());
    if (op === 'delta_dryrun') return jsonResponse(applyDelta({ apply: false }));
    if (op === 'delta_apply') return jsonResponse(applyDelta({ apply: true }));
    if (op === 'audit') return jsonResponse(auditPreexistingVsAdded());
    if (op === 'execute_action_plan_dryrun') return jsonResponse(executeActionPlan_({ apply: false }));
    if (op === 'execute_action_plan_apply') return jsonResponse(executeActionPlan_({ apply: true }));
    if (op === 'create_formatted_audit_sheet') return jsonResponse(createFormattedAuditSheet());
    if (op === 'create_simple_audit_sheet') return jsonResponse(createSimpleAuditSheet());
    if (op === 'populate_simple_audit_in_existing') {
      var tid = e.parameter.id || '';
      if (!tid) return jsonResponse({ error: 'need id param' });
      return jsonResponse(populateSimpleAuditInExisting(tid));
    }
    if (op === 'populate_single_audit_in_existing') {
      var tid2 = e.parameter.id || '';
      if (!tid2) return jsonResponse({ error: 'need id param' });
      return jsonResponse(populateSingleAuditInExisting(tid2));
    }
    if (op === 'trash_sheet') {
      var sid = e.parameter.id || '';
      if (!sid) return jsonResponse({ error: 'need id param' });
      DriveApp.getFileById(sid).setTrashed(true);
      return jsonResponse({ ok: true, trashed: sid });
    }
    if (op === 'rename_sheet') {
      var id = e.parameter.id || '';
      var name = e.parameter.name || '';
      if (!id || !name) return jsonResponse({ error: 'need id and name params' });
      SpreadsheetApp.openById(id).rename(name);
      return jsonResponse({ ok: true, id: id, newName: name });
    }
    return jsonResponse({ error: 'unknown op: ' + op });
  } catch (err) {
    return jsonResponse({ error: String(err && err.message || err), stack: err && err.stack });
  }
}

function jsonResponse(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj, null, 2))
    .setMimeType(ContentService.MimeType.JSON);
}

function getTabs() {
  var out = {};
  Object.keys(SHEETS).forEach(function (campus) {
    var ss = SpreadsheetApp.openById(SHEETS[campus]);
    out[campus] = ss.getSheets().map(function (s, i) {
      return { index: i, name: s.getName(), rows: s.getLastRow(), cols: s.getLastColumn() };
    });
  });
  return out;
}

function normalizeName(s) {
  return (s == null ? '' : ('' + s)).trim().toLowerCase().replace(/\s+/g, ' ');
}
function normalizeEmail(s) {
  return (s == null ? '' : ('' + s)).trim().toLowerCase();
}
function ageNum(s) {
  if (s == null) return null;
  var t = ('' + s).trim();
  if (!t) return null;
  var f = parseFloat(t);
  return isNaN(f) ? null : f;
}

function determineCampus(row) {
  var notes = (row.additionalNotes || '').toLowerCase();
  if (notes.indexOf('upper campus') !== -1) return 'upper';
  if (notes.indexOf('lower campus') !== -1) return 'lower';
  if (row.group) {
    var g = ('' + row.group).toLowerCase();
    if (g === 'upper') return 'upper';
    if (g === 'lower' || g === 'mini') return 'lower';
  }
  var a = ageNum(row.age);
  if (a !== null) return a >= 6 ? 'upper' : 'lower';
  return 'lower';
}

function findTabForWeek(ss, weekIndex) {
  var sheets = ss.getSheets();
  var candidates = [
    'Week ' + weekIndex,
    'Week ' + (weekIndex < 10 ? '0' + weekIndex : weekIndex),
    'WK ' + weekIndex
  ];
  for (var c = 0; c < candidates.length; c++) {
    var want = candidates[c].toLowerCase();
    for (var i = 0; i < sheets.length; i++) {
      if (sheets[i].getName().trim().toLowerCase() === want) return sheets[i];
    }
  }
  return sheets[weekIndex - 1] || null;
}

function buildHeaderMap(sheet) {
  var lastCol = sheet.getLastColumn();
  if (lastCol < 1) return { header: [], map: {} };
  var header = sheet.getRange(1, 1, 1, lastCol).getValues()[0].map(function (h) {
    return (h == null ? '' : ('' + h)).trim();
  });
  var map = {};
  header.forEach(function (h, i) { map[h.toLowerCase()] = i; });
  return { header: header, map: map };
}

function buildExistingKeys(sheet, map) {
  var lastRow = sheet.getLastRow();
  if (lastRow < 2) return Object.create(null);
  var lastCol = sheet.getLastColumn();
  var data = sheet.getRange(2, 1, lastRow - 1, lastCol).getValues();
  var nameIdx = map['student name'];
  var emailIdx = map['email'];
  var keys = Object.create(null);
  for (var i = 0; i < data.length; i++) {
    var name = nameIdx != null ? normalizeName(data[i][nameIdx]) : '';
    var email = emailIdx != null ? normalizeEmail(data[i][emailIdx]) : '';
    if (name || email) keys[name + '|' + email] = true;
  }
  return keys;
}

function rowValues(headerCols, row) {
  var notes = '' + (row.additionalNotes || '');
  var pottyTrained = /potty\s*trained/i.test(notes) ? 'Yes' : '';
  var days = row.days || ['', '', '', '', ''];
  var byHeader = {
    'paid?': '',
    'amt': '',
    'student name': row.studentName || '',
    'age': row.age || '',
    'is this student potty trained': pottyTrained,
    'breakfast': row.breakfast || '',
    'lunch': row.lunch || '',
    'before / after care': row.beforeAfterCare || '',
    'before/after care': row.beforeAfterCare || '',
    'shirt?': row.shirtSize || '',
    'email': row.email || '',
    'additional notes': row.additionalNotes || '',
    'mon': days[0] || '',
    'tue': days[1] || '',
    'wed': days[2] || '',
    'thu': days[3] || '',
    'fri': days[4] || ''
  };
  return headerCols.map(function (h) {
    var k = ('' + (h || '')).toLowerCase().trim();
    return Object.prototype.hasOwnProperty.call(byHeader, k) ? byHeader[k] : '';
  });
}

// Canonical spelling pick for each known duplicate pair: nonCanonical -> canonical.
// Picked based on: more-specific names (Aria Falzone > Aria), proper first-last order,
// proper capitalization, and matching the May 8 CSV format (straight quotes).
var CANONICAL_SPELLING = {
  'Aria': 'Aria Falzone',
  'Ballapiatt Ryan': 'Ryan Ballapiatt',
  'Herbst Capri': 'Capri Herbst',
  'Cosmo': 'Cosmo Robinson',
  'Grant “Geo” Olowin': 'Grant \'Geo\' Olowin',
  'Horta, Hudson': 'Hudson Horta',
  'James “Duncan” Zahringer III': 'James \'Duncan\' Zahringer III',
  'Lakow Wiley': 'Wiley Lakow',
  'Nelson gonzalez': 'Nelson Gonzalez',
  'Skaar, Norah': 'Norah Skaar',
  'Saylor': 'Saylor Carter',
  'Scott Wilder': 'Wilder Scott',
  'Hope Jean- Francois': 'Hope Jean-Francois'
};

/** Execute the doable items on the Action Plan: spelling dups (Item 1),
 *  Loupis cleanup (Item 4), pricing-syntax normalization (Item 6),
 *  and orphan investigation (Item 3). Returns a detailed report. */
function executeActionPlan_(opts) {
  var apply = !!opts.apply;
  var report = {
    apply: apply,
    spellingDupes: { renamed: [], deletedDups: [], errors: [] },
    loupisCleanup: { deletedEliana: null, sofiaEmailUpdated: null, errors: [] },
    pricingSyntaxFixes: [],
    orphanInvestigation: []
  };

  var upper = SpreadsheetApp.openById(SHEETS.upper);
  var lower = SpreadsheetApp.openById(SHEETS.lower);

  function nN(s) { return (s == null ? '' : ('' + s)).trim().toLowerCase().replace(/\s+/g, ' '); }
  function nE(s) { return (s == null ? '' : ('' + s)).trim().toLowerCase(); }
  function nonBlankCount(row) {
    var c = 0;
    for (var i = 0; i < row.length; i++) {
      var v = row[i];
      if (v !== '' && v !== null && v !== undefined) c++;
    }
    return c;
  }

  // ============ ITEM 1: Spelling duplicates =============
  Object.keys(CANONICAL_SPELLING).forEach(function (oldName) {
    var newName = CANONICAL_SPELLING[oldName];
    ['upper', 'lower'].forEach(function (campus) {
      var ss = campus === 'upper' ? upper : lower;
      ss.getSheets().forEach(function (sheet) {
        var lastRow = sheet.getLastRow();
        if (lastRow < 2) return;
        var hm = buildHeaderMap(sheet);
        var nameIdx = hm.map['student name'];
        var emailIdx = hm.map['email'];
        if (nameIdx == null) return;
        var lastCol = sheet.getLastColumn();
        var data = sheet.getRange(2, 1, lastRow - 1, lastCol).getValues();

        // Identify old-name rows and new-name rows in this tab
        var oldRows = []; // [{absRow, data, email}]
        var newRowsByEmail = {}; // email -> [{absRow, data}]
        for (var i = 0; i < data.length; i++) {
          var n = ('' + (data[i][nameIdx] || '')).trim();
          var e = emailIdx != null ? nE(data[i][emailIdx]) : '';
          if (n === oldName) oldRows.push({ absRow: i + 2, data: data[i], email: e });
          if (n === newName) {
            newRowsByEmail[e] = newRowsByEmail[e] || [];
            newRowsByEmail[e].push({ absRow: i + 2, data: data[i] });
          }
        }
        if (!oldRows.length) return;

        var rowsToDelete = [];
        oldRows.forEach(function (oldR) {
          var candidates = newRowsByEmail[oldR.email] || [];
          if (candidates.length > 0) {
            // Duplicate already exists with canonical name — keep richer row, delete other
            var oldFill = nonBlankCount(oldR.data);
            var keep = candidates[0];
            var keepFill = nonBlankCount(keep.data);
            if (oldFill > keepFill) {
              // Rename old row in place + delete the canonical-named row (which is sparser)
              if (apply) {
                sheet.getRange(oldR.absRow, nameIdx + 1).setValue(newName);
              }
              rowsToDelete.push(keep.absRow);
              report.spellingDupes.renamed.push({
                from: oldName, to: newName, campus: campus, tab: sheet.getName(),
                row: oldR.absRow, replacedAndDeletedDup: keep.absRow
              });
            } else {
              // Delete the old-name row (sparser)
              rowsToDelete.push(oldR.absRow);
              report.spellingDupes.deletedDups.push({
                deletedName: oldName, kept: newName, campus: campus, tab: sheet.getName(),
                deletedRow: oldR.absRow, keptRow: keep.absRow
              });
            }
          } else {
            // No conflict — just rename
            if (apply) {
              sheet.getRange(oldR.absRow, nameIdx + 1).setValue(newName);
            }
            report.spellingDupes.renamed.push({
              from: oldName, to: newName, campus: campus, tab: sheet.getName(), row: oldR.absRow
            });
          }
        });
        // Delete rows in reverse order to maintain indices
        rowsToDelete.sort(function (a, b) { return b - a; });
        rowsToDelete.forEach(function (r) {
          if (apply) sheet.deleteRow(r);
        });
      });
    });
  });

  // ============ ITEM 4: Loupis cleanup =============
  // Delete the Upper Wk 5 row for Eliana Loupis. Per parent's May 11 request, both
  // sisters (Eliana + Sofia) should be on LOWER together. Eliana already has a row
  // on Lower Wk 5 (we added it May 11), so this Upper Wk 5 row is the leftover legacy.
  var upperWk5 = null;
  upper.getSheets().forEach(function (s) {
    if (s.getName() === '6/29-7/3') upperWk5 = s;
  });
  if (upperWk5) {
    var hm = buildHeaderMap(upperWk5);
    var nameIdx = hm.map['student name'];
    if (nameIdx != null) {
      var lastRow = upperWk5.getLastRow();
      if (lastRow >= 2) {
        var data = upperWk5.getRange(2, 1, lastRow - 1, upperWk5.getLastColumn()).getValues();
        var rowsToDelete = [];
        for (var i = 0; i < data.length; i++) {
          var n = ('' + (data[i][nameIdx] || '')).trim().toLowerCase();
          if (n === 'eliana loupis') rowsToDelete.push(i + 2);
        }
        rowsToDelete.sort(function (a, b) { return b - a; });
        rowsToDelete.forEach(function (r) {
          if (apply) upperWk5.deleteRow(r);
          report.loupisCleanup.deletedEliana = report.loupisCleanup.deletedEliana || [];
          report.loupisCleanup.deletedEliana.push({ campus: 'upper', tab: '6/29-7/3', row: r });
        });
      }
    }
  }

  // (b) Add loupisfamily@gmail.com to Sofia Loupis's existing row(s)
  ['upper', 'lower'].forEach(function (campus) {
    var ss = campus === 'upper' ? upper : lower;
    ss.getSheets().forEach(function (sheet) {
      var lastRow = sheet.getLastRow();
      if (lastRow < 2) return;
      var hm = buildHeaderMap(sheet);
      var nameIdx = hm.map['student name'];
      var emailIdx = hm.map['email'];
      if (nameIdx == null || emailIdx == null) return;
      var data = sheet.getRange(2, 1, lastRow - 1, sheet.getLastColumn()).getValues();
      for (var i = 0; i < data.length; i++) {
        var n = nN(data[i][nameIdx]);
        var e = ('' + (data[i][emailIdx] || '')).trim();
        if (n === 'sofia loupis' && !e) {
          if (apply) sheet.getRange(i + 2, emailIdx + 1).setValue('loupisfamily@gmail.com');
          report.loupisCleanup.sofiaEmailUpdated = report.loupisCleanup.sofiaEmailUpdated || [];
          report.loupisCleanup.sofiaEmailUpdated.push({ campus: campus, tab: sheet.getName(), row: i + 2 });
        }
      }
    });
  });

  // ============ ITEM 6: Pricing-syntax normalization =============
  // Fix patterns that the billing regex won't match.
  function fixPricing(s) {
    if (s == null) return s;
    var t = '' + s;
    var before = t;
    // "$N per day" -> "$N/day"
    t = t.replace(/\$(\d+(?:\.\d{1,2})?)\s+per\s+day/gi, '$$$1/day');
    // "$N per week" -> "$N/week"
    t = t.replace(/\$(\d+(?:\.\d{1,2})?)\s+per\s+week/gi, '$$$1/week');
    // "$N/wk" -> "$N/week"
    t = t.replace(/\$(\d+(?:\.\d{1,2})?)\/wk\b/gi, '$$$1/week');
    // spaces around slash: "$N / day" -> "$N/day"
    t = t.replace(/\$(\d+(?:\.\d{1,2})?)\s*\/\s*day\b/gi, '$$$1/day');
    t = t.replace(/\$(\d+(?:\.\d{1,2})?)\s*\/\s*week\b/gi, '$$$1/week');
    // Normalize case after the above (handle /Day, /Week)
    t = t.replace(/(\$\d+(?:\.\d{1,2})?)\/Day\b/g, '$1/day');
    t = t.replace(/(\$\d+(?:\.\d{1,2})?)\/Week\b/g, '$1/week');
    return { fixed: t, changed: t !== before };
  }

  var pricingCols = ['breakfast', 'lunch', 'before / after care', 'before/after care', 'additional notes'];
  ['upper', 'lower'].forEach(function (campus) {
    var ss = campus === 'upper' ? upper : lower;
    ss.getSheets().forEach(function (sheet) {
      var lastRow = sheet.getLastRow();
      if (lastRow < 2) return;
      var hm = buildHeaderMap(sheet);
      var nameIdx = hm.map['student name'];
      var data = sheet.getRange(2, 1, lastRow - 1, sheet.getLastColumn()).getValues();
      pricingCols.forEach(function (colName) {
        var colIdx = hm.map[colName];
        if (colIdx == null) return;
        for (var i = 0; i < data.length; i++) {
          var result = fixPricing(data[i][colIdx]);
          if (result && result.changed) {
            if (apply) sheet.getRange(i + 2, colIdx + 1).setValue(result.fixed);
            report.pricingSyntaxFixes.push({
              campus: campus, tab: sheet.getName(), row: i + 2,
              student: data[i][nameIdx] || '',
              column: colName,
              before: data[i][colIdx],
              after: result.fixed
            });
          }
        }
      });
    });
  });

  // ============ ITEM 3: Orphan investigation =============
  // Pull context (notes, age, lunch, etc.) for the 4 orphan rows.
  var ORPHAN_NAMES = ['hayden finneran', 'Jackson Sonderman', 'Sydney Sonderman', 'Sofia Loupis'];
  ORPHAN_NAMES.forEach(function (orphan) {
    var orphanLc = orphan.toLowerCase();
    ['upper', 'lower'].forEach(function (campus) {
      var ss = campus === 'upper' ? upper : lower;
      ss.getSheets().forEach(function (sheet) {
        var lastRow = sheet.getLastRow();
        if (lastRow < 2) return;
        var hm = buildHeaderMap(sheet);
        var nameIdx = hm.map['student name'];
        if (nameIdx == null) return;
        var data = sheet.getRange(2, 1, lastRow - 1, sheet.getLastColumn()).getValues();
        for (var i = 0; i < data.length; i++) {
          var n = ('' + (data[i][nameIdx] || '')).trim().toLowerCase();
          if (n === orphanLc) {
            var rowObj = { name: orphan, campus: campus, tab: sheet.getName(), row: i + 2 };
            Object.keys(hm.map).forEach(function (col) {
              rowObj[col] = data[i][hm.map[col]];
            });
            report.orphanInvestigation.push(rowObj);
          }
        }
      });
    });
  });

  // Summary counts
  report.summary = {
    spellingRenames: report.spellingDupes.renamed.length,
    spellingDeletedDups: report.spellingDupes.deletedDups.length,
    pricingFixes: report.pricingSyntaxFixes.length,
    elianaRowDeleted: !!report.loupisCleanup.deletedEliana,
    sofiaEmailUpdated: (report.loupisCleanup.sofiaEmailUpdated || []).length,
    orphanRowsFound: report.orphanInvestigation.length
  };

  return report;
}

// Week-index → date-range tab name (matches both campus sheets' tab naming)
var WEEK_TO_TAB = {
  1: '6/1-6/5', 2: '6/8-6/12', 3: '6/15-6/19', 4: '6/22-6/26',
  5: '6/29-7/3', 6: '7/6-7/10', 7: '7/13-7/17', 8: '7/20-7/24',
  9: '7/27-7/31', 10: '8/3-8/7', 11: '8/10-8/14', 12: '8/17-8/21'
};

// Hand-curated suspected-duplicate-spelling map for the audit Notes column.
var DUPLICATE_OF = {
  'Aria Falzone': 'Aria',
  'Aria': 'Aria Falzone',
  'Ballapiatt Ryan': 'Ryan Ballapiatt',
  'Ryan Ballapiatt': 'Ballapiatt Ryan',
  'Capri Herbst': 'Herbst Capri',
  'Herbst Capri': 'Capri Herbst',
  'Cosmo': 'Cosmo Robinson',
  'Cosmo Robinson': 'Cosmo',
  'Grant \'Geo\' Olowin': 'Grant “Geo” Olowin',
  'Grant “Geo” Olowin': 'Grant \'Geo\' Olowin',
  'Horta, Hudson': 'Hudson Horta',
  'Hudson Horta': 'Horta, Hudson',
  'James \'Duncan\' Zahringer III': 'James “Duncan” Zahringer III',
  'James “Duncan” Zahringer III': 'James \'Duncan\' Zahringer III',
  'Lakow Wiley': 'Wiley Lakow',
  'Wiley Lakow': 'Lakow Wiley',
  'Nelson Gonzalez': 'Nelson gonzalez',
  'Nelson gonzalez': 'Nelson Gonzalez',
  'Norah Skaar': 'Skaar, Norah',
  'Skaar, Norah': 'Norah Skaar',
  'Saylor': 'Saylor Carter',
  'Saylor Carter': 'Saylor',
  'Scott Wilder': 'Wilder Scott',
  'Wilder Scott': 'Scott Wilder',
  'Hope Jean- Francois': 'Hope Jean-Francois',
  'Hope Jean-Francois': 'Hope Jean- Francois'
};

/** Shared data prep for the 3-tab simple audit views. */
function buildSimpleAuditData_() {
  var audit = auditPreexistingVsAdded();
  function cap(s) { return s.charAt(0).toUpperCase() + s.slice(1); }
  function uniqSorted(arr) {
    var seen = {}, out = [];
    arr.forEach(function (v) { if (!seen[v]) { seen[v] = true; out.push(v); } });
    return out.sort();
  }

  var allNames = {};
  Object.keys(audit.detail.preexisting).forEach(function (n) { allNames[n] = true; });
  Object.keys(audit.detail.added).forEach(function (n) { allNames[n] = true; });

  var newRows = [];
  Object.keys(allNames).forEach(function (name) {
    var pre = audit.detail.preexisting[name] || [];
    var add = audit.detail.added[name] || [];
    if (pre.length || !add.length) return;
    var weeks = uniqSorted(add.map(function (e) { return e.tab; }));
    var campuses = uniqSorted(add.map(function (e) { return cap(e.campus); }));
    var emails = uniqSorted(add.map(function (e) { return e.email || ''; }).filter(function (e) { return e; }));
    var dupOf = DUPLICATE_OF[name] || '';
    newRows.push([name, emails.join(', '), campuses.join(' & '), weeks.join(', '), dupOf]);
  });
  newRows.sort(function (a, b) { return a[0].toLowerCase().localeCompare(b[0].toLowerCase()); });

  var dupPairs = [];
  var seenPair = {};
  Object.keys(DUPLICATE_OF).forEach(function (a) {
    var b = DUPLICATE_OF[a];
    var key = [a, b].sort().join('||');
    if (seenPair[key]) return;
    seenPair[key] = true;
    if (!allNames[a] || !allNames[b]) return;
    dupPairs.push([a, b, 'Likely the same kid. Pick one spelling and update the other rows.']);
  });
  dupPairs.sort(function (a, b) { return a[0].toLowerCase().localeCompare(b[0].toLowerCase()); });

  var existingRows = [];
  Object.keys(allNames).forEach(function (name) {
    var pre = audit.detail.preexisting[name] || [];
    var add = audit.detail.added[name] || [];
    if (!pre.length) return;
    var weeks = uniqSorted(pre.concat(add).map(function (e) { return e.tab; }));
    var campuses = uniqSorted(pre.concat(add).map(function (e) { return cap(e.campus); }));
    var note = add.length ? 'We added them to ' + add.length + ' more week(s) they had registered for' : '';
    existingRows.push([name, campuses.join(' & '), weeks.join(', '), note]);
  });
  existingRows.sort(function (a, b) { return a[0].toLowerCase().localeCompare(b[0].toLowerCase()); });

  return { audit: audit, newRows: newRows, dupPairs: dupPairs, existingRows: existingRows };
}

/** Build provenance lookup: (nameLc|emailLc|tab) -> source label string. */
function buildProvenanceMaps_() {
  function nN(s) { return (s == null ? '' : ('' + s)).trim().toLowerCase().replace(/\s+/g, ' '); }
  function nE(s) { return (s == null ? '' : ('' + s)).trim().toLowerCase(); }
  var csv = {}, delta = {};
  WEEKLY_DATA.forEach(function (week) {
    var tab = WEEK_TO_TAB[week.weekIndex];
    week.rows.forEach(function (r) {
      csv[nN(r.studentName) + '|' + nE(r.email) + '|' + tab] =
        'May 8 master CSV: week' + week.weekIndex + '.csv (' + tab + ')';
    });
  });
  NEW_STUDENTS.forEach(function (s) {
    s.weeks.forEach(function (w) {
      var tab = WEEK_TO_TAB[w];
      var label;
      if (s.studentName === 'Aria Falzone' && w === 12) {
        label = 'May 7 batch CSV: additional_weeks_students.csv (Aria Wk12 add-on from Juliana)';
      } else if (s.studentName === 'Anna McIntosh') {
        label = 'May 6 forwarded form (Linda Pratka registered Anna for Wk 2)';
      } else {
        label = 'May 8 form-image OCR (registration screenshot Tom forwarded)';
      }
      delta[nN(s.studentName) + '|' + nE(s.email) + '|' + tab] = label;
    });
  });
  return {
    nN: nN, nE: nE,
    sourceFor: function (name, email, tab) {
      var k = nN(name) + '|' + nE(email) + '|' + tab;
      return delta[k] || csv[k] || 'orphan: row exists on the sheet but no matching CSV/form was found in our sources';
    }
  };
}

// Sheet URLs (used by the Where column hyperlinks)
var UPPER_ID = '1qejcgNQt3sS_UZ9Gl9Txr8TOocw3LzK5PjPICqnRrGA';
var LOWER_ID = '18A_sc917xnxYo3UQ8_cGogqg46Im6qUQlakOC9Oc-Fs';
var AUDIT_ID = '1ChURMMPTYtyAU6xWMBm65XQvSLLAf-HwpAudPDecOC8';
var UPPER_URL = 'https://docs.google.com/spreadsheets/d/' + UPPER_ID + '/edit';
var LOWER_URL = 'https://docs.google.com/spreadsheets/d/' + LOWER_ID + '/edit';
var AUDIT_URL = 'https://docs.google.com/spreadsheets/d/' + AUDIT_ID + '/edit';

/** Build a HYPERLINK formula to a SPECIFIC tab in a spreadsheet by tab-name lookup.
 *  Returns the URL with #gid={sheetId} so the link opens directly on that tab. */
function tabUrl_(spreadsheetId, tabName) {
  try {
    var ss = SpreadsheetApp.openById(spreadsheetId);
    var sheet = ss.getSheetByName(tabName);
    if (!sheet) return 'https://docs.google.com/spreadsheets/d/' + spreadsheetId + '/edit';
    return 'https://docs.google.com/spreadsheets/d/' + spreadsheetId + '/edit#gid=' + sheet.getSheetId();
  } catch (e) {
    return 'https://docs.google.com/spreadsheets/d/' + spreadsheetId + '/edit';
  }
}

function hl_(url, text) {
  // Escape any double-quotes in the label text for use inside the HYPERLINK formula
  var safe = ('' + text).replace(/"/g, '""');
  return '=HYPERLINK("' + url + '", "' + safe + '")';
}

/** The recommended action plan rows. 5 columns: Priority, Action, Why, Where (link), Team Comments.
 *  Each row is an atomic question with one clear answer expected.
 *  Accepts a tabUrls object with pre-computed deep-links to audit-sheet tabs. */
function buildActionPlanRows_(data, tabUrls) {
  tabUrls = tabUrls || {};
  var newStudentsUrl = tabUrls.newStudents || AUDIT_URL;
  var dupsUrl = tabUrls.duplicates || AUDIT_URL;

  var rows = [];

  // ==== Section A: things we already did (DONE, informational) ====
  rows.push([
    'A1 DONE',
    'Cleaned up spelling duplicates (no team action needed)',
    'AUTOMATED 2026-05-12. 14 rows renamed to canonical spelling: Nelson gonzalez -> Nelson Gonzalez; Lakow Wiley -> Wiley Lakow; Horta, Hudson -> Hudson Horta; Skaar, Norah -> Norah Skaar; curly Grant "Geo" Olowin -> straight Grant \'Geo\' Olowin; curly James "Duncan" Zahringer III -> straight; Hope Jean- Francois -> Hope Jean-Francois. 16 duplicate rows deleted: 10 legacy "Aria" rows where canonical "Aria Falzone" already existed; 2 "Saylor" rows replaced by "Saylor Carter"; "Herbst Capri" -> "Capri Herbst"; "Lakow Wiley" -> "Wiley Lakow"; "Scott Wilder" -> "Wilder Scott". Spelling Duplicates tab on the audit sheet is now empty.',
    hl_(dupsUrl, 'Verify Spelling Duplicates tab is empty'),
    ''
  ]);
  rows.push([
    'A2 DONE',
    'Investigated 4 orphan rows (no team action needed)',
    'INVESTIGATED 2026-05-12. The 4 names that I could not trace to any of the source CSVs/forms turned out to be valid registrations: hayden finneran (tommyfin@msn.com), Upper Wks 6/22, 6/29, 7/6, team-entered. Jackson Sonderman + Sydney Sonderman (kalurie@gmail.com), Upper Wks 7/6 + 7/13, both with note "If possible, I would appreciate at 50% scholarship" so they came in via the scholarship form. Sofia Loupis already has email loupisfamily@gmail.com.',
    hl_(tabUrl_(UPPER_ID, '7/6-7/10'), 'Open Upper 7/6-7/10 to verify'),
    ''
  ]);
  rows.push([
    'A3 DONE',
    'Eliana + Sofia Loupis cleanup from May 11 form (no team action needed)',
    'AUTOMATED 2026-05-12. Deleted the old Upper Wk 6/29-7/3 row for Eliana Loupis. She is now only on Lower Wk 6/29-7/3 with sister Sofia per the parent\'s May 11 form request.',
    hl_(tabUrl_(LOWER_ID, '6/29-7/3'), 'Open Lower 6/29-7/3 to verify'),
    ''
  ]);
  rows.push([
    'A4 DONE',
    'Pricing-syntax normalization (no team action needed)',
    'AUTOMATED 2026-05-12. 10 Before/After Care cells fixed across both campus sheets: all "$25 per day" became "$25/day"; one "$20 per day" became "$20/day". Billing-dashboard regex picks these up now.',
    hl_(tabUrl_(LOWER_ID, '6/15-6/19'), 'Open Lower 6/15-6/19 to spot-check'),
    ''
  ]);

  // ==== Section B: Full-sheet review - one row per campus sheet ====
  rows.push([
    'B1',
    'Review every weekly tab on the UPPER Campus sheet and confirm it looks right',
    'Go through each of the 12 weekly tabs (6/1-6/5, 6/8-6/12, ..., 8/17-8/21) and verify: every student belongs there, no one is missing, parent emails are correct, lunch/aftercare/breakfast options match what the parent wanted, Mon-Fri marks make sense. Newly-added rows have their Student Name cell highlighted yellow so they are easy to spot. Write "looks good" if everything is fine, or list any corrections to make (e.g. "Wk 7/6 remove Susan Smith; Wk 8/3 add Beth Carter") and we will take care of it.',
    hl_(UPPER_URL, 'Open Upper Campus sheet'),
    ''
  ]);
  rows.push([
    'B2',
    'Review every weekly tab on the LOWER Campus sheet and confirm it looks right',
    'Same as B1 but for the Lower Campus sheet (kids age 5 and under). 12 weekly tabs to go through. Newly-added rows have yellow highlight on the Student Name. Write "looks good" or list corrections to make.',
    hl_(LOWER_URL, 'Open Lower Campus sheet'),
    ''
  ]);

  // ==== Section C: Partial-week day assignments - one row per kid ====
  var partialKids = [
    { name: 'Liam McPherson', age: 6, campus: 'Upper', tab: '7/20-7/24', daysCount: 3, ss: UPPER_ID },
    { name: 'Luke McPherson', age: 5, campus: 'Lower', tab: '7/20-7/24', daysCount: 4, ss: LOWER_ID },
    { name: 'Anna McIntosh',  age: 6, campus: 'Upper', tab: '6/8-6/12',  daysCount: 3, ss: UPPER_ID },
    { name: 'Jack Schwencke', age: 5, campus: 'Lower', tab: '6/29-7/3',  daysCount: 4, ss: LOWER_ID }
  ];
  partialKids.forEach(function (k, i) {
    rows.push([
      'C' + (i + 1),
      'Which days does ' + k.name + ' attend (' + k.campus + ' Wk ' + k.tab + ')?',
      'Registration form said ' + k.daysCount + ' days but did not specify which days of the week. Billing needs this to compute per-day charges. Write the day names here (e.g. "Mon Wed Fri") and we\'ll mark them on the campus sheet.',
      hl_(tabUrl_(k.ss, k.tab), 'Open ' + k.campus + ' Campus ' + k.tab + ' tab'),
      ''
    ]);
  });

  return rows;
}

/** Add the 4 audit tabs (Action Plan / NEW / Duplicates / Existing) to the given spreadsheet. */
function applyThreeTabs_(ss, data) {
  // Before rebuilding, preserve any team-written comments from the existing Action Plan tab.
  // Keyed by Action title (column B) so renaming rows still preserves comments.
  var preservedComments = {};
  ss.getSheets().forEach(function (sh) {
    if (sh.getName().toLowerCase().indexOf('action plan') !== 0) return;
    var lastRow = sh.getLastRow();
    var lastCol = sh.getLastColumn();
    if (lastRow < 2 || lastCol < 5) return;
    var rows = sh.getRange(2, 1, lastRow - 1, lastCol).getValues();
    var headerRow = sh.getRange(1, 1, 1, lastCol).getValues()[0];
    var actionIdx = -1, commentsIdx = -1;
    for (var i = 0; i < headerRow.length; i++) {
      var h = (headerRow[i] || '').toString().toLowerCase().trim();
      if (h === 'action') actionIdx = i;
      if (h.indexOf('team comments') === 0 || h === 'comments' || h.indexOf('team notes') === 0) commentsIdx = i;
    }
    if (actionIdx === -1 || commentsIdx === -1) return;
    rows.forEach(function (r) {
      var actionKey = (r[actionIdx] || '').toString().trim();
      var comment = r[commentsIdx];
      if (actionKey && comment !== '' && comment != null) {
        preservedComments[actionKey] = comment;
      }
    });
  });

  // Build the 3 audit data tabs FIRST so we know their sheet IDs (for the deep-link URLs).
  var t1 = ss.insertSheet('__NEW_temp__');
  styleTab_(t1, [['Student Name', 'Parent Email', 'Campus', 'Weeks Attending', 'Possible Duplicate Of']],
            data.newRows, '#0b8043', '#d9ead3');
  var t2 = ss.insertSheet('__DUPS_temp__');
  styleTab_(t2, [['Name in the sheet', 'Probably the same kid as', 'What to do']],
            data.dupPairs, '#cc0000', '#fce5cd');
  var t3 = ss.insertSheet('__EXIST_temp__');
  styleTab_(t3, [['Student Name', 'Campus', 'Weeks Attending', 'Note']],
            data.existingRows, '#1c4587', '#ffffff');

  // Now build the action plan rows with tab-specific deep links into the just-created audit tabs.
  var ssId = ss.getId();
  var tabUrls = {
    newStudents: 'https://docs.google.com/spreadsheets/d/' + ssId + '/edit#gid=' + t1.getSheetId(),
    duplicates:  'https://docs.google.com/spreadsheets/d/' + ssId + '/edit#gid=' + t2.getSheetId(),
    existing:    'https://docs.google.com/spreadsheets/d/' + ssId + '/edit#gid=' + t3.getSheetId()
  };
  var tAction = ss.insertSheet('__ACTION_temp__');
  var actionPlanRows = buildActionPlanRows_(data, tabUrls);
  // Reinject any preserved team comments into matching rows (match by Action title in col 2)
  actionPlanRows.forEach(function (r) {
    var existing = preservedComments[r[1]];
    if (existing !== undefined && existing !== '') r[4] = existing;
  });
  styleTab_(tAction, [['Priority', 'Action', 'Why it matters', 'Where to do it', 'Team Comments / Instructions']],
            actionPlanRows, '#674ea7', '#e7e0f1'); // purple theme

  // Delete every other sheet
  ss.getSheets().forEach(function (s) {
    if (s.getSheetId() !== tAction.getSheetId() &&
        s.getSheetId() !== t1.getSheetId() &&
        s.getSheetId() !== t2.getSheetId() &&
        s.getSheetId() !== t3.getSheetId()) {
      ss.deleteSheet(s);
    }
  });

  // Rename to final names with counts
  tAction.setName('Action Plan (' + buildActionPlanRows_(data).length + ')');
  t1.setName('NEW Students (' + data.newRows.length + ')');
  t2.setName('Spelling Duplicates (' + data.dupPairs.length + ')');
  t3.setName('Already on Sheets (' + data.existingRows.length + ')');

  // Color-code rows based on whether Priority column contains "DONE"
  var rows = actionPlanRows.length;
  var actionDataRange = tAction.getRange(2, 1, rows, 5);
  var actionRules = [
    SpreadsheetApp.newConditionalFormatRule()
      .whenFormulaSatisfied('=ISNUMBER(SEARCH("DONE",$A2))')
      .setBackground('#b6d7a8').setFontColor('#274e13')
      .setRanges([actionDataRange]).build()
  ];
  tAction.setConditionalFormatRules(actionRules);

  // Highlight the Team Comments column with a light yellow fill so the team sees where to type
  tAction.getRange(2, 5, rows, 1).setBackground('#fff9e6');

  // Column widths for the 5-column layout
  tAction.setColumnWidth(1, 110);   // Priority
  tAction.setColumnWidth(2, 280);   // Action
  tAction.setColumnWidth(3, 480);   // Why
  tAction.setColumnWidth(4, 240);   // Where (link)
  tAction.setColumnWidth(5, 360);   // Team Comments

  // === Provenance cell notes on every Student Name cell ===
  var prov = buildProvenanceMaps_();
  var audit = data.audit;

  // Tab 1: NEW Students — note shows which CSV/form each yellow row came from
  data.newRows.forEach(function (row, i) {
    var name = row[0];
    var entries = (audit.detail.added[name] || []);
    var sources = {};
    entries.forEach(function (e) {
      var src = prov.sourceFor(name, e.email || '', e.tab);
      sources[src] = true;
    });
    var note = 'WHERE THIS KID CAME FROM\n\n' + Object.keys(sources).sort().join('\n\n');
    if (entries.length) {
      var emails = {};
      entries.forEach(function (e) { if (e.email) emails[e.email] = true; });
      note += '\n\nParent email(s): ' + Object.keys(emails).join(', ');
    }
    t1.getRange(i + 2, 1).setNote(note);
  });

  // Tab 2: Spelling Duplicates — note on each name showing where THAT spelling appears
  data.dupPairs.forEach(function (pair, i) {
    [0, 1].forEach(function (col) {
      var name = pair[col];
      var allEntries = (audit.detail.preexisting[name] || []).concat(audit.detail.added[name] || []);
      var sources = {};
      allEntries.forEach(function (e) {
        var classification = (audit.detail.preexisting[name] || []).indexOf(e) !== -1
          ? 'Already on sheet (legacy team-entered)'
          : prov.sourceFor(name, e.email || '', e.tab);
        sources[classification + ' [' + e.campus + ' ' + e.tab + ']'] = true;
      });
      var note = 'WHERE THIS SPELLING APPEARS\n\n' + Object.keys(sources).sort().join('\n');
      t2.getRange(i + 2, col + 1).setNote(note);
    });
  });

  // Tab 3: Already on Sheets — note explains legacy origin + lists the tabs they're on
  data.existingRows.forEach(function (row, i) {
    var name = row[0];
    var pre = audit.detail.preexisting[name] || [];
    var add = audit.detail.added[name] || [];
    var preTabs = {};
    pre.forEach(function (e) { preTabs[e.campus + ' ' + e.tab] = true; });
    var note = 'WHERE THIS KID CAME FROM\n\nAlready on the sheet before our 2026-05-08 sync. ' +
               'Original source unknown (likely team-entered manually OR submitted via an older form before the GHL automation).\n\n' +
               'Found on these tabs (legacy):\n  - ' + Object.keys(preTabs).sort().join('\n  - ');
    if (add.length) {
      var addSources = {};
      add.forEach(function (e) {
        var src = prov.sourceFor(name, e.email || '', e.tab);
        addSources[src + ' -> ' + e.campus + ' ' + e.tab] = true;
      });
      note += '\n\nWe ALSO added them to these additional weeks (yellow rows):\n  - ' +
              Object.keys(addSources).sort().join('\n  - ');
    }
    t3.getRange(i + 2, 1).setNote(note);
  });

  // Make Action Plan the default open tab (it's the call to action)
  ss.setActiveSheet(tAction);
  ss.moveActiveSheet(1);
}

/** Create a brand-new spreadsheet with the 3 simple tabs. */
function createSimpleAuditSheet() {
  var data = buildSimpleAuditData_();
  var ss = SpreadsheetApp.create('Summer Camp 2026: Roster Reconciliation');
  applyThreeTabs_(ss, data);
  return {
    url: ss.getUrl(),
    id: ss.getId(),
    counts: { newKids: data.newRows.length, duplicates: data.dupPairs.length, existing: data.existingRows.length }
  };
}

/** Replace contents of an existing spreadsheet (same URL) with the 3 simple tabs. */
function populateSimpleAuditInExisting(targetId) {
  var data = buildSimpleAuditData_();
  var ss = SpreadsheetApp.openById(targetId);
  applyThreeTabs_(ss, data);
  return {
    url: ss.getUrl(),
    id: targetId,
    counts: { newKids: data.newRows.length, duplicates: data.dupPairs.length, existing: data.existingRows.length }
  };
}

/** Single-tab consolidated audit. Replaces every tab with one "Audit" tab. */
function populateSingleAuditInExisting(targetId) {
  var ss = SpreadsheetApp.openById(targetId);

  // Preserve any answers/comments from the previous Audit tab, keyed by Topic (col B).
  var preserved = {};
  ss.getSheets().forEach(function (sh) {
    if (sh.getName().toLowerCase().indexOf('audit') !== 0) return;
    var lastRow = sh.getLastRow();
    var lastCol = sh.getLastColumn();
    if (lastRow < 2 || lastCol < 5) return;
    var values = sh.getRange(2, 1, lastRow - 1, lastCol).getValues();
    values.forEach(function (r) {
      var key = (r[1] || '').toString().trim();
      var answer = r[4];
      if (key && answer !== '' && answer != null) preserved[key] = answer;
    });
  });

  // Clean up any leftover temp tabs from a previous failed run
  ss.getSheets().forEach(function (sh) {
    if (sh.getName().indexOf('__') === 0) ss.deleteSheet(sh);
  });
  // Create the new single Audit tab with a temp name
  var t = ss.insertSheet('__AUDIT_temp__');
  var rows = buildAuditTabRows_();
  // Reinject preserved answers
  rows.forEach(function (r) {
    var saved = preserved[r[1]];
    if (saved !== undefined && saved !== '') r[4] = saved;
  });

  var header = ['#', 'Topic', 'Details', 'Where to go', 'Your answer'];
  t.getRange(1, 1, 1, header.length).setValues([header]);
  t.getRange(2, 1, rows.length, header.length).setValues(rows);

  // Header style
  t.getRange(1, 1, 1, header.length)
    .setBackground('#1c4587')
    .setFontColor('#ffffff')
    .setFontWeight('bold')
    .setFontSize(11)
    .setHorizontalAlignment('center')
    .setVerticalAlignment('middle');
  t.setRowHeight(1, 40);
  t.setFrozenRows(1);

  var dataRange = t.getRange(2, 1, rows.length, header.length);
  dataRange.setVerticalAlignment('top').setWrap(true).setFontSize(11);

  // Conditional formatting: DONE rows green, YES/NO rows light yellow
  var fmtRules = [
    SpreadsheetApp.newConditionalFormatRule()
      .whenFormulaSatisfied('=$A2="DONE"')
      .setBackground('#d9ead3').setFontColor('#274e13')
      .setRanges([dataRange]).build(),
    SpreadsheetApp.newConditionalFormatRule()
      .whenFormulaSatisfied('=AND($A2<>"DONE",$A2<>"")')
      .setBackground('#fff2cc')
      .setRanges([dataRange]).build(),
    // Highlight the answer cell yellow if it's still blank on a question row
    SpreadsheetApp.newConditionalFormatRule()
      .whenFormulaSatisfied('=AND($A2<>"DONE",$E2="")')
      .setBackground('#ffff00').setBold(true)
      .setRanges([t.getRange(2, 5, rows.length, 1)]).build()
  ];
  t.setConditionalFormatRules(fmtRules);

  // Data validation on Your answer column for QUESTION rows: Yes / No (with custom text allowed)
  var rule = SpreadsheetApp.newDataValidation()
    .requireValueInList(['Yes', 'No'], true)
    .setAllowInvalid(true)  // allow free-form text overrides (like "Mon Wed Fri" instead of yes/no)
    .setHelpText('Type Yes or No, or enter your own answer (e.g. "Mon Wed Fri").')
    .build();
  rows.forEach(function (r, i) {
    if (r[0] !== 'DONE' && r[0] !== '') {
      t.getRange(i + 2, 5).setDataValidation(rule);
    }
  });

  // Column widths
  t.setColumnWidth(1, 70);    // # / DONE
  t.setColumnWidth(2, 360);   // Topic
  t.setColumnWidth(3, 520);   // Details
  t.setColumnWidth(4, 220);   // Where (link)
  t.setColumnWidth(5, 220);   // Your answer

  // Delete every other tab so only this Audit tab remains
  ss.getSheets().forEach(function (sh) {
    if (sh.getSheetId() !== t.getSheetId()) ss.deleteSheet(sh);
  });
  t.setName('Audit');

  return {
    url: ss.getUrl(),
    id: targetId,
    rows: rows.length,
    questionRowsNeedingAnswer: rows.filter(function (r) { return r[0] !== 'DONE' && r[4] === ''; }).length
  };
}

function buildAuditTabRows_() {
  // 5 columns: # | Topic | Details | Where to go | Your answer
  var upper = UPPER_URL;
  var lower = LOWER_URL;
  return [
    // ============ Section 1: What we did (informational, no action needed) ============
    ['DONE', 'Imported your 12 master CSVs from May 8',
     '159 new rows added across the two campus sheets (36 to Upper, 123 to Lower). 69 candidate rows were already on the sheets and correctly skipped.',
     '', ''],
    ['DONE', 'Picked up 9 students whose forms were missing from the CSVs',
     'Hannah Bennett, Miles Younes, Sloane Kassatly, Liam McPherson, Luke McPherson, Bennett Carter, Saylor Carter, Norah Skaar, Anna McIntosh. Each one was added on the correct campus and the correct week.',
     '', ''],
    ['DONE', 'Reinstated Hawthorn Fennell and Lilly Heyes after your May 11 emails',
     'They had been removed earlier in error because Juliana\'s May 7 reply flagged them as cancelled. After your May 11 forms came in, both were re-added to the sheets and to Florida GHL.',
     '', ''],
    ['DONE', 'Added the 4 new parents from your May 11 emails to Florida GHL',
     'Hawthorn Fennell, Jack Schwencke, Eliana Loupis, and Lilly Heyes\'s parents are now in Florida GHL with the "Summer Camp 2026" tag.',
     '', ''],
    ['DONE', 'Pushed every unique parent to Florida GoHighLevel',
     '67 unique parent contacts now exist in the Florida sub-account, all tagged "Summer Camp 2026". This is what feeds the dashboard.',
     '', ''],
    ['DONE', 'Cleaned up 13 spelling-duplicate pairs',
     '14 rows renamed to a canonical spelling (e.g. "Nelson gonzalez" -> "Nelson Gonzalez", "Lakow Wiley" -> "Wiley Lakow", "Horta, Hudson" -> "Hudson Horta") and 16 duplicate rows were deleted (mostly legacy "Aria" rows where canonical "Aria Falzone" already existed on the same week tab). Drops the dashboard\'s unique-name count.',
     '', ''],
    ['DONE', 'Normalized pricing syntax on legacy rows',
     '10 Before/After Care cells fixed: every "$25 per day" became "$25/day" and one "$20 per day" became "$20/day" so the billing-dashboard regex reads them correctly.',
     '', ''],
    ['DONE', 'Investigated 4 "orphan" rows that did not trace to any CSV/form',
     'All 4 turned out to be legitimate registrations from the scholarship form: hayden finneran (tommyfin@msn.com), Jackson Sonderman, Sydney Sonderman (both kalurie@gmail.com, "I would appreciate a 50% scholarship"), and Sofia Loupis (already had her parent email). No action needed.',
     '', ''],
    ['DONE', 'Cleaned up Eliana + Sofia Loupis from your May 11 form',
     'Per the parent\'s request to have both sisters in Lower together, Eliana was moved from Upper Wk 6/29-7/3 to Lower Wk 6/29-7/3 (Sofia was already there). The leftover Upper row was deleted.',
     '', ''],
    ['DONE', 'Updated the Free Camp dashboard weekly caps',
     'Was showing Upper 35/wk and Lower 35/wk (= 70 total spots, wrong). Now showing Upper 17/wk and Lower 18/wk (= 35 total) per your message.',
     '', ''],

    // ============ Section 2: Yes/No questions for the team ============
    ['Q1', 'Does the UPPER Campus sheet look right?',
     'Open the link and walk through all 12 weekly tabs. Yellow Student Name cells = rows we added. Pick Yes if everything looks correct. Pick No (or write any corrections in this cell) if anything is wrong.',
     hl_(upper, 'Open Upper Campus sheet'),
     ''],
    ['Q2', 'Does the LOWER Campus sheet look right?',
     'Same idea, walk through all 12 weekly tabs. Yellow = rows we added.',
     hl_(lower, 'Open Lower Campus sheet'),
     ''],
    ['Q3', 'Confirm Liam McPherson is Mon, Tue, Thu on Upper Wk 7/20-7/24?',
     'Already marked as Mon, Tue, Thu (3 days) on the sheet (probably team-entered). Form said 3 days but did not specify which. Yes = keep as-is. No = write the correct days here.',
     hl_(tabUrl_(UPPER_ID, '7/20-7/24'), 'Open Upper 7/20-7/24 tab'),
     ''],
    ['Q4', 'Mark Luke McPherson as Mon, Tue, Wed, Thu (4 days) on Lower Wk 7/20-7/24?',
     'Currently blank on the sheet. The form said 4 days but did not say which. Yes = we will mark Mon/Tue/Wed/Thu. No = please write the actual days here.',
     hl_(tabUrl_(LOWER_ID, '7/20-7/24'), 'Open Lower 7/20-7/24 tab'),
     ''],
    ['Q5', 'Mark Anna McIntosh as Mon, Tue, Wed (3 days) on Upper Wk 6/8-6/12?',
     'Currently blank on the sheet. The form said 3 days but did not say which. Yes = we will mark Mon/Tue/Wed. No = please write the actual days here.',
     hl_(tabUrl_(UPPER_ID, '6/8-6/12'), 'Open Upper 6/8-6/12 tab'),
     ''],
    ['Q6', 'Confirm Jack Schwencke is Mon, Tue, Wed, Fri on Lower Wk 6/29-7/3?',
     'Already marked as Mon, Tue, Wed, Fri (4 days) on the sheet (probably team-entered). Form said 4 days but did not specify which. Yes = keep as-is. No = write the correct days here.',
     hl_(tabUrl_(LOWER_ID, '6/29-7/3'), 'Open Lower 6/29-7/3 tab'),
     '']
  ];
}

function styleTab_(sheet, headerRows, dataRows, headerBg, rowFill) {
  var header = headerRows[0];
  sheet.getRange(1, 1, 1, header.length).setValues(headerRows);
  if (dataRows.length > 0) {
    sheet.getRange(2, 1, dataRows.length, header.length).setValues(dataRows);
  }

  // Header style
  sheet.getRange(1, 1, 1, header.length)
    .setBackground(headerBg)
    .setFontColor('#ffffff')
    .setFontWeight('bold')
    .setFontSize(11)
    .setHorizontalAlignment('center')
    .setVerticalAlignment('middle');
  sheet.setRowHeight(1, 40);
  sheet.setFrozenRows(1);

  // Body style
  if (dataRows.length > 0) {
    var body = sheet.getRange(2, 1, dataRows.length, header.length);
    body.setVerticalAlignment('middle').setFontSize(11).setWrap(true);
    if (rowFill && rowFill !== '#ffffff') {
      body.setBackground(rowFill);
    }
    // Alternating bands via banding
    try {
      sheet.getRange(1, 1, dataRows.length + 1, header.length).applyRowBanding();
    } catch (e) { /* ignore if banding API unavailable */ }
  }

  // Borders + auto-resize + filter
  sheet.autoResizeColumns(1, header.length);
  // Cap super-wide columns so the sheet fits on screen
  for (var c = 1; c <= header.length; c++) {
    var w = sheet.getColumnWidth(c);
    if (w > 320) sheet.setColumnWidth(c, 320);
    if (w < 120) sheet.setColumnWidth(c, 120);
  }
  if (dataRows.length > 0) {
    sheet.getRange(1, 1, dataRows.length + 1, header.length).createFilter();
  }
}

/**
 * Create a NEW formatted Google Sheet from the audit data: one row per student,
 * sorted (truly-new on top), color-coded by status, with frozen header + filter.
 * Returns the URL of the new sheet.
 */
function createFormattedAuditSheet() {
  var audit = auditPreexistingVsAdded();

  // Build provenance maps: (name|email|tab) -> source label
  function nN(s) { return (s == null ? '' : ('' + s)).trim().toLowerCase().replace(/\s+/g, ' '); }
  function nE(s) { return (s == null ? '' : ('' + s)).trim().toLowerCase(); }

  var csvProv = {};
  WEEKLY_DATA.forEach(function (week) {
    var tab = WEEK_TO_TAB[week.weekIndex];
    week.rows.forEach(function (r) {
      csvProv[nN(r.studentName) + '|' + nE(r.email) + '|' + tab] = 'week' + week.weekIndex + '.csv';
    });
  });
  var deltaProv = {};
  NEW_STUDENTS.forEach(function (s) {
    s.weeks.forEach(function (w) {
      var tab = WEEK_TO_TAB[w];
      var label = (s.studentName === 'Aria Falzone' && w === 12)
        ? 'May 7 batch CSV'
        : (s.studentName === 'Anna McIntosh' ? 'May 6 forwarded form' : 'form-image OCR');
      deltaProv[nN(s.studentName) + '|' + nE(s.email) + '|' + tab] = label;
    });
  });
  function srcFor(name, email, tab) {
    var k = nN(name) + '|' + nE(email) + '|' + tab;
    return deltaProv[k] || csvProv[k] || 'orphan (no source)';
  }

  function uniqSorted(arr) {
    var seen = {};
    var out = [];
    arr.forEach(function (v) { if (!seen[v]) { seen[v] = true; out.push(v); } });
    return out.sort();
  }
  function cap(s) { return s.charAt(0).toUpperCase() + s.slice(1); }

  // Build the row data
  var allNames = {};
  Object.keys(audit.detail.preexisting).forEach(function (n) { allNames[n] = true; });
  Object.keys(audit.detail.added).forEach(function (n) { allNames[n] = true; });
  var nameList = Object.keys(allNames).sort(function (a, b) {
    return a.toLowerCase().localeCompare(b.toLowerCase());
  });

  var rows = [];
  nameList.forEach(function (name) {
    var pre = audit.detail.preexisting[name] || [];
    var add = audit.detail.added[name] || [];
    var status =
      (pre.length && add.length) ? 'Existing kid + we added more weeks' :
      pre.length ? 'Already on sheets (we did not touch)' :
                   'Truly NEW (added by us)';
    var preTabs = uniqSorted(pre.map(function (e) { return e.tab; }));
    var addTabs = uniqSorted(add.map(function (e) { return e.tab; }));
    var campuses = uniqSorted(pre.concat(add).map(function (e) { return cap(e.campus); }));
    var sources = uniqSorted(add.map(function (e) {
      return srcFor(name, e.email || '', e.tab);
    }));
    var dupOf = DUPLICATE_OF[name] || '';
    var notes = '';
    if (sources.indexOf('orphan (no source)') !== -1) notes = 'orphan rows';
    if (!pre.concat(add).some(function (e) { return e.email; })) {
      notes = (notes ? notes + '; ' : '') + 'incomplete entry (no email)';
    }
    rows.push([
      name, status, campuses.join(', '),
      preTabs.join(', '), addTabs.join(', '),
      pre.length, add.length,
      sources.join(', '),
      dupOf,
      notes
    ]);
  });

  // Sort: truly new first, then existing+added, then preexisting-only
  var order = {
    'Truly NEW (added by us)': 0,
    'Existing kid + we added more weeks': 1,
    'Already on sheets (we did not touch)': 2
  };
  rows.sort(function (a, b) {
    var s = order[a[1]] - order[b[1]];
    return s !== 0 ? s : a[0].toLowerCase().localeCompare(b[0].toLowerCase());
  });

  // Create the new spreadsheet
  var ss = SpreadsheetApp.create('Summer Camp 2026: Pre-existing vs Newly-added Students (Audit)');
  var sheet = ss.getActiveSheet();
  sheet.setName('Audit');

  var header = [
    'Student Name', 'Status', 'Campus(es)',
    'Already-there Tabs', 'We-Added Tabs',
    '# Already', '# Added',
    'Source(s) for Added', 'Suspected Duplicate Of', 'Notes'
  ];
  sheet.getRange(1, 1, 1, header.length).setValues([header]);
  if (rows.length > 0) {
    sheet.getRange(2, 1, rows.length, header.length).setValues(rows);
  }

  var lastRow = sheet.getLastRow();
  var lastCol = sheet.getLastColumn();

  // Header formatting: bold white on dark blue, centered, frozen
  sheet.getRange(1, 1, 1, lastCol)
    .setBackground('#1c4587')
    .setFontColor('#ffffff')
    .setFontWeight('bold')
    .setHorizontalAlignment('center')
    .setVerticalAlignment('middle');
  sheet.setRowHeight(1, 36);
  sheet.setFrozenRows(1);

  // Body styling
  if (lastRow > 1) {
    var body = sheet.getRange(2, 1, lastRow - 1, lastCol);
    body.setVerticalAlignment('top').setWrap(true).setFontSize(10);
  }

  // Conditional formatting on Status column (B)
  var dataRange = sheet.getRange(2, 1, Math.max(lastRow - 1, 1), lastCol);
  var rules = [];
  rules.push(SpreadsheetApp.newConditionalFormatRule()
    .whenFormulaSatisfied('=$B2="Truly NEW (added by us)"')
    .setBackground('#d9ead3') // light green
    .setRanges([dataRange])
    .build());
  rules.push(SpreadsheetApp.newConditionalFormatRule()
    .whenFormulaSatisfied('=$B2="Existing kid + we added more weeks"')
    .setBackground('#fff2cc') // light yellow
    .setRanges([dataRange])
    .build());
  rules.push(SpreadsheetApp.newConditionalFormatRule()
    .whenFormulaSatisfied('=$I2<>""')
    .setFontColor('#cc0000') // red font for any "Suspected Duplicate Of"
    .setRanges([sheet.getRange(2, 9, Math.max(lastRow - 1, 1), 1)])
    .build());
  sheet.setConditionalFormatRules(rules);

  // Set column widths (auto-resize for text columns, narrow for counts)
  sheet.autoResizeColumns(1, lastCol);
  // Cap the wide multi-week tab columns so the sheet doesn't sprawl
  sheet.setColumnWidth(4, 260); // Already-there Tabs
  sheet.setColumnWidth(5, 260); // We-Added Tabs
  sheet.setColumnWidth(8, 280); // Source(s) for Added
  sheet.setColumnWidth(6, 80);  // # Already
  sheet.setColumnWidth(7, 80);  // # Added

  // Filter on whole range
  if (lastRow > 1) {
    sheet.getRange(1, 1, lastRow, lastCol).createFilter();
  }

  // Add a small summary panel above the data? Insert 4 rows at top with totals
  // (skipped to keep filtering clean)

  return {
    url: ss.getUrl(),
    id: ss.getId(),
    rowCount: rows.length,
    note: 'Owner is the script account (systemafloydsheets@gmail.com). Share with team via the Drive UI before sending the email.'
  };
}

/**
 * For Tom's review: classify every Student Name across both sheets as
 *   - "preexisting" = was on the sheet BEFORE we ran the May 8 sync (no yellow fill)
 *   - "added"       = added by our sync (Student Name cell highlighted #fff475)
 * Returns unique-name sets, per-campus and per-tab breakdowns, and overlap.
 */
function auditPreexistingVsAdded() {
  var YELLOW = '#fff475';
  var preexistingSet = Object.create(null);
  var addedSet = Object.create(null);
  var perCampus = { upper: { preexisting: [], added: [] }, lower: { preexisting: [], added: [] } };
  var perTab = [];

  Object.keys(SHEETS).forEach(function (campus) {
    var ss = SpreadsheetApp.openById(SHEETS[campus]);
    ss.getSheets().forEach(function (sheet) {
      var lastRow = sheet.getLastRow();
      var hm = buildHeaderMap(sheet);
      var nameCol = hm.map['student name'];
      var emailCol = hm.map['email'];
      var tabReport = {
        campus: campus,
        tab: sheet.getName(),
        rows: lastRow,
        preexistingNames: [],
        addedNames: []
      };
      if (lastRow < 2 || nameCol == null) {
        perTab.push(tabReport);
        return;
      }
      var nameRange = sheet.getRange(2, nameCol + 1, lastRow - 1, 1);
      var bgs = nameRange.getBackgrounds();
      var values = nameRange.getValues();
      var emails = emailCol != null
        ? sheet.getRange(2, emailCol + 1, lastRow - 1, 1).getValues()
        : null;
      for (var r = 0; r < bgs.length; r++) {
        var name = (values[r][0] || '').toString().trim();
        if (!name) continue;
        var email = emails ? (emails[r][0] || '').toString().trim() : '';
        var nameKey = name; // preserve case for display
        var entry = { name: name, email: email, campus: campus, tab: sheet.getName(), row: r + 2 };
        var bg = (bgs[r][0] || '').toString().toLowerCase();
        if (bg === YELLOW) {
          addedSet[nameKey] = addedSet[nameKey] || [];
          addedSet[nameKey].push(entry);
          tabReport.addedNames.push(name);
          perCampus[campus].added.push(name);
        } else {
          preexistingSet[nameKey] = preexistingSet[nameKey] || [];
          preexistingSet[nameKey].push(entry);
          tabReport.preexistingNames.push(name);
          perCampus[campus].preexisting.push(name);
        }
      }
      perTab.push(tabReport);
    });
  });

  function uniqSorted(arr) {
    var seen = Object.create(null);
    var out = [];
    arr.forEach(function (n) { if (!seen[n]) { seen[n] = true; out.push(n); } });
    return out.sort(function (a, b) { return a.localeCompare(b); });
  }

  var preNames = uniqSorted(Object.keys(preexistingSet));
  var addNames = uniqSorted(Object.keys(addedSet));
  var preLc = Object.create(null);
  preNames.forEach(function (n) { preLc[n.toLowerCase()] = n; });
  var overlap = addNames.filter(function (n) { return !!preLc[n.toLowerCase()]; });
  var trueNew = addNames.filter(function (n) { return !preLc[n.toLowerCase()]; });

  return {
    summary: {
      uniquePreexistingNames: preNames.length,
      uniqueAddedNames: addNames.length,
      overlapNames: overlap.length,
      trueNewNames: trueNew.length,
      totalUniqueNamesNow: preNames.length + trueNew.length
    },
    preexisting: preNames,
    added: addNames,
    overlap: overlap,
    trueNew: trueNew,
    perCampus: {
      upper: { preexistingUnique: uniqSorted(perCampus.upper.preexisting), addedUnique: uniqSorted(perCampus.upper.added) },
      lower: { preexistingUnique: uniqSorted(perCampus.lower.preexisting), addedUnique: uniqSorted(perCampus.lower.added) }
    },
    perTab: perTab,
    detail: {
      preexisting: preexistingSet,
      added: addedSet
    }
  };
}

function applyDelta(opts) {
  var apply = !!opts.apply;
  var upperSS = SpreadsheetApp.openById(SHEETS.upper);
  var lowerSS = SpreadsheetApp.openById(SHEETS.lower);
  var report = {
    apply: apply,
    additions: { perStudent: [], totalsByCampus: { upper: 0, lower: 0 }, skippedAlreadyPresent: 0 },
    removals: { perStudent: [], totalRowsDeleted: 0, notFound: [] }
  };

  // === ADDITIONS ===
  var sheetCache = { upper: {}, lower: {} };
  function getSheet(campus, weekIndex) {
    if (sheetCache[campus][weekIndex]) return sheetCache[campus][weekIndex];
    var ss = campus === 'upper' ? upperSS : lowerSS;
    var sheet = findTabForWeek(ss, weekIndex);
    if (!sheet) return null;
    var hm = buildHeaderMap(sheet);
    var keys = buildExistingKeys(sheet, hm.map);
    var entry = { sheet: sheet, hm: hm, keys: keys, queue: [] };
    sheetCache[campus][weekIndex] = entry;
    return entry;
  }

  NEW_STUDENTS.forEach(function (student) {
    student.weeks.forEach(function (weekIndex) {
      var entry = getSheet(student.campus, weekIndex);
      if (!entry) {
        report.additions.perStudent.push({
          name: student.studentName, email: student.email, campus: student.campus,
          weekIndex: weekIndex, status: 'tab_missing'
        });
        return;
      }
      var key = normalizeName(student.studentName) + '|' + normalizeEmail(student.email);
      if (entry.keys[key]) {
        report.additions.perStudent.push({
          name: student.studentName, email: student.email, campus: student.campus,
          weekIndex: weekIndex, tab: entry.sheet.getName(), status: 'already_present'
        });
        report.additions.skippedAlreadyPresent += 1;
        return;
      }
      entry.queue.push(student);
      entry.keys[key] = true;
      report.additions.perStudent.push({
        name: student.studentName, email: student.email, campus: student.campus,
        weekIndex: weekIndex, tab: entry.sheet.getName(), status: 'will_add'
      });
      report.additions.totalsByCampus[student.campus] += 1;
    });
  });

  if (apply) {
    ['upper', 'lower'].forEach(function (campus) {
      Object.keys(sheetCache[campus]).forEach(function (weekIndex) {
        var entry = sheetCache[campus][weekIndex];
        if (!entry.queue.length) return;
        var values = entry.queue.map(function (s) { return rowValues(entry.hm.header, s); });
        var startRow = entry.sheet.getLastRow() + 1;
        entry.sheet.getRange(startRow, 1, values.length, entry.hm.header.length).setValues(values);
        var nameCol = entry.hm.map['student name'];
        if (nameCol != null) {
          entry.sheet.getRange(startRow, nameCol + 1, values.length, 1).setBackground('#fff475');
        }
      });
    });
  }

  // === REMOVALS ===
  SKIP_STUDENTS.forEach(function (s) {
    var nameLc = normalizeName(s.studentName);
    var emailLc = normalizeEmail(s.email);
    var anyFound = false;
    ['upper', 'lower'].forEach(function (campus) {
      var ss = campus === 'upper' ? upperSS : lowerSS;
      ss.getSheets().forEach(function (sheet) {
        var lastRow = sheet.getLastRow();
        if (lastRow < 2) return;
        var hm = buildHeaderMap(sheet);
        var nameIdx = hm.map['student name'];
        var emailIdx = hm.map['email'];
        if (nameIdx == null || emailIdx == null) return;
        var data = sheet.getRange(2, 1, lastRow - 1, hm.header.length).getValues();
        var rowsToDelete = [];
        for (var i = 0; i < data.length; i++) {
          var n = normalizeName(data[i][nameIdx]);
          var e = normalizeEmail(data[i][emailIdx]);
          if (n === nameLc && e === emailLc) rowsToDelete.push(i + 2);
        }
        rowsToDelete.reverse();
        rowsToDelete.forEach(function (rowNum) {
          if (apply) sheet.deleteRow(rowNum);
          report.removals.perStudent.push({
            name: s.studentName, email: s.email, campus: campus,
            tab: sheet.getName(), row: rowNum, status: apply ? 'deleted' : 'will_delete'
          });
          report.removals.totalRowsDeleted += 1;
          anyFound = true;
        });
      });
    });
    if (!anyFound) {
      report.removals.notFound.push({ name: s.studentName, email: s.email });
    }
  });

  return report;
}

function verifyHighlights() {
  var YELLOW = '#fff475';
  var out = { upper: [], lower: [] };
  Object.keys(SHEETS).forEach(function (campus) {
    var ss = SpreadsheetApp.openById(SHEETS[campus]);
    ss.getSheets().forEach(function (sheet, i) {
      var lastRow = sheet.getLastRow();
      var hm = buildHeaderMap(sheet);
      var nameCol = hm.map['student name'];
      if (lastRow < 2 || nameCol == null) {
        out[campus].push({ index: i, name: sheet.getName(), highlighted: 0, rows: lastRow });
        return;
      }
      var rng = sheet.getRange(2, nameCol + 1, lastRow - 1, 1);
      var bgs = rng.getBackgrounds();
      var values = rng.getValues();
      var highlighted = [];
      for (var r = 0; r < bgs.length; r++) {
        var bg = (bgs[r][0] || '').toLowerCase();
        if (bg === YELLOW) highlighted.push({ row: r + 2, name: values[r][0] });
      }
      out[campus].push({ index: i, name: sheet.getName(), rows: lastRow, highlighted: highlighted.length, sample: highlighted.slice(0, 5), all: highlighted });
    });
  });
  return out;
}

function applyContacts(opts) {
  var apply = !!opts.apply;
  var upperSS = SpreadsheetApp.openById(SHEETS.upper);
  var lowerSS = SpreadsheetApp.openById(SHEETS.lower);

  var report = {
    apply: apply,
    perWeek: [],
    summary: { totalCandidates: 0, alreadyPresent: 0, appendedUpper: 0, appendedLower: 0, missingTab: 0 }
  };

  WEEKLY_DATA.forEach(function (week) {
    var w = {
      weekIndex: week.weekIndex,
      label: week.label,
      upperTab: null,
      lowerTab: null,
      existingUpper: 0,
      existingLower: 0,
      candidates: 0,
      skippedAlreadyPresent: 0,
      appendedUpper: 0,
      appendedLower: 0,
      newUpper: [],
      newLower: [],
      skipped: []
    };
    var upperSheet = findTabForWeek(upperSS, week.weekIndex);
    var lowerSheet = findTabForWeek(lowerSS, week.weekIndex);
    if (!upperSheet || !lowerSheet) {
      w.error = 'Missing tab (upper=' + !!upperSheet + ', lower=' + !!lowerSheet + ')';
      report.summary.missingTab += 1;
      report.perWeek.push(w);
      return;
    }
    w.upperTab = upperSheet.getName();
    w.lowerTab = lowerSheet.getName();

    var upperHM = buildHeaderMap(upperSheet);
    var lowerHM = buildHeaderMap(lowerSheet);
    var upperKeys = buildExistingKeys(upperSheet, upperHM.map);
    var lowerKeys = buildExistingKeys(lowerSheet, lowerHM.map);
    w.existingUpper = Object.keys(upperKeys).length;
    w.existingLower = Object.keys(lowerKeys).length;

    var upperToAppend = [];
    var lowerToAppend = [];

    week.rows.forEach(function (row) {
      w.candidates += 1;
      report.summary.totalCandidates += 1;
      var campus = determineCampus(row);
      var key = normalizeName(row.studentName) + '|' + normalizeEmail(row.email);
      if (campus === 'upper') {
        if (upperKeys[key]) {
          w.skippedAlreadyPresent += 1;
          report.summary.alreadyPresent += 1;
          w.skipped.push({ name: row.studentName, email: row.email, age: row.age, campus: 'upper', matchedKey: key });
        } else {
          upperToAppend.push(rowValues(upperHM.header, row));
          upperKeys[key] = true;
          w.newUpper.push({ name: row.studentName, email: row.email, age: row.age, key: key });
        }
      } else {
        if (lowerKeys[key]) {
          w.skippedAlreadyPresent += 1;
          report.summary.alreadyPresent += 1;
          w.skipped.push({ name: row.studentName, email: row.email, age: row.age, campus: 'lower', matchedKey: key });
        } else {
          lowerToAppend.push(rowValues(lowerHM.header, row));
          lowerKeys[key] = true;
          w.newLower.push({ name: row.studentName, email: row.email, age: row.age, key: key });
        }
      }
    });
    w.appendedUpper = upperToAppend.length;
    w.appendedLower = lowerToAppend.length;

    if (apply) {
      if (upperToAppend.length > 0) {
        var rUStart = upperSheet.getLastRow() + 1;
        upperSheet.getRange(rUStart, 1, upperToAppend.length, upperHM.header.length).setValues(upperToAppend);
        var uNameCol = upperHM.map['student name'];
        if (uNameCol != null) {
          upperSheet.getRange(rUStart, uNameCol + 1, upperToAppend.length, 1).setBackground('#fff475');
        }
      }
      if (lowerToAppend.length > 0) {
        var rLStart = lowerSheet.getLastRow() + 1;
        lowerSheet.getRange(rLStart, 1, lowerToAppend.length, lowerHM.header.length).setValues(lowerToAppend);
        var lNameCol = lowerHM.map['student name'];
        if (lNameCol != null) {
          lowerSheet.getRange(rLStart, lNameCol + 1, lowerToAppend.length, 1).setBackground('#fff475');
        }
      }
    }
    report.summary.appendedUpper += w.appendedUpper;
    report.summary.appendedLower += w.appendedLower;
    report.perWeek.push(w);
  });

  return report;
}
