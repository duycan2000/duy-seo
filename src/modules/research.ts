import { cachedLive } from "../dfs";
import type { Env } from "../types";
import { normDomain } from "../util";

function kwRow(item: any) {
  const kd = item.keyword_data || item;
  const info = kd.keyword_info || {};
  return {
    keyword: kd.keyword,
    volume: info.search_volume ?? null,
    cpc: info.cpc ?? null,
    competition: info.competition_level ?? null,
    kd: kd.keyword_properties?.keyword_difficulty ?? null,
    intent: kd.search_intent_info?.main_intent ?? null,
    trend: (info.monthly_searches || []).slice(0, 12).reverse().map((m: any) => m.search_volume),
  };
}

export async function keywordResearch(env: Env, seed: string, mode: string, location_code: number, language_code: string) {
  const common = { location_code, language_code, limit: 200 };
  let res: any;
  if (mode === "suggestions") {
    res = await cachedLive(env, "dataforseo_labs/google/keyword_suggestions/live", { ...common, keyword: seed, order_by: ["keyword_info.search_volume,desc"] });
  } else if (mode === "related") {
    res = await cachedLive(env, "dataforseo_labs/google/related_keywords/live", { ...common, keyword: seed, depth: 2, limit: 200 });
  } else {
    res = await cachedLive(env, "dataforseo_labs/google/keyword_ideas/live", { ...common, keywords: seed.split(",").map((s) => s.trim()).filter(Boolean), order_by: ["keyword_info.search_volume,desc"] });
  }
  const items = (res?.items || []).map(kwRow).filter((r: any) => r.keyword);
  return { total: res?.total_count ?? items.length, items };
}

export async function keywordOverview(env: Env, keywords: string[], location_code: number, language_code: string) {
  const res = await cachedLive(env, "dataforseo_labs/google/keyword_overview/live", { keywords: keywords.slice(0, 700), location_code, language_code });
  return (res?.items || []).map(kwRow);
}

async function safe<T>(fn: () => Promise<T>): Promise<T | { error: string }> {
  try {
    return await fn();
  } catch (e: any) {
    return { error: e.message };
  }
}

/** Semrush-style domain overview from DataForSEO Labs (+ Backlinks if your plan has it). */
export async function domainOverview(env: Env, domainInput: string, location_code: number, language_code: string) {
  const target = normDomain(domainInput);
  const loc = { location_code, language_code };
  const [rank, history, ranked, competitors, backlinks] = await Promise.all([
    safe(() => cachedLive(env, "dataforseo_labs/google/domain_rank_overview/live", { target, ...loc })),
    safe(() => cachedLive(env, "dataforseo_labs/google/historical_rank_overview/live", { target, ...loc }, 24 * 7)),
    safe(() => cachedLive(env, "dataforseo_labs/google/ranked_keywords/live", { target, ...loc, limit: 200, order_by: ["ranked_serp_element.serp_item.etv,desc"] })),
    safe(() => cachedLive(env, "dataforseo_labs/google/competitors_domain/live", { target, ...loc, limit: 15, exclude_top_domains: true })),
    safe(() => cachedLive(env, "backlinks/summary/live", { target, include_subdomains: true }, 24 * 7)),
  ]);

  const org = (rank as any)?.items?.[0]?.metrics?.organic || null;
  const paid = (rank as any)?.items?.[0]?.metrics?.paid || null;
  return {
    target,
    organic: org && {
      keywords: org.count, traffic: Math.round(org.etv || 0), traffic_value: Math.round(org.estimated_paid_traffic_cost || 0),
      pos_1: org.pos_1, pos_2_3: org.pos_2_3, pos_4_10: org.pos_4_10, pos_11_20: org.pos_11_20,
      pos_21_50: (org.pos_21_30 || 0) + (org.pos_31_40 || 0) + (org.pos_41_50 || 0),
      pos_51_100: (org.pos_51_60 || 0) + (org.pos_61_70 || 0) + (org.pos_71_80 || 0) + (org.pos_81_90 || 0) + (org.pos_91_100 || 0),
      new: org.is_new, up: org.is_up, down: org.is_down, lost: org.is_lost,
    },
    paid: paid && { keywords: paid.count, traffic: Math.round(paid.etv || 0) },
    history: ((history as any)?.items || [])
      .map((h: any) => ({ y: h.year, m: h.month, traffic: Math.round(h.metrics?.organic?.etv || 0), keywords: h.metrics?.organic?.count || 0 }))
      .sort((a: any, b: any) => a.y - b.y || a.m - b.m),
    keywords: ((ranked as any)?.items || []).map((it: any) => ({
      keyword: it.keyword_data?.keyword,
      volume: it.keyword_data?.keyword_info?.search_volume ?? null,
      kd: it.keyword_data?.keyword_properties?.keyword_difficulty ?? null,
      position: it.ranked_serp_element?.serp_item?.rank_group ?? null,
      url: it.ranked_serp_element?.serp_item?.url ?? null,
      traffic: Math.round(it.ranked_serp_element?.serp_item?.etv || 0),
      type: it.ranked_serp_element?.serp_item?.type ?? null,
    })),
    competitors: ((competitors as any)?.items || [])
      .filter((c: any) => normDomain(c.domain) !== target)
      .map((c: any) => ({
        domain: c.domain, common: c.intersections, avg_position: c.avg_position ? Math.round(c.avg_position * 10) / 10 : null,
        traffic: Math.round(c.full_domain_metrics?.organic?.etv || 0), keywords: c.full_domain_metrics?.organic?.count || 0,
      })),
    backlinks: (backlinks as any)?.error
      ? { error: (backlinks as any).error }
      : {
          rank: (backlinks as any)?.rank ?? null,
          backlinks: (backlinks as any)?.backlinks ?? null,
          referring_domains: (backlinks as any)?.referring_main_domains ?? (backlinks as any)?.referring_domains ?? null,
          spam_score: (backlinks as any)?.backlinks_spam_score ?? null,
        },
    errors: [rank, history, ranked, competitors].filter((r: any) => r?.error).map((r: any) => r.error),
  };
}
