/** ─── One-click GHL invoicing ────────────────────────────────────────
 *  Spec:  docs/superpowers/specs/2026-06-02-ghl-invoicing-design.md
 *  Plan:  docs/superpowers/plans/2026-06-02-ghl-invoicing.md
 *
 *  Flow: tick the "Invoice" checkbox on a customer header row →
 *  installable onEdit reads that customer's unpaid line items, resolves
 *  the GHL contact by email, POSTs a DRAFT invoice (never auto-sent),
 *  stamps each billed item with the invoiceId (idempotency), and writes
 *  the GHL invoice link back to the row. The team reviews + sends inside
 *  GHL. Invoices settle through the already-connected Square processor.
 *
 *  Reuses from the existing project: getTokenFor, GHL_API_BASE,
 *  GHL_API_VERSION, SUBACCOUNTS, ghlSearchContactByEmail, COL, SHEET_NAME.
 *
 *  STATUS: Tasks 0-7 implemented. Task 0 scope probe passed live on
 *  2026-06-04 (the FL PIT carries invoices.write + contacts.write; a
 *  create-then-delete round-tripped 200/200, invoice id field is `_id`,
 *  created status is `draft`). Tasks 3-7 (network + sheet I/O + trigger)
 *  are committed but need a `clasp push` to the live billing script, then
 *  `setupInvoiceColumns_()` + `installInvoiceTrigger_()` run once in the
 *  editor, before the checkbox is usable. See the plan Task 7/8 for e2e.
 *
 *  COLUMN LAYOUT NOTE (deviates from the plan): the plan put the hidden
 *  invoiceId on col J(10), but row-1 H/I/J are existing filter/action
 *  toggles and K-O are form-sheet quick-link chips, so hiding J would hide
 *  the J1 toggle. Resolved: checkbox=H(8), link=I(9) (written only on
 *  customer header rows, row-1 cells left as filters), hidden invoiceId
 *  moved to col P(16), clear of the filters and the K-O chips.
 */

/** Business block stamped on every invoice. Extend with address/phone/website
 *  once the GHL invoice branding/template is finalized (plan Task 8). */
var GHL_INVOICE_BUSINESS = { name: 'Systema Floyd' };

// ─── Task 1: invoice item builder (pure) ─────────────────────────────
/**
 * Map eligible Dashboard line items → GHL invoice `items[]`.
 * Eligible = unpaid/pending/owed AND not already stamped with an invoiceId.
 * qty=1 all-in line: bill the line TOTAL (what's owed), not the per-unit display.
 * @param {Array<{label,unitPrice,total,status,invoiceId}>} items
 * @returns {Array<{name,currency,amount,qty}>}
 */
function buildInvoiceItems_(items) {
  return (items || [])
    .filter(function (it) {
      var s = String(it.status || '').toLowerCase();
      return (s === 'unpaid' || s === 'pending' || s === 'owed') && !it.invoiceId;
    })
    .map(function (it) {
      return {
        name: String(it.label || 'Item'),
        currency: 'USD',
        amount: Number(it.total || it.unitPrice || 0),
        qty: 1,
      };
    });
}

// ─── Task 2: invoice payload builder (pure) ──────────────────────────
/**
 * Build the POST /invoices/ request body (creates a DRAFT — sending is separate).
 * @param {{locationId, contact:{id,name,email}, lines:Array, issueDate, dueDate}} opts
 * @returns {Object}
 */
function buildInvoicePayload_(opts) {
  return {
    altId: opts.locationId,
    altType: 'location',
    name: 'Systema Floyd Invoice - ' + opts.contact.name,
    businessDetails: GHL_INVOICE_BUSINESS,
    currency: 'USD',
    items: opts.lines,
    discount: { value: 0, type: 'percentage' },
    contactDetails: { id: opts.contact.id, name: opts.contact.name, email: opts.contact.email },
    issueDate: opts.issueDate,
    dueDate: opts.dueDate,
  };
}

