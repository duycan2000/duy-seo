/** Money-keyword tracking for R&R sites: mobile Google, city location, organic + map pack. */
import { Dfs } from "../dfs";
import type { Env, RrSite } from "../types";
import { matchesDomain } from "../util";
import { getSettings, raiseAlert, resolveAlert } from "./common";
import type { City } from "./market";

export async function runRrKeyword(env: Env, site: RrSite, kw: { id: number; keyword: string }, mode: "live" | "standard") {
  const city = site.city_id ? await env.DB.prepare(`SELECT * FROM cities WHERE id=?`).bind(site.city_id).first<City>() : null;
  const loc = city?.location_code
    ? { location_code: city.location_code }
    : city
    ? { location_coordinate: `${city.lat},${city.lng}` }
    : { location_code: site.country === "NZ" ? 2554 : 2036 };
  const task = { keyword: kw.keyword, ...loc, language_code: "en", device: "mobile", depth: 50 };
  const dfs = new Dfs(env);
  if (mode === "live") {
    await processRrRank(env, { keyword_id: kw.id, site_id: site.id }, await dfs.live("serp/google/organic/live/advanced", task));
  } else {
    const id = await dfs.post("serp/google/organic/task_post", task);
    await env.DB.prepare(`INSERT OR IGNORE INTO pending_tasks(id, kind, get_path, ref) VALUES (?,?,?,?)`)
      .bind(id, "rr_rank", `serp/google/organic/task_get/advanced/${id}`, JSON.stringify({ keyword_id: kw.id, site_id: site.id })).run();
  }
}

export async function processRrRank(env: Env, ref: { keyword_id: number; site_id: number }, result: any) {
  const site = await env.DB.prepare(`SELECT * FROM rr_sites WHERE id=?`).bind(ref.site_id).first<RrSite>();
  const kw = await env.DB.prepare(`SELECT * FROM rr_keywords WHERE id=?`).bind(ref.keyword_id).first<{ id: number; keyword: string }>();
  if (!site || !kw) return;
  const items: any[] = result?.items || [];
  const hit = items.filter((i) => i.type === "organic").find((i) => matchesDomain(i.domain || i.url, site.domain));
  const pack = items.filter((i) => i.type === "local_pack");
  const packIdx = pack.findIndex((i) => i.domain && matchesDomain(i.domain, site.domain));
  const prev = await env.DB.prepare(`SELECT position FROM rr_rank_history WHERE keyword_id=? ORDER BY checked_at DESC LIMIT 1`).bind(kw.id).first<{ position: number | null }>();
  const position = hit ? hit.rank_group : null;
  await env.DB.prepare(`INSERT INTO rr_rank_history(keyword_id, position, map_pack, url) VALUES (?,?,?,?)`)
    .bind(kw.id, position, packIdx >= 0 ? packIdx + 1 : null, hit?.url ?? null).run();

  // rank-drop alert
  const s = await getSettings(env);
  const threshold = Number(s.rank_drop_threshold) || 5;
  const key = `rank:${kw.id}`;
  if (prev?.position) {
    const now = position ?? 101;
    if (now - prev.position > threshold) {
      await raiseAlert(env, {
        site_id: site.id, kind: "rank_drop", severity: "warn", key,
        message: `${site.domain}: “${kw.keyword}” dropped from #${prev.position} to ${position ? "#" + position : "out of top 50"}`,
      });
    } else if (now <= prev.position) {
      await resolveAlert(env, key);
    }
  }
}
