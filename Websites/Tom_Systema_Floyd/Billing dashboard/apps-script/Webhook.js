/** ─── Webhook.gs ──────────────────────────────────────────────────
 *  Webhook handler + orchestration for Systema Floyd Billing Dashboard.
 *  Depends on: Configuration.gs, Helpers.gs, SheetWrites.gs
 */

// ─── logWebhookEvent ────────────────────────────────────────────────────────
/**
 * Appends a debug event to the rolling "WEBHOOK_LOG" Script Property.
 * Keeps the last 50 events (newline-delimited JSON objects).
 */
function logWebhookEvent(payload, summary) {
  const props = PropertiesService.getScriptProperties();
  const existing = props.getProperty('WEBHOOK_LOG') || '';
  const lines = existing ? existing.split('\n') : [];
  const entry = JSON.stringify({
    ts: new Date().toISOString(),
    summary: summary,
    email: payload && payload.email ? payload.email : '(unknown)'
  });
  lines.push(entry);
  // Keep last 50
  const trimmed = lines.slice(-50);
  props.setProperty('WEBHOOK_LOG', trimmed.join('\n'));
}

// ─── extractSubmissionFields ──────────────────────────────────────
/**
 * Extracts the per-submission field list from the payload.
 * Priority order:
 *   1. payload.others  (GHL /forms/submissions format — object map keyed by field ID)
 *   2. payload.submitted_form_data  (array)
 *   3. payload.formData  (array)
 *   4. payload.submission  (array)
 *   5. payload.form?.fields  (array)
 *   6. payload.customField  (array, fallback — logs warning)
 *
 * Normalizes to: [{id, value, name}, ...]
 * Attaches field name from the registry if provided.
 *
 * @param {Object} payload
 * @param {Map|null} [fieldRegistry]  Optional Map from getFieldRegistry()
 * @returns {{fields: Array<{id: string, value: *, name: string}>, source: string}}
 */
function extractSubmissionFields(payload, fieldRegistry) {
  let raw = null;
  let source = 'unknown';

  // Priority 1: GHL's actual /forms/submissions format — others object map
  if (payload.others && typeof payload.others === 'object' && !Array.isArray(payload.others)) {
    raw = Object.entries(payload.others).map(function(e) { return { id: e[0], value: e[1] }; });
    source = 'others';
  }
  // Priority 2: array forms (older webhook formats)
  else if (Array.isArray(payload.submitted_form_data)) {
    raw = payload.submitted_form_data.slice(); source = 'submitted_form_data';
  } else if (Array.isArray(payload.formData)) {
    raw = payload.formData.slice(); source = 'formData';
  } else if (Array.isArray(payload.submission)) {
    raw = payload.submission.slice(); source = 'submission';
  } else if (payload.form && Array.isArray(payload.form.fields)) {
    raw = payload.form.fields.slice(); source = 'form.fields';
  } else if (Array.isArray(payload.customField)) {
    logWebhookEvent(payload, 'WARNING: using customField fallback for submission fields');
    raw = payload.customField.slice(); source = 'customField (fallback)';
  } else {
    raw = []; source = 'NONE';
  }

  // System keys that are NOT custom fields
  // Note: 'payment' is intentionally NOT in this list — it's the GHL
  // form-fee marker ($1 credit-card-verification fee) and we DO want a
  // tx row for it, but processSubmission auto-marks it as paid so it
  // doesn't pollute the customer's balance.
  const SKIP_IDS = new Set(['full_name', 'phone', 'email', 'formId',
                             'location_id', 'sessionId', 'eventData',
                             'Timezone', 'fieldsOriSequance', 'submissionId',
                             'signatureHash', 'paymentStatus', 'contact_id']);

  // Normalize: ensure every entry has {id, value, name}
  const fields = raw.map(function(entry) {
    const id    = entry.id || entry._id || entry.fieldId || '';
    const value = entry.value !== undefined ? entry.value : entry;
    const nameFromReg   = (fieldRegistry && id) ? getFieldName(fieldRegistry, id) : '';
    const nameFromEntry = entry.name || entry.label || entry.fieldKey || '';
    return {
      id:    id,
      value: value,
      name:  nameFromReg || nameFromEntry || '(unnamed)',
    };
  }).filter(function(f) { return f.id && !SKIP_IDS.has(f.id); });

  return { fields: fields, source: source };
}


