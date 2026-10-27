/** Niche & Market Finder: niche × AU/NZ city → R&R Opportunity Score. */
import { Dfs } from "../dfs";
import type { Env } from "../types";
import { matchesDomain, normDomain } from "../util";
import { DIRECTORIES } from "./cities";
import { ensureCities, randomSecret } from "./common";

const COUNTRY_CODE: Record<string, number> = { AU: 2036, NZ: 2554 };
const COUNTRY_NAME: Record<string, string> = { AU: "Australia", NZ: "New Zealand" };

export interface City {
  id: number; name: string; region: string; country: string; population: number;
  lat: number; lng: number; regional: number; location_code: number | null;
}

export const isDirectory = (d: string) => DIRECTORIES.some((x) => matchesDomain(d, x));

/** Fill cities.location_code from DataForSEO's Google Ads location list (free call, once per country). 0 = no city target exists. */
export async function resolveCityCodes(env: Env, countries: string[]) {
  const dfs = new Dfs(env);
  for (const cc of countries) {
    const missing = await env.DB.prepare(`SELECT id, name, region FROM cities WHERE country=? AND location_code IS NULL`).bind(cc).all<City>();
    if (!missing.results.length) continue;
    const locs = await dfs.list(`keywords_data/google_ads/locations/${cc.toLowerCase()}`);
    const country = COUNTRY_NAME[cc];
    const stmts = missing.results.map((c) => {
      const cands = locs.filter((l: any) => l.location_type === "City" && String(l.location_name).startsWith(c.name + ",") && String(l.location_name).endsWith("," + country));
      const best = cands.find((l: any) => String(l.location_name) === `${c.name},${c.region},${country}`) || cands[0];
      return env.DB.prepare(`UPDATE cities SET location_code=? WHERE id=?`).bind(best ? best.location_code : 0, c.id);
    });
    if (stmts.length) await env.DB.batch(stmts);
  }
}

function keywordSet(niche: string, city: City, cityLevel: boolean) {
  const n = niche.toLowerCase().trim();
  const c = city.name.toLowerCase();
  // With a city target the bare niche already means "searched in this city".
  return cityLevel ? [n, `${n} ${c}`, `${n} near me`] : [`${n} ${c}`];
}

export async function startJob(env: Env, name: string, niches: string[], cityIds: number[]) {
  await ensureCities(env);
  const placeholders = cityIds.map(() => "?").join(",");
  let cities = (await env.DB.prepare(`SELECT * FROM cities WHERE id IN (${placeholders})`).bind(...cityIds).all<City>()).results;
  const countries = [...new Set(cities.map((c) => c.country))];
  await resolveCityCodes(env, countries).catch((e) => console.error("resolve codes", e.message));
  cities = (await env.DB.prepare(`SELECT * FROM cities WHERE id IN (${placeholders})`).bind(...cityIds).all<City>()).results;

  const job = await env.DB.prepare(`INSERT INTO market_jobs(name, niches, city_ids) VALUES (?,?,?) RETURNING id`)
    .bind(name || niches.join(", "), JSON.stringify(niches), JSON.stringify(cityIds)).first<{ id: number }>();
  const jobId = job!.id;
  const dfs = new Dfs(env);

  // rows
  const rowIds = new Map<string, number>();
  for (const c of cities) for (const n of niches) {
    const r = await env.DB.prepare(`INSERT INTO market_research(job_id, niche, city_id) VALUES (?,?,?) RETURNING id`).bind(jobId, n, c.id).first<{ id: number }>();
    rowIds.set(`${n}|${c.id}`, r!.id);
  }
  const queue = (id: string, kind: string, path: string, ref: unknown) =>
    env.DB.prepare(`INSERT OR IGNORE INTO pending_tasks(id, kind, get_path, ref) VALUES (?,?,?,?)`).bind(id, kind, path, JSON.stringify(ref)).run();
  const markDone = (col: string, ids: number[]) =>
    ids.length ? env.DB.prepare(`UPDATE market_research SET ${col}=1 WHERE id IN (${ids.join(",")})`).run() : null;

  // 1) search volume + CPC: one Google Ads task per city (all niches)
  for (const c of cities) {
    const cityLevel = !!c.location_code;
    const keywords = [...new Set(niches.flatMap((n) => keywordSet(n, c, cityLevel)))];
    const ids = niches.map((n) => rowIds.get(`${n}|${c.id}`)!);
    try {
      const id = await dfs.post("keywords_data/google_ads/search_volume/task_post", {
        keywords, language_code: "en",
        location_code: cityLevel ? c.location_code : COUNTRY_CODE[c.country],
      });
      await queue(id, "mr_volume", `keywords_data/google_ads/search_volume/task_get/${id}`, { job_id: jobId, city_id: c.id, scope: cityLevel ? "city" : "country" });
    } catch (e: any) {
      console.error("mr volume", e.message);
      await markDone("vol_done", ids);
    }
  }

  // 2) keyword difficulty (Labs, country level) — live, one call per country
  for (const cc of countries) {
    const cs = cities.filter((c) => c.country === cc);
    const kws = [...new Set(cs.flatMap((c) => niches.map((n) => `${n.toLowerCase()} ${c.name.toLowerCase()}`)))];
    try {
      const res = await dfs.live("dataforseo_labs/google/bulk_keyword_difficulty/live", { keywords: kws.slice(0, 1000), location_code: COUNTRY_CODE[cc], language_code: "en" });
      const map = new Map<string, number>((res?.items || []).map((i: any) => [i.keyword, i.keyword_difficulty]));
      for (const c of cs) for (const n of niches) {
        const kd = map.get(`${n.toLowerCase()} ${c.name.toLowerCase()}`);
        if (kd != null) await env.DB.prepare(`UPDATE market_research SET kd=? WHERE id=?`).bind(kd, rowIds.get(`${n}|${c.id}`)).run();
      }
    } catch (e: any) { console.error("mr kd", e.message); }
  }

  // 3) local mobile SERP + 4) Ads advertisers, per niche × city
  for (const c of cities) for (const n of niches) {
    const rowId = rowIds.get(`${n}|${c.id}`)!;
    const loc = c.location_code ? { location_code: c.location_code } : { location_coordinate: `${c.lat},${c.lng}` };
    try {
      const id = await dfs.post("serp/google/organic/task_post", { keyword: n.toLowerCase(), ...loc, language_code: "en", device: "mobile", depth: 20 });
      await queue(id, "mr_serp", `serp/google/organic/task_get/advanced/${id}`, { row_id: rowId });
    } catch (e: any) { console.error("mr serp", e.message); await markDone("serp_done", [rowId]); }
    try {
      const id = await dfs.post("serp/google/ads_advertisers/task_post", { keyword: `${n.toLowerCase()} ${c.name.toLowerCase()}`, location_code: COUNTRY_CODE[c.country] });
      await queue(id, "mr_ads", `serp/google/ads_advertisers/task_get/advanced/${id}`, { row_id: rowId });
    } catch (e: any) { console.error("mr ads", e.message); await markDone("ads_done", [rowId]); }
  }
  return jobId;
}

