/** /api/rr/* — Rank & Rent admin API (behind the same login as the rest of /api). */
import { Hono } from "hono";
import type { Env, RrSite } from "../types";
import { normDomain, splitList } from "../util";
import { DEFAULT_SETTINGS, ensureCities, getSettings, normPhone, randomSecret, sendTelegram } from "./common";
import { finalizeJobs, shortlist, startJob } from "./market";
import { runRrKeyword } from "./rank";
import { leadSnippet } from "./leads";
import { inspectKeyPages, syncGsc } from "./gsc";
import { formTests, sendDigest, twilioChecks, uptimeChecks } from "./monitor";
import { rrDaily } from "../cron";

const rr = new Hono<{ Bindings: Env }>();

const STATUSES = ["researching", "building", "ranking", "trial", "rented", "for_sale", "sold"];
const FIELDS = ["domain", "niche", "city_id", "country", "theme", "launch_date", "status", "tracking_phone", "twilio_number", "forward_to",
  "lead_destination", "tenant_name", "tenant_contact", "monthly_rent", "currency", "rent_paid_until", "domain_expiry", "gsc_property",
  "key_pages", "uptime_url", "form_test_url", "notes"] as const;

function cleanSite(b: any) {
  const o: Record<string, any> = {};
  for (const f of FIELDS) if (b[f] !== undefined) o[f] = b[f] === "" && ["city_id", "launch_date", "rent_paid_until", "domain_expiry"].includes(f) ? null : b[f];
  if (o.domain) o.domain = normDomain(o.domain);
  if (o.status && !STATUSES.includes(o.status)) delete o.status;
  if (o.city_id != null) o.city_id = Number(o.city_id) || null;
  if (o.monthly_rent != null) o.monthly_rent = Number(o.monthly_rent) || 0;
  if (o.twilio_number) o.twilio_number = normPhone(o.twilio_number, o.country || "AU");
  if (o.forward_to) o.forward_to = normPhone(o.forward_to, o.country || "AU");
  return o;
}

const month = () => new Date().toISOString().slice(0, 7);

// ---------- portfolio ----------
rr.get("/overview", async (c) => {
  const db = c.env.DB;
  const sites = (await db.prepare(
    `SELECT s.id, s.domain, s.niche, s.status, s.country, s.tenant_name, s.monthly_rent, s.currency, s.rent_paid_until, s.launch_date,
            c.name city, c.regional,
            (SELECT COUNT(*) FROM rr_leads l WHERE l.site_id=s.id AND l.status IN ('new','sent','qualified') AND strftime('%Y-%m', l.received_at)=?) leads_month,
            (SELECT COUNT(*) FROM rr_leads l WHERE l.site_id=s.id AND l.status IN ('new','sent','qualified') AND strftime('%Y-%m', l.received_at)=strftime('%Y-%m', date('now','start of month','-1 day'))) leads_prev,
            (SELECT ok FROM rr_checks k WHERE k.site_id=s.id AND k.kind='uptime') up,
            (SELECT COUNT(*) FROM rr_alerts a WHERE a.site_id=s.id AND a.resolved_at IS NULL) open_alerts
     FROM rr_sites s LEFT JOIN cities c ON c.id=s.city_id ORDER BY s.status, s.domain`
  ).bind(month()).all<any>()).results;
  const ranks = (await db.prepare(
    `SELECT k.site_id, h.position, h.map_pack FROM rr_rank_history h JOIN rr_keywords k ON k.id=h.keyword_id
     WHERE h.id IN (SELECT MAX(id) FROM rr_rank_history GROUP BY keyword_id)`
  ).all<{ site_id: number; position: number | null; map_pack: number | null }>()).results;
  for (const s of sites) {
    const r = ranks.filter((x) => x.site_id === s.id);
    const ranked = r.filter((x) => x.position);
    s.kw_count = r.length;
    s.avg_rank = ranked.length ? Math.round((ranked.reduce((a, x) => a + x.position!, 0) / ranked.length) * 10) / 10 : null;
    s.in_pack = r.filter((x) => x.map_pack).length;
  }
  const active = sites.filter((s) => s.status !== "sold");
  const allRanked = ranks.filter((x) => x.position && sites.some((s) => s.id === x.site_id && s.status !== "sold"));
  const mrr: Record<string, number> = {};
  for (const s of sites.filter((s) => s.status === "rented")) mrr[s.currency] = (mrr[s.currency] || 0) + (s.monthly_rent || 0);
  const monthly = (await db.prepare(
    `SELECT strftime('%Y-%m', received_at) m, kind, COUNT(*) n FROM rr_leads WHERE status IN ('new','sent','qualified') AND received_at > date('now','start of month','-11 months')
     GROUP BY m, kind ORDER BY m`
  ).all<{ m: string; kind: string; n: number }>()).results;
  return c.json({
    sites,
    totals: {
      sites: active.length,
      by_status: Object.fromEntries(STATUSES.map((st) => [st, sites.filter((s) => s.status === st).length])),
      mrr,
      leads_month: sites.reduce((a, s) => a + s.leads_month, 0),
      leads_prev: sites.reduce((a, s) => a + s.leads_prev, 0),
      avg_rank: allRanked.length ? Math.round((allRanked.reduce((a, x) => a + x.position!, 0) / allRanked.length) * 10) / 10 : null,
      occupancy: active.length ? Math.round((sites.filter((s) => s.status === "rented").length / active.length) * 100) : null,
      open_alerts: (await db.prepare(`SELECT COUNT(*) n FROM rr_alerts WHERE resolved_at IS NULL`).first<{ n: number }>())!.n,
    },
    monthly,
  });
});

