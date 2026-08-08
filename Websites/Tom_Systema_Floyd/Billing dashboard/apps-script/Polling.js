/** ─── Polling.gs ───────────────────────────────────────────────────
 *  5-minute polling job against GHL /forms/submissions.
 *  Replaces the old webhook ingestion path entirely.
 *  Depends on: Configuration.gs, Helpers.gs, SheetWrites.gs
 */

// ─── logEvent ────────────────────────────────────────────────────────────────
/**
 * Inserts a log row at row 2 of the Logs sheet (newest entries at top).
 * @param {Object} entry  { timestamp, submissionId, email, status, details, rawPayload }
 */
function logEvent(entry) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName('Logs');
  if (!sheet) {
    Logger.log('[logEvent] WARNING: Logs sheet not found. Entry: ' + JSON.stringify(entry));
    return;
  }
  try {
    sheet.insertRowBefore(2);
    sheet.getRange(2, 1, 1, 6).setValues([[
      entry.timestamp || new Date().toISOString(),
      entry.submissionId || '(poll)',
      entry.email || '',
      entry.status || '',
      entry.details || '',
      entry.rawPayload || ''
    ]]);
  } catch (e) {
    Logger.log('[logEvent] Error writing to Logs: ' + e.message);
  }
}

// ─── setupLogsSheet ──────────────────────────────────────────────────────────
/**
 * Creates (or re-creates) the Logs sheet with header, formatting, filters.
 * Safe to re-run — clears and rebuilds if the sheet already exists.
 */
function setupLogsSheet() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sheet = ss.getSheetByName('Logs');

  // Create if not found
  if (!sheet) {
    sheet = ss.insertSheet('Logs');
    // Move to position 2 (after Dashboard)
    ss.setActiveSheet(sheet);
    ss.moveActiveSheet(2);
  } else {
    sheet.clearContents();
    sheet.clearFormats();
    // Remove any existing filters
    const existingFilter = sheet.getFilter();
    if (existingFilter) existingFilter.remove();
  }

  // ── Headers ────────────────────────────────────────────────────────────────
  const headers = [['Timestamp', 'Submission ID', 'Email', 'Status', 'Details', 'Raw Payload']];
  sheet.getRange(1, 1, 1, 6).setValues(headers);

  // Header formatting: bold, 11pt, dark bg #0F3634, white text
  const headerRange = sheet.getRange(1, 1, 1, 6);
  headerRange.setFontWeight('bold');
  headerRange.setFontSize(11);
  headerRange.setBackground('#0F3634');
  headerRange.setFontColor('#FFFFFF');

  // Freeze header row
  sheet.setFrozenRows(1);

  // ── Column widths ──────────────────────────────────────────────────────────
  sheet.setColumnWidth(1, 160);   // A: Timestamp
  sheet.setColumnWidth(2, 200);   // B: Submission ID
  sheet.setColumnWidth(3, 200);   // C: Email
  sheet.setColumnWidth(4, 110);   // D: Status
  sheet.setColumnWidth(5, 280);   // E: Details
  sheet.setColumnWidth(6, 400);   // F: Raw Payload

  // ── Add filter on row 1 ────────────────────────────────────────────────────
  sheet.getRange(1, 1, 1, 6).createFilter();

  // ── Conditional formatting on col D (Status) ──────────────────────────────
  const rules = [];
  const maxRow = 1000; // Apply to rows 2-1000

  // processed → light green row (#E0F4E5)
  rules.push(SpreadsheetApp.newConditionalFormatRule()
    .whenFormulaSatisfied('=$D2="processed"')
    .setBackground('#E0F4E5')
    .setRanges([sheet.getRange(2, 1, maxRow, 6)])
    .build());

  // duplicate → light grey row (#F0F0F0)
  rules.push(SpreadsheetApp.newConditionalFormatRule()
    .whenFormulaSatisfied('=$D2="duplicate"')
    .setBackground('#F0F0F0')
    .setRanges([sheet.getRange(2, 1, maxRow, 6)])
    .build());

  // lead_only → light blue row (#E0EEF8)
  rules.push(SpreadsheetApp.newConditionalFormatRule()
    .whenFormulaSatisfied('=$D2="lead_only"')
    .setBackground('#E0EEF8')
    .setRanges([sheet.getRange(2, 1, maxRow, 6)])
    .build());

  // failed → light red row (#FCE4E4), col E red text
  rules.push(SpreadsheetApp.newConditionalFormatRule()
    .whenFormulaSatisfied('=$D2="failed"')
    .setBackground('#FCE4E4')
    .setFontColor('#CC0000')
    .setRanges([sheet.getRange(2, 1, maxRow, 6)])
    .build());

  // poll_error → dark red row (#F5BCB7), col E bold red text
  rules.push(SpreadsheetApp.newConditionalFormatRule()
    .whenFormulaSatisfied('=$D2="poll_error"')
    .setBackground('#F5BCB7')
    .setFontColor('#990000')
    .setRanges([sheet.getRange(2, 1, maxRow, 6)])
    .build());

  sheet.setConditionalFormatRules(rules);

  Logger.log('[setupLogsSheet] Logs sheet created/updated successfully.');
}

// ─── seenSubmissionIds ───────────────────────────────────────────────
/**
 * Returns a Set of all submission IDs that have already been processed.
 * Source A (primary): Logs sheet col B — append-only, survives Dashboard cleanup.
 * Source B (backup): Dashboard col B Notes — catches rows imported before Logs existed.
 * @returns {Set<string>}
 */
function seenSubmissionIds() {
  const set = new Set();

  // Source A (primary) — Logs sheet col B is append-only
  // and survives Dashboard cleanup. Skip the synthetic
  // markers '(poll)' and '(system)' which are used for
  // non-submission events.
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const logsSheet = ss.getSheetByName('Logs');
  if (logsSheet && logsSheet.getLastRow() >= 2) {
    const ids = logsSheet
      .getRange(2, 2, logsSheet.getLastRow() - 1, 1)
      .getValues();
    for (const [id] of ids) {
      if (id && typeof id === 'string'
          && id !== '(poll)' && id !== '(system)') {
        set.add(id);
      }
    }
  }

  // Source B (backup) — Dashboard col B Notes. Catches any
  // rows imported before Logs existed.
  const dashSheet = getDashboardSheet();
  if (dashSheet.getLastRow() >= 2) {
    const notes = dashSheet
      .getRange(2, 2, dashSheet.getLastRow() - 1, 1)
      .getNotes();
    for (const [note] of notes) {
      if (!note) continue;
      const m = note.match(/Submission ID:\s*(\S+)/);
      if (m) set.add(m[1]);
    }
  }

  return set;
}