export async function processVolume(env: Env, ref: { job_id: number; city_id: number; scope: string }, result: any[]) {
  const vols = new Map<string, any>(result.map((r: any) => [String(r.keyword).toLowerCase(), r]));
  const city = await env.DB.prepare(`SELECT * FROM cities WHERE id=?`).bind(ref.city_id).first<City>();
  const rows = (await env.DB.prepare(`SELECT id, niche FROM market_research WHERE job_id=? AND city_id=?`).bind(ref.job_id, ref.city_id).all<{ id: number; niche: string }>()).results;
  for (const row of rows) {
    const set = keywordSet(row.niche, city!, ref.scope === "city").map((k) => vols.get(k)).filter(Boolean);
    const volume = set.reduce((s, r) => s + (r.search_volume || 0), 0);
    const cpcs = set.map((r) => r.cpc).filter((x) => x != null);
    const bids = set.map((r) => r.high_top_of_page_bid).filter((x) => x != null);
    await env.DB.prepare(`UPDATE market_research SET volume=?, volume_scope=?, cpc=?, top_bid=?, vol_done=1 WHERE id=?`)
      .bind(volume, ref.scope, cpcs.length ? Math.max(...cpcs) : null, bids.length ? Math.max(...bids) : null, row.id).run();
  }
}

export async function processSerpRow(env: Env, ref: { row_id: number }, result: any) {
  const items: any[] = result?.items || [];
  const organic = items.filter((i) => i.type === "organic").slice(0, 10);
  const top10 = organic.map((i) => ({ p: i.rank_group, d: normDomain(i.domain || i.url), dir: isDirectory(i.domain || i.url) ? 1 : 0 }));
  const pack = items.find((i) => i.type === "local_pack") ? items.filter((i) => i.type === "local_pack") : [];
  const mapPack = pack.slice(0, 3).map((i) => ({ t: i.title, d: i.domain ? normDomain(i.domain) : null, r: i.rating?.value ?? null, v: i.rating?.votes_count ?? null }));
  const paid = new Set(items.filter((i) => i.type === "paid").map((i) => normDomain(i.domain || i.url)));
  const top3 = top10.filter((x) => !x.dir).slice(0, 3).map((x) => ({ d: x.d, rd: null as number | null }));
  await env.DB.prepare(`UPDATE market_research SET top10=?, map_pack=?, directories=?, ads_in_serp=?, top3=?, serp_done=1 WHERE id=?`)
    .bind(JSON.stringify(top10), JSON.stringify(mapPack), top10.filter((x) => x.dir).length, paid.size, JSON.stringify(top3), ref.row_id).run();
}

export async function processAdsRow(env: Env, ref: { row_id: number }, result: any) {
  const items: any[] = result?.items || [];
  const n = items.filter((i) => i.type === "ads_advertiser" || i.type === "ads_multi_account_advertiser" || i.type === "ads_domain").length;
  await env.DB.prepare(`UPDATE market_research SET advertisers=?, ads_done=1 WHERE id=?`).bind(n, ref.row_id).run();
}

