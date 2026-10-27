import { Dfs } from "../dfs";
import type { Env, Keyword, Project } from "../types";
import { collectLinks, matchesDomain, normDomain, splitList } from "../util";

type CallType = "google" | "bing" | "ai_mode";

/** Which DataForSEO calls a keyword needs, given its engines. */
export function callTypes(engines: string): CallType[] {
  const e = splitList(engines);
  const out: CallType[] = [];
  if (e.includes("google") || e.includes("ai_overview")) out.push("google");
  if (e.includes("bing")) out.push("bing");
  if (e.includes("ai_mode")) out.push("ai_mode");
  return out;
}

function serpBase(t: CallType) {
  return t === "bing" ? "serp/bing/organic" : t === "ai_mode" ? "serp/google/ai_mode" : "serp/google/organic";
}

function serpTask(p: Project, kw: Keyword, t: CallType): Record<string, unknown> {
  const task: Record<string, unknown> = {
    keyword: kw.keyword,
    location_code: p.location_code,
    language_code: p.language_code,
    device: p.device || "desktop",
    tag: `kw:${kw.id}`,
  };
  if (t !== "ai_mode") task.depth = Math.min(Math.max(p.depth || 50, 10), 100);
  if (t === "google" && splitList(kw.engines).includes("ai_overview")) task.load_async_ai_overview = true;
  if (t === "ai_mode") task.language_code = "en"; // AI Mode is English-only
  return task;
}

/** Run (live) or queue (standard) all checks for one keyword. */
export async function runKeyword(env: Env, p: Project, kw: Keyword, mode: "live" | "standard") {
  const dfs = new Dfs(env);
  const errors: string[] = [];
  for (const t of callTypes(kw.engines)) {
    const base = serpBase(t);
    const task = serpTask(p, kw, t);
    try {
      if (mode === "live") {
        const result = await dfs.live(`${base}/live/advanced`, task);
        await processSerp(env, { keyword_id: kw.id, project_id: p.id, type: t, engines: kw.engines }, result);
      } else {
        const id = await dfs.post(`${base}/task_post`, task);
        await env.DB.prepare(`INSERT OR IGNORE INTO pending_tasks(id, kind, get_path, ref) VALUES (?,?,?,?)`)
          .bind(id, "rank", `${base}/task_get/advanced/${id}`, JSON.stringify({ keyword_id: kw.id, project_id: p.id, type: t, engines: kw.engines }))
          .run();
      }
    } catch (e: any) {
      errors.push(`${t}: ${e.message}`);
    }
  }
  return errors;
}

export interface SerpRef {
  keyword_id: number;
  project_id: number;
  type: CallType;
  engines: string;
}

export async function processSerp(env: Env, ref: SerpRef, result: any) {
  const p = await env.DB.prepare(`SELECT * FROM projects WHERE id = ?`).bind(ref.project_id).first<Project>();
  if (!p) return;
  const items: any[] = result?.items || [];
  const engines = splitList(ref.engines);
  const stmts: D1PreparedStatement[] = [];
  const ins = (engine: string, position: number | null, url: string | null, present: number, cited: number, features: unknown, top: unknown) =>
    stmts.push(
      env.DB.prepare(
        `INSERT INTO rank_history(keyword_id, engine, position, url, present, cited, features, top) VALUES (?,?,?,?,?,?,?,?)`
      ).bind(ref.keyword_id, engine, position, url, present, cited, JSON.stringify(features ?? null), JSON.stringify(top ?? null))
    );

  if (ref.type === "google" || ref.type === "bing") {
    const organic = items.filter((i) => i.type === "organic");
    const hit = organic.find((i) => matchesDomain(i.domain || i.url, p.domain));
    const features = [...new Set(items.map((i) => i.type).filter((t) => t && t !== "organic"))];
    const top = organic.slice(0, 20).map((i) => ({ d: normDomain(i.domain || i.url), u: i.url, p: i.rank_group }));
    const engine = ref.type;
    if (engine === "bing" || engines.includes("google")) {
      ins(engine, hit ? hit.rank_group : null, hit?.url ?? null, 1, hit ? 1 : 0, features, top);
    }
    if (ref.type === "google" && engines.includes("ai_overview")) {
      const aio = items.find((i) => i.type === "ai_overview");
      const links = aio ? collectLinks(aio) : [];
      const idx = links.findIndex((l) => matchesDomain(l.d, p.domain));
      ins("ai_overview", idx >= 0 ? idx + 1 : null, idx >= 0 ? links[idx].u : null, aio ? 1 : 0, idx >= 0 ? 1 : 0, null, links.slice(0, 15).map((l, n) => ({ d: l.d, u: l.u, p: n + 1 })));
    }
  } else {
    const links = collectLinks(items);
    const idx = links.findIndex((l) => matchesDomain(l.d, p.domain));
    ins("ai_mode", idx >= 0 ? idx + 1 : null, idx >= 0 ? links[idx].u : null, items.length ? 1 : 0, idx >= 0 ? 1 : 0, null, links.slice(0, 15).map((l, n) => ({ d: l.d, u: l.u, p: n + 1 })));
  }
  if (stmts.length) await env.DB.batch(stmts);
}

/** One-off position check for any domain (no storage). */
export async function quickCheck(env: Env, domain: string, keyword: string, location_code: number, language_code: string, engine: "google" | "bing") {
  const dfs = new Dfs(env);
  const result = await dfs.live(`serp/${engine}/organic/live/advanced`, { keyword, location_code, language_code, depth: 100 });
  const items: any[] = result?.items || [];
  const organic = items.filter((i) => i.type === "organic");
  const hit = organic.find((i) => matchesDomain(i.domain || i.url, domain));
  return {
    position: hit?.rank_group ?? null,
    url: hit?.url ?? null,
    features: [...new Set(items.map((i) => i.type).filter((t) => t !== "organic"))],
    top: organic.slice(0, 10).map((i) => ({ p: i.rank_group, d: normDomain(i.domain), u: i.url, t: i.title })),
  };
}
