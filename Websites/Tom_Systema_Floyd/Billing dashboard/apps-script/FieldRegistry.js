/** ─── FieldRegistry.gs ───────────────────────────────────────
 *  Cached field-name registry pulled from GHL custom fields endpoint.
 *  Stores a fieldId -> {name, dataType, picklistOptions} map.
 *  24-hour TTL with force-refresh support.
 *  Depends on: Configuration.gs (SUBACCOUNTS, GHL_API_BASE, GHL_API_VERSION, getTokenFor)
 */

// ─── getFieldRegistry ───────────────────────────────────────────
/**
 * Returns a Map<fieldId, {name, dataType, picklistOptions}>.
 * Cached in Script Properties for 24 hours.
 * @param {string} subaccountName - e.g. 'Florida'
 * @param {{forceRefresh?: boolean}} [options]
 */
function getFieldRegistry(subaccountName, options) {
  options = options || {};
  const props = PropertiesService.getScriptProperties();
  const dataKey = 'fieldRegistry:' + subaccountName + ':data';
  const tsKey   = 'fieldRegistry:' + subaccountName + ':fetchedAt';
  const cachedRaw = props.getProperty(dataKey);
  const cachedTs  = parseInt(props.getProperty(tsKey) || '0', 10);
  const ageMs = Date.now() - cachedTs;
  const TTL_MS = 24 * 60 * 60 * 1000;

  if (cachedRaw && !options.forceRefresh && ageMs < TTL_MS) {
    try {
      return new Map(Object.entries(JSON.parse(cachedRaw)));
    } catch (e) {
      // fall through to refresh
    }
  }
  return refreshFieldRegistry(subaccountName);
}

// ─── refreshFieldRegistry ────────────────────────────────────
/**
 * Fetches custom field metadata from GHL /locations/{id}/customFields.
 * Stores result in Script Properties and returns a Map.
 * @param {string} subaccountName
 * @returns {Map<string, {name: string, dataType: string, picklistOptions: Array}>}
 */
function refreshFieldRegistry(subaccountName) {
  const meta = SUBACCOUNTS[subaccountName];
  if (!meta) throw new Error('Unknown subaccount: ' + subaccountName);
  const token = getTokenFor(subaccountName);
  const url = GHL_API_BASE + '/locations/' + meta.locationId + '/customFields';
  const resp = UrlFetchApp.fetch(url, {
    method: 'get',
    headers: {
      'Authorization': 'Bearer ' + token,
      'Version': GHL_API_VERSION,
      'Accept': 'application/json',
    },
    muteHttpExceptions: true
  });
  if (resp.getResponseCode() !== 200) {
    throw new Error('GET /customFields returned ' + resp.getResponseCode() +
                    ': ' + resp.getContentText().substring(0, 300));
  }
  const data = JSON.parse(resp.getContentText());
  const fields = data.customFields || data.fields || data.data || [];

  const registry = {};
  for (const f of fields) {
    const id = f.id || f._id;
    if (!id) continue;
    registry[id] = {
      name: f.name || f.fieldKey || f.label || '',
      dataType: f.dataType || f.type || '',
      picklistOptions: f.picklistOptions || f.options || [],
    };
  }

  const props = PropertiesService.getScriptProperties();
  props.setProperty('fieldRegistry:' + subaccountName + ':data',
                    JSON.stringify(registry));
  props.setProperty('fieldRegistry:' + subaccountName + ':fetchedAt',
                    String(Date.now()));

  Logger.log('[FieldRegistry] Refreshed registry for ' + subaccountName +
             ' — ' + fields.length + ' fields fetched.');
  return new Map(Object.entries(registry));
}

// ─── getFieldName ───────────────────────────────────────────
/**
 * Convenience: returns name for a given fieldId, or empty string if not found.
 * @param {Map} registry
 * @param {string} fieldId
 * @returns {string}
 */
function getFieldName(registry, fieldId) {
  const meta = registry.get(fieldId);
  return meta ? meta.name : '';
}

// ─── findFieldByNamePattern ───────────────────────────────
/**
 * Returns the first submissionField whose .name matches the given regex.
 * Used to locate Camp Dates, Camp Duration, etc. without hardcoded IDs.
 * @param {Array<{id: string, value: *, name: string}>} submissionFields
 * @param {RegExp} regex
 * @returns {{id: string, value: *, name: string}|undefined}
 */
function findFieldByNamePattern(submissionFields, regex) {
  return submissionFields.find(function(f) { return regex.test(f.name || ''); });
}

// ─── extractSubmissionFieldsWithSelfHeal ────────────────
/**
 * Calls extractSubmissionFields, and if any fields are unnamed,
 * force-refreshes the registry and retries once.
 * @param {Object} submission  Raw GHL submission object
 * @param {string} subaccountName
 * @returns {{fields: Array, source: string}}
 */
function extractSubmissionFieldsWithSelfHeal(submission, subaccountName) {
  var registry = getFieldRegistry(subaccountName);
  var result = extractSubmissionFields(submission, registry);

  // Count how many fields are missing names
  var unnamedCount = result.fields.filter(function(f) {
    return !f.name || f.name === '(unnamed)';
  }).length;

  if (unnamedCount > 0) {
    // Possibly stale registry — force refresh and retry once
    registry = getFieldRegistry(subaccountName, { forceRefresh: true });
    result = extractSubmissionFields(submission, registry);
  }
  return result;
}