const clamp = (x: number) => Math.max(0, Math.min(1, x));

/**
 * R&R Opportunity Score (0–100):
 *  volume 25 · CPC (lead value) 20 · directory share in top 10 = 20 · weak backlinks of top-3 real sites 20 · advertisers (potential tenants) 15
 */
export function score(r: { volume: number | null; cpc: number | null; directories: number | null; top3_rd: number | null; advertisers: number | null; ads_in_serp: number | null }) {
  const vol = clamp(Math.log10((r.volume || 0) + 1) / Math.log10(1000));              // 1,000+/mo = full
  const cpc = clamp((r.cpc || 0) / 15);                                               // $15+ CPC = full
  const dirs = clamp((r.directories || 0) / 5);                                       // 5+ directories in top 10 = full
  const weak = r.top3_rd == null ? 0.5 : clamp(1 - Math.log10(r.top3_rd + 1) / Math.log10(300)); // 0 RD = full, 300+ = 0
  const tenants = clamp(Math.max(r.advertisers || 0, (r.ads_in_serp || 0) * 2) / 8); // 8+ advertisers = full
  return Math.round(vol * 25 + cpc * 20 + dirs * 20 + weak * 20 + tenants * 15);
}

/** When all tasks of a job are in (or the job is old), pull backlinks for top-3 domains and score. */
export async function finalizeJobs(env: Env) {
  const jobs = (await env.DB.prepare(`SELECT * FROM market_jobs WHERE status='running'`).all<{ id: number; created_at: string }>()).results;
  for (const job of jobs) {
    const pending = await env.DB.prepare(
      `SELECT COUNT(*) n FROM market_research WHERE job_id=? AND (serp_done=0 OR ads_done=0 OR vol_done=0)`
    ).bind(job.id).first<{ n: number }>();
    const old = Date.parse(job.created_at.replace(" ", "T") + "Z") < Date.now() - 6 * 3600e3;
    if (pending!.n > 0 && !old) continue;
    await env.DB.prepare(`UPDATE market_jobs SET status='scoring' WHERE id=?`).bind(job.id).run();
    try {
      const rows = (await env.DB.prepare(`SELECT * FROM market_research WHERE job_id=?`).bind(job.id).all<any>()).results;
      const domains = [...new Set(rows.flatMap((r) => (JSON.parse(r.top3 || "[]") as any[]).map((x) => x.d)))].filter(Boolean);
      const rd = new Map<string, number>();
      if (domains.length) {
        try {
          const res = await new Dfs(env).live("backlinks/bulk_referring_domains/live", { targets: domains.slice(0, 1000) });
          for (const it of res?.items || []) rd.set(normDomain(it.target), it.referring_main_domains ?? it.referring_domains ?? 0);
        } catch (e: any) { console.error("mr backlinks", e.message); }
      }
      const stmts = rows.map((r) => {
        const top3 = (JSON.parse(r.top3 || "[]") as any[]).map((x) => ({ ...x, rd: rd.has(x.d) ? rd.get(x.d)! : null }));
        const known = top3.filter((x) => x.rd != null);
        const top3_rd = known.length ? Math.round(known.reduce((s, x) => s + x.rd, 0) / known.length) : null;
        return env.DB.prepare(`UPDATE market_research SET top3=?, top3_rd=?, score=? WHERE id=?`)
          .bind(JSON.stringify(top3), top3_rd, score({ ...r, top3_rd }), r.id);
      });
      if (stmts.length) await env.DB.batch(stmts);
      await env.DB.prepare(`UPDATE market_jobs SET status='done', finished_at=datetime('now') WHERE id=?`).bind(job.id).run();
    } catch (e: any) {
      await env.DB.prepare(`UPDATE market_jobs SET status='error', error=? WHERE id=?`).bind(e.message, job.id).run();
    }
  }
}

/** Save a researched niche × city as a "researching" site in the portfolio. */
export async function shortlist(env: Env, rowId: number) {
  const r = await env.DB.prepare(
    `SELECT m.*, c.name city, c.country FROM market_research m JOIN cities c ON c.id=m.city_id WHERE m.id=?`
  ).bind(rowId).first<any>();
  if (!r) throw new Error("Row not found");
  if (r.shortlisted_site_id) return r.shortlisted_site_id as number;
  const slug = `${r.niche}-${r.city}`.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
  const tld = r.country === "NZ" ? "co.nz" : "com.au";
  const site = await env.DB.prepare(
    `INSERT INTO rr_sites(domain, niche, city_id, country, status, currency, lead_secret, notes) VALUES (?,?,?,?, 'researching', ?, ?, ?) RETURNING id`
  ).bind(`${slug}.${tld}`, r.niche, r.city_id, r.country, r.country === "NZ" ? "NZD" : "AUD", randomSecret(),
    `Shortlisted from market research: score ${r.score}, volume ${r.volume ?? "?"}, CPC $${r.cpc ?? "?"}. Domain is a placeholder.`).first<{ id: number }>();
  await env.DB.prepare(`UPDATE market_research SET shortlisted_site_id=? WHERE id=?`).bind(site!.id, rowId).run();
  return site!.id;
}
