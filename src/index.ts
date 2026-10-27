import { Hono } from "hono";
import type { Env, Keyword, Project } from "./types";
import { login, logout, requireAuth } from "./auth";
import { Dfs } from "./dfs";
import { normDomain, splitList, sqlDate } from "./util";
import { quickCheck, runKeyword } from "./modules/rank";
import { aiMentionsIndex, runPrompt, type PromptRow } from "./modules/ai";
import { findBusiness, runGrid, type GridRow } from "./modules/local";
import { pollAudit, startAudit } from "./modules/audit";
import { domainOverview, keywordOverview, keywordResearch } from "./modules/research";
import { collectPending, scheduled } from "./cron";
import rrRoutes from "./rr/routes";
import toolRoutes from "./tools/routes";
import { ingestLead, twilioDial, twilioRecording, twilioStatus, twilioVoice } from "./rr/leads";

type C = { Bindings: Env };
const app = new Hono<C>();

app.onError((err, c) => {
  console.error(err);
  return c.json({ error: err.message || "Server error" }, 500);
});

// Public webhooks (each verifies its own signature)
app.post("/hooks/lead/:siteId", ingestLead);
app.post("/hooks/twilio/voice", twilioVoice);
app.post("/hooks/twilio/dial", twilioDial);
app.post("/hooks/twilio/status", twilioStatus);
app.post("/hooks/twilio/recording", twilioRecording);
app.all("/hooks/*", (c) => c.json({ error: "Not found" }, 404));

app.post("/api/login", login);
app.post("/api/logout", logout);
app.use("/api/*", requireAuth);
app.get("/api/me", (c) => c.json({ ok: true, mode: c.env.DFS_MODE || "standard", sandbox: c.env.DFS_SANDBOX === "1" }));
app.route("/api/rr", rrRoutes);
app.route("/api/tools", toolRoutes);

const mode = (c: { env: Env }) => (c.env.DFS_MODE === "live" ? "live" : "standard") as "live" | "standard";
const CTR = [0, 0.28, 0.15, 0.11, 0.08, 0.07, 0.05, 0.04, 0.03, 0.03, 0.025];
const ctr = (p: number | null) => (!p ? 0 : p <= 10 ? CTR[p] : p <= 20 ? 0.01 : 0);

async function getProject(env: Env, id: string | number) {
  const p = await env.DB.prepare(`SELECT * FROM projects WHERE id=?`).bind(id).first<Project>();
  if (!p) throw new Error("Project not found");
  return p;
}

// ---------- Projects ----------
app.get("/api/projects", async (c) => {
  const { results: projects } = await c.env.DB.prepare(`SELECT * FROM projects ORDER BY name`).all<Project>();
  const { results: latest } = await c.env.DB.prepare(
    `SELECT k.project_id, r.engine, r.position, r.cited FROM rank_history r JOIN keywords k ON k.id = r.keyword_id
     WHERE r.id IN (SELECT MAX(id) FROM rank_history GROUP BY keyword_id, engine)`
  ).all<{ project_id: number; engine: string; position: number | null; cited: number }>();
  const { results: counts } = await c.env.DB.prepare(
    `SELECT project_id, COUNT(*) n FROM keywords GROUP BY project_id`
  ).all<{ project_id: number; n: number }>();
  const { results: ai } = await c.env.DB.prepare(
    `SELECT a.project_id, r.brand_mentioned, r.domain_cited FROM ai_results r JOIN ai_prompts a ON a.id = r.prompt_id
     WHERE r.id IN (SELECT MAX(id) FROM ai_results GROUP BY prompt_id, platform)`
  ).all<{ project_id: number; brand_mentioned: number; domain_cited: number }>();
  return c.json(
    projects.map((p) => {
      const g = latest.filter((r) => r.project_id === p.id && r.engine === "google");
      const ranked = g.filter((r) => r.position);
      const aio = latest.filter((r) => r.project_id === p.id && (r.engine === "ai_overview" || r.engine === "ai_mode"));
      const aiP = ai.filter((r) => r.project_id === p.id);
      const n = counts.find((x) => x.project_id === p.id)?.n || 0;
      return {
        ...p,
        keyword_count: n,
        avg_position: ranked.length ? Math.round((ranked.reduce((s, r) => s + r.position!, 0) / ranked.length) * 10) / 10 : null,
        top3: g.filter((r) => r.position && r.position <= 3).length,
        top10: g.filter((r) => r.position && r.position <= 10).length,
        visibility: g.length ? Math.round((g.reduce((s, r) => s + ctr(r.position), 0) / (g.length * CTR[1])) * 1000) / 10 : null,
        ai_cited: aio.length ? Math.round((aio.filter((r) => r.cited).length / aio.length) * 100) : null,
        ai_mentioned: aiP.length ? Math.round((aiP.filter((r) => r.brand_mentioned || r.domain_cited).length / aiP.length) * 100) : null,
      };
    })
  );
});