// ─── Task 3: contact resolve + invoice create (network) ──────────────
/**
 * Return {id, name, email} for an email; create the contact if it doesn't
 * exist. Reuses the project's ghlSearchContactByEmail; only POSTs a new
 * contact when the search misses. Throws on a failed create.
 * @param {string} subaccount  e.g. 'Florida'
 * @param {string} email
 * @param {string} displayName fallback display name for a freshly-created contact
 * @returns {{id:string, name:string, email:string}}
 */
function resolveContact_(subaccount, email, displayName) {
  var existingId = ghlSearchContactByEmail(subaccount, email);
  if (existingId) return { id: existingId, name: displayName || email, email: email };

  var meta = SUBACCOUNTS[subaccount];
  if (!meta) throw new Error('Unknown subaccount: ' + subaccount);
  var resp = UrlFetchApp.fetch(GHL_API_BASE + '/contacts/', {
    method: 'post',
    contentType: 'application/json',
    headers: {
      'Authorization': 'Bearer ' + getTokenFor(subaccount),
      'Version': GHL_API_VERSION,
      'Accept': 'application/json',
    },
    payload: JSON.stringify({ locationId: meta.locationId, email: email, name: displayName || email }),
    muteHttpExceptions: true,
  });
  if (resp.getResponseCode() >= 300) {
    throw new Error('contact create failed ' + resp.getResponseCode() + ': ' +
                    resp.getContentText().substring(0, 200));
  }
  var c = (JSON.parse(resp.getContentText()).contact) || {};
  if (!c.id) throw new Error('contact create returned no id');
  return { id: c.id, name: displayName || email, email: email };
}

/**
 * POST a DRAFT invoice (sending is a separate, manual team action in GHL).
 * Returns {id, url}. Throws on non-2xx. The create response uses `_id`
 * for the invoice id (confirmed via the Task 0 live probe).
 * @param {string} subaccount
 * @param {Object} payload  from buildInvoicePayload_
 * @returns {{id:string, url:string}}
 */
function ghlCreateInvoice_(subaccount, payload) {
  var resp = UrlFetchApp.fetch(GHL_API_BASE + '/invoices/', {
    method: 'post',
    contentType: 'application/json',
    headers: {
      'Authorization': 'Bearer ' + getTokenFor(subaccount),
      'Version': GHL_API_VERSION,
      'Accept': 'application/json',
    },
    payload: JSON.stringify(payload),
    muteHttpExceptions: true,
  });
  if (resp.getResponseCode() >= 300) {
    throw new Error('invoice create failed ' + resp.getResponseCode() + ': ' +
                    resp.getContentText().substring(0, 300));
  }
  var d = JSON.parse(resp.getContentText());
  var id = d._id || d.id;
  if (!id) throw new Error('invoice create returned no id');
  var locId = SUBACCOUNTS[subaccount].locationId;
  // NOTE: confirm this whitelabel path against a real invoice in the GHL UI
  // during e2e (plan Task 7/8) and adjust the segment if it differs.
  return { id: id, url: 'https://app.nilsdigital.com/v2/location/' + locId + '/payments/invoices/' + id };
}

// ─── Task 4: dashboard invoice columns (one-time setup) ──────────────
/**
 * One-time, idempotent. Adds the hidden invoiceId header on col P, hides
 * it, and applies an Invoice checkbox to every existing customer header
 * row (col H). Does NOT touch row-1 H/I/J (existing filter toggles) or
 * the K-O quick-link chips. Run once in the editor after a clasp push.
 *
 * New customer sections created later by the 5-min reconciler won't have a
 * checkbox until ensureInvoiceCheckboxes_() runs again — call it from a
 * menu item or re-run this. (Kept out of the reconciler hot path to avoid
 * coupling BillingFromSheets to invoicing.)
 */