// ─── isTransientGhlFailure_ ──────────────────────────────────────────────────
/**
 * Returns true for HTTP statuses + body patterns that suggest a transient
 * GHL backend hiccup worth retrying once. Covers:
 *   - 5xx: any server error
 *   - 408, 429: client-side timeout / rate-limit
 *   - 400 with "timed out" in the body — GHL specifically returns HTTP 400
 *     when its internal MongoDB query (reporting_form_submissions.find())
 *     times out after 10s. Real 400s (bad request) don't say "timed out",
 *     so the body check distinguishes the transient case from a code bug.
 */
function isTransientGhlFailure_(code, body) {
  if (code >= 500 && code <= 599) return true;
  if (code === 408 || code === 429) return true;
  if (code === 400 && /timed?\s*out|timeout/i.test(String(body || ''))) return true;
  return false;
}

// ─── ghlListSubmissions ──────────────────────────────────────────────────────
/**
 * Calls GHL's GET /forms/submissions endpoint for a date range.
 * Retries once on transient backend failures (see isTransientGhlFailure_)
 * before surfacing the error — silences sub-second GHL DB hiccups that
 * historically generated ~1 false-alarm [CRITICAL] email per few days.
 * @param {string} subaccountName  e.g. 'Florida'
 * @param {string} startAt         ISO 8601
 * @param {string} endAt           ISO 8601
 * @returns {Array<Object>}  Array of submission objects
 */
function ghlListSubmissions(subaccountName, startAt, endAt) {
  const meta = SUBACCOUNTS[subaccountName];
  if (!meta) throw new Error('Unknown subaccount: ' + subaccountName);
  const token = getTokenFor(subaccountName);

  const url = GHL_API_BASE +
    '/forms/submissions' +
    '?locationId='  + encodeURIComponent(meta.locationId) +
    '&startAt='     + encodeURIComponent(startAt) +
    '&endAt='       + encodeURIComponent(endAt) +
    '&limit=100';

  Logger.log('[ghlListSubmissions] GET ' + url);

  const fetchOpts = {
    method: 'get',
    headers: {
      'Authorization': 'Bearer ' + token,
      'Version': GHL_API_VERSION,
      'Accept': 'application/json',
    },
    muteHttpExceptions: true
  };

  let resp = UrlFetchApp.fetch(url, fetchOpts);
  let code = resp.getResponseCode();
  let body = resp.getContentText();

  // One retry on transient backend hiccups. 2-second backoff is long enough
  // for GHL's internal pool to recover from a sub-second blip but short
  // enough not to push the poll into the 6-min Apps Script execution cap.
  if (isTransientGhlFailure_(code, body)) {
    Logger.log('[ghlListSubmissions] transient HTTP ' + code + ', retrying in 2s. body[0..200]: ' + body.substring(0, 200));
    Utilities.sleep(2000);
    resp = UrlFetchApp.fetch(url, fetchOpts);
    code = resp.getResponseCode();
    body = resp.getContentText();
    Logger.log('[ghlListSubmissions] retry got HTTP ' + code);
  }

  Logger.log('[ghlListSubmissions] HTTP ' + code + ' body[0..300]: ' + body.substring(0, 300));

  if (code !== 200) {
    throw new Error('HTTP ' + code + ': ' + body.substring(0, 300));
  }

  let data;
  try {
    data = JSON.parse(body);
  } catch (e) {
    throw new Error('JSON parse error: ' + e.message + ' | body: ' + body.substring(0, 200));
  }

  // Log actual shape for debugging
  Logger.log('[ghlListSubmissions] Top-level keys: ' + Object.keys(data).join(', '));

  // Handle varied response shapes
  if (Array.isArray(data)) return data;
  if (Array.isArray(data.submissions)) return data.submissions;
  if (Array.isArray(data.results))     return data.results;
  if (Array.isArray(data.data))        return data.data;

  // Unknown shape — log and return empty
  Logger.log('[ghlListSubmissions] WARNING: unknown response shape. Returning [].');
  return [];
}

// ─── ghlGetContact ───────────────────────────────────────────────────────────
/**
 * Fetches a single contact by ID from the given subaccount.
 * @param {string} subaccountName
 * @param {string} contactId
 * @returns {Object} contact object
 */
function ghlGetContact(subaccountName, contactId) {
  const token = getTokenFor(subaccountName);
  const resp = UrlFetchApp.fetch(GHL_API_BASE + '/contacts/' + contactId, {
    method: 'get',
    headers: {
      'Authorization': 'Bearer ' + token,
      'Version': GHL_API_VERSION,
      'Accept': 'application/json',
    },
    muteHttpExceptions: true
  });
  const code = resp.getResponseCode();
  if (code !== 200) {
    throw new Error('GET /contacts/' + contactId + ' returned HTTP ' + code +
                    ': ' + resp.getContentText().substring(0, 200));
  }
  const parsed = JSON.parse(resp.getContentText());
  return parsed.contact || parsed || {};
}

// ─── readCustomField ─────────────────────────────────────────────────────────
/**
 * Searches contact.customFields for a field by name (case-insensitive).
 * @param {Object} contact   GHL contact object
 * @param {string} fieldName  e.g. 'Waiver Origin'
 * @returns {string}  field value, or empty string if not found
 */
function readCustomField(contact, fieldName) {
  const fields = contact.customFields || contact.customField || [];
  const lower = fieldName.toLowerCase();
  for (const f of fields) {
    const name = (f.name || f.fieldKey || f.id || '').toLowerCase();
    if (name.includes(lower) || lower.includes(name.replace(/_/g, ' '))) {
      return String(f.value || '');
    }
  }
  return '';
}

