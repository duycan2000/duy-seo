import { Dfs } from "./dfs";
import type { Env, Keyword, Project } from "./types";
import { mapLimit, nextRun } from "./util";
import { processSerp, runKeyword } from "./modules/rank";
import { processAiModePrompt, runPrompt, type PromptRow } from "./modules/ai";
import { processMapsPoint, runGrid, type GridRow } from "./modules/local";
import { pollAudit } from "./modules/audit";
import { processRrRank, runRrKeyword } from "./rr/rank";
import { processSerpCache } from "./tools/serp";
import { finalizeJobs, processAdsRow, processSerpRow, processVolume } from "./rr/market";
import { domainExpiry, formTests, formTestTimeouts, leadAndRentChecks, retention, sendDigest, twilioChecks, uptimeChecks } from "./rr/monitor";
import { getSettings } from "./rr/common";
import { inspectKeyPages, syncGsc } from "./rr/gsc";
import type { RrSite } from "./types";

function mode(env: Env): "live" | "standard" {
  return env.DFS_MODE === "live" ? "live" : "standard";
}

/** Collect finished Standard-mode tasks. */
export async function collectPending(env: Env) {
  const { results } = await env.DB.prepare(
    `SELECT * FROM pending_tasks WHERE created_at < datetime('now','-1 minute') ORDER BY created_at LIMIT 150`
  ).all<{ id: string; kind: string; get_path: string; ref: string; attempts: number }>();
  const dfs = new Dfs(env);
  let done = 0;
  const giveUp = async (t: { id: string; kind: string; ref: string }) => {
    await env.DB.prepare(`DELETE FROM pending_tasks WHERE id=?`).bind(t.id).run();
    // never leave a market-research job waiting on a task that will not come back
    const col = { mr_volume: "vol_done", mr_serp: "serp_done", mr_ads: "ads_done" }[t.kind];
    if (col) {
      const ref = JSON.parse(t.ref);
      if (ref.row_id) await env.DB.prepare(`UPDATE market_research SET ${col}=1 WHERE id=?`).bind(ref.row_id).run();
      else await env.DB.prepare(`UPDATE market_research SET ${col}=1 WHERE job_id=? AND city_id=?`).bind(ref.job_id, ref.city_id).run();
    }
  };
  await mapLimit(results, 10, async (t) => {
    try {
      const all = await dfs.getAll(t.get_path);
      if (all === undefined) {
        if (t.attempts > 300) await giveUp(t);
        else await env.DB.prepare(`UPDATE pending_tasks SET attempts = attempts + 1 WHERE id=?`).bind(t.id).run();
        return;
      }
      const result = all[0] ?? null;
      const ref = JSON.parse(t.ref);
      if (t.kind === "rr_rank") await processRrRank(env, ref, result);
      else if (t.kind === "serp_cache") await processSerpCache(env, ref, result);
      else if (t.kind === "mr_volume") await processVolume(env, ref, all);
      else if (t.kind === "mr_serp") await processSerpRow(env, ref, result);
      else if (t.kind === "mr_ads") await processAdsRow(env, ref, result);
      else if (t.kind === "rank") await processSerp(env, ref, result);
      else if (t.kind === "local_point") await processMapsPoint(env, ref, result);
      else if (t.kind === "ai_mode_prompt") {
        const p = await env.DB.prepare(`SELECT * FROM projects WHERE id=?`).bind(ref.project_id).first<Project>();
        if (p) await processAiModePrompt(env, p, ref.prompt_id, result);
      }
      await env.DB.prepare(`DELETE FROM pending_tasks WHERE id=?`).bind(t.id).run();
      done++;
    } catch (e: any) {
      console.error("collect", t.id, e.message);
      if (t.attempts > 290) await giveUp(t);
      else await env.DB.prepare(`UPDATE pending_tasks SET attempts = attempts + 10 WHERE id=?`).bind(t.id).run();
    }
  });
  return done;
}

