/** Google Search Console for any property the service account can see (client sites, own sites). */
import type { Env } from "../types";
import { googleApi } from "../rr/gsc";

const SA = (p: string) => `https://www.googleapis.com/webmasters/v3/sites/${encodeURIComponent(p)}/searchAnalytics/query`;
const day = (offset: number) => new Date(Date.now() - offset * 864e5).toISOString().slice(0, 10);

export async function listProperties(env: Env) {
  const [res, saved] = await Promise.all([
    googleApi(env, "https://www.googleapis.com/webmasters/v3/sites").catch((e) => ({ error: e.message })),
    env.DB.prepare(`SELECT * FROM gsc_sites ORDER BY label, property`).all<any>(),
  ]);
  const visible = ((res as any).siteEntry || []).map((s: any) => ({ property: s.siteUrl, permission: s.permissionLevel }));
  return { visible, saved: saved.results, error: (res as any).error || null };
}

export async function addProperty(env: Env, property: string, label: string, projectId?: number) {
  const p = property.trim();
  if (!/^sc-domain:|^https?:\/\//.test(p)) throw new Error("Use sc-domain:example.com or a URL-prefix property like https://example.com/");
  // verify access with a tiny query
  await googleApi(env, SA(p), { startDate: day(8), endDate: day(2), rowLimit: 1 });
  await env.DB.prepare(`INSERT OR REPLACE INTO gsc_sites(property, label, project_id) VALUES (?,?,?)`).bind(p, label || p.replace(/^sc-domain:|^https?:\/\//, "").replace(/\/$/, ""), projectId || null).run();
  return { ok: true };
}

export async function removeProperty(env: Env, property: string) {
  await env.DB.prepare(`DELETE FROM gsc_sites WHERE property=?`).bind(property).run();
}

/** Performance report: totals vs previous period, daily series, rows for one dimension. */
export async function report(env: Env, property: string, days: number, dimension: string, filter?: { dim: string; op: string; value: string }, type = "web") {
  // GSC data lags ~2 days
  const end = 2, start = days + 1;
  const range = { startDate: day(start), endDate: day(end) };
  const prev = { startDate: day(start + days), endDate: day(end + days) };
  const dimensionFilterGroups = filter?.value ? [{ filters: [{ dimension: filter.dim, operator: filter.op || "contains", expression: filter.value }] }] : undefined;
  const base = { type, dimensionFilterGroups, dataState: "final" };
  const [totNow, totPrev, daily, rows, rowsPrev] = await Promise.all([
    googleApi(env, SA(property), { ...range, ...base }),
    googleApi(env, SA(property), { ...prev, ...base }),
    googleApi(env, SA(property), { ...range, ...base, dimensions: ["date"], rowLimit: 500 }),
    googleApi(env, SA(property), { ...range, ...base, dimensions: [dimension], rowLimit: 500 }),
    googleApi(env, SA(property), { ...prev, ...base, dimensions: [dimension], rowLimit: 1000 }),
  ]);
  const t = (r: any) => r.rows?.[0] || { clicks: 0, impressions: 0, ctr: 0, position: 0 };
  const prevMap = new Map<string, any>((rowsPrev.rows || []).map((r: any) => [r.keys[0], r]));
  return {
    range, prev,
    totals: { now: t(totNow), prev: t(totPrev) },
    daily: (daily.rows || []).map((r: any) => ({ d: r.keys[0], clicks: r.clicks, impressions: r.impressions, ctr: r.ctr, position: r.position })),
    rows: (rows.rows || []).map((r: any) => {
      const p = prevMap.get(r.keys[0]);
      return { key: r.keys[0], clicks: r.clicks, impressions: r.impressions, ctr: r.ctr, position: r.position, d_clicks: p ? r.clicks - p.clicks : null, d_position: p ? p.position - r.position : null };
    }),
  };
}