// ─── readWaiverOrigin ────────────────────────────────────────────────────────
/**
 * Reads the "WaiverOrigin" custom field (or its with-space variant
 * "Waiver Origin") from a GHL contact. This field is set ONLY by the
 * waiver form, and the waiver form REQUIRES the $1 CC verification fee.
 *
 * Therefore: WaiverOrigin populated <=> the contact submitted a waiver
 * <=> a CC verification fee should exist for that submission.
 *
 * If the field is not present on the contact, return empty string.
 * Do NOT default to the polling subaccount — that's misleading.
 *
 * @param {Object} contact  GHL contact object
 * @returns {string}        State string ("Florida" / "Georgia" / "Virginia") or ''
 */
function readWaiverOrigin(contact) {
  // GHL contact customFields entries only carry `id` + `value` (no name).
  // Translate via the FieldRegistry, which is a Map<fieldId, {name, ...}>.
  var registry = null;
  try { registry = getFieldRegistry('Florida'); } catch (e) {}
  if (!registry || typeof registry.forEach !== 'function') return '';

  // Find the field whose registry name matches WaiverOrigin / "Waiver Origin"
  var targetId = null;
  registry.forEach(function(meta, id) {
    if (targetId) return;
    var name = String(meta && meta.name || '').toLowerCase().trim();
    if (name === 'waiverorigin' || name === 'waiver origin') targetId = id;
  });
  if (!targetId) return '';

  // Read that field's value off the contact
  var fields = contact.customFields || contact.customField || [];
  for (var i = 0; i < fields.length; i++) {
    if (fields[i].id === targetId) {
      var v = fields[i].value;
      if (Array.isArray(v)) v = v.length ? String(v[0]) : '';
      return String(v || '').trim();
    }
  }
  return '';
}

// ─── processSubmissionVerificationFeeOnly ───────────────────────────────────
/**
 * Stripped-down poll path. After 2026-05-13 cutover, the new
 * sheet-driven pipeline (BillingFromSheets.js) handles every camp /
 * lunch / shirt charge by reading the registration sheets directly.
 *
 * The ONE thing the sheet-driven pipeline can't see is the $1 GHL
 * credit-card-verification fee, which arrives only inside GHL's
 * `payment` field on every signed waiver. This function preserves
 * that audit trail by writing a single $1 row per waiver into the
 * central Billing Dashboard's Dashboard tab and marking it "paid"
 * (it doesn't affect balance — it's pure paper trail).
 *
 * Everything else from the original processSubmission (camp tuition,
 * lunch, shirt, etc.) is skipped on purpose. processSubmission is
 * kept in this file for rollback only — no live caller invokes it.
 *
 * @param {Object} submission
 * @returns {string}  'processed' | 'duplicate' | 'lead_only' | 'failed'
 */
function processSubmissionVerificationFeeOnly(submission) {
  var submissionId = submission.id || submission._id || submission.submissionId;
  if (!submissionId) {
    logEvent({
      timestamp: new Date().toISOString(),
      submissionId: '(missing)',
      email: '',
      status: 'failed',
      details: 'Submission missing id field',
      rawPayload: JSON.stringify(submission).substring(0, 45000)
    });
    return 'failed';
  }

  // Dedup against the Logs sheet so we never double-write a $1 row
  if (seenSubmissionIds().has(submissionId)) {
    logEvent({
      timestamp: new Date().toISOString(),
      submissionId: submissionId,
      email: (submission.contact && submission.contact.email) || '',
      status: 'duplicate',
      details: 'Already processed (verification-fee-only path)',
      rawPayload: JSON.stringify(submission).substring(0, 45000)
    });
    return 'duplicate';
  }

  try {
    // Detect the $1 CC verification fee
    var extraction = extractSubmissionFieldsWithSelfHeal(submission, 'Florida');
    var feeField = null;
    for (var i = 0; i < extraction.fields.length; i++) {
      var f = extraction.fields[i];
      if (f.id !== 'payment') continue;
      var price = parsePrice(String(f.value || ''));
      var mult  = extractMultiplier(String(f.value || ''));
      if (price === 1 && !mult) { feeField = f; break; }
    }

    if (!feeField) {
      // Not a waiver submission (no $1 fee) — skip silently as lead_only
      logEvent({
        timestamp: new Date().toISOString(),
        submissionId: submissionId,
        email: (submission.contact && submission.contact.email) || '',
        status: 'lead_only',
        details: 'No $1 verification fee in payload — non-waiver submission, skipping',
        rawPayload: JSON.stringify(submission).substring(0, 45000)
      });
      return 'lead_only';
    }

    // Pull contact info for the audit log only — we no longer write
    // a $1 tx row to the Dashboard tab because BillingFromSheets'
    // rebuildDashboardHierarchical_ now wipes the Dashboard data area
    // every 5 minutes and re-emits from registration sheets. The $1
    // fee row would be destroyed on the next rebuild.
    //
    // Audit trail moves to the Logs sheet only. Tom can search Logs
    // for "CC verification fee" / "$1" / a specific submissionId if
    // he ever needs to confirm a parent's waiver fee was processed.
    var flContactId = submission.contactId ||
                      (submission.contact && submission.contact.id);
    if (!flContactId) throw new Error('No contactId in submission');

    var flContact = ghlGetContact('Florida', flContactId);
    var email = ((flContact.email) ||
                 (submission.contact && submission.contact.email) || '').toLowerCase().trim();

    logEvent({
      timestamp: new Date().toISOString(),
      submissionId: submissionId,
      email: email,
      status: 'processed',
      details: '$1 CC verification fee captured for ' + email +
               ' (audit only — Dashboard tab now driven by registration sheets)',
      rawPayload: JSON.stringify(submission).substring(0, 45000)
    });
    return 'processed';
  } catch (err) {
    logEvent({
      timestamp: new Date().toISOString(),
      submissionId: submissionId,
      email: (submission.contact && submission.contact.email) || '',
      status: 'failed',
      details: err.message + '\n' + (err.stack || '').substring(0, 800),
      rawPayload: JSON.stringify(submission).substring(0, 45000)
    });
    return 'failed';
  }
}