rr.post("/sites", async (c) => {
  const b = cleanSite(await c.req.json());
  if (!b.domain || !b.niche) return c.json({ error: "Domain and niche are required." }, 400);
  b.lead_secret = randomSecret();
  const keys = Object.keys(b);
  const row = await c.env.DB.prepare(`INSERT INTO rr_sites(${keys.join(",")}) VALUES (${keys.map(() => "?").join(",")}) RETURNING id`)
    .bind(...keys.map((k) => b[k])).first<{ id: number }>();
  return c.json({ id: row!.id });
});

rr.put("/sites/:id", async (c) => {
  const b = cleanSite(await c.req.json());
  const keys = Object.keys(b);
  if (keys.length) await c.env.DB.prepare(`UPDATE rr_sites SET ${keys.map((k) => `${k}=?`).join(",")} WHERE id=?`).bind(...keys.map((k) => b[k]), c.req.param("id")).run();
  return c.json({ ok: true });
});

rr.delete("/sites/:id", async (c) => {
  await c.env.DB.prepare(`DELETE FROM rr_sites WHERE id=?`).bind(c.req.param("id")).run();
  return c.json({ ok: true });
});

rr.post("/sites/:id/rotate-secret", async (c) => {
  const secret = randomSecret();
  await c.env.DB.prepare(`UPDATE rr_sites SET lead_secret=? WHERE id=?`).bind(secret, c.req.param("id")).run();
  return c.json({ lead_secret: secret });
});

rr.get("/sites/:id", async (c) => {
  const db = c.env.DB;
  const id = c.req.param("id");
  const site = await db.prepare(`SELECT s.*, c.name city, c.region, c.population, c.location_code FROM rr_sites s LEFT JOIN cities c ON c.id=s.city_id WHERE s.id=?`).bind(id).first<any>();
  if (!site) return c.json({ error: "Site not found" }, 404);
  const kws = (await db.prepare(`SELECT * FROM rr_keywords WHERE site_id=? ORDER BY keyword`).bind(id).all<any>()).results;
  const hist = (await db.prepare(
    `SELECT h.* FROM rr_rank_history h JOIN rr_keywords k ON k.id=h.keyword_id WHERE k.site_id=? AND h.checked_at > datetime('now','-60 days') ORDER BY h.checked_at DESC`
  ).bind(id).all<any>()).results;
  const keywords = kws.map((k) => {
    const rows = hist.filter((h) => h.keyword_id === k.id);
    return { ...k, position: rows[0]?.position ?? null, map_pack: rows[0]?.map_pack ?? null, url: rows[0]?.url ?? null, checked_at: rows[0]?.checked_at ?? null,
      prev: rows[1] ? rows[1].position : undefined, spark: rows.slice(0, 30).reverse().map((r) => r.position) };
  });
  const leadsMonthly = (await db.prepare(
    `SELECT strftime('%Y-%m', received_at) m, kind, COUNT(*) n FROM rr_leads WHERE site_id=? AND status IN ('new','sent','qualified') AND received_at > date('now','start of month','-11 months') GROUP BY m, kind ORDER BY m`
  ).bind(id).all<any>()).results;
  const calls = await db.prepare(
    `SELECT COUNT(*) total, SUM(answered) answered, SUM(first_time) first_time, AVG(CASE WHEN answered=1 THEN duration END) avg_duration
     FROM rr_calls WHERE site_id=? AND started_at > datetime('now','-30 days')`
  ).bind(id).first<any>();
  const gsc = (await db.prepare(`SELECT * FROM rr_gsc_daily WHERE site_id=? AND date > date('now','-35 days') ORDER BY date`).bind(id).all<any>()).results;
  const top = (await db.prepare(`SELECT * FROM rr_gsc_top WHERE site_id=? ORDER BY clicks DESC, impressions DESC`).bind(id).all<any>()).results;
  const index = (await db.prepare(`SELECT * FROM rr_index_status WHERE site_id=? ORDER BY url`).bind(id).all<any>()).results;
  const checks = (await db.prepare(`SELECT * FROM rr_checks WHERE site_id=?`).bind(id).all<any>()).results;
  const alerts = (await db.prepare(`SELECT * FROM rr_alerts WHERE site_id=? ORDER BY created_at DESC LIMIT 30`).bind(id).all<any>()).results;
  const origin = new URL(c.req.url).origin;
  return c.json({
    site, keywords, leadsMonthly, calls, gsc, top_queries: top.filter((t) => t.kind === "query"), top_pages: top.filter((t) => t.kind === "page"),
    index, checks, alerts,
    integration: {
      lead_url: `${origin}/hooks/lead/${site.id}`,
      voice_url: `${origin}/hooks/twilio/voice`,
      status_url: `${origin}/hooks/twilio/status`,
      snippet: leadSnippet(origin, site as RrSite),
    },
  });
});

