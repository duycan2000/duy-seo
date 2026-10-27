import { cachedLive, Dfs } from "../dfs";
import type { Env, Project } from "../types";
import { collectLinks, matchesDomain, mentionsBrand, normDomain, splitList } from "../util";

export interface PromptRow {
  id: number;
  project_id: number;
  prompt: string;
  platforms: string;
}

function brandsFor(p: Project): string[] {
  const list = splitList(p.brand_names);
  if (!list.length) list.push(p.name);
  // also match the bare domain ("duy.digital")
  list.push(normDomain(p.domain));
  return list;
}

function competitorHits(p: Project, domains: string[], text: string): string[] {
  const t = text.toLowerCase();
  return splitList(p.competitors)
    .map(normDomain)
    .filter((c) => domains.some((d) => matchesDomain(d, c)) || t.includes(c) || t.includes(c.split(".")[0]));
}

async function saveResult(env: Env, promptId: number, platform: string, r: {
  brand: boolean; cited: number; sources: { d: string; u: string; t?: string }[]; brands: string[]; comps: string[]; excerpt: string;
}) {
  await env.DB.prepare(
    `INSERT INTO ai_results(prompt_id, platform, brand_mentioned, domain_cited, cited_position, sources, brands, competitors_hit, excerpt)
     VALUES (?,?,?,?,?,?,?,?,?)`
  )
    .bind(promptId, platform, r.brand ? 1 : 0, r.cited > 0 ? 1 : 0, r.cited > 0 ? r.cited : null,
      JSON.stringify(r.sources.slice(0, 20)), JSON.stringify(r.brands.slice(0, 30)), JSON.stringify(r.comps), r.excerpt.slice(0, 2500))
    .run();
}

export async function processChatgpt(env: Env, p: Project, promptId: number, result: any) {
  const text: string = result?.markdown || (result?.items || []).map((i: any) => i.markdown || "").join("\n");
  let sources = (result?.sources || []).map((s: any) => ({ d: normDomain(s.domain || s.url), u: s.url, t: s.title }));
  if (!sources.length) sources = collectLinks(result?.items || []);
  const brandEntities: string[] = (result?.brand_entities || []).map((b: any) => b.title).filter(Boolean);
  const brands = brandsFor(p);
  const brand = mentionsBrand(text, brands) || brandEntities.some((b) => mentionsBrand(b, brands));
  const idx = sources.findIndex((s: any) => matchesDomain(s.d, p.domain));
  await saveResult(env, promptId, "chatgpt", {
    brand, cited: idx + 1, sources, brands: brandEntities,
    comps: competitorHits(p, sources.map((s: any) => s.d), text), excerpt: text,
  });
}

export async function processAiModePrompt(env: Env, p: Project, promptId: number, result: any) {
  const items: any[] = result?.items || [];
  const text = items.map((i) => i.markdown || i.text || "").join("\n");
  const sources = collectLinks(items);
  const brand = mentionsBrand(text, brandsFor(p));
  const idx = sources.findIndex((s) => matchesDomain(s.d, p.domain));
  await saveResult(env, promptId, "ai_mode", {
    brand, cited: idx + 1, sources, brands: [],
    comps: competitorHits(p, sources.map((s) => s.d), text), excerpt: text,
  });
}

/** ChatGPT always runs Live (LLM Scraper); AI Mode follows the configured mode. */
export async function runPrompt(env: Env, p: Project, pr: PromptRow, mode: "live" | "standard") {
  const dfs = new Dfs(env);
  const errors: string[] = [];
  const platforms = splitList(pr.platforms);
  if (platforms.includes("chatgpt")) {
    try {
      const result = await dfs.live("ai_optimization/chat_gpt/llm_scraper/live/advanced", {
        keyword: pr.prompt,
        location_code: p.location_code === 2704 ? 2840 : p.location_code, // fall back to US when unsupported
        language_code: "en",
        force_web_search: true,
      });
      await processChatgpt(env, p, pr.id, result);
    } catch (e: any) {
      // retry with US if the location isn't supported for ChatGPT
      if (p.location_code !== 2840 && /location/i.test(e.message)) {
        try {
          const result = await dfs.live("ai_optimization/chat_gpt/llm_scraper/live/advanced", { keyword: pr.prompt, location_code: 2840, language_code: "en", force_web_search: true });
          await processChatgpt(env, p, pr.id, result);
        } catch (e2: any) { errors.push(`chatgpt: ${e2.message}`); }
      } else errors.push(`chatgpt: ${e.message}`);
    }
  }
  if (platforms.includes("ai_mode")) {
    const task = { keyword: pr.prompt, location_code: p.location_code, language_code: "en", device: "desktop" };
    try {
      if (mode === "live") {
        await processAiModePrompt(env, p, pr.id, await dfs.live("serp/google/ai_mode/live/advanced", task));
      } else {
        const id = await dfs.post("serp/google/ai_mode/task_post", task);
        await env.DB.prepare(`INSERT OR IGNORE INTO pending_tasks(id, kind, get_path, ref) VALUES (?,?,?,?)`)
          .bind(id, "ai_mode_prompt", `serp/google/ai_mode/task_get/advanced/${id}`, JSON.stringify({ prompt_id: pr.id, project_id: p.id }))
          .run();
      }
    } catch (e: any) {
      errors.push(`ai_mode: ${e.message}`);
    }
  }
  return errors;
}

/** AI mentions index from DataForSEO's LLM Mentions database (ChatGPT + Google AI). */
export async function aiMentionsIndex(env: Env, domain: string, brand?: string) {
  const target: any[] = [{ domain: normDomain(domain), search_filter: "include", include_subdomains: true, search_scope: ["any"] }];
  const res = await cachedLive(env, "ai_optimization/llm_mentions/target_metrics/live", {
    target, location_code: 2840, language_code: "en", internal_list_limit: 10,
  }, 24 * 7);
  let brandRes = null;
  if (brand) {
    try {
      brandRes = await cachedLive(env, "ai_optimization/llm_mentions/target_metrics/live", {
        target: [{ keyword: brand, search_filter: "include", search_scope: ["answer", "brand_entities"] }],
        location_code: 2840, language_code: "en", internal_list_limit: 10,
      }, 24 * 7);
    } catch { /* optional */ }
  }
  const pick = (r: any) => r?.aggregated_metrics || r?.items?.[0]?.aggregated_metrics || r?.items?.[0] || r;
  return { domain: pick(res), brand: pick(brandRes) };
}