// ─── processSubmission ───────────────────────────────────────────────────────
/**
 * LEGACY: full-fat submission processor. No live caller after the
 * 2026-05-13 cutover — kept here only as a rollback artifact in case
 * the sheet-driven pipeline turns out to have a regression and we need
 * the old form-driven billing back temporarily.
 *
 * @param {Object} submission
 * @returns {string}  'processed' | 'duplicate' | 'lead_only' | 'failed'
 */
function processSubmission(submission) {
  // Extract submission ID — handle varied field names
  const submissionId = submission.id || submission._id || submission.submissionId;
  if (!submissionId) {
    logEvent({
      timestamp: new Date().toISOString(),
      submissionId: '(missing)',
      email: submission.contactId || '',
      status: 'failed',
      details: 'Submission missing id field',
      rawPayload: JSON.stringify(submission).substring(0, 45000)
    });
    return 'failed';
  }

  // ── 1. Dedupe ──────────────────────────────────────────────────────────────
  const seen = seenSubmissionIds();
  if (seen.has(submissionId)) {
    logEvent({
      timestamp: new Date().toISOString(),
      submissionId,
      email: (submission.contact && submission.contact.email) || '',
      status: 'duplicate',
      details: 'Already processed — submission_id found in cell Notes',
      rawPayload: JSON.stringify(submission).substring(0, 45000)
    });
    return 'duplicate';
  }

  try {
    // ── 2. Get FL contact for Waiver Origin ───────────────────────────────────
    const flContactId = submission.contactId ||
                        (submission.contact && submission.contact.id);
    if (!flContactId) throw new Error('No contactId in submission');

    const flContact = ghlGetContact('Florida', flContactId);
    // WaiverOrigin is set only by the waiver form. Empty for non-waiver
    // submissions (lead capture, info request, etc.).
    const waiverOrigin   = readWaiverOrigin(flContact);
    // For routing the profile URL we still need to pick a subaccount.
    // Empty waiverOrigin => default to Florida (polling subaccount) for
    // search purposes only; the value written to col D stays empty.
    const targetSubaccount = resolveSubaccount(waiverOrigin || 'Florida');

    // ── 3. Build profile URL ──────────────────────────────────────────────────
    const email = ((flContact.email) ||
                   (submission.contact && submission.contact.email) || '').toLowerCase().trim();
    const firstName = flContact.firstName || '';
    const lastName  = flContact.lastName  || '';
    const name  = (firstName + ' ' + lastName).trim() || email;
    const phone = flContact.phone || '';

    let targetContactId;
    if (targetSubaccount === 'Florida') {
      targetContactId = flContactId;
    } else {
      targetContactId = ghlSearchContactByEmail(targetSubaccount, email);
    }
    const profileUrl = targetContactId
      ? buildProfileUrl(SUBACCOUNTS[targetSubaccount].locationId, targetContactId)
      : null;

    // ── 4. Extract submission fields (with field-name registry) ───────────
    const { fields: submissionFields, source: fieldSource } =
      extractSubmissionFieldsWithSelfHeal(submission, 'Florida');

    // ── 5. Compute multipliers ────────────────────────────────────────────────
    // durationDays: prefer Camp Duration field value, fall back to any "# days" pattern
    let durationDays = 1;
    // (campDurationField resolved below after campDatesField detection)

    const campDatesField    = findFieldByNamePattern(submissionFields,
      /camp\s*dates|select\s+camp\s+dates/i);
    const campDurationField = findFieldByNamePattern(submissionFields,
      /camp\s*duration|select\s+camp\s+duration/i);
    // Capture the actual list of selected week date strings so we can
    // surface them in the Total cell's note.
    const selectedWeeks = campDatesField
      ? parseMultiSelectValue(campDatesField.value).map(function(s) { return String(s).trim(); }).filter(Boolean)
      : [];
    const numWeeks = Math.max(1, selectedWeeks.length || 1);
    // Also capture the day-of-week selection if present (some forms have
    // "Days of the week" or similar — Monday, Tuesday, ...).
    const dowField = findFieldByNamePattern(submissionFields,
      /days?\s+of\s+the\s+week|attendance\s+days|which\s+days/i);
    const selectedDays = dowField
      ? parseMultiSelectValue(dowField.value).map(function(s) { return String(s).trim(); }).filter(Boolean)
      : [];
    // durationDays: prefer Camp Duration field's value, fall back to any "# days" pattern
    if (campDurationField) {
      const dm = String(campDurationField.value).match(/^(\d+)\s*day/i);
      if (dm) durationDays = parseInt(dm[1], 10);
    }
    if (durationDays === 1 && !campDurationField) {
      // fallback: scan all string values for "# days"
      const allVals = submissionFields
        .flatMap(function(f) { return parseMultiSelectValue(f.value); })
        .map(function(v) { return String(v); });
      durationDays = parseDurationDays(allVals);
    }

  // — 5b. Extract student names from form fields ————————————————————
  const studentNames = extractStudentNames(submissionFields);

      // ── 6. Upsert customer row ────────────────────────────────────────────────
    const customerRow = upsertCustomerRow({
      email, name, phone,
      waiverOrigin: waiverOrigin || '',
      studentNames,
    profileUrl,
      contactId: targetContactId,
      subaccount: targetSubaccount
    });

    // ── 6b. Ensure sub-header row exists ─────────────────────────────────────
    // findCustomerTxRange always returns a non-null object — it just assumes
    // customerRow + 1 IS the sub-header. So check the actual cell content.
    const dashSheetForSubHeader = getDashboardSheet();
    const possibleSubHeaderA = String(
      dashSheetForSubHeader.getRange(customerRow + 1, 1).getValue() || ''
    ).trim().toUpperCase();
    const possibleSubHeaderG = String(
      dashSheetForSubHeader.getRange(customerRow + 1, 7).getValue() || ''
    ).trim().toUpperCase();
    const hasRealSubHeader = (possibleSubHeaderA === 'DATE' && possibleSubHeaderG === 'STATUS');
    if (!hasRealSubHeader) {
      appendSubHeaderRow(customerRow);
    }

    // ── 7. Walk fields, write tx rows ─────────────────────────────────────────
    let txRowsWritten = 0;
    for (const field of submissionFields) {
    // Fix #5: skip fields whose value contains no '$' — prevents phantom "1, 1, $1.00" rows
    if (!String(field.value || '').includes('$')) continue;
      const items = parseMultiSelectValue(field.value);
      for (const item of items) {
        const itemStr = String(item);
        if (!PRICE_REGEX.test(itemStr)) continue;
        const price      = parsePrice(itemStr);
        const multiplier = extractMultiplier(itemStr);
        const pricing    = applyPricingRule(price, multiplier, durationDays, numWeeks);
        // Nice-to-have #5: GHL's built-in `payment` field carries the $1
        // credit-card-verification fee. Auto-mark as 'paid' so it doesn't
        // pollute the customer's balance.
        // Item label format (per user request): "<Field Question>: <Answer>"
        // e.g. "Camp Duration: Full Week" — gives Erin context on what
        // form question this line came from.
        const isVerificationFee = (field.id === 'payment' && price === 1 && !multiplier);

        // Build the base item label "Question: Answer"
        const baseItem = (function(){
          if (isVerificationFee) return 'CC verification fee';
          var stripped = stripPriceFromLabel(itemStr);
          var answer = (stripped && !/^[$0-9.+\-\s()\/]+$/.test(stripped)) ? stripped : '';
          var question = (field.name && field.name !== '(unnamed)') ? field.name : '';
          if (question && answer && question.toLowerCase() !== answer.toLowerCase()) {
            return question + ': ' + answer;
          }
          return answer || question || itemStr;
        })();

        // Per-week breakdown (Option A): when a /week or /day item has more
        // than one selected week, write ONE tx row PER WEEK so each week is
        // independently markable as paid AND the actual date is visible
        // right in the Item column. Single-week items and flat items still
        // get a single row.
        const isMultiWeek =
          (multiplier === '/week' || multiplier === '/day') &&
          selectedWeeks.length > 1;

        const weekIterations = isMultiWeek ? selectedWeeks : [null];

        weekIterations.forEach(function(weekStr, weekIdx) {
          const itemForRow = isMultiWeek
            ? (baseItem + ' (' + weekStr + ')')
            : baseItem;
          appendTxRow(customerRow, {
            date:             new Date(submission.createdAt || Date.now()),
            item:             itemForRow,
            // Numeric price + multiplier so col F can reference cells (clickable formula)
            unitPriceNumeric: price,
            unitMultiplier:   multiplier || '',
            pricingRule:      pricing.rule,
            // For multi-week rows: each row is just 1 week (per-row math)
            days:             multiplier === '/day'  ? durationDays : '',
            weeks:            (multiplier === '/day' || multiplier === '/week')
                                ? (isMultiWeek ? 1 : numWeeks)
                                : '',
            status:           isVerificationFee ? 'paid' : 'owed',
            submissionId,
            sourceFieldName:  field.name || field.id || '',
            // Verbose context for the Total cell's Note
            selectedWeeks:    selectedWeeks,
            selectedDays:     selectedDays,
            weekLabel:        isMultiWeek ? weekStr : (selectedWeeks[0] || ''),
            allWeeksOnSubmission: selectedWeeks,
            formAnswerLabel:  itemStr
          });
          txRowsWritten++;
        });
      }
    }

    updateBalanceFormula(customerRow, profileUrl, targetSubaccount);

    // ── Apply row grouping and collapse by default ────────────────────────────
    // User preference: every customer's group starts COLLAPSED. Erin opens
    // a customer's section manually when she wants to act on it. This keeps
    // the dashboard scannable.
    const range = findCustomerTxRange(customerRow);
    if (range && range.lastTx >= range.firstTx) {
      const groupStart = customerRow + 1; // include sub-header
      applyRowGrouping(groupStart, range.lastTx);
      setGroupExpansion(groupStart, false); // always collapsed
    }

    const status = txRowsWritten > 0 ? 'processed' : 'lead_only';
    logEvent({
      timestamp: new Date().toISOString(),
      submissionId,
      email,
      status,
      details: txRowsWritten > 0
        ? txRowsWritten + ' tx row(s) written (source=' + fieldSource + ', durationDays=' + durationDays + ', numWeeks=' + numWeeks + ')'
        : 'No $N items found (source=' + fieldSource + ', fields=' + submissionFields.length + ')',
      rawPayload: JSON.stringify(submission).substring(0, 45000)
    });
    return status;

  } catch (err) {
    logEvent({
      timestamp: new Date().toISOString(),
      submissionId,
      email: (submission.contact && submission.contact.email) || '',
      status: 'failed',
      details: err.message + '\n' + (err.stack || '').substring(0, 800),
      rawPayload: JSON.stringify(submission).substring(0, 45000)
    });
    return 'failed';
  }
}