rr.post("/sites/:id/keywords", async (c) => {
  const { keywords } = await c.req.json<{ keywords: string }>();
  const list = [...new Set(String(keywords || "").split("\n").map((s) => s.trim().toLowerCase()).filter(Boolean))].slice(0, 100);
  if (!list.length) return c.json({ error: "Add at least one keyword." }, 400);
  await c.env.DB.batch(list.map((k) => c.env.DB.prepare(`INSERT OR IGNORE INTO rr_keywords(site_id, keyword) VALUES (?,?)`).bind(c.req.param("id"), k)));
  return c.json({ added: list.length });
});

rr.delete("/keywords/:kid", async (c) => {
  await c.env.DB.prepare(`DELETE FROM rr_keywords WHERE id=?`).bind(c.req.param("kid")).run();
  return c.json({ ok: true });
});

rr.post("/sites/:id/check", async (c) => {
  const site = await c.env.DB.prepare(`SELECT * FROM rr_sites WHERE id=?`).bind(c.req.param("id")).first<RrSite>();
  if (!site) return c.json({ error: "Site not found" }, 404);
  const kws = (await c.env.DB.prepare(`SELECT id, keyword FROM rr_keywords WHERE site_id=?`).bind(site.id).all<{ id: number; keyword: string }>()).results;
  const errors: string[] = [];
  for (const k of kws) { try { await runRrKeyword(c.env, site, k, "live"); } catch (e: any) { errors.push(e.message); } }
  await c.env.DB.prepare(`UPDATE rr_keywords SET next_run_at=datetime('now','+1 day') WHERE site_id=?`).bind(site.id).run();
  return c.json({ checked: kws.length, errors: errors.slice(0, 3) });
});

rr.post("/sites/:id/gsc", async (c) => {
  const site = await c.env.DB.prepare(`SELECT * FROM rr_sites WHERE id=?`).bind(c.req.param("id")).first<RrSite>();
  if (!site) return c.json({ error: "Site not found" }, 404);
  await syncGsc(c.env, site);
  const { inspect } = await c.req.json<{ inspect?: boolean }>().catch(() => ({ inspect: false }));
  if (inspect) await inspectKeyPages(c.env, site);
  return c.json({ ok: true });
});

rr.post("/sites/:id/form-test", async (c) => {
  // run the weekly test for this site only
  const id = Number(c.req.param("id"));
  const site = await c.env.DB.prepare(`SELECT * FROM rr_sites WHERE id=?`).bind(id).first<RrSite>();
  if (!site?.form_test_url) return c.json({ error: "Set a form test URL first." }, 400);
  const saved = site.status;
  if (!["ranking", "trial", "rented", "for_sale"].includes(saved)) return c.json({ error: "Form tests run on live sites (ranking, trial, rented, for sale)." }, 400);
  await formTests(c.env); // cheap: one POST per live site with a form URL
  return c.json({ ok: true });
});

