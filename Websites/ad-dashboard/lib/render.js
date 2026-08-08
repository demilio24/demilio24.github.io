import { sumMetrics, conversionRate, rollupByClient, rollupByCampaign, formatMoney, periodDelta } from "./transform.mjs";

const pct = (f) => (f * 100).toFixed(1) + "%";
const n = (v) => new Intl.NumberFormat("en-US").format(Math.round(Number(v ?? 0)));
const el = (html) => { const t = document.createElement("template"); t.innerHTML = html.trim(); return t.content.firstElementChild; };

// ---- date helpers ---------------------------------------------------------
function shiftDate(ymd, deltaDays) {
  const [y, m, d] = ymd.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  dt.setUTCDate(dt.getUTCDate() + deltaDays);
  return dt.toISOString().slice(0, 10);
}
function lastNDays(rows, days) {
  const dates = [...new Set(rows.map((r) => r.date).filter(Boolean))].sort();
  if (!dates.length) return [];
  const cutoff = shiftDate(dates[dates.length - 1], -(days - 1));
  return rows.filter((r) => r.date && r.date >= cutoff);
}
function fmtDate(ymd) {
  const [y, m, d] = ymd.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
}

// ---- per-date aggregation -------------------------------------------------
function byDateTotals(rows) {
  const map = new Map();
  for (const r of rows) {
    const t = map.get(r.date) ?? { conversions: 0, clicks: 0, cost: 0 };
    t.conversions += Number(r.conversions ?? 0);
    t.clicks += Number(r.clicks ?? 0);
    t.cost += Number(r.cost ?? 0);
    map.set(r.date, t);
  }
  return map;
}

function ratioDeltaPct(rows, numField, denField, days) {
  const num = periodDelta(rows, numField, days);
  const den = periodDelta(rows, denField, days);
  const recent = den.recent > 0 ? num.recent / den.recent : 0;
  const prior = den.prior > 0 ? num.prior / den.prior : null;
  return prior && prior > 0 ? (recent - prior) / prior : null;
}

// ---- metric registry (shared by KPI cards + history drawer) ---------------
const METRICS = {
  leads:    { label: "Leads Generated", mode: "goodUp", kind: "int",
              agg: (t) => t.conversions, daily: (d) => d.conversions,
              delta: (rows, days) => periodDelta(rows, "conversions", days).pct },
  clicks:   { label: "Clicks", mode: "goodUp", kind: "int",
              agg: (t) => t.clicks, daily: (d) => d.clicks,
              delta: (rows, days) => periodDelta(rows, "clicks", days).pct },
  spend:    { label: "Ad Spend", mode: "flat", kind: "money",
              agg: (t) => t.cost, daily: (d) => d.cost,
              delta: (rows, days) => periodDelta(rows, "cost", days).pct },
  convrate: { label: "Conversion Rate", mode: "goodUp", kind: "pct",
              agg: (t) => conversionRate(t), daily: (d) => (d.clicks > 0 ? d.conversions / d.clicks : 0),
              delta: (rows, days) => ratioDeltaPct(rows, "conversions", "clicks", days) },
  cpl:      { label: "Cost / Lead", mode: "badUp", kind: "money",
              agg: (t) => (t.conversions > 0 ? t.cost / t.conversions : null), daily: (d) => (d.conversions > 0 ? d.cost / d.conversions : 0),
              delta: (rows, days) => ratioDeltaPct(rows, "cost", "conversions", days) },
};
function fmtMetric(key, value, currency) {
  if (value === null || value === undefined) return "—";
  const m = METRICS[key];
  if (m.kind === "money") return formatMoney(value, currency);
  if (m.kind === "pct") return pct(value);
  return n(value);
}

// ---- delta pill -----------------------------------------------------------
function deltaHtml(pctChange, mode, windowDays) {
  if (pctChange === null || !isFinite(pctChange)) {
    return `<div class="delta"><span class="vs">vs prev ${windowDays}d · no prior data</span></div>`;
  }
  const up = pctChange >= 0;
  const arrow = up ? "▲" : "▼";
  let cls = "flat";
  if (mode === "goodUp") cls = up ? "up" : "down";
  else if (mode === "badUp") cls = up ? "down" : "up";
  return `<div class="delta"><span class="delta-pill ${cls}">${arrow} ${(Math.abs(pctChange) * 100).toFixed(0)}%</span><span class="vs">vs prev ${windowDays}d</span></div>`;
}