const PROJECT_FIELDS = ["name", "domain", "brand_names", "competitors", "location_code", "language_code", "device", "depth", "frequency", "business_name", "place_cid", "notes"] as const;

function cleanProject(body: any) {
  const out: Record<string, unknown> = {};
  for (const f of PROJECT_FIELDS) if (body[f] !== undefined) out[f] = body[f];
  if (out.domain) out.domain = normDomain(String(out.domain));
  if (out.competitors) out.competitors = splitList(String(out.competitors)).map(normDomain).join(", ");
  if (out.location_code) out.location_code = Number(out.location_code);
  if (out.depth) out.depth = Math.min(100, Math.max(10, Number(out.depth)));
  return out;
}

app.post("/api/projects", async (c) => {
  const b = cleanProject(await c.req.json());
  if (!b.name || !b.domain) return c.json({ error: "Name and domain are required." }, 400);
  const keys = Object.keys(b);
  const row = await c.env.DB.prepare(`INSERT INTO projects(${keys.join(",")}) VALUES (${keys.map(() => "?").join(",")}) RETURNING id`)
    .bind(...keys.map((k) => b[k] as any))
    .first<{ id: number }>();
  return c.json({ id: row!.id });
});

app.get("/api/projects/:id", async (c) => c.json(await getProject(c.env, c.req.param("id"))));

app.put("/api/projects/:id", async (c) => {
  const b = cleanProject(await c.req.json());
  const keys = Object.keys(b);
  if (!keys.length) return c.json({ ok: true });
  await c.env.DB.prepare(`UPDATE projects SET ${keys.map((k) => `${k}=?`).join(",")} WHERE id=?`)
    .bind(...keys.map((k) => b[k] as any), c.req.param("id"))
    .run();
  return c.json({ ok: true });
});

app.delete("/api/projects/:id", async (c) => {
  await c.env.DB.prepare(`DELETE FROM projects WHERE id=?`).bind(c.req.param("id")).run();
  return c.json({ ok: true });
});

/** Daily trend: visibility, avg position, AI citation rates (last N days). */
app.get("/api/projects/:id/overview", async (c) => {
  const days = Math.min(Number(c.req.query("days") || 90), 365);
  const { results } = await c.env.DB.prepare(
    `SELECT r.keyword_id, r.engine, r.position, r.cited, date(r.checked_at) d FROM rank_history r
     JOIN keywords k ON k.id = r.keyword_id WHERE k.project_id = ? AND r.checked_at > datetime('now', ?)
     ORDER BY r.checked_at`
  ).bind(c.req.param("id"), `-${days} days`).all<{ keyword_id: number; engine: string; position: number | null; cited: number; d: string }>();
  // carry forward the latest value per keyword+engine through each day
  const dates = [...new Set(results.map((r) => r.d))].sort();
  const state = new Map<string, { engine: string; position: number | null; cited: number }>();
  let i = 0;
  const series = dates.map((d) => {
    while (i < results.length && results[i].d <= d) {
      const r = results[i++];
      state.set(`${r.keyword_id}:${r.engine}`, r);
    }
    const all = [...state.values()];
    const g = all.filter((s) => s.engine === "google");
    const ranked = g.filter((s) => s.position);
    const ai = all.filter((s) => s.engine === "ai_overview" || s.engine === "ai_mode");
    return {
      d,
      visibility: g.length ? Math.round((g.reduce((s, r) => s + ctr(r.position), 0) / (g.length * CTR[1])) * 1000) / 10 : null,
      avg: ranked.length ? Math.round((ranked.reduce((s, r) => s + r.position!, 0) / ranked.length) * 10) / 10 : null,
      top3: g.filter((s) => s.position && s.position <= 3).length,
      top10: g.filter((s) => s.position && s.position <= 10).length,
      top100: ranked.length,
      ai_cited: ai.length ? Math.round((ai.filter((s) => s.cited).length / ai.length) * 100) : null,
    };
  });
  const pending = await c.env.DB.prepare(
    `SELECT COUNT(*) n FROM pending_tasks WHERE json_extract(ref,'$.project_id') = ?`
  ).bind(Number(c.req.param("id"))).first<{ n: number }>();
  return c.json({ series, pending: pending?.n || 0 });
});

