import { Dfs } from "../dfs";
import type { Env, Project } from "../types";

/** Checks where `true` is good — everything else that is `true` is an issue. */
export const POSITIVE_CHECKS = new Set([
  "is_https", "has_html_doctype", "canonical", "seo_friendly_url", "seo_friendly_url_characters_check",
  "seo_friendly_url_dynamic_check", "seo_friendly_url_keywords_check", "seo_friendly_url_relative_length_check",
  "has_meta_title", "is_www", "meta_charset_consistency", "has_micromarkup", "from_sitemap", "has_meta_viewport",
]);

export async function startAudit(env: Env, p: Project, maxPages: number) {
  const id = await new Dfs(env).post("on_page/task_post", {
    target: p.domain,
    max_crawl_pages: maxPages,
    load_resources: true,
    enable_javascript: false,
    store_raw_html: false,
    tag: `audit:${p.id}`,
  });
  const row = await env.DB.prepare(`INSERT INTO audits(project_id, task_id, max_pages) VALUES (?,?,?) RETURNING id`)
    .bind(p.id, id, maxPages)
    .first<{ id: number }>();
  return row!.id;
}

export async function pollAudit(env: Env, audit: { id: number; task_id: string }) {
  const dfs = new Dfs(env);
  const summary = await dfs.get(`on_page/summary/${audit.task_id}`);
  if (!summary) return "crawling";
  if (summary.crawl_progress !== "finished") {
    await env.DB.prepare(`UPDATE audits SET summary = ? WHERE id = ?`).bind(JSON.stringify(compactSummary(summary)), audit.id).run();
    return "crawling";
  }
  const pagesRes = await dfs.live("on_page/pages", { id: audit.task_id, limit: 500, order_by: ["meta.onpage_score,asc"] });
  const pages = (pagesRes?.items || []).map((pg: any) => ({
    url: pg.url,
    status: pg.status_code,
    score: pg.onpage_score,
    title: pg.meta?.title ?? null,
    desc_len: pg.meta?.description_length ?? null,
    words: pg.meta?.content?.plain_text_word_count ?? null,
    load_ms: pg.page_timing?.duration_time ?? null,
    issues: Object.entries(pg.checks || {})
      .filter(([k, v]) => v === true && !POSITIVE_CHECKS.has(k))
      .map(([k]) => k),
  }));
  await env.DB.prepare(`UPDATE audits SET status='finished', summary=?, pages=?, finished_at=datetime('now') WHERE id=?`)
    .bind(JSON.stringify(compactSummary(summary)), JSON.stringify(pages), audit.id)
    .run();
  return "finished";
}

function compactSummary(s: any) {
  const checks = s.page_metrics?.checks || {};
  return {
    progress: s.crawl_progress,
    crawled: s.crawl_status?.pages_crawled ?? 0,
    in_queue: s.crawl_status?.pages_in_queue ?? 0,
    score: s.page_metrics?.onpage_score ?? null,
    broken_links: s.page_metrics?.broken_links ?? 0,
    broken_resources: s.page_metrics?.broken_resources ?? 0,
    duplicate_title: s.page_metrics?.duplicate_title ?? 0,
    duplicate_description: s.page_metrics?.duplicate_description ?? 0,
    duplicate_content: s.page_metrics?.duplicate_content ?? 0,
    non_indexable: s.page_metrics?.non_indexable ?? 0,
    domain: {
      cms: s.domain_info?.cms ?? null,
      ip: s.domain_info?.ip ?? null,
      server: s.domain_info?.server ?? null,
      ssl: s.domain_info?.checks?.ssl ?? null,
      sitemap: s.domain_info?.checks?.sitemap ?? null,
      robots_txt: s.domain_info?.checks?.robots_txt ?? null,
    },
    issues: Object.entries(checks)
      .filter(([k, v]) => typeof v === "number" && v > 0 && !POSITIVE_CHECKS.has(k))
      .sort((a: any, b: any) => b[1] - a[1])
      .map(([k, v]) => ({ k, n: v })),
  };
}