// ---- building blocks ------------------------------------------------------
function kpiBlock(key, valueHtml, deltaInner) {
  const b = el(`<div class="block" data-metric="${key}" role="button" tabindex="0">
    <div class="sec-bar">${METRICS[key].label}</div>
    <div class="kpi-card"><div class="val">${valueHtml}</div>${deltaInner}<span class="kpi-hint">View history →</span></div>
  </div>`);
  return b;
}
function section(title, bodyNode) {
  const sec = el(`<section class="section"><div class="sec-bar">${title}</div></section>`);
  sec.append(bodyNode);
  return sec;
}
function rangeControl(range) {
  const presets = [7, 14, 30];
  const btns = presets.map((p) => `<button class="rg ${p === range ? "on" : ""}" data-range="${p}">${p}d</button>`).join("");
  return `<div class="range-ctl">
    <span class="rg-cal">📅</span>${btns}
    <input class="rg-custom" type="number" min="1" max="30" placeholder="custom" value="${presets.includes(range) ? "" : range}" data-range-input title="custom number of days (1-30)" />
    <span class="rg-unit">days</span>
  </div>`;
}
function pageHeader(title, range) {
  return el(`<div class="page-head"><h1 class="page-title">${title}</h1>${rangeControl(range)}</div>`);
}

// ---- KPI grids ------------------------------------------------------------
// headline value uses rows within the selected range; delta compares the last
// `range` days vs the prior `range` days using the full dataset.
function kpiGrid(keys, allRows, range, currency) {
  const t = sumMetrics(lastNDays(allRows, range));
  const grid = el(`<div class="kpi-grid"></div>`);
  for (const key of keys) {
    const m = METRICS[key];
    grid.append(kpiBlock(key, fmtMetric(key, m.agg(t), currency), deltaHtml(m.delta(allRows, range), m.mode, range)));
  }
  return grid;
}

// ---- views ----------------------------------------------------------------
export function renderOverview(app, allRows, accountsById = {}, range = 30, insights = [], clickupTasks = []) {
  const rangeRows = lastNDays(allRows, range);
  const clients = rollupByClient(rangeRows).sort((a, b) => b.conversions - a.conversions);
  app.innerHTML = "";
  app.append(pageHeader("Performance Overview", range));
  // Spend/CPL omitted from the agency total (clients bill in USD/CAD/CLP).
  app.append(kpiGrid(["leads", "clicks", "convrate"], allRows, range, "USD"));

  const cgrid = el(`<div class="client-grid"></div>`);
  for (const c of clients) {
    const name = accountsById[c.account_id]?.account_name ?? c.account_name ?? c.account_id;
    cgrid.append(el(`<a class="client-card" href="?client=${c.account_id}">
      <div class="cc-name">${name}</div>
      <div class="cc-rows">
        <div class="mini"><span>Leads</span><b>${n(c.conversions)}</b></div>
        <div class="mini"><span>Spend</span><b>${formatMoney(c.cost, c.currency_code)}</b></div>
        <div class="mini"><span>Clicks</span><b>${n(c.clicks)}</b></div>
        <div class="mini"><span>Conv. rate</span><b>${pct(conversionRate(c))}</b></div>
      </div>
      <span class="cc-go">View report →</span>
    </a>`));
  }
  app.append(section(`Clients · ${clients.length} active · spend in each client's currency`, cgrid));
  app.append(renderInsights(insights, clickupTasks));
}

// Match a ClickUp [Ad Alert] task to a campaign by name in the task title.
function matchTask(tasks, campaignName) {
  if (!campaignName) return null;
  return (tasks ?? []).find((t) => String(t.name ?? "").includes(campaignName)) ?? null;
}