// ---------- Keywords / rankings ----------
app.get("/api/projects/:id/keywords", async (c) => {
  const pid = c.req.param("id");
  const { results: kws } = await c.env.DB.prepare(`SELECT * FROM keywords WHERE project_id=? ORDER BY keyword`).bind(pid).all<Keyword & { search_volume: number | null }>();
  const { results: hist } = await c.env.DB.prepare(
    `SELECT r.keyword_id, r.engine, r.position, r.cited, r.present, r.url, r.features, r.checked_at FROM rank_history r
     JOIN keywords k ON k.id=r.keyword_id WHERE k.project_id=? AND r.checked_at > datetime('now','-35 days')
     ORDER BY r.checked_at DESC`
  ).bind(pid).all<any>();
  const weekAgo = sqlDate(new Date(Date.now() - 7 * 864e5));
  const by = new Map<string, any[]>();
  for (const h of hist) {
    const k = `${h.keyword_id}:${h.engine}`;
    if (!by.has(k)) by.set(k, []);
    by.get(k)!.push(h);
  }
  return c.json(
    kws.map((k) => {
      const engines: Record<string, unknown> = {};
      for (const e of splitList(k.engines)) {
        const rows = by.get(`${k.id}:${e}`) || [];
        const cur = rows[0];
        const prev = rows[1];
        const week = rows.find((r) => r.checked_at <= weekAgo);
        const positions = rows.map((r) => r.position).filter(Boolean);
        engines[e] = cur
          ? {
              position: cur.position, cited: cur.cited, present: cur.present, url: cur.url, checked_at: cur.checked_at,
              features: cur.features ? JSON.parse(cur.features) : null,
              prev: prev ? prev.position : undefined, week: week ? week.position : undefined,
              best: positions.length ? Math.min(...positions) : null,
              spark: rows.slice(0, 30).reverse().map((r) => r.position),
            }
          : null;
      }
      return { ...k, data: engines };
    })
  );
});

app.post("/api/projects/:id/keywords", async (c) => {
  const pid = c.req.param("id");
  const { keywords, engines, tags } = await c.req.json<{ keywords: string; engines?: string; tags?: string }>();
  const list = [...new Set(String(keywords || "").split("\n").map((s) => s.trim().toLowerCase()).filter(Boolean))].slice(0, 500);
  if (!list.length) return c.json({ error: "Add at least one keyword." }, 400);
  const eng = engines || "google,ai_overview";
  await c.env.DB.batch(
    list.map((k) =>
      c.env.DB.prepare(`INSERT OR IGNORE INTO keywords(project_id, keyword, engines, tags) VALUES (?,?,?,?)`).bind(pid, k, eng, tags || "")
    )
  );
  // fetch search volumes in the background (one Labs call)
  const p = await getProject(c.env, pid);
  c.executionCtx.waitUntil(
    (async () => {
      try {
        const rows = await keywordOverview(c.env, list, p.location_code, p.language_code);
        await c.env.DB.batch(rows.filter((r: any) => r.volume != null).map((r: any) =>
          c.env.DB.prepare(`UPDATE keywords SET search_volume=? WHERE project_id=? AND keyword=?`).bind(r.volume, pid, r.keyword)));
      } catch (e) { console.error("volume", e); }
    })()
  );
  return c.json({ added: list.length });
});

