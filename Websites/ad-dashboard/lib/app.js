import { fetchAccounts, fetchCampaignMetrics, fetchKeywords, fetchInsights, fetchClickUpStatus, pushClickUpAlerts } from "./data.js";
import { renderOverview, renderClient, renderCampaign, openDrawer, openInsightDrawer, closeDrawer } from "./render.js";

function toast(msg, ok = true) {
  const t = document.createElement("div");
  t.className = "toast " + (ok ? "ok" : "err");
  t.textContent = msg;
  document.body.appendChild(t);
  requestAnimationFrame(() => t.classList.add("show"));
  setTimeout(() => { t.classList.remove("show"); setTimeout(() => t.remove(), 300); }, 4200);
}

async function handlePushClickUp(btn) {
  if (btn.disabled) return;
  const label = btn.querySelector(".cu-label") ?? btn; // section button has a label span; mini button is the button itself
  const original = label.textContent;
  const campaignId = btn.dataset.campaign || null;
  btn.disabled = true;
  label.textContent = "Sending…";
  try {
    const r = await pushClickUpAlerts(campaignId);
    const parts = [];
    if (r.created) parts.push(`${r.created} task${r.created === 1 ? "" : "s"} created`);
    if (r.skipped) parts.push(`${r.skipped} already open`);
    toast("ClickUp: " + (parts.join(" · ") || "nothing to send") + (r.assigned ? ` → ${r.assigned}` : ""), true);
    label.textContent = r.created ? "✓ Sent" : "✓ Already open";
    setTimeout(() => { label.textContent = original; btn.disabled = false; }, 3000);
  } catch (e) {
    toast("ClickUp push failed: " + (e.message ?? e), false);
    label.textContent = original;
    btn.disabled = false;
  }
}

const app = document.getElementById("app");
const crumbs = document.getElementById("crumbs");
const updatedEl = document.getElementById("updated");

const getRange = () => {
  const v = parseInt(new URLSearchParams(location.search).get("range"), 10);
  return v >= 1 && v <= 30 ? v : 30;
};

// Holds the current view's data + a re-render fn so range changes don't refetch.
let ctx = { rows: [], currency: "USD", render: () => {} };

function setRange(days) {
  const d = Math.max(1, Math.min(30, parseInt(days, 10) || 30));
  const p = new URLSearchParams(location.search);
  if (d === 30) p.delete("range"); else p.set("range", String(d));
  history.replaceState(null, "", location.pathname + (p.toString() ? "?" + p : "") + location.hash);
  ctx.render();
  stamp(ctx.rows);
}

function stamp(rows) {
  const max = rows.map((r) => r.updated_at).filter(Boolean).sort().at(-1);
  updatedEl.textContent = max ? "Updated " + new Date(max).toLocaleString() : "";
}

// Event delegation for range control, KPI-card history, and drawer close.
document.addEventListener("click", (e) => {
  const rb = e.target.closest("[data-range]");
  if (rb && app.contains(rb)) { setRange(rb.dataset.range); return; }
  const cu = e.target.closest("[data-clickup-push]");
  if (cu) { handlePushClickUp(cu); return; } // exists only on our buttons (in #app or the drawer)
  if (e.target.closest("[data-drawer-close]") || e.target.id === "overlay") { closeDrawer(); return; }
  // Let real links work (client cards, ClickUp links, "view campaign") without opening a drawer.
  const link = e.target.closest("a");
  if (link && (app.contains(link) || document.getElementById("drawer")?.contains(link))) return;
  const ins = e.target.closest("[data-insight]");
  if (ins && app.contains(ins)) { openInsightDrawer(ins.dataset.insight, { insights: ctx.insights, rows: ctx.rows, clickupTasks: ctx.clickupTasks }); return; }
  const mk = e.target.closest("[data-metric]");
  if (mk && app.contains(mk)) { openDrawer(mk.dataset.metric, ctx.rows, ctx.currency); return; }
});
document.addEventListener("change", (e) => {
  const ci = e.target.closest("[data-range-input]");
  if (ci && ci.value) setRange(ci.value);
});
document.addEventListener("keydown", (e) => {
  if (e.key === "Enter" && e.target.closest("[data-range-input]") && e.target.value) setRange(e.target.value);
  if (e.key === "Escape") closeDrawer();
});

async function route() {
  const p = new URLSearchParams(location.search);
  const client = p.get("client");
  const campaign = p.get("campaign");
  try {
    if (campaign) {
      const [accounts, rows, keywords] = await Promise.all([
        fetchAccounts(), fetchCampaignMetrics({ campaign_id: campaign }), fetchKeywords(campaign),
      ]);
      const acc = rows[0]?.account_id ?? "";
      const accName = accounts.find((a) => a.account_id === acc)?.account_name ?? "Client";
      ctx = {
        rows, currency: rows[0]?.currency_code ?? "USD",
        render() {
          crumbs.innerHTML = `<a href="./">Overview</a> › <a href="?client=${acc}">${accName}</a> › ${rows[0]?.campaign_name ?? campaign}`;
          renderCampaign(app, rows, keywords, getRange());
        },
      };
    } else if (client) {
      const [accounts, rows] = await Promise.all([fetchAccounts(), fetchCampaignMetrics({ account_id: client })]);
      const account = accounts.find((a) => a.account_id === client);
      ctx = {
        rows, currency: account?.currency_code ?? "USD",
        render() {
          crumbs.innerHTML = `<a href="./">Overview</a> › ${account?.account_name ?? client}`;
          renderClient(app, account, rows, getRange());
        },
      };
    } else {
      const [accounts, rows, insights, clickupTasks] = await Promise.all([
        fetchAccounts(), fetchCampaignMetrics(), fetchInsights(), fetchClickUpStatus(),
      ]);
      const accountsById = Object.fromEntries(accounts.map((a) => [a.account_id, a]));
      ctx = {
        rows, currency: "USD", insights, clickupTasks,
        render() {
          crumbs.textContent = "Overview";
          renderOverview(app, rows, accountsById, getRange(), insights, clickupTasks);
        },
      };
    }
    ctx.render();
    stamp(ctx.rows);
  } catch (e) {
    app.innerHTML = `<div class="loading">Could not load data: ${e.message ?? e}</div>`;
  }
}

route();
