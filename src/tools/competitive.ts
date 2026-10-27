/** Competitive research: organic keywords & top pages (Traffic Analytics), content gap, sitemap extractor, bulk domain analysis. */
import { cachedLive } from "../dfs";
import type { Env } from "../types";
import { mapLimit, normDomain } from "../util";

const INTENT_ABBR: Record<string, string> = { informational: "I", navigational: "N", commercial: "C", transactional: "T" };

function targetOf(input: string) {
  const s = input.trim();
  // keep full URLs (page-level), otherwise bare domain
  return /^https?:\/\/[^/]+\/.+/.test(s) ? s : normDomain(s);
}

export interface KwQuery {
  target: string; location_code: number; language_code: string;
  offset?: number; limit?: number; sort?: string; dir?: "asc" | "desc";
  q?: string; url?: string; pos_max?: number; pos_min?: number; vol_min?: number; intent?: string;
}

const SORT_FIELDS: Record<string, string> = {
  position: "ranked_serp_element.serp_item.rank_group",
  volume: "keyword_data.keyword_info.search_volume",
  visits: "ranked_serp_element.serp_item.etv",
  kd: "keyword_data.keyword_properties.keyword_difficulty",
  cpc: "keyword_data.keyword_info.cpc",
};

/** Traffic Analytics → Organic Keywords (paginated, server-side sort + filters). */
export async function organicKeywords(env: Env, q: KwQuery) {
  const filters: any[] = [];
  const add = (f: any) => { if (filters.length) filters.push("and"); filters.push(f); };
  add(["ranked_serp_element.serp_item.type", "=", "organic"]);
  if (q.q) add(["keyword_data.keyword", "like", `%${q.q}%`]);
  if (q.url) add(["ranked_serp_element.serp_item.relative_url", "like", `%${q.url}%`]);
  if (q.pos_max) add(["ranked_serp_element.serp_item.rank_group", "<=", Number(q.pos_max)]);
  if (q.pos_min) add(["ranked_serp_element.serp_item.rank_group", ">=", Number(q.pos_min)]);
  if (q.vol_min) add(["keyword_data.keyword_info.search_volume", ">=", Number(q.vol_min)]);
  if (q.intent) add(["keyword_data.search_intent_info.main_intent", "=", q.intent]);
  const order = `${SORT_FIELDS[q.sort || "visits"] || SORT_FIELDS.visits},${q.dir || (q.sort === "position" ? "asc" : "desc")}`;
  const res = await cachedLive(env, "dataforseo_labs/google/ranked_keywords/live", {
    target: targetOf(q.target), location_code: q.location_code, language_code: q.language_code,
    limit: Math.min(q.limit || 100, 1000), offset: q.offset || 0, order_by: [order],
    filters: filters.length > 1 ? filters : filters[0], load_rank_absolute: true,
  });
  const items = (res?.items || []).map((it: any) => {
    const kd = it.keyword_data || {};
    const ki = kd.keyword_info || {};
    const si = it.ranked_serp_element?.serp_item || {};
    const intents = [kd.search_intent_info?.main_intent, ...(kd.search_intent_info?.foreign_intent || [])].filter(Boolean);
    return {
      keyword: kd.keyword,
      url: si.url || null,
      intents: [...new Set(intents.map((x: string) => INTENT_ABBR[x] || x[0]?.toUpperCase()))],
      volume: ki.search_volume ?? null,
      trend: (ki.monthly_searches || []).slice(0, 12).reverse().map((m: any) => m.search_volume),
      kd: kd.keyword_properties?.keyword_difficulty ?? null,
      cpc: ki.cpc ?? null,
      position: si.rank_group ?? null,
      prev_position: si.rank_changes?.previous_rank_absolute ?? null,
      is_new: !!si.rank_changes?.is_new,
      visits: Math.round(si.etv || 0),
      updated: it.ranked_serp_element?.last_updated_time || ki.last_updated_time || null,
      features: (it.ranked_serp_element?.serp_item_types || []).filter((t: string) => t !== "organic"),
    };
  });
  return { total: res?.total_count ?? items.length, offset: q.offset || 0, items };
}

