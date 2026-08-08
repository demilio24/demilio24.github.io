/** ─── Payments.gs ─────────────────────────────────────────────
 *  Backend functions for transaction lookup. Used by Transactions.gs
 *  (syncTransactionsSheet) to pull each Dashboard customer's payment
 *  history from their WaiverOrigin subaccount.
 *
 *  The old HtmlService-based Transactions modal was removed: its
 *  google.script.run callbacks kept tripping the "Authorization is
 *  required" check on a per-user-session basis, even after the script
 *  was authorized. The replacement is the standalone "Transactions"
 *  sheet, refreshed via the menu or as a polling tail (see
 *  Transactions.gs). This file keeps just the backend GHL calls.
 *
 *  Depends on: Configuration.gs, Helpers.gs, Polling.gs (readWaiverOrigin)
 */

// ─── Backend: search FL for contacts matching the query ─────
/**
 * Returns up to 10 matching contacts from the FL subaccount (the
 * canonical contact home). Each result is augmented with its
 * WaiverOrigin so the front-end can show which subaccount payments
 * will be queried in.
 *
 * @param {string} query  free-text: name / email / phone
 * @returns {Array<{contactId, name, email, phone, waiverOrigin}>}
 */
function tx_searchContacts(query) {
  query = String(query || '').trim();
  if (!query) return [];
  var meta = SUBACCOUNTS.Florida;
  var token = getTokenFor('Florida');
  var resp = UrlFetchApp.fetch(GHL_API_BASE + '/contacts/search', {
    method: 'post',
    contentType: 'application/json',
    headers: {
      'Authorization': 'Bearer ' + token,
      'Version': GHL_API_VERSION,
      'Accept': 'application/json',
    },
    payload: JSON.stringify({ locationId: meta.locationId, query: query, pageLimit: 10 }),
    muteHttpExceptions: true
  });
  if (resp.getResponseCode() !== 200) {
    return [];
  }
  var data = JSON.parse(resp.getContentText());
  var contacts = data.contacts || [];
  return contacts.slice(0, 10).map(function(c) {
    var waiver = '';
    try {
      var full = ghlGetContact('Florida', c.id);
      waiver = readWaiverOrigin(full);
    } catch (e) {}
    return {
      contactId: c.id,
      name: ((c.firstName || '') + ' ' + (c.lastName || '')).trim() || c.contactName || '',
      email: c.email || '',
      phone: c.phone || '',
      waiverOrigin: waiver
    };
  });
}

// ─── Backend: fetch transactions for a given (FL) contact ───
/**
 * Given an FL contactId, route to the WaiverOrigin subaccount, find the
 * SAME contact there by email, and pull their payments/transactions.
 *
 * If WaiverOrigin is empty, default to FL (the polling subaccount and
 * canonical contact home).
 *
 * @param {string} flContactId
 * @returns {Object} { ok, subaccount, transactions: [...], error? }
 */
function tx_fetchTransactions(flContactId) {
  if (!flContactId) return { ok: false, error: 'No contact ID provided' };
  var flContact;
  try {
    flContact = ghlGetContact('Florida', flContactId);
  } catch (e) {
    return { ok: false, error: 'FL contact fetch failed: ' + e.message };
  }
  var waiverOrigin = readWaiverOrigin(flContact) || 'Florida';
  var subaccountName = resolveSubaccount(waiverOrigin) || 'Florida';
  var subMeta = SUBACCOUNTS[subaccountName];
  if (!subMeta) return { ok: false, error: 'Unknown subaccount: ' + subaccountName };

  // Find the same contact in the routed subaccount (by email)
  var email = String(flContact.email || '').toLowerCase().trim();
  var subContactId = null;
  if (email) {
    try { subContactId = ghlSearchContactByEmail(subaccountName, email); }
    catch (e) {}
  }
  if (!subContactId) {
    return {
      ok: true,
      subaccount: subaccountName,
      subaccountLocationId: subMeta.locationId,
      subContactId: null,
      waiverOrigin: waiverOrigin,
      contactNotInSubaccount: true,
      transactions: []
    };
  }

  // Pull transactions
  var token = getTokenFor(subaccountName);
  var url = GHL_API_BASE + '/payments/transactions?altId=' +
            encodeURIComponent(subMeta.locationId) +
            '&altType=location&contactId=' + encodeURIComponent(subContactId);
  var resp = UrlFetchApp.fetch(url, {
    method: 'get',
    headers: {
      'Authorization': 'Bearer ' + token,
      'Version': GHL_API_VERSION,
      'Accept': 'application/json'
    },
    muteHttpExceptions: true
  });
  if (resp.getResponseCode() !== 200) {
    return { ok: false, error: 'Transactions API ' + resp.getResponseCode() };
  }
  var body = JSON.parse(resp.getContentText());
  var rows = (body.data || []).map(function(t) {
    var card = (t.paymentMethod && t.paymentMethod.card) || {};
    var snap = t.chargeSnapshot || {};
    return {
      id: t._id,
      date: t.createdAt || '',
      amount: t.amount || 0,
      currency: t.currency || 'USD',
      status: t.status || '',
      sourceName: t.entitySourceName || '',
      cardBrand: (card.brand || '').toUpperCase(),
      cardLast4: card.last4 || '',
      amountRefunded: t.amountRefunded || 0,
      receiptUrl: snap.receiptUrl || ''
    };
  });

  return {
    ok: true,
    subaccount: subaccountName,
    subaccountLocationId: subMeta.locationId,
    subContactId: subContactId,
    waiverOrigin: waiverOrigin,
    contactName: ((flContact.firstName || '') + ' ' + (flContact.lastName || '')).trim() || flContact.contactName || email,
    contactEmail: email,
    transactions: rows
  };
}
