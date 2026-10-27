/** Google Search Console via one service account (add its email as a user on every property). */
import type { Env, RrSite } from "../types";
import { raiseAlert, resolveAlert } from "./common";

let cached: { token: string; exp: number } | null = null;

const b64url = (buf: ArrayBuffer | Uint8Array | string) => {
  const bytes = typeof buf === "string" ? new TextEncoder().encode(buf) : new Uint8Array(buf as ArrayBuffer);
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/=+$/, "").replace(/\+/g, "-").replace(/\//g, "_");
};

async function accessToken(env: Env): Promise<string> {
  if (!env.GSC_SERVICE_ACCOUNT) throw new Error("GSC_SERVICE_ACCOUNT secret is not set.");
  if (cached && cached.exp > Date.now() + 60_000) return cached.token;
  const sa = JSON.parse(env.GSC_SERVICE_ACCOUNT);
  const now = Math.floor(Date.now() / 1000);
  const header = b64url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const claim = b64url(JSON.stringify({
    iss: sa.client_email, scope: "https://www.googleapis.com/auth/webmasters.readonly",
    aud: "https://oauth2.googleapis.com/token", iat: now, exp: now + 3600,
  }));
  const pem = String(sa.private_key).replace(/-----[^-]+-----/g, "").replace(/\s+/g, "");
  const der = Uint8Array.from(atob(pem), (ch) => ch.charCodeAt(0));
  const key = await crypto.subtle.importKey("pkcs8", der, { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, ["sign"]);
  const sig = await crypto.subtle.sign("RSASSA-PKCS1-v1_5", key, new TextEncoder().encode(`${header}.${claim}`));
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer", assertion: `${header}.${claim}.${b64url(sig)}` }),
  });
  const json: any = await res.json();
  if (!json.access_token) throw new Error(`Google auth failed: ${json.error_description || json.error || res.status}`);
  cached = { token: json.access_token, exp: Date.now() + json.expires_in * 1000 };
  return cached.token;
}

/** Call a Google API with the service-account token (POST with body, or GET when body is undefined). */
export async function googleApi(env: Env, url: string, body?: unknown) {
  const res = await fetch(env.GSC_API_BASE ? url.replace(/^https:\/\/[^/]+/, env.GSC_API_BASE) : url, {
    method: body === undefined ? "GET" : "POST",
    headers: { Authorization: `Bearer ${env.GSC_API_BASE ? "test" : await accessToken(env)}`, "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const json: any = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(json.error?.message || `Google API ${res.status}`);
  return json;
}
const gapi = googleApi;

const day = (offset: number) => new Date(Date.now() - offset * 864e5).toISOString().slice(0, 10);
const prop = (s: RrSite) => s.gsc_property || `sc-domain:${s.domain}`;
const sa = (s: RrSite) => `https://www.googleapis.com/webmasters/v3/sites/${encodeURIComponent(prop(s))}/searchAnalytics/query`;

/** Daily metrics (last 35 days on first run, then last 7) + 28-day top queries/pages. */
export async function syncGsc(env: Env, site: RrSite) {
  try {
    const have = await env.DB.prepare(`SELECT COUNT(*) n FROM rr_gsc_daily WHERE site_id=?`).bind(site.id).first<{ n: number }>();
    const daily = await gapi(env, sa(site), { startDate: day(have!.n ? 7 : 35), endDate: day(1), dimensions: ["date"], rowLimit: 100 });
    const stmts = (daily.rows || []).map((r: any) =>
      env.DB.prepare(`INSERT OR REPLACE INTO rr_gsc_daily(site_id, date, clicks, impressions, ctr, position) VALUES (?,?,?,?,?,?)`)
        .bind(site.id, r.keys[0], r.clicks, r.impressions, r.ctr, r.position));
    const range = { startDate: day(29), endDate: day(1), rowLimit: 50 };
    const [q, p] = await Promise.all([
      gapi(env, sa(site), { ...range, dimensions: ["query"] }),
      gapi(env, sa(site), { ...range, dimensions: ["page"] }),
    ]);
    stmts.push(env.DB.prepare(`DELETE FROM rr_gsc_top WHERE site_id=?`).bind(site.id));
    for (const [kind, data] of [["query", q], ["page", p]] as const)
      for (const r of data.rows || [])
        stmts.push(env.DB.prepare(`INSERT OR REPLACE INTO rr_gsc_top(site_id, kind, key, clicks, impressions, ctr, position) VALUES (?,?,?,?,?,?,?)`)
          .bind(site.id, kind, r.keys[0], r.clicks, r.impressions, r.ctr, r.position));
    await env.DB.batch(stmts);
    await setCheck(env, site.id, true, "Synced");
    await resolveAlert(env, `gsc:${site.id}`);
  } catch (e: any) {
    await setCheck(env, site.id, false, e.message);
    await raiseAlert(env, { site_id: site.id, kind: "gsc", severity: "info", key: `gsc:${site.id}`, message: `${site.domain}: Search Console sync failed — ${e.message}` });
    throw e;
  }
}

/** URL Inspection for the site's key pages (2,000/day/property quota — weekly is plenty). */
export async function inspectKeyPages(env: Env, site: RrSite) {
  const urls = site.key_pages.split(/\s+/).map((u) => u.trim()).filter((u) => u.startsWith("http")).slice(0, 30);
  if (!urls.length) urls.push(`https://${site.domain}/`);
  for (const url of urls) {
    try {
      const r = await gapi(env, "https://searchconsole.googleapis.com/v1/urlInspection/index:inspect", { inspectionUrl: url, siteUrl: prop(site) });
      const s = r.inspectionResult?.indexStatusResult || {};
      await env.DB.prepare(`INSERT OR REPLACE INTO rr_index_status(site_id, url, verdict, coverage, last_crawl, checked_at) VALUES (?,?,?,?,?,datetime('now'))`)
        .bind(site.id, url, s.verdict || null, s.coverageState || null, s.lastCrawlTime || null).run();
    } catch (e: any) {
      await env.DB.prepare(`INSERT OR REPLACE INTO rr_index_status(site_id, url, verdict, coverage, checked_at) VALUES (?,?,'ERROR',?,datetime('now'))`)
        .bind(site.id, url, e.message.slice(0, 200)).run();
    }
  }
}

async function setCheck(env: Env, siteId: number, ok: boolean, detail: string) {
  await env.DB.prepare(
    `INSERT INTO rr_checks(site_id, kind, ok, fails, detail, checked_at, last_ok_at) VALUES (?, 'gsc', ?, ?, ?, datetime('now'), CASE WHEN ? THEN datetime('now') END)
     ON CONFLICT(site_id, kind) DO UPDATE SET ok=excluded.ok, fails=CASE WHEN excluded.ok THEN 0 ELSE fails+1 END, detail=excluded.detail,
       checked_at=excluded.checked_at, last_ok_at=COALESCE(excluded.last_ok_at, last_ok_at)`
  ).bind(siteId, ok ? 1 : 0, ok ? 0 : 1, detail.slice(0, 300), ok ? 1 : 0).run();
}
