/** ─── Invoicing smoke tests ───────────────────────────────────────────
 *  Run a test function in the Apps Script editor (select → Run) and read
 *  Logs, or via `clasp run <name>`. Mirrors the existing stage1SmokeTest
 *  logged-assertion convention. Pure-function tests need no network; the
 *  `_live_` tests hit GHL and clean up after themselves (gated on the
 *  scope probe in plan Task 0).
 */

// ─── Task 1: buildInvoiceItems_ (pure) ───────────────────────────────
function test_buildInvoiceItems_() {
  var out = [];
  var items = [
    { label: 'Summer Camp - Wk 1 (2 days) - Mia', unitPrice: 215, total: 215, status: 'unpaid', invoiceId: '' },
    { label: 'T-shirt', unitPrice: 30, total: 30, status: 'unpaid', invoiceId: '' },
    { label: 'Already paid item', unitPrice: 99, total: 99, status: 'paid', invoiceId: '' },
    { label: 'Already invoiced', unitPrice: 50, total: 50, status: 'unpaid', invoiceId: 'inv_x' },
  ];
  var lines = buildInvoiceItems_(items);
  out.push(lines.length === 2 ? '[OK] only 2 eligible lines' : '[FAIL] got ' + lines.length);
  out.push(lines[0].name === 'Summer Camp - Wk 1 (2 days) - Mia' ? '[OK] name' : '[FAIL] name=' + lines[0].name);
  out.push((lines[0].amount === 215 && lines[0].qty === 1 && lines[0].currency === 'USD') ? '[OK] shape' : '[FAIL] shape');
  // billed amount uses TOTAL, not per-unit display
  var multiDay = buildInvoiceItems_([{ label: 'Camp', unitPrice: 100, total: 215, status: 'unpaid', invoiceId: '' }]);
  out.push(multiDay[0].amount === 215 ? '[OK] amount uses total' : '[FAIL] amount=' + multiDay[0].amount);
  Logger.log(out.join('\n'));
  return out;
}

// ─── Task 2: buildInvoicePayload_ (pure) ─────────────────────────────
function test_buildInvoicePayload_() {
  var out = [];
  var p = buildInvoicePayload_({
    locationId: '8IWtNFlmgJ8bif9DivHT',
    contact: { id: 'c1', name: 'Jane Doe', email: 'jane@example.com' },
    lines: [{ name: 'Camp', currency: 'USD', amount: 215, qty: 1 }],
    issueDate: '2026-06-02', dueDate: '2026-06-09',
  });
  out.push((p.altId === '8IWtNFlmgJ8bif9DivHT' && p.altType === 'location') ? '[OK] alt' : '[FAIL] alt');
  out.push(p.contactDetails.id === 'c1' ? '[OK] contact' : '[FAIL] contact');
  out.push((p.items.length === 1 && p.currency === 'USD') ? '[OK] items' : '[FAIL] items');
  out.push((p.businessDetails && p.businessDetails.name === 'Systema Floyd') ? '[OK] biz' : '[FAIL] biz');
  Logger.log(out.join('\n'));
  return out;
}

// ─── Task 5: readCustomerItems_ (sheet I/O — point at a real header row) ──
/**
 * Set HEADER_ROW to a known customer header row on the live Dashboard, then
 * Run this and read Logs. Confirms grouping + column parsing line up with
 * the real sheet before trusting the orchestrator. Read-only.
 */
function test_readCustomerItems_() {
  var out = [];
  var HEADER_ROW = 2; // ← change to a real customer header row before running
  var cust = readCustomerItems_(HEADER_ROW);
  out.push(cust.email && cust.email.indexOf('@') !== -1 ? '[OK] email ' + cust.email : '[FAIL] email=' + cust.email);
  out.push(cust.items.length >= 0 ? '[OK] ' + cust.items.length + ' item(s) read' : '[FAIL] items');
  if (cust.items.length) {
    var it = cust.items[0];
    out.push((typeof it.total === 'number' && it.status !== undefined && it.row > HEADER_ROW)
      ? '[OK] item shape (row ' + it.row + ', status "' + it.status + '", total ' + it.total + ')'
      : '[FAIL] item shape ' + JSON.stringify(it));
  }
  Logger.log(out.join('\n'));
  return out;
}

// ─── Task 3: live create-then-delete (gated on Task 0 scope) ─────────────
/**
 * Hits live GHL: creates a throwaway contact + draft invoice, asserts ids,
 * then DELETES both. Run in the editor after a clasp push. Leaves no
 * residue on success.
 */
function test_ghlCreateInvoice_live_() {
  var out = [];
  var sub = DEFAULT_SUBACCOUNT;
  var contact = resolveContact_(sub, 'zz-gas-test@example.com', 'ZZ GasTest');
  out.push(contact.id ? '[OK] contact ' + contact.id : '[FAIL] no contact');
  var payload = buildInvoicePayload_({
    locationId: SUBACCOUNTS[sub].locationId, contact: contact,
    lines: buildInvoiceItems_([{ label: 'GAS test line', unitPrice: 1, total: 1, status: 'owed', invoiceId: '' }]),
    issueDate: '2026-06-04', dueDate: '2026-06-14',
  });
  var inv = ghlCreateInvoice_(sub, payload);
  out.push(inv.id ? '[OK] invoice ' + inv.id : '[FAIL] no invoice');
  // cleanup — delete invoice then contact
  var H = { 'Authorization': 'Bearer ' + getTokenFor(sub), 'Version': GHL_API_VERSION, 'Accept': 'application/json' };
  var loc = SUBACCOUNTS[sub].locationId;
  try {
    var di = UrlFetchApp.fetch(GHL_API_BASE + '/invoices/' + inv.id + '?altId=' + loc + '&altType=location',
      { method: 'delete', headers: H, muteHttpExceptions: true });
    out.push('[INFO] del invoice ' + di.getResponseCode());
  } catch (e) { out.push('[WARN] del invoice ' + e.message); }
  try {
    var dc = UrlFetchApp.fetch(GHL_API_BASE + '/contacts/' + contact.id,
      { method: 'delete', headers: H, muteHttpExceptions: true });
    out.push('[INFO] del contact ' + dc.getResponseCode());
  } catch (e) { out.push('[WARN] del contact ' + e.message); }
  Logger.log(out.join('\n'));
  return out;
}
