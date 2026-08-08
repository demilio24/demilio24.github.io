import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { SUPABASE_URL, SUPABASE_ANON_KEY } from "../config.js";

const db = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

export async function fetchAccounts() {
  const { data, error } = await db.from("google_ads_accounts").select("*");
  if (error) throw error;
  return data ?? [];
}

export async function fetchCampaignMetrics(filter = {}) {
  let q = db.from("google_ads_campaign_metrics").select("*");
  if (filter.account_id) q = q.eq("account_id", filter.account_id);
  if (filter.campaign_id) q = q.eq("campaign_id", filter.campaign_id);
  const { data, error } = await q;
  if (error) throw error;
  return data ?? [];
}

export async function fetchKeywords(campaign_id) {
  const { data, error } = await db.from("google_ads_keyword_metrics")
    .select("*").eq("campaign_id", campaign_id)
    .order("clicks", { ascending: false }).limit(25);
  if (error) throw error;
  return data ?? [];
}

// Current [Ad Alert] tasks in ClickUp (open), so cards can show status + a link.
// Returns [] gracefully on any error.
export async function fetchClickUpStatus() {
  try {
    const res = await fetch(`${SUPABASE_URL}/functions/v1/clickup-alert-status`);
    const out = await res.json();
    return out.ok ? (out.tasks ?? []) : [];
  } catch {
    return [];
  }
}

// Manually push the current watch/bad campaigns to ClickUp as review tasks
// (idempotent — the edge function dedups to one open task per campaign).
export async function pushClickUpAlerts(campaignId = null) {
  const res = await fetch(`${SUPABASE_URL}/functions/v1/push-clickup-alerts`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(campaignId ? { campaign_id: campaignId } : {}),
  });
  const out = await res.json().catch(() => ({ ok: false, error: "bad response" }));
  if (!res.ok || !out.ok) throw new Error(out.error ?? `HTTP ${res.status}`);
  return out; // { created, skipped, campaigns, assigned }
}

// AI-generated per-campaign trend interpretations (written daily by the routine).
// Returns [] gracefully if the table doesn't exist yet.
export async function fetchInsights() {
  try {
    const { data, error } = await db.from("google_ads_insights")
      .select("*").order("sort", { ascending: true });
    if (error) return [];
    return data ?? [];
  } catch {
    return [];
  }
}