function setupInvoiceColumns_() {
  var sh = getDashboardSheet();
  sh.getRange(1, COL.ITEM_INVOICE_ID).setValue('InvoiceId');
  try { sh.hideColumns(COL.ITEM_INVOICE_ID); } catch (e) { Logger.log('[setupInvoiceColumns_] hide: ' + e.message); }
  var n = ensureInvoiceCheckboxes_();
  Logger.log('[setupInvoiceColumns_] done — ' + n + ' customer checkbox(es) applied');
}

/**
 * Apply an unchecked Invoice checkbox (col H) to every customer header row
 * (col B contains '@') that doesn't already have one. Idempotent; safe to
 * re-run any time new customers appear. Returns the count touched.
 */
function ensureInvoiceCheckboxes_() {
  var sh = getDashboardSheet();
  var lastRow = sh.getLastRow();
  if (lastRow < 2) return 0;
  var emails = sh.getRange(2, COL.EMAIL_OR_ITEM, lastRow - 1, 1).getValues();
  var cbRange = sh.getRange(2, COL.INVOICE_CHECKBOX, lastRow - 1, 1);
  var existing = cbRange.getValues();
  var rule = SpreadsheetApp.newDataValidation().requireCheckbox().build();
  var applied = 0;
  for (var i = 0; i < emails.length; i++) {
    var isCustomer = String(emails[i][0] || '').indexOf('@') !== -1;
    var r = i + 2;
    if (isCustomer) {
      // Only set a checkbox where there isn't already a boolean value.
      if (existing[i][0] !== true && existing[i][0] !== false) {
        sh.getRange(r, COL.INVOICE_CHECKBOX).setDataValidation(rule).setValue(false);
        applied++;
      }
    }
  }
  return applied;
}

// ─── Task 5: read a customer's items + stamp invoiced ────────────────
/**
 * Read the line items beneath a customer header row, using the project's
 * own grouping helper (findCustomerTxRange) so row ranges stay the single
 * source of truth. Returns {email, name, items:[{label,unitPrice,total,
 * status,invoiceId,row}]}.
 */
function readCustomerItems_(headerRow) {
  var sh = getDashboardSheet();
  var name  = String(sh.getRange(headerRow, COL.NAME_OR_DATE).getValue() || '').trim();
  var email = String(sh.getRange(headerRow, COL.EMAIL_OR_ITEM).getValue() || '').trim();
  // Waiver Origin (col D) encodes which sub-account/state owns this contact —
  // it routes the invoice to the right GHL sub-account so it settles in that
  // state's Square (correct tax). Read it as display text (handles a HYPERLINK).
  var waiverOrigin = String(sh.getRange(headerRow, COL.WAIVER_OR_DAYS).getValue() || '').trim();
  var range = findCustomerTxRange(headerRow);
  var items = [];
  if (range && range.lastTx >= range.firstTx) {
    var n = range.lastTx - range.firstTx + 1;
    // One batch read across A..P so we get label/price/total/status/invoiceId together.
    var vals = sh.getRange(range.firstTx, 1, n, COL.ITEM_INVOICE_ID).getValues();
    for (var i = 0; i < vals.length; i++) {
      var row = vals[i];
      var label = String(row[COL.EMAIL_OR_ITEM - 1] || '').trim();   // col B (HYPERLINK display text)
      if (!label) continue;
      items.push({
        label:     label,
        unitPrice: Number(row[COL.PHONE_OR_UNIT_PRICE - 1]) || 0,    // col C
        total:     Number(row[COL.CONTACT_OR_TOTAL - 1]) || 0,       // col F
        status:    String(row[COL.BALANCE_OR_STATUS - 1] || '').toLowerCase().trim(), // col G
        invoiceId: String(row[COL.ITEM_INVOICE_ID - 1] || '').trim(),// col P
        row:       range.firstTx + i,
      });
    }
  }
  return { email: email, name: name, waiverOrigin: waiverOrigin, items: items };
}