const SENTIMENT = {
  good:    { dot: "good",    tag: "On track" },
  watch:   { dot: "watch",   tag: "Watch" },
  bad:     { dot: "bad",     tag: "Needs attention" },
  neutral: { dot: "neutral", tag: "Steady" },
};
function renderInsights(insights = [], clickupTasks = []) {
  const sec = el(`<section class="section insights"><div class="sec-bar">AI Performance Read-out</div></section>`);
  if (!insights.length) {
    sec.append(el(`<div class="card insight-empty">
      <div class="ie-spark">✦</div>
      <div><b>Insights generate automatically.</b><br><span class="vs">A plain-English read of each campaign's latest trend appears here, refreshed daily.</span></div>
    </div>`));
    return sec;
  }
  const flagged = insights.filter((i) => i.sentiment === "watch" || i.sentiment === "bad").length;
  sec.append(el(`<div class="insights-actions">
    <span class="vs">${flagged} campaign${flagged === 1 ? "" : "s"} flagged · click a card for details</span>
    <button class="cu-btn" data-clickup-push ${flagged ? "" : "disabled"}>
      <span class="cu-label">↗ Send alerts to ClickUp</span>
    </button>
  </div>`));
  const grid = el(`<div class="insight-grid"></div>`);
  for (const it of insights) {
    const s = SENTIMENT[it.sentiment] ?? SENTIMENT.neutral;
    const isFlagged = it.sentiment === "watch" || it.sentiment === "bad";
    const task = matchTask(clickupTasks, it.campaign_name ?? "");
    let foot = "";
    if (task) {
      foot = `<div class="ic-foot"><span class="task-chip ${task.closed ? "done" : "open"}">● ${task.status ?? "in ClickUp"}</span><a class="task-link" href="${task.url}" target="_blank" rel="noopener">Open in ClickUp ↗</a></div>`;
    } else if (isFlagged) {
      foot = `<div class="ic-foot"><button class="cu-mini" data-clickup-push data-campaign="${it.campaign_id}">↗ Send to ClickUp</button></div>`;
    }
    grid.append(el(`<article class="insight-card clickable" data-insight="${it.campaign_id}" role="button" tabindex="0">
      <div class="ic-top">
        <span class="ic-dot ${s.dot}"></span>
        <div class="ic-titles"><div class="ic-camp">${it.campaign_name ?? "Campaign"}</div><div class="ic-acct">${it.account_name ?? ""}</div></div>
        <span class="ic-tag ${s.dot}">${s.tag}</span>
      </div>
      <div class="ic-headline">${it.headline ?? ""}</div>
      <p class="ic-body">${it.body ?? ""}</p>
      ${foot}
      <span class="ic-more">Details →</span>
    </article>`));
  }
  sec.append(grid);
  return sec;
}

// Detail drawer for one read-out card: status, full read-out, KPIs, ClickUp link / send.
export function openInsightDrawer(campaignId, ctxData = {}) {
  const { insights = [], rows = [], clickupTasks = [] } = ctxData;
  const it = insights.find((i) => String(i.campaign_id) === String(campaignId));
  if (!it) return;
  const overlay = document.getElementById("overlay");
  const drawer = document.getElementById("drawer");
  const s = SENTIMENT[it.sentiment] ?? SENTIMENT.neutral;
  const task = matchTask(clickupTasks, it.campaign_name ?? "");
  const campRows = rows.filter((r) => String(r.campaign_id) === String(campaignId));
  const currency = campRows[0]?.currency_code ?? "USD";
  const t = sumMetrics(campRows);
  const cpl = t.conversions ? formatMoney(t.cost / t.conversions, currency) : "—";

  drawer.innerHTML = `
    <div class="dw-head">
      <div><div class="dw-kicker">Campaign alert</div><h2 class="dw-title">${it.campaign_name ?? "Campaign"}</h2><div class="ic-acct">${it.account_name ?? ""}</div></div>
      <button class="dw-close" data-drawer-close aria-label="Close">✕</button>
    </div>
    <div class="dw-statusrow">
      <span class="ic-tag ${s.dot}">${s.tag}</span>
      ${task
        ? `<span class="task-chip ${task.closed ? "done" : "open"}">● ClickUp: ${task.status ?? "open"}</span>`
        : `<span class="task-chip none">No open task</span>`}
    </div>
    <div class="dw-readout"><div class="ic-headline">${it.headline ?? ""}</div><p class="ic-body">${it.body ?? ""}</p></div>
    <div class="dw-section">Last 30 days</div>
    <div class="dw-stats5">
      <div class="dw-stat"><div class="dw-lab">Leads</div><div class="dw-val">${n(t.conversions)}</div></div>
      <div class="dw-stat"><div class="dw-lab">Spend</div><div class="dw-val">${formatMoney(t.cost, currency)}</div></div>
      <div class="dw-stat"><div class="dw-lab">Clicks</div><div class="dw-val">${n(t.clicks)}</div></div>
      <div class="dw-stat"><div class="dw-lab">Conv. rate</div><div class="dw-val">${pct(conversionRate(t))}</div></div>
      <div class="dw-stat"><div class="dw-lab">Cost / lead</div><div class="dw-val">${cpl}</div></div>
    </div>
    <div class="dw-actions">
      ${task
        ? `<a class="cu-btn" href="${task.url}" target="_blank" rel="noopener"><span class="cu-label">Open task in ClickUp ↗</span></a>`
        : `<button class="cu-btn" data-clickup-push data-campaign="${it.campaign_id}"><span class="cu-label">↗ Send to ClickUp</span></button>`}
      <a class="cu-btn ghost" href="?campaign=${it.campaign_id}"><span class="cu-label">View full campaign →</span></a>
    </div>`;

  overlay.hidden = false;
  drawer.hidden = false;
  requestAnimationFrame(() => { overlay.classList.add("show"); drawer.classList.add("open"); });
}