// ─── pollFloridaSubmissions ──────────────────────────────────────────────────
/**
 * Main poll function — runs every 5 minutes via time-driven trigger.
 * Fetches FL form submissions since last poll, dedupes, and processes each.
 */
function pollFloridaSubmissions() {
  // F02 fix: LockService prevents duplicate processing from concurrent 5-min triggers
  var _lock = LockService.getScriptLock();
  if (!_lock.tryLock(0)) {
    Logger.log('[pollFloridaSubmissions] Skipping: concurrent trigger already running');
    return;
  }
  try { // lock wrapper - release in finally
  const props = PropertiesService.getScriptProperties();
  const lastPolledAt = props.getProperty('lastPolledAt') ||
    new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString(); // first run: 24h lookback

  const startAt = lastPolledAt;
  const endAt   = new Date().toISOString();

  Logger.log('[pollFloridaSubmissions] Polling ' + startAt + ' → ' + endAt);

  let submissions;
  try {
    submissions = ghlListSubmissions('Florida', startAt, endAt);
  } catch (err) {
    logEvent({
      timestamp: new Date().toISOString(),
      submissionId: '(poll)',
      email: '',
      status: 'poll_error',
      details: 'API call failed: ' + err.message,
      rawPayload: JSON.stringify({ startAt, endAt })
    });
    Logger.log('[pollFloridaSubmissions] API error: ' + err.message);
    notifyError('critical', 'GHL polling failed', 'API error: ' + err.message, { rawPayload: JSON.stringify({ startAt: startAt, endAt: endAt }) });
    return;
  }

  Logger.log('[pollFloridaSubmissions] Got ' + submissions.length + ' submissions');

  let processedCount = 0, dupCount = 0, leadCount = 0, failCount = 0;
  for (const sub of submissions) {
    // Post-2026-05-13: only the $1 CC verification fee is captured by
    // this polling path. Camp/lunch/shirt billing comes from the
    // sheet-driven pipeline in BillingFromSheets.js.
    const result = processSubmissionVerificationFeeOnly(sub);
    if      (result === 'processed') processedCount++;
    else if (result === 'duplicate') dupCount++;
    else if (result === 'lead_only') leadCount++;
    else if (result === 'failed')    failCount++;
  }

  // Update timestamp only after a clean top-level run
  props.setProperty('lastPolledAt', endAt);
  const summary = new Date().toISOString() + ': ' + submissions.length + ' submissions (' +
    processedCount + ' processed, ' + dupCount + ' dup, ' +
    leadCount + ' lead, ' + failCount + ' failed)';
  props.setProperty('lastPollSummary', summary);

  Logger.log('[pollFloridaSubmissions] ' + summary);

  // Defensive final pass: repair sub-headers + regroup customers + refresh
  // grand-total header. Per-submission writes can leave intermediate state
  // where a customer's sub-header gets clobbered by an adjacent insert;
  // this guarantees the final state is clean.
  if (processedCount > 0) {
    if (typeof repairAllSubHeaders === 'function') {
      try { repairAllSubHeaders(); }
      catch (e) { Logger.log('[pollFloridaSubmissions] subheader repair err: ' + e.message); }
    }
    if (typeof regroupAllCustomers === 'function') {
      try { regroupAllCustomers(); }
      catch (e) { Logger.log('[pollFloridaSubmissions] regroup tail err: ' + e.message); }
    }
    if (typeof refreshGrandTotalHeader === 'function') {
      try { refreshGrandTotalHeader(); }
      catch (e) { Logger.log('[pollFloridaSubmissions] grand-total tail err: ' + e.message); }
    }
    if (typeof setupBalanceFilterToggle === 'function') {
      try { setupBalanceFilterToggle(); }
      catch (e) { Logger.log('[pollFloridaSubmissions] filter toggle tail err: ' + e.message); }
    }
    // setupBalanceFilterToggle clears H2+; re-add quick-action checkboxes after
    if (typeof addQuickActionCheckboxes === 'function') {
      try { addQuickActionCheckboxes(); }
      catch (e) { Logger.log('[pollFloridaSubmissions] checkbox-after-toggle err: ' + e.message); }
    }
    if (typeof applyChipDropdownsToAllTxRows === 'function') {
      try { applyChipDropdownsToAllTxRows(); }
      catch (e) { Logger.log('[pollFloridaSubmissions] chip-dropdown tail err: ' + e.message); }
    }
    if (typeof refreshAllBalanceNotes === 'function') {
      try { refreshAllBalanceNotes(); }
      catch (e) { Logger.log('[pollFloridaSubmissions] balance-note tail err: ' + e.message); }
    }
    if (typeof addQuickActionCheckboxes === 'function') {
      try { addQuickActionCheckboxes(); }
      catch (e) { Logger.log('[pollFloridaSubmissions] checkbox tail err: ' + e.message); }
    }
  }

  // Refresh the standalone Transactions sheet ONLY when new submissions
  // arrived this poll. Was unconditional, but that costs 3 GHL calls per
  // Dashboard customer per poll, which blew past the 20K daily UrlFetch
  // quota in May 2026 at ~138 customers (with 30-min polling). Trade-off:
  // refunds/voids made directly in GHL no longer reflect on the
  // Transactions sheet until the next form submission triggers a sync.
  // For a manual hourly rebuild, run the menu item or call
  // syncTransactionsSheet() directly from the editor.
  if (processedCount > 0 && typeof syncTransactionsSheet === 'function') {
    try { syncTransactionsSheet(); }
    catch (e) { Logger.log('[pollFloridaSubmissions] tx-sheet tail err: ' + e.message); }
  }
  } finally { _lock.releaseLock(); } // end lock wrapper
}