/**
 * Pick the GHL sub-account to bill through, from a customer's Waiver Origin.
 * Substring match (so "Georgia Liability Waiver" still routes to Georgia),
 * falling back to the project's exact-match resolveSubaccount (which itself
 * defaults to Florida). Florida is the safe default for the camp majority.
 */
function resolveSubaccountForInvoice_(waiverOrigin) {
  var s = String(waiverOrigin || '').toLowerCase();
  var keys = Object.keys(SUBACCOUNTS);
  for (var i = 0; i < keys.length; i++) {
    if (s.indexOf(keys[i].toLowerCase()) !== -1) return keys[i];
  }
  return (typeof resolveSubaccount === 'function') ? resolveSubaccount(waiverOrigin) : DEFAULT_SUBACCOUNT;
}

/** Stamp each given row's invoiceId column (col P) for idempotency. */
function stampInvoiced_(rows, invoiceId) {
  var sh = getDashboardSheet();
  rows.forEach(function (r) { sh.getRange(r, COL.ITEM_INVOICE_ID).setValue(invoiceId); });
}

// ─── Task 6: orchestrator + writeback + log ──────────────────────────
/**
 * Create a DRAFT invoice in GHL for one customer's eligible (owed,
 * un-stamped) items. Steps: read items → filter eligible → resolve/create
 * contact → POST draft → stamp rows → write link back → log. Returns
 * {id,url} or null (no eligible items). Throws on bad email / API failure.
 */
function createDraftInvoiceForCustomer_(headerRow) {
  var cust = readCustomerItems_(headerRow);
  if (!cust.email || cust.email.indexOf('@') === -1) {
    throw new Error('no valid customer email on row ' + headerRow);
  }
  var lines = buildInvoiceItems_(cust.items);
  if (!lines.length) {
    SpreadsheetApp.getActiveSpreadsheet().toast('No unpaid items to invoice for ' + (cust.name || cust.email));
    return null;
  }
  // Route to the sub-account the Waiver Origin points at, so the invoice is
  // created in the right GHL location and settles into that state's Square.
  var sub = resolveSubaccountForInvoice_(cust.waiverOrigin);
  Logger.log('[createDraftInvoiceForCustomer_] ' + cust.email + ' → ' + sub +
             ' (waiverOrigin="' + cust.waiverOrigin + '")');

  var contact = resolveContact_(sub, cust.email, cust.name);
  var tz    = Session.getScriptTimeZone();
  var today = Utilities.formatDate(new Date(), tz, 'yyyy-MM-dd');
  var due   = Utilities.formatDate(new Date(Date.now() + 10 * 864e5), tz, 'yyyy-MM-dd'); // Net 10
  var payload = buildInvoicePayload_({
    locationId: SUBACCOUNTS[sub].locationId,
    contact: contact, lines: lines, issueDate: today, dueDate: due,
  });
  var inv = ghlCreateInvoice_(sub, payload);

  var billedRows = cust.items.filter(function (it) {
    var s = it.status;
    return (s === 'unpaid' || s === 'pending' || s === 'owed') && !it.invoiceId;
  }).map(function (it) { return it.row; });
  stampInvoiced_(billedRows, inv.id);

  writeInvoiceLink_(headerRow, inv);
  logInvoice_(cust, inv, lines.length);
  // Surface the routed state in the toast so a mis-routed draft is caught
  // before the team sends it.
  SpreadsheetApp.getActiveSpreadsheet().toast(
    'Draft invoice created in ' + sub + ' for ' + (cust.name || cust.email) +
    ' (' + lines.length + ' line(s))');
  return inv;
}

/** Write the GHL invoice link into col I and reset the checkbox in col H. */
function writeInvoiceLink_(headerRow, inv) {
  var sh = getDashboardSheet();
  sh.getRange(headerRow, COL.INVOICE_STATUS)
    .setFormula('=HYPERLINK("' + inv.url + '","Draft ✓ open in GHL")')
    .setFontLine('none');
  sh.getRange(headerRow, COL.INVOICE_CHECKBOX).setValue(false);
}