// ---------- leads ----------
rr.get("/leads", async (c) => {
  const q = c.req.query();
  const where: string[] = [];
  const args: unknown[] = [];
  if (q.site_id) { where.push("l.site_id=?"); args.push(Number(q.site_id)); }
  if (q.status) { where.push("l.status=?"); args.push(q.status); }
  if (q.kind) { where.push("l.kind=?"); args.push(q.kind); }
  if (q.month) { where.push("strftime('%Y-%m', l.received_at)=?"); args.push(q.month); }
  const rows = (await c.env.DB.prepare(
    `SELECT l.*, s.domain, k.answered, k.duration, k.recording_url, k.first_time FROM rr_leads l JOIN rr_sites s ON s.id=l.site_id
     LEFT JOIN rr_calls k ON k.call_sid=l.call_sid ${where.length ? "WHERE " + where.join(" AND ") : ""} ORDER BY l.received_at DESC LIMIT 500`
  ).bind(...args).all<any>()).results;
  return c.json(rows);
});

rr.put("/leads/:id", async (c) => {
  const { status } = await c.req.json<{ status: string }>();
  if (!["new", "sent", "qualified", "spam", "duplicate"].includes(status)) return c.json({ error: "Invalid status" }, 400);
  await c.env.DB.prepare(`UPDATE rr_leads SET status=? WHERE id=?`).bind(status, c.req.param("id")).run();
  return c.json({ ok: true });
});

rr.delete("/leads/:id", async (c) => {
  await c.env.DB.prepare(`DELETE FROM rr_leads WHERE id=?`).bind(c.req.param("id")).run();
  return c.json({ ok: true });
});

rr.get("/leads/stats", async (c) => {
  const db = c.env.DB;
  const perSite = (await db.prepare(
    `SELECT s.domain, strftime('%Y-%m', l.received_at) m, SUM(CASE WHEN l.kind='form' THEN 1 ELSE 0 END) forms, SUM(CASE WHEN l.kind='call' THEN 1 ELSE 0 END) calls
     FROM rr_leads l JOIN rr_sites s ON s.id=l.site_id WHERE l.status IN ('new','sent','qualified') AND l.received_at > date('now','start of month','-11 months')
     GROUP BY s.domain, m ORDER BY m`
  ).all<any>()).results;
  const missed = (await db.prepare(
    `SELECT s.domain, COUNT(*) total, SUM(CASE WHEN k.answered=0 THEN 1 ELSE 0 END) missed FROM rr_calls k JOIN rr_sites s ON s.id=k.site_id
     WHERE k.started_at > datetime('now','-30 days') AND k.status != 'ringing' GROUP BY s.domain ORDER BY total DESC`
  ).all<any>()).results;
  const status = (await db.prepare(`SELECT status, COUNT(*) n FROM rr_leads WHERE received_at > datetime('now','-30 days') GROUP BY status`).all<any>()).results;
  return c.json({ perSite, missed, status });
});

// ---------- cities & market ----------
rr.get("/cities", async (c) => {
  await ensureCities(c.env);
  const cc = c.req.query("country");
  const rows = (await c.env.DB.prepare(`SELECT * FROM cities ${cc ? "WHERE country=?" : ""} ORDER BY country, population DESC`).bind(...(cc ? [cc] : [])).all<any>()).results;
  return c.json(rows);
});

rr.post("/cities", async (c) => {
  const b = await c.req.json<any>();
  if (!b.name || !b.region || !["AU", "NZ"].includes(b.country)) return c.json({ error: "Name, region and country (AU/NZ) are required." }, 400);
  await c.env.DB.prepare(`INSERT INTO cities(name, region, country, population, lat, lng, regional) VALUES (?,?,?,?,?,?,?)`)
    .bind(b.name, b.region, b.country, Number(b.population) || null, Number(b.lat) || null, Number(b.lng) || null, b.regional ? 1 : 0).run();
  return c.json({ ok: true });
});

rr.post("/market/jobs", async (c) => {
  const b = await c.req.json<{ name?: string; niches: string | string[]; city_ids: number[] }>();
  const niches = (Array.isArray(b.niches) ? b.niches : splitList(b.niches)).map((n) => n.trim()).filter(Boolean).slice(0, 30);
  const cityIds = (b.city_ids || []).map(Number).filter(Boolean).slice(0, 60);
  if (!niches.length || !cityIds.length) return c.json({ error: "Pick at least one niche and one city." }, 400);
  if (niches.length * cityIds.length > 400) return c.json({ error: "Keep it under 400 niche × city pairs per run." }, 400);
  const id = await startJob(c.env, b.name || "", niches, cityIds);
  return c.json({ id, pairs: niches.length * cityIds.length });
});

