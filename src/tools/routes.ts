/** /api/tools/* — research & utility tools. */
import { Hono } from "hono";
import type { Env } from "../types";
import { organicKeywords, topPages, contentGap, extractSitemap, bulkDomains } from "./competitive";
import { anchors, backlinkGap, backlinkList, backlinkOverview, referringDomains } from "./links";
import { bulkAutocomplete, bulkKeywordMetrics, semanticCluster } from "./keywords";
import { attachVolumes, bulkPaa, getSerp, searchLocations, serpClusterResult, serpSimilarity, startSerpCluster, type Loc } from "./serp";
import { addProperty, listProperties, removeProperty, report } from "./searchconsole";
import { addHost, deleteHost, listHosts, submit, verifyHost } from "./indexnow";

const t = new Hono<{ Bindings: Env }>();
const lines = (v: unknown) => (Array.isArray(v) ? v.map(String) : String(v || "").split(/\r?\n/)).map((s) => s.trim()).filter(Boolean);
const loc = (b: any): Loc => ({
  ...(b.city_name ? { location_name: String(b.city_name) } : b.location_name ? { location_name: String(b.location_name) } : { location_code: Number(b.location_code) || 2036 }),
  language_code: b.language_code || "en", device: b.device === "mobile" ? "mobile" : "desktop",
});
/** "keyword<TAB or comma>volume" lines → rows */
const kwRows = (v: unknown) => lines(v).map((l) => {
  const m = l.match(/^(.*?)[\t,;]\s*([\d.,]+)\s*$/);
  return m ? { keyword: m[1].trim().toLowerCase(), volume: Number(m[2].replace(/[,.]/g, "")) || 0 } : { keyword: l.toLowerCase() };
});

// ---- competitive research ----
t.post("/traffic/keywords", async (c) => {
  const b = await c.req.json<any>();
  if (!b.target) return c.json({ error: "Enter a domain or URL." }, 400);
  return c.json(await organicKeywords(c.env, { ...b, location_code: Number(b.location_code) || 2704, language_code: b.language_code || "en" }));
});
t.post("/traffic/pages", async (c) => {
  const b = await c.req.json<any>();
  return c.json(await topPages(c.env, b.target, Number(b.location_code) || 2704, b.language_code || "en", Number(b.offset) || 0));
});
t.post("/content-gap", async (c) => {
  const b = await c.req.json<any>();
  if (!b.you || !lines(b.competitors).length) return c.json({ error: "Enter your domain and at least one competitor." }, 400);
  return c.json(await contentGap(c.env, b.you, lines(b.competitors), Number(b.location_code) || 2704, b.language_code || "en", Number(b.max_pos) || 20));
});
t.post("/sitemap", async (c) => {
  const b = await c.req.json<any>();
  if (!b.url) return c.json({ error: "Enter a domain or sitemap URL." }, 400);
  return c.json(await extractSitemap(b.url));
});
t.post("/bulk-domains", async (c) => {
  const b = await c.req.json<any>();
  const list = lines(b.targets);
  if (!list.length) return c.json({ error: "Paste at least one domain or URL." }, 400);
  return c.json(await bulkDomains(c.env, list, Number(b.location_code) || 2704, b.language_code || "en"));
});

// ---- link building ----
t.post("/backlinks/overview", async (c) => c.json(await backlinkOverview(c.env, (await c.req.json<any>()).target)));
t.post("/backlinks/list", async (c) => { const b = await c.req.json<any>(); return c.json(await backlinkList(c.env, b.target, b.mode, Number(b.offset) || 0, !!b.dofollow)); });
t.post("/backlinks/domains", async (c) => { const b = await c.req.json<any>(); return c.json(await referringDomains(c.env, b.target, Number(b.offset) || 0)); });
t.post("/backlinks/anchors", async (c) => c.json(await anchors(c.env, (await c.req.json<any>()).target)));
t.post("/backlinks/gap", async (c) => {
  const b = await c.req.json<any>();
  if (!b.you) return c.json({ error: "Enter your domain." }, 400);
  return c.json(await backlinkGap(c.env, b.you, lines(b.competitors), Number(b.min_shared) || 1));
});

