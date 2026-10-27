/** Keyword tools: bulk metrics, bulk autocomplete, semantic clustering. */
import { cachedLive, Dfs } from "../dfs";
import type { Env } from "../types";
import { mapLimit } from "../util";

// ---------------- Bulk keyword metrics ----------------
export async function bulkKeywordMetrics(env: Env, keywords: string[], location_code: number, language_code: string) {
  const list = [...new Set(keywords.map((k) => k.trim().toLowerCase()).filter(Boolean))].slice(0, 1000);
  const loc = { location_code, language_code };
  const [volRows, kd, intent] = await Promise.all([
    adsVolumes(env, list, location_code, language_code).catch((e) => ({ error: e.message })),
    cachedLive(env, "dataforseo_labs/google/bulk_keyword_difficulty/live", { keywords: list, ...loc }).catch((e) => ({ error: e.message })),
    cachedLive(env, "dataforseo_labs/google/search_intent/live", { keywords: list, language_code }).catch((e) => ({ error: e.message })),
  ]);
  const vol = Array.isArray(volRows) ? volRows : [];
  const v = new Map<string, any>();
  for (const r of vol) if (r?.keyword) v.set(String(r.keyword).toLowerCase(), r);
  const k = new Map<string, number>(((kd as any)?.items || []).map((i: any) => [String(i.keyword).toLowerCase(), i.keyword_difficulty]));
  const it = new Map<string, any>(((intent as any)?.items || []).map((i: any) => [String(i.keyword).toLowerCase(), i]));
  return {
    rows: list.map((kw) => {
      const r = v.get(kw) || {};
      const i = it.get(kw);
      return {
        keyword: kw, volume: r.search_volume ?? null, cpc: r.cpc ?? null, competition: r.competition ?? null,
        kd: k.get(kw) ?? null,
        intent: i?.keyword_intent?.label ?? null,
        secondary: (i?.secondary_keyword_intents || []).map((x: any) => x.label),
        trend: (r.monthly_searches || []).slice(0, 12).reverse().map((m: any) => m.search_volume),
      };
    }),
    errors: [volRows, kd, intent].filter((x: any) => x?.error).map((x: any) => x.error),
  };
}

/** Google Ads volume returns one row per keyword; cachedLive keeps only result[0], so use a dedicated cached call. */
export async function adsVolumes(env: Env, keywords: string[], location_code: number, language_code: string) {
  const key = `ads_sv:${location_code}:${language_code}:${keywords.join("|")}`.slice(0, 1800);
  const row = await env.DB.prepare(`SELECT data FROM cache WHERE key=? AND created_at > datetime('now','-7 days')`).bind(key).first<{ data: string }>();
  if (row) return JSON.parse(row.data) as any[];
  const dfs = new Dfs(env);
  const id = await dfs.post("keywords_data/google_ads/search_volume/task_post", { keywords, location_code, language_code });
  // Google Ads standard tasks usually finish in seconds; poll briefly, else return empty
  for (let i = 0; i < 8; i++) {
    await new Promise((r) => setTimeout(r, 2500));
    const all = await dfs.getAll(`keywords_data/google_ads/search_volume/task_get/${id}`);
    if (all) {
      await env.DB.prepare(`INSERT OR REPLACE INTO cache(key, data, created_at) VALUES (?,?,datetime('now'))`).bind(key, JSON.stringify(all)).run();
      return all;
    }
  }
  return [];
}

// ---------------- Bulk autocomplete ----------------
const QUESTION = ["how", "what", "why", "where", "when", "which", "who", "can", "is", "best", "cheap", "near me", "vs", "for"];

async function suggest(engine: string, q: string, hl: string, gl: string): Promise<string[]> {
  const url = engine === "bing"
    ? `https://api.bing.com/osjson.aspx?query=${encodeURIComponent(q)}&market=${hl}-${gl.toUpperCase()}`
    : engine === "youtube"
    ? `https://suggestqueries.google.com/complete/search?client=firefox&ds=yt&hl=${hl}&gl=${gl}&q=${encodeURIComponent(q)}`
    : `https://suggestqueries.google.com/complete/search?client=firefox&hl=${hl}&gl=${gl}&q=${encodeURIComponent(q)}`;
  const r = await fetch(url, { headers: { "User-Agent": "Mozilla/5.0 (compatible; DuySEO/1.0)" }, signal: AbortSignal.timeout(8000) })
    .catch(() => { throw new Error(`Couldn't reach ${engine} suggestions — try again in a minute`); });
  if (!r.ok) throw new Error(`${engine} autocomplete HTTP ${r.status}`);
  const text = new TextDecoder("utf-8").decode(await r.arrayBuffer());
  const j = JSON.parse(text);
  return Array.isArray(j?.[1]) ? j[1].map(String) : [];
}