// ─── debugQuotaState ─────────────────────────────────────────────────────────
/**
 * One-shot diagnostic: dumps the live state Emilio needs to debug the quota
 * issue. Logs everything to the Executions panel. Safe to run any time.
 */
function debugQuotaState() {
  Logger.log('=== debugQuotaState @ ' + new Date().toISOString() + ' ===');

  // 1. Who's running this?
  try {
    Logger.log('[1] Effective user (Session.getEffectiveUser): ' + Session.getEffectiveUser().getEmail());
  } catch (e) { Logger.log('[1] effective user unavailable: ' + e.message); }
  try {
    Logger.log('[1] Active user (Session.getActiveUser): ' + Session.getActiveUser().getEmail());
  } catch (e) { Logger.log('[1] active user unavailable: ' + e.message); }

  // 2. Triggers visible to this user
  var triggers = ScriptApp.getProjectTriggers();
  Logger.log('[2] Visible triggers (count=' + triggers.length + '):');
  triggers.forEach(function(t) {
    try {
      Logger.log('    handler=' + t.getHandlerFunction() +
                 ' source=' + t.getTriggerSource() +
                 ' eventType=' + t.getEventType() +
                 ' uid=' + t.getUniqueId());
    } catch (e) { Logger.log('    trigger inspect err: ' + e.message); }
  });

  // 3. Script properties relevant to polling
  var props = PropertiesService.getScriptProperties();
  Logger.log('[3] lastPolledAt: ' + props.getProperty('lastPolledAt'));
  Logger.log('[3] lastPollSummary: ' + props.getProperty('lastPollSummary'));

  // 4. Last 8 rows of Logs sheet (newest at top per Polling.js insertion logic)
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var logs = ss.getSheetByName('Logs');
  if (!logs) { Logger.log('[4] Logs sheet missing'); return; }
  var lastRow = logs.getLastRow();
  Logger.log('[4] Logs sheet has ' + (lastRow - 1) + ' data rows. Last 8:');
  if (lastRow >= 2) {
    var n = Math.min(8, lastRow - 1);
    var rows = logs.getRange(2, 1, n, 5).getValues();
    rows.forEach(function(r, i) {
      Logger.log('    [' + (i+1) + '] ' + r[0] + ' | sub=' + r[1] +
                 ' | email=' + r[2] + ' | status=' + r[3] +
                 ' | details=' + String(r[4]).substring(0, 200));
    });
  }

  Logger.log('=== debugQuotaState done ===');
}