// ---- keyword research ----
t.post("/bulk-keywords", async (c) => {
  const b = await c.req.json<any>();
  const list = lines(b.keywords);
  if (!list.length) return c.json({ error: "Paste at least one keyword." }, 400);
  return c.json(await bulkKeywordMetrics(c.env, list, Number(b.location_code) || 2036, b.language_code || "en", Number(b.city_code) || undefined));
});
t.post("/autocomplete", async (c) => {
  const b = await c.req.json<any>();
  const seeds = lines(b.seeds);
  if (!seeds.length) return c.json({ error: "Enter at least one seed keyword." }, 400);
  return c.json(await bulkAutocomplete(c.env, seeds, b.engine || "google", b.hl || "en", b.gl || "us", b.expand || "alphabet"));
});
t.post("/semantic", async (c) => {
  const b = await c.req.json<any>();
  const rows = kwRows(b.keywords);
  if (rows.length < 2) return c.json({ error: "Paste at least two keywords." }, 400);
  return c.json(await semanticCluster(c.env, rows, Math.min(0.95, Math.max(0.5, Number(b.threshold) || 0.8))));
});

// ---- SERP research ----
t.post("/serp-similarity", async (c) => {
  const b = await c.req.json<any>();
  const kws = lines(b.keywords).slice(0, 6);
  if (kws.length < 2) return c.json({ error: "Enter 2 to 6 keywords." }, 400);
  return c.json(await serpSimilarity(c.env, kws, loc(b)));
});
t.post("/serp-cluster", async (c) => {
  const b = await c.req.json<any>();
  const rows = kwRows(b.keywords).slice(0, 1000);
  if (rows.length < 2) return c.json({ error: "Paste at least two keywords." }, 400);
  const r = await startSerpCluster(c.env, b.name || "", rows.map((x) => x.keyword), loc(b), Number(b.reuse_days) || 14);
  const vols = Object.fromEntries(rows.filter((x: any) => x.volume != null).map((x: any) => [x.keyword, x.volume]));
  if (Object.keys(vols).length) await attachVolumes(c.env, r.id, vols);
  return c.json(r);
});
t.get("/serp-cluster", async (c) => {
  const { results } = await c.env.DB.prepare(`SELECT id, name, status, created_at, params FROM tool_jobs WHERE kind='serp_cluster' ORDER BY created_at DESC LIMIT 30`).all<any>();
  return c.json(results.map((j) => ({ id: j.id, name: j.name, status: j.status, created_at: j.created_at, keywords: JSON.parse(j.params).keywords.length })));
});
t.get("/serp-cluster/:id", async (c) =>
  c.json(await serpClusterResult(c.env, Number(c.req.param("id")), Math.min(7, Math.max(2, Number(c.req.query("threshold")) || 4)), (c.req.query("algo") as any) || "default")));
t.delete("/serp-cluster/:id", async (c) => { await c.env.DB.prepare(`DELETE FROM tool_jobs WHERE id=?`).bind(c.req.param("id")).run(); return c.json({ ok: true }); });
t.post("/paa", async (c) => {
  const b = await c.req.json<any>();
  const kws = lines(b.keywords).slice(0, 50);
  if (!kws.length) return c.json({ error: "Enter at least one keyword." }, 400);
  return c.json(await bulkPaa(c.env, kws, loc(b), Number(b.depth) || 2));
});
t.get("/locations", async (c) => c.json(await searchLocations(c.env, c.req.query("country") || "au", c.req.query("q") || "")));
t.post("/serp-preview", async (c) => {
  const b = await c.req.json<any>();
  if (!b.keyword) return c.json({ error: "Enter a keyword." }, 400);
  return c.json(await getSerp(c.env, String(b.keyword).trim(), loc(b), 1));
});

// ---- Search Console ----
t.get("/gsc/sites", async (c) => c.json(await listProperties(c.env)));
t.post("/gsc/sites", async (c) => { const b = await c.req.json<any>(); return c.json(await addProperty(c.env, b.property, b.label, b.project_id)); });
t.delete("/gsc/sites", async (c) => { await removeProperty(c.env, c.req.query("property") || ""); return c.json({ ok: true }); });
t.post("/gsc/report", async (c) => {
  const b = await c.req.json<any>();
  return c.json(await report(c.env, b.property, Math.min(480, Number(b.days) || 28), b.dimension || "query", b.filter, b.type || "web"));
});

// ---- IndexNow ----
t.get("/indexnow", async (c) => c.json(await listHosts(c.env)));
t.post("/indexnow/hosts", async (c) => c.json(await addHost(c.env, (await c.req.json<any>()).host)));
t.post("/indexnow/verify", async (c) => c.json(await verifyHost(c.env, (await c.req.json<any>()).host)));
t.delete("/indexnow/hosts", async (c) => { await deleteHost(c.env, c.req.query("host") || ""); return c.json({ ok: true }); });
t.post("/indexnow/submit", async (c) => {
  const urls = lines((await c.req.json<any>()).urls);
  if (!urls.length) return c.json({ error: "Paste at least one URL." }, 400);
  return c.json(await submit(c.env, urls));
});

export default t;