/** Traffic Analytics → Top Pages. */
export async function topPages(env: Env, target: string, location_code: number, language_code: string, offset = 0) {
  const res = await cachedLive(env, "dataforseo_labs/google/relevant_pages/live", {
    target: normDomain(target), location_code, language_code, limit: 100, offset,
    order_by: ["metrics.organic.etv,desc"],
  });
  return {
    total: res?.total_count ?? 0,
    items: (res?.items || []).map((p: any) => {
      const o = p.metrics?.organic || {};
      return {
        url: p.page_address, traffic: Math.round(o.etv || 0), keywords: o.count || 0,
        top3: (o.pos_1 || 0) + (o.pos_2_3 || 0), top10: (o.pos_1 || 0) + (o.pos_2_3 || 0) + (o.pos_4_10 || 0),
        value: Math.round(o.estimated_paid_traffic_cost || 0), new: o.is_new || 0, lost: o.is_lost || 0,
      };
    }),
  };
}

/** Content Gap: keywords the competitors rank for (top N) that you don't. */
export async function contentGap(env: Env, you: string, competitors: string[], location_code: number, language_code: string, maxPos = 20) {
  const me = normDomain(you);
  const comps = competitors.map(normDomain).filter((d) => d && d !== me).slice(0, 4);
  const results = await mapLimit(comps, 4, async (c) => {
    try {
      const res = await cachedLive(env, "dataforseo_labs/google/domain_intersection/live", {
        target1: c, target2: me, intersections: false, location_code, language_code, limit: 1000,
        item_types: ["organic"], filters: ["first_domain_serp_element.rank_group", "<=", maxPos],
        order_by: ["keyword_data.keyword_info.search_volume,desc"],
      });
      return { c, items: res?.items || [] };
    } catch (e: any) { return { c, items: [], error: e.message }; }
  });
  const map = new Map<string, any>();
  for (const r of results) for (const it of r.items) {
    const kd = it.keyword_data || {};
    const k = kd.keyword;
    if (!k) continue;
    const row = map.get(k) || {
      keyword: k, volume: kd.keyword_info?.search_volume ?? null, cpc: kd.keyword_info?.cpc ?? null,
      kd: kd.keyword_properties?.keyword_difficulty ?? null, intent: kd.search_intent_info?.main_intent ?? null, positions: {} as Record<string, any>,
    };
    const el = it.first_domain_serp_element || {};
    row.positions[r.c] = { p: el.rank_group ?? null, u: el.url ?? null };
    map.set(k, row);
  }
  const rows = [...map.values()].map((r) => ({ ...r, shared_by: Object.keys(r.positions).length }))
    .sort((a, b) => b.shared_by - a.shared_by || (b.volume || 0) - (a.volume || 0));
  return { you: me, competitors: comps, rows, errors: results.filter((r: any) => r.error).map((r: any) => `${r.c}: ${r.error}`) };
}

// ---------------- Sitemap extractor ----------------
async function fetchText(url: string) {
  const r = await fetch(url, { headers: { "User-Agent": "Mozilla/5.0 (compatible; DuySEO-Sitemap/1.0)" }, redirect: "follow", signal: AbortSignal.timeout(15000) });
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  if (url.endsWith(".gz") && r.body) {
    const ds = r.body.pipeThrough(new DecompressionStream("gzip"));
    return await new Response(ds).text();
  }
  return r.text();
}

const tagAll = (xml: string, tag: string) => [...xml.matchAll(new RegExp(`<(?:[a-z]+:)?${tag}\\b[^>]*>([\\s\\S]*?)</(?:[a-z]+:)?${tag}>`, "gi"))].map((m) => m[1]);
const tagOne = (xml: string, tag: string) => tagAll(xml, tag)[0]?.trim() || null;
const unesc = (s: string) => s.replace(/<!\[CDATA\[|\]\]>/g, "").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").trim();