export function renderClient(app, account, allRows, range = 30) {
  const currency = account?.currency_code ?? "USD";
  app.innerHTML = "";
  app.append(pageHeader(account?.account_name ?? "Client", range));
  app.append(kpiGrid(["leads", "spend", "clicks", "convrate", "cpl"], allRows, range, currency));
  app.append(section(`Leads Trend · last ${range} days`, trendCard(lastNDays(allRows, range))));

  const camps = rollupByCampaign(lastNDays(allRows, range)).sort((a, b) => b.conversions - a.conversions);
  const card = el(`<div class="card"></div>`);
  const table = el(`<table><thead><tr>
    <th>Campaign</th><th>Status</th><th>Leads</th><th>Spend</th><th>Clicks</th><th>Conv. rate</th>
  </tr></thead><tbody></tbody></table>`);
  const tb = table.querySelector("tbody");
  if (!camps.length) tb.append(el(`<tr><td colspan="6">No campaign data in this range.</td></tr>`));
  for (const c of camps) {
    tb.append(el(`<tr>
      <td><a href="?campaign=${c.campaign_id}">${c.campaign_name ?? c.campaign_id}</a></td>
      <td><span class="status ${c.status ?? ""}">${c.status ?? "—"}</span></td>
      <td>${n(c.conversions)}</td><td>${formatMoney(c.cost, currency)}</td>
      <td>${n(c.clicks)}</td><td>${pct(conversionRate(c))}</td>
    </tr>`));
  }
  card.append(table);
  app.append(section("Campaigns", card));
}

export function renderCampaign(app, allRows, keywords, range = 30) {
  const currency = allRows[0]?.currency_code ?? "USD";
  app.innerHTML = "";
  app.append(pageHeader(allRows[0]?.campaign_name ?? "Campaign", range));
  app.append(kpiGrid(["leads", "spend", "clicks", "convrate", "cpl"], allRows, range, currency));
  app.append(section(`Leads Trend · last ${range} days`, trendCard(lastNDays(allRows, range))));

  const card = el(`<div class="card"></div>`);
  const table = el(`<table><thead><tr>
    <th>Keyword</th><th>Match</th><th>Clicks</th><th>Cost</th><th>Leads</th>
  </tr></thead><tbody></tbody></table>`);
  const tb = table.querySelector("tbody");
  if (!keywords.length) tb.append(el(`<tr><td colspan="5">No keyword data yet.</td></tr>`));
  for (const k of keywords) {
    tb.append(el(`<tr>
      <td>${k.keyword ?? "—"}</td><td><span class="status ${k.match_type ?? ""}">${k.match_type ?? "—"}</span></td>
      <td>${n(k.clicks)}</td><td>${formatMoney(k.cost, currency)}</td><td>${n(k.conversions)}</td>
    </tr>`));
  }
  card.append(table);
  app.append(section("Top Keywords", card));
}

// ---- trend chart (leads by date) ------------------------------------------
function trendCard(rows) {
  const map = byDateTotals(rows);
  const dates = [...map.keys()].sort();
  const card = el(`<div class="card"><div class="chart-wrap"><canvas></canvas></div></div>`);
  queueMicrotask(() => drawLineChart(card.querySelector("canvas"), dates, dates.map((d) => map.get(d).conversions), "int", "USD"));
  return card;
}

