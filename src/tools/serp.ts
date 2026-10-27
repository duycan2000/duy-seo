/** SERP research tools: cached top-10s, SERP similarity, SERP clustering, bulk PAA, UULE locations. */
import { cachedLive, Dfs } from "../dfs";
import type { Env } from "../types";
import { mapLimit, normDomain } from "../util";

export interface Loc { location_code?: number; location_name?: string; language_code: string; device: string }
const locKey = (l: Loc) => String(l.location_code ?? l.location_name ?? "2840");
const locParams = (l: Loc) => (l.location_name ? { location_name: l.location_name } : { location_code: l.location_code || 2840 });
const normUrl = (u: string) => u.replace(/^https?:\/\/(www\.)?/, "").replace(/[?#].*$/, "").replace(/\/$/, "").toLowerCase();

function parseTop(result: any) {
  const items: any[] = result?.items || [];
  const urls = items.filter((i) => i.type === "organic").slice(0, 10)
    .map((i) => ({ p: i.rank_group, u: i.url, d: normDomain(i.domain || i.url), t: i.title }));
  const features = [...new Set(items.map((i) => i.type).filter((t: string) => t && t !== "organic"))];
  return { urls, features };
}

async function saveSerp(env: Env, keyword: string, l: Loc, result: any) {
  const { urls, features } = parseTop(result);
  await env.DB.prepare(`INSERT OR REPLACE INTO serp_cache(keyword, loc, lang, device, urls, features, fetched_at) VALUES (?,?,?,?,?,?,datetime('now'))`)
    .bind(keyword, locKey(l), l.language_code, l.device, JSON.stringify(urls), JSON.stringify(features)).run();
  return { urls, features };
}

async function cached(env: Env, keyword: string, l: Loc, days: number) {
  const r = await env.DB.prepare(
    `SELECT urls, features, fetched_at FROM serp_cache WHERE keyword=? AND loc=? AND lang=? AND device=? AND fetched_at > datetime('now', ?)`
  ).bind(keyword, locKey(l), l.language_code, l.device, `-${days} days`).first<{ urls: string; features: string; fetched_at: string }>();
  return r ? { urls: JSON.parse(r.urls), features: JSON.parse(r.features || "[]"), fetched_at: r.fetched_at } : null;
}

/** Top 10 for a keyword: reuse cache for `days`, otherwise one live call. */
export async function getSerp(env: Env, keyword: string, l: Loc, days = 7) {
  const hit = await cached(env, keyword, l, days);
  if (hit) return { ...hit, cached: true };
  const result = await new Dfs(env).live("serp/google/organic/live/advanced", { keyword, ...locParams(l), language_code: l.language_code, device: l.device, depth: 10 });
  return { ...(await saveSerp(env, keyword, l, result)), cached: false };
}

/** SERP Similarity: pairwise shared URLs between 2–6 keywords. */
export async function serpSimilarity(env: Env, keywords: string[], l: Loc) {
  const serps = await mapLimit(keywords, 4, async (k) => ({ keyword: k, ...(await getSerp(env, k, l)) }));
  const pairs: any[] = [];
  for (let i = 0; i < serps.length; i++)
    for (let j = i + 1; j < serps.length; j++) {
      const a = new Set(serps[i].urls.map((x: any) => normUrl(x.u)));
      const shared = serps[j].urls.filter((x: any) => a.has(normUrl(x.u))).map((x: any) => x.u);
      const pct = Math.round((shared.length / 10) * 100);
      pairs.push({
        a: serps[i].keyword, b: serps[j].keyword, shared: shared.length, pct, urls: shared,
        verdict: shared.length >= 4 ? "same" : shared.length >= 2 ? "maybe" : "separate",
      });
    }
  return { serps, pairs };
}

// ---------------- SERP clustering (job) ----------------
export async function startSerpCluster(env: Env, name: string, keywords: string[], l: Loc, reuseDays: number) {
  const job = await env.DB.prepare(`INSERT INTO tool_jobs(kind, name, params) VALUES ('serp_cluster', ?, ?) RETURNING id`)
    .bind(name || `${keywords.length} keywords`, JSON.stringify({ keywords, loc: l, reuseDays })).first<{ id: number }>();
  const dfs = new Dfs(env);
  let queued = 0;
  await mapLimit(keywords, 10, async (k) => {
    if (await cached(env, k, l, reuseDays)) return;
    try {
      const id = await dfs.post("serp/google/organic/task_post", { keyword: k, ...locParams(l), language_code: l.language_code, device: l.device, depth: 10 });
      await env.DB.prepare(`INSERT OR IGNORE INTO pending_tasks(id, kind, get_path, ref) VALUES (?,?,?,?)`)
        .bind(id, "serp_cache", `serp/google/organic/task_get/advanced/${id}`, JSON.stringify({ keyword: k, loc: l })).run();
      queued++;
    } catch (e: any) { console.error("serp cluster post", e.message); }
  });
  if (!queued) await env.DB.prepare(`UPDATE tool_jobs SET status='done' WHERE id=?`).bind(job!.id).run();
  return { id: job!.id, queued, reused: keywords.length - queued };
}

export async function processSerpCache(env: Env, ref: { keyword: string; loc: Loc }, result: any) {
  await saveSerp(env, ref.keyword, ref.loc, result);
}

/**
 * Cluster keywords by shared top-10 URLs.
 *  default  — join the cluster whose primary keyword shares ≥ threshold URLs (broad topics)
 *  strict   — must share ≥ threshold URLs with every member (tight clusters)
 *  balanced — must match 100% of members up to 5, 80% up to 10, 60% beyond
 */
export function clusterBySerp(
  rows: { keyword: string; volume?: number; urls: string[] }[],
  threshold: number,
  algo: "default" | "strict" | "balanced"
) {
  const sets = rows.map((r) => ({ ...r, set: new Set(r.urls.map(normUrl)) }));
  const shared = (a: Set<string>, b: Set<string>) => { let n = 0; for (const x of a) if (b.has(x)) n++; return n; };
  // primary candidates: highest volume first, then most results
  const order = [...sets].sort((a, b) => (b.volume || 0) - (a.volume || 0) || b.set.size - a.set.size);
  const clusters: { primary: typeof order[number]; members: typeof order }[] = [];
  const used = new Set<string>();
  for (const kw of order) {
    if (used.has(kw.keyword) || !kw.set.size) continue;
    let best: (typeof clusters)[number] | null = null, bestScore = 0;
    for (const c of clusters) {
      const withPrimary = shared(kw.set, c.primary.set);
      let ok = withPrimary >= threshold;
      if (ok && algo !== "default") {
        const matches = c.members.filter((m) => shared(kw.set, m.set) >= threshold).length;
        const need = algo === "strict" ? 1 : c.members.length <= 5 ? 1 : c.members.length <= 10 ? 0.8 : 0.6;
        ok = matches / c.members.length >= need;
      }
      if (ok && withPrimary > bestScore) { best = c; bestScore = withPrimary; }
    }
    if (best) best.members.push(kw);
    else clusters.push({ primary: kw, members: [kw] });
    used.add(kw.keyword);
  }
  const multi = clusters.filter((c) => c.members.length > 1);
  const singles = clusters.filter((c) => c.members.length === 1).map((c) => c.primary.keyword);
  return {
    clusters: multi.map((c) => {
      const union = new Map<string, number>();
      c.members.forEach((m) => m.urls.forEach((u) => union.set(normUrl(u), (union.get(normUrl(u)) || 0) + 1)));
      return {
        primary: c.primary.keyword,
        volume: c.members.reduce((s, m) => s + (m.volume || 0), 0),
        keywords: c.members.map((m) => ({ keyword: m.keyword, volume: m.volume ?? null, shared: shared(m.set, c.primary.set) })),
        top_urls: [...union.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5).map(([u, n]) => ({ u, n })),
      };
    }).sort((a, b) => b.volume - a.volume || b.keywords.length - a.keywords.length),
    unclustered: singles.concat(rows.filter((r) => !r.urls.length).map((r) => r.keyword)),
  };
}

export async function serpClusterResult(env: Env, id: number, threshold: number, algo: any) {
  const job = await env.DB.prepare(`SELECT * FROM tool_jobs WHERE id=?`).bind(id).first<any>();
  if (!job) throw new Error("Job not found");
  const p = JSON.parse(job.params);
  const rows: any[] = [];
  let missing = 0;
  for (const k of p.keywords as string[]) {
    const s = await cached(env, k, p.loc, 365);
    if (!s) missing++;
    rows.push({ keyword: k, volume: p.volumes?.[k], urls: s ? s.urls.map((x: any) => x.u) : [] });
  }
  if (!missing && job.status !== "done") await env.DB.prepare(`UPDATE tool_jobs SET status='done' WHERE id=?`).bind(id).run();
  return { job: { id: job.id, name: job.name, created_at: job.created_at, total: p.keywords.length, missing, status: missing ? "running" : "done" }, ...clusterBySerp(rows, threshold, algo) };
}

export async function attachVolumes(env: Env, id: number, volumes: Record<string, number>) {
  const job = await env.DB.prepare(`SELECT params FROM tool_jobs WHERE id=?`).bind(id).first<{ params: string }>();
  if (!job) return;
  const p = JSON.parse(job.params);
  p.volumes = volumes;
  await env.DB.prepare(`UPDATE tool_jobs SET params=? WHERE id=?`).bind(JSON.stringify(p), id).run();
}

// ---------------- Bulk People Also Ask ----------------
export async function bulkPaa(env: Env, keywords: string[], l: Loc, depth: number) {
  const dfs = new Dfs(env);
  return mapLimit(keywords, 5, async (keyword) => {
    try {
      const r = await dfs.live("serp/google/organic/live/advanced", {
        keyword, ...locParams(l), language_code: l.language_code, device: l.device, depth: 10,
        people_also_ask_click_depth: Math.min(4, Math.max(1, depth)),
      });
      const questions: any[] = [];
      for (const block of (r?.items || []).filter((i: any) => i.type === "people_also_ask")) {
        for (const el of block.items || []) {
          const ex = (el.expanded_element || [])[0] || {};
          questions.push({
            q: el.title,
            answer: ex.description || ex.featured_title || null,
            url: ex.url || null,
            domain: ex.domain ? normDomain(ex.domain) : ex.url ? normDomain(ex.url) : null,
          });
        }
      }
      const seen = new Set<string>();
      return { keyword, questions: questions.filter((q) => q.q && !seen.has(q.q.toLowerCase()) && seen.add(q.q.toLowerCase())) };
    } catch (e: any) {
      return { keyword, questions: [], error: e.message };
    }
  });
}

// ---------------- UULE ----------------
/** Google canonical location names from DataForSEO (cached 30 days), filtered by text. */
export async function searchLocations(env: Env, country: string, q: string) {
  const key = `serp_locations:${country}`;
  let row = await env.DB.prepare(`SELECT data FROM cache WHERE key=? AND created_at > datetime('now','-30 days')`).bind(key).first<{ data: string }>();
  let list: any[];
  if (row) list = JSON.parse(row.data);
  else {
    const res = await new Dfs(env).list(`serp/google/locations/${country.toLowerCase()}`);
    list = res.map((l: any) => ({ c: l.location_code, n: l.location_name, t: l.location_type }));
    await env.DB.prepare(`INSERT OR REPLACE INTO cache(key, data, created_at) VALUES (?,?,datetime('now'))`).bind(key, JSON.stringify(list)).run();
  }
  const s = q.toLowerCase();
  return list.filter((l) => !s || l.n.toLowerCase().includes(s)).sort((a, b) => a.n.length - b.n.length).slice(0, 40);
}

export { cachedLive };