// ─── installPollingTrigger ───────────────────────────────────────────────────
/**
 * Installs a 5-minute time-driven trigger for pollFloridaSubmissions.
 * Removes any existing triggers for that function first.
 * Run once manually from the Apps Script editor.
 */
function installPollingTrigger() {
  // Remove any existing triggers for pollFloridaSubmissions
  ScriptApp.getProjectTriggers().forEach(function(t) {
    if (t.getHandlerFunction() === 'pollFloridaSubmissions') {
      ScriptApp.deleteTrigger(t);
      Logger.log('[installPollingTrigger] Removed old trigger: ' + t.getUniqueId());
    }
  });

  // Restored to 5 min after the syncTransactionsSheet gate landed: idle
  // polls now cost 1 UrlFetch instead of 1 + 3N. Combined with the
  // emilio@nilsdigital.com Workspace quota (100K/day vs 20K consumer),
  // 5-min polling sits at ~2.5% of daily budget at Tom's volume.
  const trigger = ScriptApp.newTrigger('pollFloridaSubmissions')
    .timeBased()
    .everyMinutes(5)
    .create();

  Logger.log('[installPollingTrigger] Installed trigger: ' + trigger.getUniqueId());
}

// ─── runMigrationTest ────────────────────────────────────────────────────────
/**
 * End-to-end migration verification.
 * 1. Verify Logs sheet exists with header
 * 2. Run pollFloridaSubmissions() once
 * 3. Check Logs sheet for entries
 * 4. Run pollFloridaSubmissions() again — verify duplicates
 * 5. Check lastPolledAt and lastPollSummary
 */
function runMigrationTest() {
  const results = [];
  const ss = SpreadsheetApp.getActiveSpreadsheet();

  // ── 1. Logs sheet structure ───────────────────────────────────────────────
  const logsSheet = ss.getSheetByName('Logs');
  if (!logsSheet) {
    results.push('[FAIL] Logs sheet does not exist');
  } else {
    const header = logsSheet.getRange(1, 1, 1, 6).getValues()[0];
    const expected = ['Timestamp', 'Submission ID', 'Email', 'Status', 'Details', 'Raw Payload'];
    const match = expected.every(function(h, i) { return header[i] === h; });
    results.push(match ? '[PASS] Logs sheet header correct' : '[FAIL] Logs header: ' + header.join('|'));

    // Check no extra columns on Dashboard
    const dash = getDashboardSheet();
    const dashHeader = dash.getRange(1, 1, 1, 8).getValues()[0];
    results.push('[INFO] Dashboard cols 1-8: ' + dashHeader.join(' | '));
  }

  // ── 2. First poll ─────────────────────────────────────────────────────────
  results.push('[INFO] Running first poll...');
  pollFloridaSubmissions();

  // ── 3. Check Logs sheet ───────────────────────────────────────────────────
  const logRows = logsSheet ? logsSheet.getLastRow() - 1 : 0;
  results.push('[INFO] Logs sheet has ' + logRows + ' data row(s) after first poll');

  // ── 4. Second poll — should all be duplicates ─────────────────────────────
  results.push('[INFO] Running second poll (dedupe check)...');
  pollFloridaSubmissions();

  const logRows2 = logsSheet ? logsSheet.getLastRow() - 1 : 0;
  results.push('[INFO] Logs sheet has ' + logRows2 + ' data row(s) after second poll');

  // ── 5. Check Script Properties ────────────────────────────────────────────
  const props = PropertiesService.getScriptProperties();
  results.push('[INFO] lastPolledAt: ' + props.getProperty('lastPolledAt'));
  results.push('[INFO] lastPollSummary: ' + props.getProperty('lastPollSummary'));

  // ── 6. Check for any tx rows with Notes ───────────────────────────────────
  const dash = getDashboardSheet();
  const lastRow = dash.getLastRow();
  let notesFound = 0;
  if (lastRow >= 2) {
    const notes = dash.getRange(2, 2, lastRow - 1, 1).getNotes();
    for (const [n] of notes) {
      if (n && n.includes('Submission ID:')) notesFound++;
    }
  }
  results.push('[INFO] Dashboard tx rows with Submission ID notes: ' + notesFound);

  // Log all results
  results.forEach(function(r) { Logger.log(r); });
  SpreadsheetApp.getUi().alert('Migration Test Results:\n\n' + results.join('\n'));
}


// ─── replayAllSubmissions ──────────────────────────────────────────
/**
 * One-shot utility: clears Dashboard data rows + Logs data rows,
 * resets lastPolledAt to 7 days ago, then re-runs the Florida poll
 * so all recent GHL submissions are re-imported fresh.
 */