export async function extractSitemap(input: string, maxUrls = 50000) {
  let base = input.trim();
  if (!/^https?:\/\//.test(base)) base = "https://" + base;
  const origin = new URL(base).origin;
  const queue: string[] = [];
  const log: { sitemap: string; urls: number; error?: string }[] = [];
  if (/\.xml(\.gz)?$|sitemap/i.test(new URL(base).pathname)) queue.push(base);
  else {
    try {
      const robots = await fetchText(`${origin}/robots.txt`);
      for (const m of robots.matchAll(/^\s*sitemap:\s*(\S+)/gim)) queue.push(m[1]);
    } catch { /* no robots.txt */ }
    if (!queue.length) queue.push(`${origin}/sitemap.xml`, `${origin}/sitemap_index.xml`, `${origin}/wp-sitemap.xml`);
  }
  const seen = new Set<string>();
  const urls: { url: string; lastmod: string | null; sitemap: string; images: number }[] = [];
  const seenUrl = new Set<string>();
  while (queue.length && seen.size < 200 && urls.length < maxUrls) {
    const sm = queue.shift()!;
    if (seen.has(sm)) continue;
    seen.add(sm);
    try {
      const xml = await fetchText(sm);
      if (/<sitemapindex/i.test(xml)) {
        for (const block of tagAll(xml, "sitemap")) { const loc = tagOne(block, "loc"); if (loc) queue.push(unesc(loc)); }
        log.push({ sitemap: sm, urls: 0 });
        continue;
      }
      let n = 0;
      for (const block of tagAll(xml, "url")) {
        const loc = tagOne(block, "loc");
        if (!loc) continue;
        const u = unesc(loc);
        if (seenUrl.has(u)) continue;
        seenUrl.add(u);
        urls.push({ url: u, lastmod: tagOne(block, "lastmod"), sitemap: sm, images: tagAll(block, "image").length });
        n++;
        if (urls.length >= maxUrls) break;
      }
      log.push({ sitemap: sm, urls: n });
    } catch (e: any) {
      log.push({ sitemap: sm, urls: 0, error: e.message });
    }
  }
  return { origin, sitemaps: log, urls, truncated: urls.length >= maxUrls };
}

// ---------------- Bulk domain / URL analysis ----------------
export async function bulkDomains(env: Env, inputs: string[], location_code: number, language_code: string) {
  const targets = [...new Set(inputs.map(targetOf).filter(Boolean))].slice(0, 1000);
  const [traffic, ranks, rds, spam] = await Promise.all([
    cachedLive(env, "dataforseo_labs/google/bulk_traffic_estimation/live", { targets, location_code, language_code, item_types: ["organic"] }).catch((e) => ({ error: e.message })),
    cachedLive(env, "backlinks/bulk_ranks/live", { targets, rank_scale: "one_hundred" }).catch((e) => ({ error: e.message })),
    cachedLive(env, "backlinks/bulk_referring_domains/live", { targets }).catch((e) => ({ error: e.message })),
    cachedLive(env, "backlinks/bulk_spam_score/live", { targets }).catch((e) => ({ error: e.message })),
  ]);
  const by = (res: any, f: (i: any) => any) => new Map<string, any>(((res as any)?.items || []).map((i: any) => [String(i.target).replace(/\/$/, ""), f(i)]));
  const t = by(traffic, (i) => i.metrics?.organic || {});
  const r = by(ranks, (i) => i.rank);
  const d = by(rds, (i) => i.referring_main_domains ?? i.referring_domains);
  const s = by(spam, (i) => i.spam_score);
  return {
    rows: targets.map((tg) => {
      const k = tg.replace(/\/$/, "");
      return { target: tg, traffic: Math.round(t.get(k)?.etv || 0) || (t.has(k) ? 0 : null), keywords: t.get(k)?.count ?? null, rank: r.get(k) ?? null, referring_domains: d.get(k) ?? null, spam_score: s.get(k) ?? null };
    }),
    errors: [traffic, ranks, rds, spam].filter((x: any) => x?.error).map((x: any) => x.error),
  };
}