function drawLineChart(cv, labels, data, kind, currency) {
  if (!window.Chart || !cv) return;
  const ctx = cv.getContext("2d");
  const grad = ctx.createLinearGradient(0, 0, 0, 260);
  grad.addColorStop(0, "rgba(22,104,227,.22)");
  grad.addColorStop(1, "rgba(22,104,227,0)");
  const isPct = kind === "pct";
  const series = isPct ? data.map((v) => v * 100) : data;
  return new Chart(cv, {
    type: "line",
    data: { labels: labels.map(fmtDate), datasets: [{
      data: series, borderColor: "#1668E3", backgroundColor: grad, fill: true, tension: .35,
      borderWidth: 2.5, pointRadius: 3, pointBackgroundColor: "#fff", pointBorderColor: "#1668E3", pointBorderWidth: 2, pointHoverRadius: 5,
    }] },
    options: {
      responsive: true, maintainAspectRatio: false,
      plugins: { legend: { display: false }, tooltip: { backgroundColor: "#0E2A4E", padding: 10, displayColors: false,
        callbacks: { label: (c) => isPct ? c.parsed.y.toFixed(1) + "%" : (kind === "money" ? formatMoney(c.parsed.y, currency) : n(c.parsed.y)) } } },
      scales: {
        x: { grid: { display: false }, ticks: { color: "#9aa7ba", maxRotation: 0, autoSkip: true, maxTicksLimit: 8, font: { family: "Inter", size: 11 } } },
        y: { beginAtZero: true, grid: { color: "#eef1f6" }, border: { display: false },
          ticks: { color: "#9aa7ba", font: { family: "Inter", size: 11 }, callback: (v) => isPct ? v + "%" : (kind === "money" ? formatMoney(v, currency) : v) } },
      },
    },
  });
}

// ---- history drawer (slide-over) ------------------------------------------
export function openDrawer(metricKey, allRows, currency) {
  const m = METRICS[metricKey];
  if (!m) return;
  const overlay = document.getElementById("overlay");
  const drawer = document.getElementById("drawer");

  const periodVal = (days) => fmtMetric(metricKey, m.agg(sumMetrics(lastNDays(allRows, days))), currency);
  const map = byDateTotals(allRows);
  const dates = [...map.keys()].sort();

  drawer.innerHTML = `
    <div class="dw-head">
      <div><div class="dw-kicker">Metric history</div><h2 class="dw-title">${m.label}</h2></div>
      <button class="dw-close" data-drawer-close aria-label="Close">✕</button>
    </div>
    <div class="dw-stats">
      <div class="dw-stat"><div class="dw-lab">Today</div><div class="dw-val">${periodVal(1)}</div></div>
      <div class="dw-stat"><div class="dw-lab">Last 7 days</div><div class="dw-val">${periodVal(7)}</div></div>
      <div class="dw-stat"><div class="dw-lab">Last 14 days</div><div class="dw-val">${periodVal(14)}</div></div>
    </div>
    <div class="dw-section">By day (last 30 days)</div>
    <div class="dw-chart"><canvas></canvas></div>
    <div class="dw-section">Daily breakdown</div>
    <div class="dw-table-wrap"><table class="dw-table"><thead><tr><th>Date</th><th>${m.label}</th></tr></thead><tbody>
      ${dates.slice().reverse().map((d) => `<tr><td>${fmtDate(d)}</td><td>${fmtMetric(metricKey, m.daily(map.get(d)), currency)}</td></tr>`).join("")}
    </tbody></table></div>`;

  overlay.hidden = false;
  drawer.hidden = false;
  requestAnimationFrame(() => { overlay.classList.add("show"); drawer.classList.add("open"); });
  queueMicrotask(() => drawLineChart(drawer.querySelector(".dw-chart canvas"), dates, dates.map((d) => m.daily(map.get(d))), m.kind, currency));
}

export function closeDrawer() {
  const overlay = document.getElementById("overlay");
  const drawer = document.getElementById("drawer");
  overlay.classList.remove("show");
  drawer.classList.remove("open");
  setTimeout(() => { overlay.hidden = true; drawer.hidden = true; drawer.innerHTML = ""; }, 240);
}