function applyPricingRule(price, multiplier, durationDays, numWeeks) {
  if (multiplier === '/day') {
    return {
      amount:  price * durationDays * numWeeks,
      formula: '=' + price + '*' + durationDays + '*' + numWeeks,
      rule:    'per_day'
    };
  } else if (multiplier === '/week') {
    return {
      amount:  price * numWeeks,
      formula: '=' + price + '*' + numWeeks,
      rule:    'per_week'
    };
  } else {
    return {
      amount:  price,
      formula: '=' + price,
      rule:    'flat'
    };
  }
}

// ─── processWebhookPayload ────────────────────────────────────────────────────
/**
 * Orchestrates contact lookup + sheet writes from a GHL webhook payload.
 *
 * @param {Object} payload
 */
function processWebhookPayload(payload) {
  // 1. Extract contact-level fields
  const email = (payload.email || '').toLowerCase().trim();
  const name  = (payload.name  || payload.full_name || payload.contact_name || '').trim();
  const phone = (payload.phone || payload.phoneNumber || '').trim();

  if (!email) {
    Logger.log('[processWebhookPayload] No email found — skipping');
    logWebhookEvent(payload, 'SKIP: no email');
    return;
  }

  // 2. Extract Waiver Origin from customField list
  let waiverOrigin = '';
  const customFields = payload.customField || [];
  if (Array.isArray(customFields)) {
    const waiverField = customFields.find(function(f) {
      const n = (f.name || '').toLowerCase();
      const id = (f.id || '').toLowerCase();
      return n.includes('waiver origin') || id.includes('waiver') || n === 'waiver origin';
    });
    if (waiverField) waiverOrigin = String(waiverField.value || '').trim();
  }

  // 3. Resolve subaccount
  const subaccountName = resolveSubaccount(waiverOrigin);

  // 4. Look up contact in GHL
  const contactId = ghlSearchContactByEmail(subaccountName, email);
  const locationId = SUBACCOUNTS[subaccountName].locationId;
  const profileUrl = contactId ? buildProfileUrl(locationId, contactId) : null;

  // 5. Upsert customer row
  const customerRow = upsertCustomerRow({
    email:       email,
    name:        name,
    phone:       phone,
    waiverOrigin: waiverOrigin,
    profileUrl:  profileUrl,
    contactId:   contactId
  });

  // 6. Find existing sub-header row (or note where to create one)
  const txRange = findCustomerTxRange(customerRow);
  // appendSubHeaderRow is idempotent — only needed if sub-header doesn't exist yet
  // We use the sub-header from txRange (customerRow + 1)
  // If it doesn't exist as a "Date" row yet, create it
  const sh = getDashboardSheet();
  const subHeaderVal = sh.getRange(customerRow + 1, COL.NAME_OR_DATE).getValue();
  if (String(subHeaderVal).trim() !== 'Date') {
    appendSubHeaderRow(customerRow);
  }

  // 7. Get submission fields
  const submissionFields = extractSubmissionFields(payload);
  const allStringValues = submissionFields.map(function(f) { return String(f.value || ''); });

  // 8. Parse duration + numWeeks
  const durationDays = parseDurationDays(allStringValues);

  // Find the "Camp Dates" multi-select field to determine numWeeks
  let numWeeks = 1;
  const campDatesField = submissionFields.find(function(f) {
    const n = (f.name || '').toLowerCase();
    const id = (f.id || '').toLowerCase();
    return n.includes('camp date') || n === 'camp dates' || id.includes('camp_date') || id === 'camp_dates';
  });
  if (campDatesField) {
    const parsed = parseMultiSelectValue(campDatesField.value);
    numWeeks = parsed.length || 1;
  }

  // 9. Scan each field value for prices and append tx rows
  let txCount = 0;
  const today = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'MMM d, yyyy');

  submissionFields.forEach(function(field) {
    const items = parseMultiSelectValue(field.value);
    items.forEach(function(item) {
      const itemStr = String(item);
      if (!PRICE_REGEX.test(itemStr)) return;

      const price      = parsePrice(itemStr);
      const multiplier = extractMultiplier(itemStr);
      const label      = stripPriceFromLabel(itemStr);
      if (price === null) return;

      const pricing = applyPricingRule(price, multiplier, durationDays, numWeeks);

      const days  = durationDays; // always populate days column
      const weeks = (multiplier === '/day' || multiplier === '/week') ? numWeeks : '';

      appendTxRow(customerRow, {
        date:             today,
        item:             label,
        unitPriceDisplay: '$' + price + (multiplier || ''),
        days:             days,
        weeks:            weeks,
        totalFormula:     pricing.formula,
        status:           'owed'
      });
      applyStatusDropdown(getDashboardSheet().getLastRow());
      txCount++;
    });
  });

  Logger.log('[processWebhookPayload] appended ' + txCount + ' tx rows for ' + email);

  // 10. Update balance formula + bg color
  updateBalanceFormula(customerRow, profileUrl);

  // 11. Apply row grouping
  const updatedRange = findCustomerTxRange(customerRow);
  if (updatedRange.lastTx >= updatedRange.firstTx) {
    applyRowGrouping(customerRow + 1, updatedRange.lastTx);
  }

  // 12. Set group expansion based on balance
  const balanceCell = sh.getRange(customerRow, COL.BALANCE_OR_WEEKS);
  const balanceVal  = balanceCell.getValue();
  const numericBalance = typeof balanceVal === 'number' ? balanceVal : 0;
  setGroupExpansion(customerRow + 1, numericBalance > 0);

  // 13. Log event
  const summary = 'OK: ' + txCount + ' tx rows for ' + email + ' (' + subaccountName + ')';
  Logger.log('[processWebhookPayload] ' + summary);
  logWebhookEvent(payload, summary);
}