rr.get("/market/jobs", async (c) => {
  const rows = (await c.env.DB.prepare(
    `SELECT j.*, (SELECT COUNT(*) FROM market_research m WHERE m.job_id=j.id) pairs,
            (SELECT COUNT(*) FROM market_research m WHERE m.job_id=j.id AND m.serp_done=1 AND m.ads_done=1 AND m.vol_done=1) complete
     FROM market_jobs j ORDER BY j.created_at DESC LIMIT 50`
  ).all<any>()).results;
  return c.json(rows);
});

rr.get("/market/jobs/:id", async (c) => {
  await finalizeJobs(c.env).catch(() => {});
  const job = await c.env.DB.prepare(`SELECT * FROM market_jobs WHERE id=?`).bind(c.req.param("id")).first<any>();
  if (!job) return c.json({ error: "Not found" }, 404);
  const rows = (await c.env.DB.prepare(
    `SELECT m.*, c.name city, c.region, c.country, c.population, c.regional FROM market_research m JOIN cities c ON c.id=m.city_id WHERE m.job_id=? ORDER BY m.score DESC NULLS LAST, m.volume DESC`
  ).bind(job.id).all<any>()).results;
  return c.json({ job, rows: rows.map((r) => ({ ...r, top10: JSON.parse(r.top10 || "[]"), map_pack: JSON.parse(r.map_pack || "[]"), top3: JSON.parse(r.top3 || "[]") })) });
});

rr.delete("/market/jobs/:id", async (c) => {
  await c.env.DB.prepare(`DELETE FROM market_jobs WHERE id=?`).bind(c.req.param("id")).run();
  return c.json({ ok: true });
});

rr.post("/market/rows/:id/shortlist", async (c) => c.json({ site_id: await shortlist(c.env, Number(c.req.param("id"))) }));

// ---------- alerts & settings ----------
rr.get("/alerts", async (c) => {
  const open = c.req.query("open") === "1";
  const rows = (await c.env.DB.prepare(
    `SELECT a.*, s.domain FROM rr_alerts a LEFT JOIN rr_sites s ON s.id=a.site_id ${open ? "WHERE a.resolved_at IS NULL" : ""} ORDER BY a.created_at DESC LIMIT 200`
  ).all<any>()).results;
  return c.json(rows);
});

rr.post("/alerts/:id/resolve", async (c) => {
  await c.env.DB.prepare(`UPDATE rr_alerts SET resolved_at=datetime('now') WHERE id=?`).bind(c.req.param("id")).run();
  return c.json({ ok: true });
});

rr.post("/digest", async (c) => c.json(await sendDigest(c.env, true)));

/** Run the daily + weekly checks now (GSC, indexing, domain expiry, lead drop, rent, form tests, Twilio, uptime) without sending the digest. */
rr.post("/run-checks", async (c) => {
  await uptimeChecks(c.env);
  await twilioChecks(c.env);
  await rrDaily(c.env, true, false);
  const open = await c.env.DB.prepare(`SELECT COUNT(*) n FROM rr_alerts WHERE resolved_at IS NULL`).first<{ n: number }>();
  return c.json({ ok: true, open_alerts: open!.n });
});

rr.post("/telegram-test", async (c) => {
  try { return c.json({ ok: await sendTelegram(c.env, "Duy SEO: Telegram alerts are connected.") }); }
  catch (e: any) { return c.json({ error: e.message }, 400); }
});

rr.get("/settings", async (c) => {
  const s = await getSettings(c.env);
  const e = c.env;
  return c.json({
    settings: Object.fromEntries(Object.keys(DEFAULT_SETTINGS).map((k) => [k, s[k]])),
    twilio_last_balance: s.twilio_last_balance || null,
    integrations: {
      twilio: !!(e.TWILIO_ACCOUNT_SID && e.TWILIO_AUTH_TOKEN),
      gsc: !!e.GSC_SERVICE_ACCOUNT,
      gsc_email: (() => { try { return e.GSC_SERVICE_ACCOUNT ? JSON.parse(e.GSC_SERVICE_ACCOUNT).client_email : null; } catch { return "invalid JSON"; } })(),
      email: !!(e.RESEND_API_KEY && e.ALERT_EMAIL_TO),
      telegram: !!(e.TELEGRAM_BOT_TOKEN && e.TELEGRAM_CHAT_ID),
    },
  });
});

rr.put("/settings", async (c) => {
  const b = await c.req.json<Record<string, string>>();
  const stmts = Object.keys(DEFAULT_SETTINGS).filter((k) => b[k] !== undefined)
    .map((k) => c.env.DB.prepare(`INSERT OR REPLACE INTO rr_settings(key, value) VALUES (?,?)`).bind(k, String(b[k])));
  if (stmts.length) await c.env.DB.batch(stmts);
  return c.json({ ok: true });
});

export default rr;