app.put("/api/keywords/:kid", async (c) => {
  const { engines, tags } = await c.req.json<{ engines?: string; tags?: string }>();
  await c.env.DB.prepare(`UPDATE keywords SET engines=COALESCE(?,engines), tags=COALESCE(?,tags) WHERE id=?`)
    .bind(engines ?? null, tags ?? null, c.req.param("kid")).run();
  return c.json({ ok: true });
});

app.delete("/api/keywords/:kid", async (c) => {
  await c.env.DB.prepare(`DELETE FROM keywords WHERE id=?`).bind(c.req.param("kid")).run();
  return c.json({ ok: true });
});

app.post("/api/keywords/:kid/check", async (c) => {
  const kw = await c.env.DB.prepare(`SELECT * FROM keywords WHERE id=?`).bind(c.req.param("kid")).first<Keyword>();
  if (!kw) return c.json({ error: "Keyword not found" }, 404);
  const p = await getProject(c.env, kw.project_id);
  const errors = await runKeyword(c.env, p, kw, "live");
  return c.json({ ok: !errors.length, errors });
});

app.get("/api/keywords/:kid/history", async (c) => {
  const { results } = await c.env.DB.prepare(
    `SELECT engine, position, cited, present, url, checked_at, top FROM rank_history WHERE keyword_id=? AND checked_at > datetime('now','-180 days') ORDER BY checked_at`
  ).bind(c.req.param("kid")).all<any>();
  return c.json(results.map((r) => ({ ...r, top: r.top ? JSON.parse(r.top) : null })));
});

/** Check every keyword in a project now (uses configured mode). */
app.post("/api/projects/:id/check-all", async (c) => {
  const p = await getProject(c.env, c.req.param("id"));
  const { results } = await c.env.DB.prepare(`SELECT * FROM keywords WHERE project_id=?`).bind(p.id).all<Keyword>();
  const m = mode(c);
  c.executionCtx.waitUntil(
    (async () => {
      for (const kw of results) await runKeyword(c.env, p, kw, m);
      await c.env.DB.prepare(`UPDATE keywords SET next_run_at=datetime('now','+1 day') WHERE project_id=?`).bind(p.id).run();
    })()
  );
  return c.json({ queued: results.length, mode: m });
});

// ---------- AI visibility ----------
app.get("/api/projects/:id/prompts", async (c) => {
  const pid = c.req.param("id");
  const { results: prompts } = await c.env.DB.prepare(`SELECT * FROM ai_prompts WHERE project_id=? ORDER BY created_at`).bind(pid).all<PromptRow>();
  const { results: res } = await c.env.DB.prepare(
    `SELECT r.* FROM ai_results r JOIN ai_prompts a ON a.id=r.prompt_id WHERE a.project_id=? AND r.checked_at > datetime('now','-120 days') ORDER BY r.checked_at DESC`
  ).bind(pid).all<any>();
  return c.json(
    prompts.map((p) => {
      const data: Record<string, unknown> = {};
      for (const pl of splitList(p.platforms)) {
        const rows = res.filter((r) => r.prompt_id === p.id && r.platform === pl);
        const cur = rows[0];
        data[pl] = cur
          ? {
              ...cur,
              sources: JSON.parse(cur.sources || "[]"), brands: JSON.parse(cur.brands || "[]"), competitors_hit: JSON.parse(cur.competitors_hit || "[]"),
              history: rows.slice(0, 20).reverse().map((r) => (r.domain_cited ? 2 : r.brand_mentioned ? 1 : 0)),
            }
          : null;
      }
      return { ...p, data };
    })
  );
});

app.post("/api/projects/:id/prompts", async (c) => {
  const { prompts, platforms } = await c.req.json<{ prompts: string; platforms?: string }>();
  const list = String(prompts || "").split("\n").map((s) => s.trim()).filter(Boolean).slice(0, 100);
  if (!list.length) return c.json({ error: "Add at least one prompt." }, 400);
  await c.env.DB.batch(list.map((pr) =>
    c.env.DB.prepare(`INSERT INTO ai_prompts(project_id, prompt, platforms) VALUES (?,?,?)`).bind(c.req.param("id"), pr.slice(0, 500), platforms || "chatgpt,ai_mode")));
  return c.json({ added: list.length });
});