function readWebhookLog() {
  const props = PropertiesService.getScriptProperties();
  const log = props.getProperty('WEBHOOK_LOG') || '(empty)';
  const lines = log.split('\n');
  Logger.log('=== WEBHOOK_LOG (last 5 entries) ===');
  lines.slice(-5).forEach(function(line) { Logger.log(line); });
  Logger.log('Total entries: ' + lines.length);
}
function stage5E2ECleanup() {
  const TEST_EMAIL = 'stage5test@example.com';
  const sh = getDashboardSheet();
  const custRow = findCustomerRowByEmail(TEST_EMAIL);
  if (!custRow) { Logger.log('Nothing to clean up'); return; }
  const { lastInGroup } = findCustomerTxRange(custRow);
  sh.deleteRows(custRow, lastInGroup - custRow + 1);
  Logger.log('[stage5E2ECleanup] Deleted rows. lastRow=' + sh.getLastRow());
}


// ─── Stage 5 Diagnostic ───────────────────────────────────────────────────
// Tests the balance update mechanism directly without onEdit
function testBalanceUpdate() {
  const sh = getDashboardSheet();
  
  // Read current state of rows 2-10
  const lastRow = sh.getLastRow();
  Logger.log('Last row: ' + lastRow);
  
  for (let r = 2; r <= Math.min(lastRow, 10); r++) {
    const rowData = sh.getRange(r, 1, 1, 7).getValues()[0];
    const formula = sh.getRange(r, 5).getFormula();
    Logger.log('Row ' + r + ': A=' + rowData[0] + ' B=' + rowData[1] + ' E_val=' + rowData[4] + ' E_formula=' + formula);
  }
  
  // Now manually test: does findOwningCustomerRow(5) return 2?
  const owner = findOwningCustomerRow(5);
  Logger.log('findOwningCustomerRow(5) = ' + owner);
  
  // And isTxRow(5)?
  const isTx = isTxRow(5);
  Logger.log('isTxRow(5) = ' + isTx);
  
  // Try calling updateBalanceFormula for row 2
  if (owner) {
    Logger.log('Calling updateBalanceFormula(' + owner + ', null)...');
    updateBalanceFormula(owner, null);
    Logger.log('Done. E2 formula is now: ' + sh.getRange(2, 5).getFormula());
    Logger.log('E2 value is now: ' + sh.getRange(2, 5).getValue());
  }
}
