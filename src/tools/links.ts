/** Link building: Backlink Analytics (summary, history, backlinks, referring domains, anchors) and Backlink Gap. */
import { cachedLive } from "../dfs";
import type { Env } from "../types";
import { normDomain } from "../util";

const tgt = (s: string) => (/^https?:\/\/[^/]+\/.+/.test(s.trim()) ? s.trim() : normDomain(s));

export async function backlinkOverview(env: Env, target: string) {
  const t = tgt(target);
  const from = new Date(Date.now() - 365 * 864e5).toISOString().slice(0, 10);
  const [summary, history] = await Promise.all([
    cachedLive(env, "backlinks/summary/live", { target: t, include_subdomains: true, rank_scale: "one_hundred" }, 24),
    cachedLive(env, "backlinks/history/live", { target: normDomain(t), date_from: from, rank_scale: "one_hundred" }, 24 * 7).catch(() => null),
  ]);
  const s = summary || {};
  return {
    target: t,
    summary: {
      rank: s.rank ?? null, backlinks: s.backlinks ?? null, referring_domains: s.referring_main_domains ?? s.referring_domains ?? null,
      referring_ips: s.referring_ips ?? null, dofollow: s.backlinks ? s.backlinks - (s.referring_links_attributes?.nofollow || 0) : null,
      nofollow: s.referring_links_attributes?.nofollow ?? null, spam_score: s.backlinks_spam_score ?? null,
      broken_backlinks: s.broken_backlinks ?? null, first_seen: s.first_seen ?? null,
      tlds: Object.entries(s.referring_links_tld || {}).sort((a: any, b: any) => b[1] - a[1]).slice(0, 8),
      countries: Object.entries(s.referring_links_countries || {}).filter(([k]) => k).sort((a: any, b: any) => b[1] - a[1]).slice(0, 8),
      types: s.referring_links_types || {},
    },
    history: ((history as any)?.items || []).map((h: any) => ({ d: String(h.date).slice(0, 7), backlinks: h.backlinks, rd: h.referring_main_domains ?? h.referring_domains, rank: h.rank, new_rd: h.new_referring_domains, lost_rd: h.lost_referring_domains })),
  };
}

export async function backlinkList(env: Env, target: string, mode: string, offset = 0, dofollowOnly = false) {
  const t = tgt(target);
  const filters: any[] = [["is_lost", "=", false]];
  if (dofollowOnly) filters.push("and", ["dofollow", "=", true]);
  const res = await cachedLive(env, "backlinks/backlinks/live", {
    target: t, mode: mode === "all" ? "as_is" : "one_per_domain", limit: 100, offset, rank_scale: "one_hundred",
    order_by: ["domain_from_rank,desc"], filters,
  }, 24);
  return {
    total: res?.total_count ?? 0,
    items: (res?.items || []).map((b: any) => ({
      url_from: b.url_from, domain_from: b.domain_from, url_to: b.url_to, anchor: b.anchor, dofollow: b.dofollow,
      domain_rank: b.domain_from_rank, page_rank: b.rank, type: b.item_type, first_seen: (b.first_seen || "").slice(0, 10),
      spam: b.backlink_spam_score, text_pre: b.text_pre, text_post: b.text_post,
    })),
  };
}

export async function referringDomains(env: Env, target: string, offset = 0) {
  const res = await cachedLive(env, "backlinks/referring_domains/live", {
    target: tgt(target), limit: 100, offset, rank_scale: "one_hundred", order_by: ["rank,desc"], exclude_internal_backlinks: true,
  }, 24);
  return {
    total: res?.total_count ?? 0,
    items: (res?.items || []).map((d: any) => ({
      domain: d.domain, rank: d.rank, backlinks: d.backlinks, dofollow: d.referring_links_attributes ? d.backlinks - (d.referring_links_attributes.nofollow || 0) : null,
      first_seen: (d.first_seen || "").slice(0, 10), spam: d.backlinks_spam_score, country: d.referring_links_countries ? Object.keys(d.referring_links_countries)[0] : null,
    })),
  };
}

export async function anchors(env: Env, target: string) {
  const res = await cachedLive(env, "backlinks/anchors/live", { target: tgt(target), limit: 100, order_by: ["referring_domains,desc"] }, 24);
  return {
    total: res?.total_count ?? 0,
    items: (res?.items || []).map((a: any) => ({ anchor: a.anchor, referring_domains: a.referring_main_domains ?? a.referring_domains, backlinks: a.backlinks, first_seen: (a.first_seen || "").slice(0, 10) })),
  };
}

/** Backlink Gap: domains linking to competitors but not to you. */
export async function backlinkGap(env: Env, you: string, competitors: string[], minShared: number) {
  const me = normDomain(you);
  const comps = competitors.map(normDomain).filter((d) => d && d !== me).slice(0, 10);
  if (!comps.length) throw new Error("Add at least one competitor.");
  const targets: Record<string, string> = {};
  comps.forEach((c, i) => (targets[String(i + 1)] = c));
  const res = await cachedLive(env, "backlinks/domain_intersection/live", {
    targets, exclude_targets: [me], limit: 1000, include_subdomains: true, rank_scale: "one_hundred",
    intersection_mode: "all", order_by: ["1.rank,desc"],
  }, 24);
  const rows = (res?.items || []).map((it: any) => {
    const per = it.domain_intersection || {};
    const linked = Object.entries(per).filter(([, v]: any) => v && v.backlinks > 0);
    const any: any = linked[0]?.[1] || {};
    return {
      domain: any.target, rank: Math.max(...linked.map(([, v]: any) => v.rank || 0)), shared: linked.length,
      links: Object.fromEntries(linked.map(([k, v]: any) => [comps[Number(k) - 1], v.backlinks])),
      spam: any.backlinks_spam_score ?? null, first_seen: (any.first_seen || "").slice(0, 10),
    };
  }).filter((r: any) => r.domain && r.shared >= minShared).sort((a: any, b: any) => b.shared - a.shared || b.rank - a.rank);
  return { you: me, competitors: comps, total: res?.total_count ?? rows.length, rows };
}