/** Append an audit row to the Logs sheet (best-effort). */
function logInvoice_(cust, inv, n) {
  try {
    var sh = SpreadsheetApp.getActiveSpreadsheet().getSheetByName('Logs');
    if (sh) sh.appendRow([new Date(), 'invoice-draft', cust.email, inv.id, n + ' line(s)', inv.url]);
  } catch (e) { Logger.log('[logInvoice_] ' + e.message); }
}

// ─── Task 7: installable onEdit handler + trigger registration ───────
/**
 * Installable onEdit handler (runs with the owner's auth so UrlFetchApp has
 * scopes). Fires only when an Invoice checkbox (col H) on a customer header
 * row is checked. Everything else is ignored. Errors uncheck the box and
 * surface a toast so the team can retry.
 *
 * NOTE: this is an INSTALLABLE trigger (registered by installInvoiceTrigger_),
 * separate from the simple onEdit in Triggers.js — both fire; the simple one
 * already returns early on customer rows / col 8.
 */
function onEditInvoiceCheckbox_(e) {
  try {
    if (!e || !e.range) return;
    var sh = e.range.getSheet();
    if (sh.getName() !== SHEET_NAME) return;
    if (e.range.getColumn() !== COL.INVOICE_CHECKBOX) return;
    if (e.value !== 'TRUE' && e.value !== true) return; // only on check
    var row = e.range.getRow();
    if (row < 2) return;
    var email = String(sh.getRange(row, COL.EMAIL_OR_ITEM).getValue() || '');
    if (email.indexOf('@') === -1) {
      SpreadsheetApp.getActiveSpreadsheet().toast('Not a customer row — nothing to invoice');
      e.range.setValue(false);
      return;
    }
    createDraftInvoiceForCustomer_(row);
  } catch (err) {
    Logger.log('[onEditInvoiceCheckbox_] ' + err.message + '\n' + (err.stack || ''));
    try { SpreadsheetApp.getActiveSpreadsheet().toast('Invoice failed: ' + err.message); } catch (_) {}
    try { e.range.setValue(false); } catch (_) {}
  }
}

/**
 * Register the installable onEdit trigger for invoicing. Idempotent —
 * skips if a trigger for onEditInvoiceCheckbox_ already exists.
 */
function installInvoiceTrigger_() {
  var handler = 'onEditInvoiceCheckbox_';
  var triggers = ScriptApp.getProjectTriggers();
  for (var i = 0; i < triggers.length; i++) {
    if (triggers[i].getHandlerFunction() === handler) {
      Logger.log('[installInvoiceTrigger_] already installed');
      return;
    }
  }
  ScriptApp.newTrigger(handler)
    .forSpreadsheet(SpreadsheetApp.getActiveSpreadsheet())
    .onEdit()
    .create();
  Logger.log('[installInvoiceTrigger_] installed ' + handler);
}

// ─── Invoice-state → dashboard sync (paid-flip + deleted/voided cleanup) ──
/**
 * Fetch ALL invoices for a subaccount (every status), paginated. Returns the
 * raw invoice array, or **null on any failure** (HTTP error or a page that
 * fails mid-pagination). Returning null is critical: the caller must NOT
 * clear any col-P stamps when the list is unreliable, or a transient API
 * error would wipe stamps and unlock everything.
 */