/** Expands each seed with a–z and question modifiers; dedupes. Free (no DataForSEO credits). */
export async function bulkAutocomplete(env: Env, seeds: string[], engine: string, hl: string, gl: string, expand: string) {
  const queries: { seed: string; q: string; mod: string }[] = [];
  for (const s of seeds.slice(0, 20)) {
    queries.push({ seed: s, q: s, mod: "" });
    if (expand === "alphabet" || expand === "both") for (const ch of "abcdefghijklmnopqrstuvwxyz0123456789") queries.push({ seed: s, q: `${s} ${ch}`, mod: ch });
    if (expand === "questions" || expand === "both") for (const w of QUESTION) queries.push({ seed: s, q: w === "near me" || w === "vs" || w === "for" ? `${s} ${w}` : `${w} ${s}`, mod: w });
  }
  const out = new Map<string, { keyword: string; seed: string; mods: string[] }>();
  const errors: string[] = [];
  await mapLimit(queries, 8, async ({ seed, q, mod }) => {
    try {
      for (const s of await suggest(engine, q, hl, gl)) {
        const k = s.toLowerCase().trim();
        if (!k) continue;
        const e = out.get(k);
        if (e) { if (mod && !e.mods.includes(mod)) e.mods.push(mod); }
        else out.set(k, { keyword: k, seed, mods: mod ? [mod] : [] });
      }
    } catch (e: any) { if (errors.length < 3) errors.push(e.message); }
  });
  return { rows: [...out.values()].sort((a, b) => a.seed.localeCompare(b.seed) || a.keyword.localeCompare(b.keyword)), queries: queries.length, errors };
}

// ---------------- Semantic clustering ----------------
function charTrigramVectors(texts: string[]) {
  // fallback when Workers AI isn't bound: hashed character trigrams (lexical, not semantic)
  const DIM = 512;
  return texts.map((t) => {
    const v = new Float32Array(DIM);
    const s = ` ${t.toLowerCase()} `;
    for (let i = 0; i < s.length - 2; i++) {
      let h = 0;
      for (const ch of s.slice(i, i + 3)) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
      v[h % DIM] += 1;
    }
    return Array.from(v);
  });
}

async function embed(env: Env, texts: string[]): Promise<{ vectors: number[][]; model: string }> {
  if (!env.AI) return { vectors: charTrigramVectors(texts), model: "lexical fallback (Workers AI not bound)" };
  const vectors: number[][] = [];
  for (let i = 0; i < texts.length; i += 100) {
    const r: any = await env.AI.run("@cf/baai/bge-m3" as any, { text: texts.slice(i, i + 100) } as any);
    vectors.push(...(r.data as number[][]));
  }
  return { vectors, model: "@cf/baai/bge-m3" };
}

function normalize(v: number[]) {
  let n = 0;
  for (const x of v) n += x * x;
  n = Math.sqrt(n) || 1;
  return v.map((x) => x / n);
}

/**
 * Average-linkage-style greedy clustering on cosine similarity.
 * Keywords join the most similar cluster centroid above `threshold`; centroids update as clusters grow.
 */
export async function semanticCluster(env: Env, input: { keyword: string; volume?: number }[], threshold: number) {
  const rows = input.slice(0, 3000);
  const { vectors, model } = await embed(env, rows.map((r) => r.keyword));
  const vecs = vectors.map(normalize);
  const order = rows.map((_, i) => i).sort((a, b) => (rows[b].volume || 0) - (rows[a].volume || 0));
  const clusters: { members: number[]; centroid: number[] }[] = [];
  const dot = (a: number[], b: number[]) => { let s = 0; for (let i = 0; i < a.length; i++) s += a[i] * b[i]; return s; };
  for (const i of order) {
    let best = -1, bestSim = threshold;
    for (let c = 0; c < clusters.length; c++) {
      const sim = dot(vecs[i], clusters[c].centroid);
      if (sim >= bestSim) { bestSim = sim; best = c; }
    }
    if (best >= 0) {
      const c = clusters[best];
      c.members.push(i);
      const n = c.members.length;
      c.centroid = normalize(c.centroid.map((x, k) => (x * (n - 1) + vecs[i][k]) / n));
    } else clusters.push({ members: [i], centroid: vecs[i] });
  }
  const out = clusters.map((c) => {
    const members = c.members.map((i) => ({ keyword: rows[i].keyword, volume: rows[i].volume ?? null, sim: Math.round(dot(vecs[i], c.centroid) * 100) / 100 }));
    const primary = [...members].sort((a, b) => (b.volume || 0) - (a.volume || 0) || b.sim - a.sim)[0];
    return { primary: primary.keyword, volume: members.reduce((s, m) => s + (m.volume || 0), 0), keywords: members.sort((a, b) => b.sim - a.sim) };
  });
  return {
    model,
    clusters: out.filter((c) => c.keywords.length > 1).sort((a, b) => b.volume - a.volume || b.keywords.length - a.keywords.length),
    unclustered: out.filter((c) => c.keywords.length === 1).map((c) => c.primary),
  };
}
