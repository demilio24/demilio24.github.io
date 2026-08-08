import { test } from "node:test";
import assert from "node:assert/strict";
import { sumMetrics, conversionRate, rollupByClient, rollupByCampaign, formatMoney, periodDelta } from "./transform.mjs";

const rows = [
  { account_id: "A", account_name: "Acme", currency_code: "USD", campaign_id: "1", campaign_name: "C1", date: "2026-06-07", clicks: 10, cost: 5, conversions: 2, impressions: 100 },
  { account_id: "A", account_name: "Acme", currency_code: "USD", campaign_id: "1", campaign_name: "C1", date: "2026-06-06", clicks: 10, cost: 5, conversions: 0, impressions: 100 },
  { account_id: "B", account_name: "Beta", currency_code: "CAD", campaign_id: "2", campaign_name: "C2", date: "2026-06-07", clicks: 5,  cost: 5, conversions: 1, impressions: 50 },
];

test("sumMetrics totals the numeric fields", () => {
  const t = sumMetrics(rows);
  assert.equal(t.clicks, 25);
  assert.equal(t.cost, 15);
  assert.equal(t.conversions, 3);
});

test("conversionRate is conversions/clicks as a fraction, 0 when no clicks", () => {
  assert.equal(conversionRate({ conversions: 2, clicks: 10 }), 0.2);
  assert.equal(conversionRate({ conversions: 0, clicks: 0 }), 0);
});

test("rollupByClient groups rows by account with summed metrics", () => {
  const clients = rollupByClient(rows);
  assert.equal(clients.length, 2);
  const acme = clients.find((c) => c.account_id === "A");
  assert.equal(acme.conversions, 2);
  assert.equal(acme.account_name, "Acme");
});

test("rollupByCampaign groups rows by campaign", () => {
  const camps = rollupByCampaign(rows);
  assert.equal(camps.length, 2);
  const c1 = camps.find((c) => c.campaign_id === "1");
  assert.equal(c1.clicks, 20);
});

test("formatMoney respects currency, CLP has no decimals", () => {
  assert.match(formatMoney(1500, "CLP"), /1,500/);
  assert.match(formatMoney(12.5, "USD"), /\$12\.50/);
});

test("periodDelta compares the last N dates vs the prior N dates", () => {
  const days = [];
  for (let i = 1; i <= 14; i++) {
    days.push({ date: `2026-06-${String(i).padStart(2, "0")}`, conversions: i <= 7 ? 1 : 2, clicks: 0 });
  }
  const d = periodDelta(days, "conversions", 7);
  assert.equal(d.recent, 14); // days 8-14 = 2 each
  assert.equal(d.prior, 7);   // days 1-7  = 1 each
  assert.equal(d.pct, 1);     // +100%
});

test("periodDelta returns pct null when the prior period has no data", () => {
  const rows7 = [{ date: "2026-06-07", clicks: 5 }];
  assert.equal(periodDelta(rows7, "clicks", 7).pct, null);
});