function ghlListInvoices_(subaccount) {
  var loc = SUBACCOUNTS[subaccount].locationId;
  var all = [];
  var offset = 0, limit = 100, guard = 0;
  while (guard++ < 100) {
    var url = GHL_API_BASE + '/invoices/?altId=' + loc + '&altType=location' +
              '&limit=' + limit + '&offset=' + offset;
    var resp = UrlFetchApp.fetch(url, {
      method: 'get',
      headers: {
        'Authorization': 'Bearer ' + getTokenFor(subaccount),
        'Version': GHL_API_VERSION,
        'Accept': 'application/json',
      },
      muteHttpExceptions: true,
    });
    if (resp.getResponseCode() >= 300) {
      Logger.log('[ghlListInvoices_] ' + resp.getResponseCode() + ': ' +
                 resp.getContentText().substring(0, 200));
      return null;  // signal failure — do NOT trust a partial list
    }
    var d = JSON.parse(resp.getContentText());
    var invs = d.invoices || [];
    for (var k = 0; k < invs.length; k++) all.push(invs[k]);
    offset += limit;
    if (invs.length === 0 || offset >= Number(d.total || 0)) break;
  }
  return all;
}

/**
 * Reverse sync, run from the buildAllBilling tail every ~5 min (no separate
 * trigger). Polls ALL sub-accounts (FL/GA/VA). Two jobs:
 *
 *   1. PAID-FLIP: rows whose col-P invoiceId is a PAID invoice → col-G 'paid'
 *      (only if not already in a terminal state). The reconciler preserves
 *      status pills by fingerprint, so the flip sticks.
 *   2. DELETED/VOIDED CLEANUP: rows whose col-P invoiceId no longer exists
 *      in GHL (deleted) or is voided → clear the col-P stamp so the item
 *      becomes re-invoiceable, and clear the now-dead "open in GHL" link in
 *      col I on that customer's header row.
 *
 * SAFETY: if the invoice fetch fails (ghlListInvoices_ returns null), the
 * function bails immediately and clears NOTHING. Item status is never
 * reverted (we only ever set 'paid'); cleanup only clears stamps/links.
 * Idempotent. Returns a summary.
 */