function replayAllSubmissions() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();

  // 1. Clear Dashboard rows 2+
  const dash = ss.getSheetByName('Dashboard');
  if (dash && dash.getLastRow() >= 2) {
    // === Clean-slate row group reset before clearing data rows ===
    resetAllRowGroups_(dash);
    dash.deleteRows(2, dash.getLastRow() - 1);
  }
  Logger.log('[replayAllSubmissions] Dashboard cleared.');
  // 1b. Update Dashboard header row to Stage 9 layout
  if (dash) {
    dash.getRange(1, 1, 1, 7).setValues([['Name','Email','Phone','Waiver Origin','Student Name','Contact Profile','Balance']]);
    dash.getRange(1, 1, 1, 7).setBackground('#000000').setFontColor('#FFFFFF').setFontWeight('bold');
    // Nice-to-have #1: grand total receivables on row 1 col G — re-derives
    // automatically as customer balances (col G plain SUMIFS) change.
    dash.getRange(1, 7).setFormula('="Balance: $" & TEXT(SUMIF($B$2:$B,"*@*",$G$2:$G),"#,##0.00")');
  }

  // 2. Clear Logs rows 2+ (keep header)
  const logs = ss.getSheetByName('Logs');
  if (logs && logs.getLastRow() >= 2) {
    logs.deleteRows(2, logs.getLastRow() - 1);
  }
  Logger.log('[replayAllSubmissions] Logs cleared.');

  // 3. Reset lastPolledAt to 7 days ago so poll fetches a wide window
  const props = PropertiesService.getScriptProperties();
  const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
  props.setProperty('lastPolledAt', sevenDaysAgo);
  Logger.log('[replayAllSubmissions] lastPolledAt reset to ' + sevenDaysAgo);

  // 4. Run the Florida poll (dedup is now empty so all submissions come through)
  pollFloridaSubmissions();
  Logger.log('[replayAllSubmissions] Done.');
}

// ─── debugFindPhantomField ──────────────────────────────────────
// ─── debugFindPhantomField ────────────────────────────────────────
// Phase 9a: Show all Dashboard rows where item label is "1" + identify source
function debugFindPhantomField() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();

  // ── PART 1: Show all "1" item rows on Dashboard with full data ──
  var dash = ss.getSheetByName('Dashboard');
  if (!dash) { Logger.log('No Dashboard sheet'); return; }
  var dRows = dash.getDataRange().getValues();
  Logger.log('Dashboard total rows: ' + dRows.length);

  var currentCustomer = '(unknown)';
  var currentEmail = '';
  var oneRows = [];
  
  for (var i = 0; i < dRows.length; i++) {
    var row = dRows[i];
    // Customer row: col A = name, col B = email
    if (String(row[1] || '').includes('@') && String(row[0] || '').length > 1) {
      currentCustomer = String(row[0]);
      currentEmail = String(row[1]);
    }
    // Check if item (col B) is "1" or "" and has a date-ish value in col A
    var dateVal = row[0];
    var item = String(row[1] || '').trim();
    var unitPrice = String(row[2] || '').trim();
    var days = String(row[3] || '').trim();
    var weeks = String(row[4] || '').trim();
    var totalFormula = row[5];
    var statusVal = String(row[6] || '').trim();
    
    var hasDate = (dateVal instanceof Date) || (typeof dateVal === 'string' && String(dateVal).length > 8);
    
    if (hasDate && (item === '1' || item === '')) {
      oneRows.push({
        dashRow: i+1,
        customer: currentCustomer,
        email: currentEmail,
        date: String(dateVal),
        item: item,
        unit: unitPrice,
        days: days,
        weeks: weeks,
        total: totalFormula,
        status: statusVal
      });
    }
  }
  
  Logger.log('=== PHANTOM ROWS (item="1" or ""): ' + oneRows.length + ' ===');
  oneRows.forEach(function(r) {
    Logger.log('  Row ' + r.dashRow + ' | ' + r.customer + ' | item=' + JSON.stringify(r.item) + 
               ' | unit=' + JSON.stringify(r.unit) + ' | days=' + r.days + ' | weeks=' + r.weeks +
               ' | total=' + r.total + ' | status=' + r.status);
  });
  
  // ── PART 2: Find affected emails and look up their GHL submission via Logs ──
  var affectedEmails = {};
  oneRows.forEach(function(r) { affectedEmails[r.email.toLowerCase()] = true; });
  Logger.log('Affected emails: ' + Object.keys(affectedEmails).join(', '));
  
  var logs = ss.getSheetByName('Logs');
  if (!logs) { Logger.log('No Logs sheet'); return; }
  var data = logs.getDataRange().getValues();
  var colPayload = data[0].indexOf('Raw Payload');
  var colEmail = data[0].indexOf('Email');
  var colStatus = data[0].indexOf('Status');
  
  for (var email in affectedEmails) {
    Logger.log('--- Looking for submission for: ' + email + ' ---');
    for (var i = 1; i < data.length; i++) {
      var rowEmail = String(data[i][colEmail] || '').toLowerCase();
      var status = String(data[i][colStatus] || '');
      if (rowEmail === email && status === 'processed') {
        var payload = String(data[i][colPayload] || '');
        Logger.log('Found log row ' + (i+1) + ' (first 3000 chars):');
        Logger.log(payload.substring(0, 3000));
        break;
      }
    }
  }
  
  // ── PART 3: Simulate processSubmission on the live GHL API for one affected contact ──
  // Fetch the actual submission from GHL to see full payload
  Logger.log('=== FETCHING LIVE SUBMISSION FROM GHL FOR FIRST AFFECTED EMAIL ===');
  var firstEmail = Object.keys(affectedEmails)[0];
  if (!firstEmail) { Logger.log('No affected emails found'); return; }
  
  try {
    var contact = ghlSearchContactByEmail('Florida', firstEmail);
    if (!contact) { Logger.log('Contact not found for: ' + firstEmail); return; }
    Logger.log('Contact ID: ' + (contact.id || contact.contactId));
    
    // Fetch recent submissions for this contact
    var now = new Date();
    var startAt = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000); // 30 days ago
    var submissions = ghlListSubmissions('Florida', startAt.toISOString(), now.toISOString());
    Logger.log('Total submissions fetched: ' + (submissions ? submissions.length : 0));
    
    if (submissions) {
      var contactId = contact.id || contact.contactId;
      var matching = submissions.filter(function(s) {
        return (s.contactId === contactId) || (s.contact && s.contact.id === contactId);
      });
      Logger.log('Matching submissions for contact: ' + matching.length);
      if (matching.length > 0) {
        var sub = matching[0];
        Logger.log('Submission others keys: ' + JSON.stringify(Object.keys(sub.others || {})));
        // Show each field in others
        var others = sub.others || {};
        Object.entries(others).forEach(function(e) {
          Logger.log('  others[' + e[0] + '] = ' + JSON.stringify(e[1]));
        });
      }
    }
  } catch(err) {
    Logger.log('Error fetching live data: ' + err);
  }
}