/** Queue/run everything that is due. */
export async function runDue(env: Env) {
  const m = mode(env);
  const projects = new Map<number, Project>();
  const getProject = async (id: number) => {
    if (!projects.has(id)) {
      const p = await env.DB.prepare(`SELECT * FROM projects WHERE id=?`).bind(id).first<Project>();
      if (p) projects.set(id, p);
    }
    return projects.get(id);
  };

  // Keywords
  const kws = await env.DB.prepare(
    `SELECT k.* FROM keywords k JOIN projects p ON p.id = k.project_id
     WHERE p.frequency != 'manual' AND k.next_run_at <= datetime('now') ORDER BY k.next_run_at LIMIT 120`
  ).all<Keyword>();
  await mapLimit(kws.results, 8, async (kw) => {
    const p = await getProject(kw.project_id);
    if (!p) return;
    await env.DB.prepare(`UPDATE keywords SET next_run_at=? WHERE id=?`).bind(nextRun(p.frequency), kw.id).run();
    await runKeyword(env, p, kw, m);
  });

  // AI prompts (ChatGPT is live & slow — keep the batch small)
  const prompts = await env.DB.prepare(
    `SELECT a.* FROM ai_prompts a JOIN projects p ON p.id = a.project_id
     WHERE p.frequency != 'manual' AND a.next_run_at <= datetime('now') ORDER BY a.next_run_at LIMIT 15`
  ).all<PromptRow & { project_id: number }>();
  await mapLimit(prompts.results, 5, async (pr) => {
    const p = await getProject(pr.project_id);
    if (!p) return;
    // AI answers are noisy: weekly is enough unless project is daily
    await env.DB.prepare(`UPDATE ai_prompts SET next_run_at=? WHERE id=?`).bind(nextRun(p.frequency), pr.id).run();
    await runPrompt(env, p, pr, m);
  });

  // Local grids (weekly)
  const grids = await env.DB.prepare(
    `SELECT * FROM local_grids WHERE next_run_at IS NOT NULL AND next_run_at <= datetime('now') LIMIT 2`
  ).all<GridRow & { project_id: number }>();
  for (const g of grids.results) {
    const p = await getProject(g.project_id);
    if (!p) continue;
    await env.DB.prepare(`UPDATE local_grids SET next_run_at=? WHERE id=?`).bind(nextRun("weekly"), g.id).run();
    await runGrid(env, p, g, m);
  }

  // Audits in progress
  const audits = await env.DB.prepare(`SELECT id, task_id FROM audits WHERE status='crawling' LIMIT 5`).all<{ id: number; task_id: string }>();
  for (const a of audits.results) {
    try {
      await pollAudit(env, a);
    } catch (e: any) {
      console.error("audit", a.id, e.message);
    }
  }

  // housekeeping
  await env.DB.prepare(`DELETE FROM cache WHERE created_at < datetime('now','-30 days')`).run();
}

/** R&R money keywords: daily, mobile, city location. */
async function runRrDue(env: Env) {
  const due = (await env.DB.prepare(
    `SELECT k.id, k.keyword, k.site_id FROM rr_keywords k JOIN rr_sites s ON s.id=k.site_id
     WHERE s.status IN ('building','ranking','trial','rented','for_sale') AND k.next_run_at <= datetime('now') LIMIT 150`
  ).all<{ id: number; keyword: string; site_id: number }>()).results;
  const sites = new Map<number, RrSite>();
  await mapLimit(due, 8, async (kw) => {
    if (!sites.has(kw.site_id)) sites.set(kw.site_id, (await env.DB.prepare(`SELECT * FROM rr_sites WHERE id=?`).bind(kw.site_id).first<RrSite>())!);
    await env.DB.prepare(`UPDATE rr_keywords SET next_run_at=datetime('now','+1 day') WHERE id=?`).bind(kw.id).run();
    try { await runRrKeyword(env, sites.get(kw.site_id)!, kw, mode(env)); } catch (e: any) { console.error("rr rank", e.message); }
  });
}

const safely = async (name: string, fn: () => Promise<unknown>) => {
  try { await fn(); } catch (e: any) { console.error(name, e.message); }
};

/** Daily R&R jobs (at the digest hour) — checks first so the digest includes them. */
export async function rrDaily(env: Env, weekly: boolean, digest = true) {
  const gscSites = (await env.DB.prepare(
    `SELECT * FROM rr_sites WHERE status IN ('ranking','trial','rented','for_sale')`
  ).all<RrSite>()).results;
  if (env.GSC_SERVICE_ACCOUNT) {
    for (const s of gscSites) await safely("gsc", () => syncGsc(env, s));
    if (weekly) for (const s of gscSites) await safely("inspect", () => inspectKeyPages(env, s));
  }
  await safely("domain", () => domainExpiry(env));
  await safely("leads", () => leadAndRentChecks(env));
  if (weekly) await safely("form tests", () => formTests(env));
  await safely("retention", () => retention(env));
  if (digest) await safely("digest", () => sendDigest(env));
}

export async function scheduled(env: Env, scheduledTime = Date.now()) {
  const t = new Date(scheduledTime);
  await safely("collect", () => collectPending(env));
  await safely("market", () => finalizeJobs(env));
  await safely("due", () => runDue(env));
  await safely("rr due", () => runRrDue(env));
  await safely("uptime", () => uptimeChecks(env));
  await safely("form timeouts", () => formTestTimeouts(env));
  if (t.getUTCMinutes() < 15) await safely("twilio", () => twilioChecks(env));
  const s = await getSettings(env);
  if (t.getUTCHours() === Number(s.digest_hour_utc) && t.getUTCMinutes() < 15) {
    await rrDaily(env, t.getUTCDay() === 1);
  }
}