app.delete("/api/prompts/:pid", async (c) => {
  await c.env.DB.prepare(`DELETE FROM ai_prompts WHERE id=?`).bind(c.req.param("pid")).run();
  return c.json({ ok: true });
});

app.post("/api/prompts/:pid/run", async (c) => {
  const pr = await c.env.DB.prepare(`SELECT * FROM ai_prompts WHERE id=?`).bind(c.req.param("pid")).first<PromptRow>();
  if (!pr) return c.json({ error: "Prompt not found" }, 404);
  const p = await getProject(c.env, pr.project_id);
  const errors = await runPrompt(c.env, p, pr, "live");
  return c.json({ ok: !errors.length, errors });
});

app.get("/api/projects/:id/ai-index", async (c) => {
  const p = await getProject(c.env, c.req.param("id"));
  return c.json(await aiMentionsIndex(c.env, p.domain, splitList(p.brand_names)[0]));
});

// ---------- Local SEO ----------
app.get("/api/projects/:id/grids", async (c) => {
  const { results: grids } = await c.env.DB.prepare(`SELECT * FROM local_grids WHERE project_id=? ORDER BY created_at`).bind(c.req.param("id")).all<any>();
  const out = [];
  for (const g of grids) {
    const scans = await c.env.DB.prepare(
      `SELECT s.*, (SELECT AVG(COALESCE(rank, 21)) FROM local_points WHERE scan_id=s.id) avg_rank,
              (SELECT SUM(CASE WHEN rank <= 3 THEN 1 ELSE 0 END) FROM local_points WHERE scan_id=s.id) top3
       FROM local_scans s WHERE grid_id=? ORDER BY started_at DESC LIMIT 12`
    ).bind(g.id).all<any>();
    out.push({ ...g, scans: scans.results });
  }
  return c.json(out);
});

app.post("/api/projects/:id/grids", async (c) => {
  const b = await c.req.json<any>();
  const size = [3, 5, 7, 9].includes(Number(b.size)) ? Number(b.size) : 5;
  if (!b.keyword || !isFinite(+b.center_lat) || !isFinite(+b.center_lng)) return c.json({ error: "Keyword and center coordinates are required." }, 400);
  const row = await c.env.DB.prepare(
    `INSERT INTO local_grids(project_id, keyword, center_lat, center_lng, size, spacing_km, zoom, next_run_at) VALUES (?,?,?,?,?,?,?,?) RETURNING id`
  ).bind(c.req.param("id"), b.keyword, +b.center_lat, +b.center_lng, size, +b.spacing_km || 1, +b.zoom || 15, b.weekly ? sqlDate() : null).first<{ id: number }>();
  return c.json({ id: row!.id });
});

app.delete("/api/grids/:gid", async (c) => {
  await c.env.DB.prepare(`DELETE FROM local_grids WHERE id=?`).bind(c.req.param("gid")).run();
  return c.json({ ok: true });
});

app.post("/api/grids/:gid/run", async (c) => {
  const g = await c.env.DB.prepare(`SELECT * FROM local_grids WHERE id=?`).bind(c.req.param("gid")).first<GridRow>();
  if (!g) return c.json({ error: "Grid not found" }, 404);
  const p = await getProject(c.env, g.project_id);
  const r = await runGrid(c.env, p, g, "live");
  return c.json({ scan_id: r.scanId, errors: r.errors.slice(0, 3) });
});

app.get("/api/scans/:sid", async (c) => {
  const { results } = await c.env.DB.prepare(`SELECT * FROM local_points WHERE scan_id=? ORDER BY row, col`).bind(c.req.param("sid")).all<any>();
  return c.json(results.map((r) => ({ ...r, top: JSON.parse(r.top || "[]") })));
});

