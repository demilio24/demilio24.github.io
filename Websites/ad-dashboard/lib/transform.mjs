const NUM = ["impressions", "clicks", "cost", "conversions"];

export function sumMetrics(rows = []) {
  const t = { impressions: 0, clicks: 0, cost: 0, conversions: 0 };
  for (const r of rows) for (const k of NUM) t[k] += Number(r[k] ?? 0);
  return t;
}

export const conversionRate = ({ conversions = 0, clicks = 0 }) =>
  clicks > 0 ? conversions / clicks : 0;

function groupBy(rows, keyFn, meta) {
  const map = new Map();
  for (const r of rows) {
    const k = keyFn(r);
    if (!map.has(k)) map.set(k, { ...meta(r), impressions: 0, clicks: 0, cost: 0, conversions: 0 });
    const g = map.get(k);
    for (const f of NUM) g[f] += Number(r[f] ?? 0);
  }
  return [...map.values()];
}

export const rollupByClient = (rows) =>
  groupBy(rows, (r) => r.account_id, (r) => ({
    account_id: r.account_id, account_name: r.account_name, currency_code: r.currency_code,
  }));

export const rollupByCampaign = (rows) =>
  groupBy(rows, (r) => r.campaign_id, (r) => ({
    account_id: r.account_id, account_name: r.account_name, currency_code: r.currency_code,
    campaign_id: r.campaign_id, campaign_name: r.campaign_name, status: r.status,
  }));

// Sum `field` over the most recent `days` dates vs the `days` dates before that.
// pct is the fractional change (recent vs prior), or null when prior has no data.
export function periodDelta(rows = [], field, days = 7) {
  const dates = [...new Set(rows.map((r) => r.date).filter(Boolean))].sort();
  const recentDates = new Set(dates.slice(-days));
  const priorDates = new Set(dates.slice(-2 * days, -days));
  let recent = 0, prior = 0;
  for (const r of rows) {
    const v = Number(r[field] ?? 0);
    if (recentDates.has(r.date)) recent += v;
    else if (priorDates.has(r.date)) prior += v;
  }
  return { recent, prior, pct: prior > 0 ? (recent - prior) / prior : null };
}

export function formatMoney(value, currency = "USD") {
  const noDecimals = currency === "CLP";
  return new Intl.NumberFormat("en-US", {
    style: "currency", currency,
    minimumFractionDigits: noDecimals ? 0 : 2,
    maximumFractionDigits: noDecimals ? 0 : 2,
  }).format(Number(value ?? 0));
}