function syncPaidInvoices_() {
  // Poll EVERY sub-account (FL/GA/VA) — invoices are created in whichever
  // sub-account the customer's Waiver Origin routed them to. Invoice ids are
  // globally unique, so the paid/live sets pool cleanly across locations.
  // `allOk` gates the destructive cleanup: if ANY sub-account's fetch fails,
  // we still apply paid-flips for what we got, but we do NOT clear stamps
  // (a GA/VA invoice could be live but just unreachable this run).
  var paid = {}, live = {}, allOk = true, subsFetched = 0;
  Object.keys(SUBACCOUNTS).forEach(function (sub) {
    // No token configured → no invoices could ever have been created here, so
    // no col-P stamp can point at this sub. Skip it WITHOUT tripping allOk, so
    // cleanup still runs for the subs that are configured. (A configured-but-
    // failing token is different: it CAN have live invoices we just can't see,
    // so that one trips allOk and blocks cleanup.)
    try { getTokenFor(sub); }
    catch (e) { Logger.log('[syncPaidInvoices_] ' + sub + ' token not configured — skipping'); return; }
    var list;
    try { list = ghlListInvoices_(sub); }
    catch (e) { Logger.log('[syncPaidInvoices_] ' + sub + ' fetch threw: ' + e.message); list = null; }
    if (list === null) { allOk = false; return; }  // present token but fetch failed → unsafe to clean
    subsFetched++;
    list.forEach(function (v) {
      var id = v._id || v.id; if (!id) return;
      var st = String(v.status || '').toLowerCase();
      if (st !== 'void' && st !== 'voided') live[id] = true;  // still exists & not voided
      if (st === 'paid') paid[id] = true;
    });
  });
  if (subsFetched === 0) {
    Logger.log('[syncPaidInvoices_] all invoice fetches failed — skipping (nothing changed)');
    return { skipped: true, rowsFlipped: 0, stampsCleared: 0, linksCleared: 0, customers: 0 };
  }

  var sh = getDashboardSheet();
  var lastRow = sh.getLastRow();
  if (lastRow < 2) return { rowsFlipped: 0, stampsCleared: 0, linksCleared: 0, customers: 0 };

  var n = lastRow - 1;
  var ids      = sh.getRange(2, COL.ITEM_INVOICE_ID, n, 1).getValues();
  var statuses = sh.getRange(2, COL.BALANCE_OR_STATUS, n, 1).getValues();
  var emails   = sh.getRange(2, COL.EMAIL_OR_ITEM, n, 1).getValues();
  var links    = sh.getRange(2, COL.INVOICE_STATUS, n, 1).getFormulas();
  var TERMINAL = { 'paid': 1, 'refunded': 1, 'refund-needed': 1, 'canceled': 1 };

  var flipped = 0, stampsCleared = 0, linksCleared = 0;
  var customersToRefresh = {};

  // Pass 1 — item rows: paid-flip or deleted/voided stamp cleanup.
  for (var i = 0; i < n; i++) {
    var iid = String(ids[i][0] || '').trim();
    if (!iid) continue;
    var row = i + 2;
    if (allOk && !live[iid]) {              // deleted/voided (clear only when ALL subs fetched OK)
      sh.getRange(row, COL.ITEM_INVOICE_ID).setValue('');   // unlock for re-invoicing
      stampsCleared++;
      var od = (typeof findOwningCustomerRow === 'function') ? findOwningCustomerRow(row) : null;
      if (od) customersToRefresh[od] = true;
      continue;
    }
    if (paid[iid]) {                        // invoice paid → flip the row
      var st = String(statuses[i][0] || '').toLowerCase().trim();
      if (!TERMINAL[st]) {
        sh.getRange(row, COL.BALANCE_OR_STATUS).setValue('paid');
        flipped++;
        var op = (typeof findOwningCustomerRow === 'function') ? findOwningCustomerRow(row) : null;
        if (op) customersToRefresh[op] = true;
      }
    }
  }

  // Pass 2 — customer header rows: clear dead "open in GHL" links (col I)
  // that reference an invoice that no longer exists / is voided. Only when
  // every sub-account fetched OK (same safety gate as the stamp cleanup).
  if (allOk) {
    for (var j = 0; j < n; j++) {
      if (String(emails[j][0] || '').indexOf('@') === -1) continue;  // not a customer header
      var f = String(links[j][0] || '');
      if (!f) continue;
      var m = f.match(/invoices\/([A-Za-z0-9]+)/);
      if (m && !live[m[1]]) {
        sh.getRange(j + 2, COL.INVOICE_STATUS).clearContent();
        linksCleared++;
      }
    }
  }

  // Recompute balances for every customer whose rows changed.
  Object.keys(customersToRefresh).forEach(function (key) {
    var cr = parseInt(key, 10);
    try {
      var purl = (typeof extractProfileUrlFromCell === 'function') ? extractProfileUrlFromCell(cr) : null;
      if (typeof updateBalanceFormula === 'function') updateBalanceFormula(cr, purl);
    } catch (e) { Logger.log('[syncPaidInvoices_] balance ' + cr + ': ' + e.message); }
    try { if (typeof refreshBalanceNoteForCustomer === 'function') refreshBalanceNoteForCustomer(cr); } catch (e) {}
  });

  Logger.log('[syncPaidInvoices_] ' + subsFetched + '/' + Object.keys(SUBACCOUNTS).length +
             ' sub(s) fetched; ' + flipped + ' → paid, ' + stampsCleared +
             ' stamp(s) cleared, ' + linksCleared + ' dead link(s) cleared' +
             (allOk ? '' : ' (cleanup SKIPPED — a sub-account fetch failed)') + '; ' +
             Object.keys(customersToRefresh).length + ' customer(s) refreshed');
  return { rowsFlipped: flipped, stampsCleared: stampsCleared, linksCleared: linksCleared,
           customers: Object.keys(customersToRefresh).length };
}

/** Public wrapper so the invoice-state sync can be run on demand from the editor. */
function runSyncPaidInvoices() { return syncPaidInvoices_(); }