app.get("/api/local/find", async (c) => {
  const q = c.req.query("q") || "";
  const loc = Number(c.req.query("location_code") || 2704);
  return c.json(await findBusiness(c.env, q, loc, c.req.query("language_code") || "en"));
});

// ---------- Site audit ----------
app.get("/api/projects/:id/audits", async (c) => {
  const { results } = await c.env.DB.prepare(
    `SELECT id, status, max_pages, summary, started_at, finished_at FROM audits WHERE project_id=? ORDER BY started_at DESC LIMIT 10`
  ).bind(c.req.param("id")).all<any>();
  return c.json(results.map((a) => ({ ...a, summary: a.summary ? JSON.parse(a.summary) : null })));
});

app.post("/api/projects/:id/audits", async (c) => {
  const p = await getProject(c.env, c.req.param("id"));
  const { max_pages } = await c.req.json<{ max_pages?: number }>().catch(() => ({ max_pages: 100 }));
  const id = await startAudit(c.env, p, Math.min(Math.max(Number(max_pages) || 100, 10), 2000));
  return c.json({ id });
});

app.get("/api/audits/:aid", async (c) => {
  let a = await c.env.DB.prepare(`SELECT * FROM audits WHERE id=?`).bind(c.req.param("aid")).first<any>();
  if (!a) return c.json({ error: "Audit not found" }, 404);
  if (a.status === "crawling") {
    await pollAudit(c.env, a).catch((e) => console.error(e));
    a = await c.env.DB.prepare(`SELECT * FROM audits WHERE id=?`).bind(c.req.param("aid")).first<any>();
  }
  return c.json({ ...a, summary: a.summary ? JSON.parse(a.summary) : null, pages: a.pages ? JSON.parse(a.pages) : null });
});

// ---------- Research ----------
app.post("/api/research/keywords", async (c) => {
  const b = await c.req.json<any>();
  if (!b.seed) return c.json({ error: "Enter a seed keyword." }, 400);
  return c.json(await keywordResearch(c.env, b.seed, b.mode || "ideas", Number(b.location_code) || 2704, b.language_code || "en"));
});

app.post("/api/research/domain", async (c) => {
  const b = await c.req.json<any>();
  if (!b.domain) return c.json({ error: "Enter a domain." }, 400);
  return c.json(await domainOverview(c.env, b.domain, Number(b.location_code) || 2704, b.language_code || "en"));
});

app.post("/api/research/serp", async (c) => {
  const b = await c.req.json<any>();
  if (!b.domain || !b.keyword) return c.json({ error: "Enter a domain and a keyword." }, 400);
  return c.json(await quickCheck(c.env, b.domain, b.keyword, Number(b.location_code) || 2704, b.language_code || "en", b.engine === "bing" ? "bing" : "google"));
});

// ---------- Usage ----------
app.get("/api/usage", async (c) => {
  const { results: daily } = await c.env.DB.prepare(
    `SELECT day, SUM(calls) calls, ROUND(SUM(cost),4) cost FROM api_usage WHERE day >= date('now','-30 days') GROUP BY day ORDER BY day`
  ).all<any>();
  const { results: byEndpoint } = await c.env.DB.prepare(
    `SELECT endpoint, SUM(calls) calls, ROUND(SUM(cost),4) cost FROM api_usage WHERE day >= date('now','-30 days') GROUP BY endpoint ORDER BY cost DESC`
  ).all<any>();
  let balance = null;
  try {
    const u = await new Dfs(c.env).userData();
    balance = u?.money?.balance ?? null;
  } catch { /* ignore */ }
  const pending = await c.env.DB.prepare(`SELECT COUNT(*) n FROM pending_tasks`).first<{ n: number }>();
  return c.json({ daily, byEndpoint, balance, pending: pending?.n || 0 });
});

app.post("/api/collect", async (c) => c.json({ collected: await collectPending(c.env) }));

app.all("/api/*", (c) => c.json({ error: "Not found" }, 404));

export default {
  fetch: app.fetch,
  async scheduled(_controller: ScheduledController, env: Env, ctx: ExecutionContext) {
    ctx.waitUntil(scheduled(env, _controller.scheduledTime));
  },
} satisfies ExportedHandler<Env>;
