/* Duy SEO — research & utility tools UI */
(() => {
"use strict";
const S = () => window.SEO;

// ---------- shared bits ----------
const kdClass = (v) => (v == null ? "" : v < 15 ? "kd0" : v < 30 ? "kd1" : v < 50 ? "kd2" : v < 70 ? "kd3" : v < 85 ? "kd4" : "kd5");
const kd = (v) => (v == null ? `<span class="muted">—</span>` : `<span class="kd ${kdClass(v)}">${v}</span>`);
const INTENT_NAME = { I: "Informational", N: "Navigational", C: "Commercial", T: "Transactional" };
const intents = (arr) => (arr || []).map((x) => { const k = String(x)[0].toUpperCase(); return `<span class="intent i-${k}" title="${INTENT_NAME[k] || x}">${k}</span>`; }).join("");
const intentOne = (x) => (x ? intents([x]) : "");
function trend(arr, w = 72, h = 22) {
  const v = (arr || []).map((x) => (x == null ? 0 : x));
  if (v.length < 2 || !v.some(Boolean)) return "";
  const max = Math.max(...v, 1), step = w / (v.length - 1);
  const pts = v.map((x, i) => `${(i * step).toFixed(1)},${(h - 2 - (x / max) * (h - 4)).toFixed(1)}`);
  return `<svg class="trend" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" aria-hidden="true"><path d="M0,${h} L${pts.join(" L")} L${w},${h}Z" class="trend-fill"/><path d="M${pts.join(" L")}" class="trend-line"/></svg>`;
}
const fmtK = (v) => (v == null ? "—" : v >= 1e6 ? (v / 1e6).toFixed(1) + "M" : v >= 1e4 ? Math.round(v / 1000) + "K" : v >= 1000 ? (v / 1000).toFixed(1) + "K" : String(v));
const money = (v) => (v == null ? "—" : "$" + Number(v).toFixed(2));
const lines = (s) => String(s || "").split(/\r?\n/).map((x) => x.trim()).filter(Boolean);
const head = (title, sub, actions = "") => `<div class="page-head"><div><h1>${title}</h1>${sub ? `<div class="sub">${sub}</div>` : ""}</div><div class="spacer"></div>${actions}</div>`;
const locFields = (opts = {}) => {
  const L = S().state.loc;
  return `<label class="f">Location${S().locSelect("location_code", L.location_code)}</label><label class="f">Language${S().langSelect("language_code", L.language_code)}</label>${opts.city ? S().cityField() : ""}${opts.device ? `<label class="f">Device<select name="device"><option value="desktop">Desktop</option><option value="mobile">Mobile</option></select></label>` : ""}`;
};
const form = (el) => Object.fromEntries(new FormData(el));
const empty = (t, p) => `<div class="empty"><h3>${t}</h3>${p ? `<p>${p}</p>` : ""}</div>`;
function sortable(container, rows, cols, render, initial) {
  let key = initial?.[0], dir = initial?.[1] || -1;
  const draw = () => {
    const list = key ? [...rows].sort((a, b) => { const x = a[key] ?? -Infinity, y = b[key] ?? -Infinity; return (x > y ? 1 : x < y ? -1 : 0) * dir; }) : rows;
    container.innerHTML = render(list, key, dir);
    container.querySelectorAll("th[data-s]").forEach((th) => (th.onclick = () => { dir = key === th.dataset.s ? -dir : (th.dataset.s === "position" || th.dataset.s === "keyword" ? 1 : -1); key = th.dataset.s; draw(); }));
  };
  draw();
  return draw;
}
const th = (k, label, cls = "", cur, dir) => `<th class="sortable ${cls}" data-s="${k}">${label}${cur === k ? (dir > 0 ? " ↑" : " ↓") : ""}</th>`;

// ================= Traffic Analytics =================
async function pageTraffic(domain, tab = "overview") {
  const { mount, $, esc, api } = S();
  if (!domain) {
    let recent = [];
    try { recent = JSON.parse(localStorage.getItem("recentDomains") || "[]"); } catch {}
    mount(`${head("Traffic Analytics", "Organic traffic, keywords, competitors and top pages for any domain or URL.")}
      <form class="panel row end" id="tf"><label class="f" style="flex:1;min-width:240px">Domain or URL<input name="d" required placeholder="laravel.com or https://site.com/blog/"></label>${locFields()}<button class="btn primary">Analyze</button></form>
      ${recent.length ? `<div class="panel"><div class="panel-head"><h3>Recent</h3></div><div class="row">${recent.map((d) => `<a class="btn sm" href="#/t/traffic/${encodeURIComponent(d)}/overview">${esc(d)}</a>`).join("")}</div></div>` : ""}`);
    $("#tf").onsubmit = (e) => {
      e.preventDefault();
      const f = form(e.target);
      setLoc(f);
      location.hash = `#/t/traffic/${encodeURIComponent(f.d.trim().replace(/^https?:\/\/(?=[^/]+\/?$)/, "").replace(/\/$/, ""))}/overview`;
    };
    return;
  }
  try { const r = JSON.parse(localStorage.getItem("recentDomains") || "[]").filter((x) => x !== domain); r.unshift(domain); localStorage.setItem("recentDomains", JSON.stringify(r.slice(0, 8))); } catch {}
  const L = S().state.loc;
  const tabs = [["overview", "Overview"], ["keywords", "Organic Keywords"], ["competitors", "Competitors"], ["pages", "Top Pages"]];
  mount(`${head(`<span class="muted-h">Traffic:</span> ${esc(domain)}`, `${esc(S().locName(L.location_code))} · ${esc(L.language_code)} — change the database in the top bar`, `<button class="btn" id="csv">Export CSV</button><a class="btn ghost" href="#/t/backlinks/${encodeURIComponent(domain)}">Backlinks</a>`)}
    <nav class="tabs">${tabs.map(([k, l]) => `<a href="#/t/traffic/${encodeURIComponent(domain)}/${k}" class="${tab === k ? "on" : ""}">${l}</a>`).join("")}</nav>
    <div id="tt"><div class="panel empty"><p>Loading…</p></div></div>`);
  const el = $("#tt");
  const base = { target: domain, ...L };
  let exportRows = () => [];
  $("#csv").onclick = () => { const rows = exportRows(); rows.length > 1 ? S().downloadCsv(`${domain.replace(/[^a-z0-9.]+/gi, "_")}-${tab}.csv`, rows) : S().toast("Nothing to export yet."); };
  try {
    if (tab === "overview") {
      const r = await api("POST", "/research/domain", { domain, ...L });
      S().renderDomainOverview(el, r, L);
      exportRows = () => [["keyword", "position", "volume", "kd", "visits", "url"], ...r.keywords.map((k) => [k.keyword, k.position, k.volume, k.kd, k.traffic, k.url])];
    }
    if (tab === "keywords") exportRows = await keywordsTab(el, base, domain);
    if (tab === "competitors") {
      const r = await api("POST", "/research/domain", { domain, ...L });
      el.innerHTML = `<div class="panel"><div class="tbl-wrap" id="ct"></div></div>`;
      sortable($("#ct"), r.competitors, [], (list, k, d) => `<table><thead><tr>${th("domain", "Domain", "", k, d)}${th("common", "Common keywords", "num", k, d)}${th("avg_position", "Avg. position", "num", k, d)}${th("keywords", "Their keywords", "num", k, d)}${th("traffic", "Their traffic", "num", k, d)}<th></th></tr></thead><tbody>
        ${list.map((c) => `<tr><td><a href="#/t/traffic/${encodeURIComponent(c.domain)}/overview"><b>${esc(c.domain)}</b></a></td><td class="num">${fmtK(c.common)}</td><td class="num">${c.avg_position ?? "—"}</td><td class="num">${fmtK(c.keywords)}</td><td class="num">${fmtK(c.traffic)}</td>
          <td class="num"><a class="btn sm" href="#/t/content-gap?you=${encodeURIComponent(domain)}&c=${encodeURIComponent(c.domain)}">Content gap</a></td></tr>`).join("") || `<tr><td colspan="6">${empty("No competitors found")}</td></tr>`}</tbody></table>`, ["common", -1]);
      exportRows = () => [["domain", "common", "avg_position", "keywords", "traffic"], ...r.competitors.map((c) => [c.domain, c.common, c.avg_position, c.keywords, c.traffic])];
    }
    if (tab === "pages") {
      let offset = 0;
      const load = async () => {
        const r = await api("POST", "/tools/traffic/pages", { ...base, offset });
        el.innerHTML = `<div class="panel"><div class="panel-head"><span>Showing ${offset + 1}–${offset + r.items.length} of ${S().n(r.total)} pages</span><div class="spacer"></div>${pager(offset, r.total)}</div>
          <div class="tbl-wrap"><table><thead><tr><th>Page</th><th></th><th class="num">Traffic</th><th class="num">Keywords</th><th class="num">Top 3</th><th class="num">Top 10</th><th class="num">Traffic value</th></tr></thead><tbody>
          ${r.items.map((p) => `<tr><td class="url" style="max-width:520px"><a href="${esc(p.url)}" target="_blank" rel="noopener">${esc(p.url)}</a></td><td><a class="btn sm" href="#/t/backlinks/${encodeURIComponent(p.url)}">Backlinks</a></td><td class="num">${fmtK(p.traffic)}</td><td class="num">${fmtK(p.keywords)}</td><td class="num">${fmtK(p.top3)}</td><td class="num">${fmtK(p.top10)}</td><td class="num">$${fmtK(p.value)}</td></tr>`).join("") || `<tr><td colspan="7">${empty("No pages found")}</td></tr>`}</tbody></table></div></div>`;
        wirePager(el, (o) => { offset = o; load(); });
        exportRows = () => [["url", "traffic", "keywords", "top3", "top10", "value"], ...r.items.map((p) => [p.url, p.traffic, p.keywords, p.top3, p.top10, p.value])];
      };
      await load();
    }
  } catch (e) {
    el.innerHTML = `<div class="panel">${empty("Couldn't load this report", S().esc(e.message))}</div>`;
  }
}

const pager = (offset, total, size = 100) => `<button class="btn sm" data-pg="${offset - size}" ${offset <= 0 ? "disabled" : ""}>Previous</button><button class="btn sm" data-pg="${offset + size}" ${offset + size >= total ? "disabled" : ""}>Next</button>`;
const wirePager = (el, go) => el.querySelectorAll("[data-pg]").forEach((b) => (b.onclick = () => go(Math.max(0, +b.dataset.pg))));

async function keywordsTab(el, base, domain) {
  const { api, esc, $, chip, n } = S();
  const q = { offset: 0, sort: "visits", dir: "desc" };
  let data = { items: [], total: 0 };
  el.innerHTML = `<div class="panel">
    <form class="filter-bar" id="kfil">
      <input name="q" placeholder="Keyword contains">
      <input name="url" placeholder="URL contains">
      <select name="pos_max"><option value="">Any position</option><option value="3">Top 3</option><option value="10">Top 10</option><option value="20">Top 20</option><option value="50">Top 50</option></select>
      <input name="vol_min" type="number" min="0" placeholder="Min. volume" style="width:120px">
      <select name="intent"><option value="">Any intent</option><option value="informational">Informational</option><option value="navigational">Navigational</option><option value="commercial">Commercial</option><option value="transactional">Transactional</option></select>
      <button class="btn">Apply filters</button>
    </form>
    <div class="panel-head" style="margin-top:12px"><span id="kcount" class="muted"></span><div class="spacer"></div><span id="kpg"></span></div>
    <div class="tbl-wrap" id="kt"></div></div>`;
  const load = async () => {
    $("#kt").innerHTML = `<div class="empty"><p>Loading…</p></div>`;
    data = await api("POST", "/tools/traffic/keywords", { ...base, ...q });
    $("#kcount").textContent = data.total ? `Showing ${q.offset + 1} to ${q.offset + data.items.length} of ${n(data.total)} results` : "";
    $("#kpg").innerHTML = pager(q.offset, data.total);
    wirePager($("#kpg"), (o) => { q.offset = o; load(); });
    const h = (k, label, cls = "") => `<th class="sortable ${cls}" data-k="${k}">${label}${q.sort === k ? (q.dir === "asc" ? " ↑" : " ↓") : ""}</th>`;
    $("#kt").innerHTML = data.items.length ? `<table class="kw-table"><thead><tr><th>Keyword</th><th></th><th>Intent</th>${h("volume", "Volume", "num")}<th></th>${h("kd", "KD", "num")}${h("cpc", "CPC", "num")}${h("position", "Position", "num")}${h("visits", "Visits", "num")}<th class="num">Updated</th></tr></thead><tbody>
      ${data.items.map((k) => `<tr>
        <td class="kw"><a href="https://www.google.com/search?q=${encodeURIComponent(k.keyword)}" target="_blank" rel="noopener" class="kw-link">${esc(k.keyword)}</a><div class="feat url-line">${esc(k.url || "")}</div></td>
        <td>${k.url ? `<a class="btn sm" href="#/t/backlinks/${encodeURIComponent(k.url)}">Backlinks</a>` : ""}</td>
        <td><span class="intents">${intents(k.intents)}</span></td>
        <td class="num">${fmtK(k.volume)}</td><td>${trend(k.trend)}</td><td class="num">${kd(k.kd)}</td><td class="num">${k.cpc ? k.cpc.toFixed(2) : "—"}</td>
        <td class="num"><span class="pos">${chip(k.position)}${k.is_new ? `<span class="delta up">new</span>` : k.prev_position && k.prev_position !== k.position ? S().delta(k.position, k.prev_position) : ""}</span></td>
        <td class="num">${fmtK(k.visits)}</td><td class="num small muted">${k.updated ? new Date(k.updated.replace(" ", "T").replace(/ \+\d\d:\d\d$/, "Z")).toLocaleDateString("en-US", { month: "short", day: "2-digit", year: "numeric" }) : "—"}</td></tr>`).join("")}
      </tbody></table>` : empty("No keywords match", "Loosen the filters or switch the database in the top bar.");
    $("#kt").querySelectorAll("th[data-k]").forEach((t) => (t.onclick = () => {
      const k = t.dataset.k;
      q.dir = q.sort === k ? (q.dir === "asc" ? "desc" : "asc") : k === "position" ? "asc" : "desc";
      q.sort = k; q.offset = 0; load();
    }));
  };
  $("#kfil").onsubmit = (e) => { e.preventDefault(); Object.assign(q, form(e.target), { offset: 0 }); load(); };
  await load();
  return () => [["keyword", "url", "intent", "volume", "kd", "cpc", "position", "visits", "updated"], ...data.items.map((k) => [k.keyword, k.url, k.intents.join(""), k.volume, k.kd, k.cpc, k.position, k.visits, k.updated])];
}

function setLoc(f) {
  if (!f.location_code) return;
  const st = S().state;
  st.loc = { location_code: +f.location_code, language_code: f.language_code || "en" };
  try { localStorage.setItem("loc", JSON.stringify(st.loc)); } catch {}
}

// ================= Content Gap =================
function pageContentGap() {
  const { mount, $, esc, api, busy, downloadCsv, chip } = S();
  const qs = new URLSearchParams(location.hash.split("?")[1] || "");
  mount(`${head("Content Gap", "Keywords your competitors rank for that you don't — the topics to write next.")}
    <form class="panel" id="gf"><div class="grid2">
      <label class="f">Your domain<input name="you" required value="${esc(qs.get("you") || "")}" placeholder="duy.digital"></label>
      <label class="f">Competitors (one per line, up to 4)<textarea name="competitors" style="min-height:80px" placeholder="competitor1.com\ncompetitor2.com">${esc(qs.get("c") || "")}</textarea></label>
    </div><div class="row end" style="margin-top:12px">${locFields()}<label class="f">They rank in<select name="max_pos"><option value="10">Top 10</option><option value="20" selected>Top 20</option><option value="50">Top 50</option></select></label><div class="spacer"></div><button class="btn primary">Find gaps</button></div></form>
    <div id="gr"></div>`);
  $("#gf").onsubmit = (e) => {
    e.preventDefault();
    const f = form(e.target);
    setLoc(f);
    busy(e.submitter, async () => {
      const r = await api("POST", "/tools/content-gap", f);
      $("#gr").innerHTML = `${r.errors.length ? `<div class="note err">${esc(r.errors.join("; "))}</div>` : ""}
        <div class="panel" style="margin-top:16px"><div class="panel-head"><h2>${S().n(r.rows.length)} missing keywords</h2><span class="muted small">Sorted by how many competitors rank, then volume</span><div class="spacer"></div><button class="btn" id="gcsv">Export CSV</button></div><div class="tbl-wrap" id="gt"></div></div>`;
      sortable($("#gt"), r.rows.map((x) => ({ ...x, ...Object.fromEntries(r.competitors.map((c) => [c, x.positions[c]?.p ?? null])) })), [], (list, k, d) => `<table><thead><tr>${th("keyword", "Keyword", "", k, d)}<th>Intent</th>${th("volume", "Volume", "num", k, d)}${th("kd", "KD", "num", k, d)}${th("cpc", "CPC", "num", k, d)}${th("shared_by", "Competitors", "num", k, d)}${r.competitors.map((c) => th(c, esc(c), "num", k, d)).join("")}</tr></thead><tbody>
        ${list.slice(0, 1000).map((x) => `<tr><td class="kw">${esc(x.keyword)}</td><td>${intentOne(x.intent)}</td><td class="num">${fmtK(x.volume)}</td><td class="num">${kd(x.kd)}</td><td class="num">${x.cpc ? x.cpc.toFixed(2) : "—"}</td><td class="num">${x.shared_by}/${r.competitors.length}</td>
          ${r.competitors.map((c) => `<td class="num">${x.positions[c] ? `<a href="${esc(x.positions[c].u || "#")}" target="_blank" rel="noopener">${chip(x.positions[c].p)}</a>` : `<span class="muted">—</span>`}</td>`).join("")}</tr>`).join("") || `<tr><td colspan="9">${empty("No gaps found", "Competitors don't rank for anything you're missing in this range.")}</td></tr>`}</tbody></table>`, ["shared_by", -1]);
      $("#gcsv").onclick = () => downloadCsv(`content-gap-${r.you}.csv`, [["keyword", "intent", "volume", "kd", "cpc", "competitors", ...r.competitors], ...r.rows.map((x) => [x.keyword, x.intent, x.volume, x.kd, x.cpc, x.shared_by, ...r.competitors.map((c) => x.positions[c]?.p ?? "")])]);
    }, "Comparing…");
  };
  if (qs.get("you") && qs.get("c")) $("#gf").requestSubmit($("#gf .btn.primary"));
}

// ================= Sitemap Extractor =================
function pageSitemap() {
  const { mount, $, esc, api, busy, downloadCsv, toast } = S();
  mount(`${head("Sitemap Extractor", "Pull every URL from a site's sitemaps (robots.txt, indexes and .gz files included).")}
    <form class="panel row end" id="sf"><label class="f" style="flex:1;min-width:260px">Domain or sitemap URL<input name="url" required placeholder="example.com or https://example.com/sitemap_index.xml"></label><button class="btn primary">Extract URLs</button></form><div id="sr"></div>`);
  $("#sf").onsubmit = (e) => {
    e.preventDefault();
    busy(e.submitter, async () => {
      const r = await api("POST", "/tools/sitemap", form(e.target));
      let filter = "";
      const draw = () => {
        const list = r.urls.filter((u) => !filter || u.url.toLowerCase().includes(filter));
        $("#su").innerHTML = list.length ? `<table><thead><tr><th>URL</th><th>Last modified</th><th class="num">Images</th></tr></thead><tbody>${list.slice(0, 2000).map((u) => `<tr><td class="url" style="max-width:640px"><a href="${esc(u.url)}" target="_blank" rel="noopener">${esc(u.url)}</a></td><td class="small muted">${esc((u.lastmod || "").slice(0, 10))}</td><td class="num">${u.images || ""}</td></tr>`).join("")}</tbody></table>${list.length > 2000 ? `<p class="muted small" style="padding:10px 20px">Showing 2,000 of ${S().n(list.length)}. Export CSV for the full list.</p>` : ""}` : empty("No URLs match");
      };
      $("#sr").innerHTML = `<div class="kpis" style="margin-top:16px"><div class="kpi"><div class="v">${S().n(r.urls.length)}</div><div class="l">URLs found${r.truncated ? " (limit reached)" : ""}</div></div><div class="kpi"><div class="v">${r.sitemaps.length}</div><div class="l">Sitemaps read</div></div><div class="kpi"><div class="v">${r.sitemaps.filter((s) => s.error).length}</div><div class="l">Sitemaps with errors</div></div></div>
        <div class="panel" style="margin-top:16px"><div class="panel-head"><h3>Sitemaps</h3></div><ul class="src-list">${r.sitemaps.map((s) => `<li><span style="flex:1" class="url">${esc(s.sitemap)}</span><span class="${s.error ? "err" : "muted"} small">${s.error ? esc(s.error) : s.urls ? S().n(s.urls) + " URLs" : "index"}</span></li>`).join("") || "<li class='muted'>No sitemap found. Try the sitemap URL directly.</li>"}</ul></div>
        <div class="panel"><div class="panel-head"><h3>URLs</h3><input id="sfil" placeholder="Filter URLs" style="width:240px"><div class="spacer"></div><button class="btn ghost" id="scopy">Copy URLs</button><button class="btn" id="sidx">Submit to IndexNow</button><button class="btn" id="scsv">Export CSV</button></div><div class="tbl-wrap" id="su"></div></div>`;
      draw();
      $("#sfil").oninput = (ev) => { filter = ev.target.value.toLowerCase(); draw(); };
      $("#scsv").onclick = () => downloadCsv(`sitemap-${new URL(r.origin).host}.csv`, [["url", "lastmod", "sitemap"], ...r.urls.map((u) => [u.url, u.lastmod, u.sitemap])]);
      $("#scopy").onclick = () => { navigator.clipboard.writeText(r.urls.map((u) => u.url).join("\n")); toast("URLs copied"); };
      $("#sidx").onclick = () => { sessionStorage.setItem("indexnowUrls", r.urls.map((u) => u.url).join("\n")); location.hash = "#/t/indexnow"; };
    }, "Reading sitemaps…");
  };
}

// ================= Backlink Analytics =================
async function pageBacklinks(target, tab = "overview") {
  const { mount, $, esc, api, n, lineChart, css, toast } = S();
  if (!target) {
    mount(`${head("Backlink Analytics", "Backlinks, referring domains and anchors for any domain or page.")}
      <form class="panel row end" id="bf"><label class="f" style="flex:1;min-width:260px">Domain or URL<input name="t" required placeholder="example.com or https://example.com/page/"></label><button class="btn primary">Analyze</button></form>
      <p class="muted small">Needs the Backlinks API enabled on your DataForSEO account.</p>`);
    $("#bf").onsubmit = (e) => { e.preventDefault(); location.hash = `#/t/backlinks/${encodeURIComponent(form(e.target).t.trim())}/overview`; };
    return;
  }
  const tabs = [["overview", "Overview"], ["links", "Backlinks"], ["domains", "Referring domains"], ["anchors", "Anchors"]];
  mount(`${head(`<span class="muted-h">Backlinks:</span> ${esc(target)}`, "", `<button class="btn" id="csv">Export CSV</button><a class="btn ghost" href="#/t/backlink-gap?you=${encodeURIComponent(target)}">Backlink gap</a>`)}
    <nav class="tabs">${tabs.map(([k, l]) => `<a href="#/t/backlinks/${encodeURIComponent(target)}/${k}" class="${tab === k ? "on" : ""}">${l}</a>`).join("")}</nav><div id="bt"><div class="panel empty"><p>Loading…</p></div></div>`);
  const el = $("#bt");
  let exp = () => [];
  $("#csv").onclick = () => { const r = exp(); r.length > 1 ? S().downloadCsv(`backlinks-${tab}.csv`, r) : toast("Nothing to export yet."); };
  try {
    if (tab === "overview") {
      const r = await api("POST", "/tools/backlinks/overview", { target });
      const s = r.summary;
      const bar = (rows) => { const max = Math.max(1, ...rows.map((x) => x[1])); return rows.map(([k, v]) => `<div class="hbar"><span>${esc(k || "—")}</span><i style="width:${(v / max) * 100}%"></i><b>${n(v)}</b></div>`).join(""); };
      el.innerHTML = `<div class="kpis"><div class="kpi"><div class="v">${n(s.rank)}</div><div class="l">Domain rank (0–100)</div></div><div class="kpi"><div class="v">${fmtK(s.backlinks)}</div><div class="l">Backlinks</div></div><div class="kpi"><div class="v">${fmtK(s.referring_domains)}</div><div class="l">Referring domains</div></div><div class="kpi"><div class="v">${fmtK(s.dofollow)}</div><div class="l">Dofollow links</div></div><div class="kpi"><div class="v">${s.spam_score ?? "—"}</div><div class="l">Spam score</div></div></div>
        ${r.history.length ? `<div class="panel" style="margin-top:16px"><div class="panel-head"><h3>Referring domains and backlinks, 12 months</h3></div><div class="chart-box"><canvas id="bh"></canvas></div></div>` : ""}
        <div class="split" style="margin-top:16px"><div class="panel"><div class="panel-head"><h3>Top TLDs</h3></div>${bar(s.tlds)}</div><div class="panel"><div class="panel-head"><h3>Top countries</h3></div>${bar(s.countries)}</div></div>`;
      if (r.history.length) lineChart($("#bh"), r.history.map((h) => h.d), [
        { label: "Referring domains", data: r.history.map((h) => h.rd), borderColor: css("--blue"), backgroundColor: css("--blue"), yAxisID: "y" },
        { label: "Backlinks", data: r.history.map((h) => h.backlinks), borderColor: css("--amber"), backgroundColor: css("--amber"), yAxisID: "y2" },
      ], { y2: { beginAtZero: true } });
    }
    if (tab === "links") {
      let offset = 0, mode = "domain", dofollow = false;
      const load = async () => {
        const r = await api("POST", "/tools/backlinks/list", { target, mode, offset, dofollow });
        el.innerHTML = `<div class="panel"><div class="panel-head"><div class="seg"><button class="${mode === "domain" ? "on" : ""}" data-m="domain">One per domain</button><button class="${mode === "all" ? "on" : ""}" data-m="all">All links</button></div><label class="chk"><input type="checkbox" id="df" ${dofollow ? "checked" : ""}>Dofollow only</label><div class="spacer"></div><span class="muted small">${n(r.total)} total</span>${pager(offset, r.total)}</div>
          <div class="tbl-wrap"><table><thead><tr><th>Referring page</th><th class="num">DR</th><th>Anchor / target</th><th>Type</th><th>First seen</th></tr></thead><tbody>
          ${r.items.map((b) => `<tr><td class="url" style="max-width:380px"><a href="${esc(b.url_from)}" target="_blank" rel="noopener">${esc(b.url_from)}</a><div class="feat">${esc(b.domain_from)}</div></td><td class="num">${b.domain_rank ?? "—"}</td>
            <td class="small" style="max-width:320px"><b>${esc(b.anchor || "(no anchor)")}</b><div class="muted url">${esc(b.url_to)}</div></td><td>${b.dofollow ? `<span class="badge ok">dofollow</span>` : `<span class="badge plain">nofollow</span>`} <span class="feat">${esc(b.type || "")}</span></td><td class="small muted">${esc(b.first_seen)}</td></tr>`).join("") || `<tr><td colspan="5">${empty("No backlinks found")}</td></tr>`}</tbody></table></div></div>`;
        el.querySelectorAll("[data-m]").forEach((b) => (b.onclick = () => { mode = b.dataset.m; offset = 0; load(); }));
        $("#df").onchange = (e) => { dofollow = e.target.checked; offset = 0; load(); };
        wirePager(el, (o) => { offset = o; load(); });
        exp = () => [["url_from", "domain_rank", "anchor", "url_to", "dofollow", "first_seen"], ...r.items.map((b) => [b.url_from, b.domain_rank, b.anchor, b.url_to, b.dofollow, b.first_seen])];
      };
      await load();
    }
    if (tab === "domains") {
      let offset = 0;
      const load = async () => {
        const r = await api("POST", "/tools/backlinks/domains", { target, offset });
        el.innerHTML = `<div class="panel"><div class="panel-head"><span class="muted small">${n(r.total)} referring domains</span><div class="spacer"></div>${pager(offset, r.total)}</div><div class="tbl-wrap"><table><thead><tr><th>Domain</th><th class="num">DR</th><th class="num">Backlinks</th><th class="num">Dofollow</th><th class="num">Spam</th><th>First seen</th></tr></thead><tbody>
          ${r.items.map((d) => `<tr><td><a href="#/t/traffic/${encodeURIComponent(d.domain)}/overview"><b>${esc(d.domain)}</b></a></td><td class="num">${d.rank ?? "—"}</td><td class="num">${n(d.backlinks)}</td><td class="num">${n(d.dofollow)}</td><td class="num">${d.spam ?? "—"}</td><td class="small muted">${esc(d.first_seen)}</td></tr>`).join("") || `<tr><td colspan="6">${empty("No referring domains")}</td></tr>`}</tbody></table></div></div>`;
        wirePager(el, (o) => { offset = o; load(); });
        exp = () => [["domain", "rank", "backlinks", "dofollow", "spam", "first_seen"], ...r.items.map((d) => [d.domain, d.rank, d.backlinks, d.dofollow, d.spam, d.first_seen])];
      };
      await load();
    }
    if (tab === "anchors") {
      const r = await api("POST", "/tools/backlinks/anchors", { target });
      el.innerHTML = `<div class="panel"><div class="tbl-wrap"><table><thead><tr><th>Anchor</th><th class="num">Referring domains</th><th class="num">Backlinks</th><th>First seen</th></tr></thead><tbody>${r.items.map((a) => `<tr><td class="kw">${esc(a.anchor || "(empty)")}</td><td class="num">${n(a.referring_domains)}</td><td class="num">${n(a.backlinks)}</td><td class="small muted">${esc(a.first_seen)}</td></tr>`).join("") || `<tr><td colspan="4">${empty("No anchors")}</td></tr>`}</tbody></table></div></div>`;
      exp = () => [["anchor", "referring_domains", "backlinks"], ...r.items.map((a) => [a.anchor, a.referring_domains, a.backlinks])];
    }
  } catch (e) {
    el.innerHTML = `<div class="panel">${empty("Couldn't load backlinks", esc(e.message) + (/access|subscri/i.test(e.message) ? "<br>Activate the Backlinks API in your DataForSEO account." : ""))}</div>`;
  }
}

// ================= Backlink Gap =================
function pageBacklinkGap() {
  const { mount, $, esc, api, busy, n, downloadCsv } = S();
  const qs = new URLSearchParams(location.hash.split("?")[1] || "");
  mount(`${head("Backlink Gap", "Sites that link to your competitors but not to you — your outreach list.")}
    <form class="panel" id="lf"><div class="grid2"><label class="f">Your domain<input name="you" required value="${esc(qs.get("you") || "")}" placeholder="duy.digital"></label>
      <label class="f">Competitors (one per line, up to 10)<textarea name="competitors" style="min-height:80px" placeholder="competitor1.com\ncompetitor2.com"></textarea></label></div>
      <div class="row end" style="margin-top:12px"><label class="f">Linking to at least<select name="min_shared"><option value="1">1 competitor</option><option value="2" selected>2 competitors</option><option value="3">3 competitors</option></select></label><div class="spacer"></div><button class="btn primary">Find link gaps</button></div></form><div id="lr"></div>`);
  $("#lf").onsubmit = (e) => {
    e.preventDefault();
    busy(e.submitter, async () => {
      const r = await api("POST", "/tools/backlinks/gap", form(e.target));
      $("#lr").innerHTML = `<div class="panel" style="margin-top:16px"><div class="panel-head"><h2>${n(r.rows.length)} link opportunities</h2><div class="spacer"></div><button class="btn" id="lcsv">Export CSV</button></div><div class="tbl-wrap" id="lt"></div></div>`;
      sortable($("#lt"), r.rows, [], (list, k, d) => `<table><thead><tr>${th("domain", "Referring domain", "", k, d)}${th("rank", "DR", "num", k, d)}${th("shared", "Links to", "num", k, d)}${r.competitors.map((c) => `<th class="num">${esc(c)}</th>`).join("")}${th("spam", "Spam", "num", k, d)}</tr></thead><tbody>
        ${list.map((x) => `<tr><td><a href="https://${esc(x.domain)}" target="_blank" rel="noopener"><b>${esc(x.domain)}</b></a></td><td class="num">${x.rank ?? "—"}</td><td class="num">${x.shared}/${r.competitors.length}</td>${r.competitors.map((c) => `<td class="num">${x.links[c] ? n(x.links[c]) : `<span class="muted">—</span>`}</td>`).join("")}<td class="num">${x.spam ?? "—"}</td></tr>`).join("") || `<tr><td colspan="9">${empty("No gaps at this threshold")}</td></tr>`}</tbody></table>`, ["shared", -1]);
      $("#lcsv").onclick = () => downloadCsv(`backlink-gap-${r.you}.csv`, [["domain", "rank", "shared", ...r.competitors, "spam"], ...r.rows.map((x) => [x.domain, x.rank, x.shared, ...r.competitors.map((c) => x.links[c] || 0), x.spam])]);
    }, "Comparing…");
  };
}

// ================= Bulk keyword analysis =================
function pageBulkKeywords() {
  const { mount, $, esc, api, busy, downloadCsv } = S();
  const pre = sessionStorage.getItem("bulkKeywords") || "";
  sessionStorage.removeItem("bulkKeywords");
  mount(`${head("Bulk Keyword Analysis", "Volume, CPC, difficulty and intent for up to 1,000 keywords at once.")}
    <form class="panel" id="bk"><label class="f">Keywords, one per line<textarea name="keywords" style="min-height:160px" placeholder="roof repairs brisbane\nemergency roof repair">${esc(pre)}</textarea></label>
      <div class="row end" style="margin-top:12px">${locFields({ city: true })}<span class="muted small" id="bkc"></span><div class="spacer"></div><button class="btn primary">Get metrics</button></div></form><div id="br"></div>`);
  const ta = $("#bk").keywords;
  const count = () => ($("#bkc").textContent = `${lines(ta.value).length} keywords`);
  ta.oninput = count; count();
  $("#bk").onsubmit = (e) => {
    e.preventDefault();
    const f = form(e.target); setLoc(f);
    busy(e.submitter, async () => {
      const r = await api("POST", "/tools/bulk-keywords", f);
      $("#br").innerHTML = `${r.errors.length ? `<div class="note err" style="margin-top:12px">${esc(r.errors.join("; "))}</div>` : ""}<div class="panel" style="margin-top:16px"><div class="panel-head"><h2>${r.rows.length} keywords</h2><div class="spacer"></div><button class="btn ghost" id="toSerp">SERP-cluster these</button><button class="btn ghost" id="toSem">Semantic-cluster these</button><button class="btn" id="bcsv">Export CSV</button></div><div class="tbl-wrap" id="bt"></div></div>`;
      sortable($("#bt"), r.rows, [], (list, k, d) => `<table><thead><tr>${th("keyword", "Keyword", "", k, d)}<th>Intent</th>${th("volume", "Volume", "num", k, d)}<th></th>${th("kd", "KD", "num", k, d)}${th("cpc", "CPC", "num", k, d)}${th("competition", "Competition", "", k, d)}</tr></thead><tbody>
        ${list.map((x) => `<tr><td class="kw">${esc(x.keyword)}</td><td><span class="intents">${intents([x.intent, ...(x.secondary || [])].filter(Boolean))}</span></td><td class="num">${fmtK(x.volume)}</td><td>${trend(x.trend)}</td><td class="num">${kd(x.kd)}</td><td class="num">${x.cpc ? x.cpc.toFixed(2) : "—"}</td><td class="small">${esc((x.competition || "").toString().toLowerCase())}</td></tr>`).join("")}</tbody></table>`, ["volume", -1]);
      const withVol = r.rows.map((x) => `${x.keyword}\t${x.volume ?? 0}`).join("\n");
      $("#bcsv").onclick = () => downloadCsv("bulk-keywords.csv", [["keyword", "intent", "volume", "kd", "cpc", "competition"], ...r.rows.map((x) => [x.keyword, x.intent, x.volume, x.kd, x.cpc, x.competition])]);
      $("#toSerp").onclick = () => { sessionStorage.setItem("clusterKeywords", withVol); location.hash = "#/t/serp-cluster"; };
      $("#toSem").onclick = () => { sessionStorage.setItem("clusterKeywords", withVol); location.hash = "#/t/semantic"; };
    }, "Fetching metrics…");
  };
}

// ================= Bulk PAA =================
function pagePaa() {
  const { mount, $, esc, api, busy, downloadCsv } = S();
  mount(`${head("Bulk Google PAA", "Collect “People also ask” questions for many keywords, expanding up to four layers deep.")}
    <form class="panel" id="pf"><label class="f">Keywords, one per line (up to 50)<textarea name="keywords" style="min-height:120px" placeholder="how to fix a leaking roof\nroof restoration cost"></textarea></label>
      <div class="row end" style="margin-top:12px">${locFields({ device: true, city: true })}<label class="f">Depth<select name="depth"><option value="1">1 layer</option><option value="2" selected>2 layers</option><option value="3">3 layers</option><option value="4">4 layers</option></select></label><span class="muted small">≈ $0.002 + $0.00015 per extra layer, per keyword</span><div class="spacer"></div><button class="btn primary">Get questions</button></div></form><div id="pr"></div>`);
  $("#pf").onsubmit = (e) => {
    e.preventDefault();
    const f = form(e.target); setLoc(f);
    busy(e.submitter, async () => {
      const r = await api("POST", "/tools/paa", f);
      const total = r.reduce((s, k) => s + k.questions.length, 0);
      $("#pr").innerHTML = `<div class="panel" style="margin-top:16px"><div class="panel-head"><h2>${total} questions</h2><span class="muted small">from ${r.length} keywords</span><div class="spacer"></div><button class="btn ghost" id="pcopy">Copy questions</button><button class="btn" id="pcsv">Export CSV</button></div>
        ${r.map((k) => `<details class="acc" ${r.length <= 3 ? "open" : ""}><summary><b>${esc(k.keyword)}</b><span class="muted small">${k.error ? esc(k.error) : k.questions.length + " questions"}</span></summary>
          <ul class="src-list">${k.questions.map((q) => `<li><span style="flex:1"><b>${esc(q.q)}</b>${q.answer ? `<div class="muted small">${esc(q.answer.slice(0, 220))}${q.answer.length > 220 ? "…" : ""}</div>` : ""}</span>${q.url ? `<a class="small" href="${esc(q.url)}" target="_blank" rel="noopener">${esc(q.domain || "source")}</a>` : ""}</li>`).join("") || "<li class='muted'>No PAA box for this keyword.</li>"}</ul></details>`).join("")}</div>`;
      $("#pcsv").onclick = () => downloadCsv("people-also-ask.csv", [["keyword", "question", "answer", "source"], ...r.flatMap((k) => k.questions.map((q) => [k.keyword, q.q, q.answer, q.url]))]);
      $("#pcopy").onclick = () => { navigator.clipboard.writeText([...new Set(r.flatMap((k) => k.questions.map((q) => q.q)))].join("\n")); S().toast("Questions copied"); };
    }, "Collecting…");
  };
}

// ================= Bulk Autocomplete =================
function pageAutocomplete() {
  const { mount, $, esc, api, busy, downloadCsv } = S();
  mount(`${head("Bulk Autocomplete", "Google, Bing and YouTube suggestions for many seeds, expanded with a–z and question words. Free — no API credits.")}
    <form class="panel" id="af"><label class="f">Seed keywords, one per line (up to 20)<textarea name="seeds" style="min-height:100px" placeholder="roof repair\nweb design"></textarea></label>
      <div class="row end" style="margin-top:12px"><label class="f">Engine<select name="engine"><option value="google">Google</option><option value="bing">Bing</option><option value="youtube">YouTube</option></select></label>
      <label class="f">Expand with<select name="expand"><option value="none">Seed only</option><option value="alphabet" selected>a–z, 0–9</option><option value="questions">Question words</option><option value="both">Both</option></select></label>
      <label class="f">Country<select name="gl"><option value="au">Australia</option><option value="nz">New Zealand</option><option value="us">United States</option><option value="gb">United Kingdom</option><option value="vn">Vietnam</option><option value="sg">Singapore</option></select></label>
      <label class="f">Language<select name="hl"><option value="en">English</option><option value="vi">Vietnamese</option></select></label><div class="spacer"></div><button class="btn primary">Get suggestions</button></div></form><div id="ar"></div>`);
  $("#af").onsubmit = (e) => {
    e.preventDefault();
    busy(e.submitter, async () => {
      const r = await api("POST", "/tools/autocomplete", form(e.target));
      let filter = "";
      $("#ar").innerHTML = `${r.errors.length ? `<div class="note err" style="margin-top:12px">${esc(r.errors.join("; "))}</div>` : ""}<div class="panel" style="margin-top:16px"><div class="panel-head"><h2>${S().n(r.rows.length)} suggestions</h2><span class="muted small">${r.queries} lookups</span><input id="afil" placeholder="Filter" style="width:200px"><div class="spacer"></div><button class="btn ghost" id="ametrics">Get metrics</button><button class="btn" id="acsv">Export CSV</button></div><div class="tbl-wrap" id="at"></div></div>`;
      const draw = () => {
        const list = r.rows.filter((x) => !filter || x.keyword.includes(filter));
        $("#at").innerHTML = `<table><thead><tr><th>Suggestion</th><th>Seed</th><th>Found via</th></tr></thead><tbody>${list.slice(0, 3000).map((x) => `<tr><td class="kw">${esc(x.keyword)}</td><td class="small muted">${esc(x.seed)}</td><td class="small muted">${esc(x.mods.slice(0, 6).join(", ") || "seed")}</td></tr>`).join("")}</tbody></table>`;
      };
      draw();
      $("#afil").oninput = (ev) => { filter = ev.target.value.toLowerCase(); draw(); };
      $("#acsv").onclick = () => downloadCsv("autocomplete.csv", [["suggestion", "seed", "modifiers"], ...r.rows.map((x) => [x.keyword, x.seed, x.mods.join(" ")])]);
      $("#ametrics").onclick = () => { sessionStorage.setItem("bulkKeywords", r.rows.slice(0, 1000).map((x) => x.keyword).join("\n")); location.hash = "#/t/bulk-keywords"; };
    }, "Fetching suggestions…");
  };
}

// ================= Semantic clustering =================
function clusterView(el, r, csvName) {
  const { esc, downloadCsv } = S();
  el.innerHTML = `<div class="panel" style="margin-top:16px"><div class="panel-head"><h2>${r.clusters.length} clusters</h2><span class="muted small">${r.unclustered.length} unclustered${r.model ? " · " + esc(r.model) : ""}</span><div class="spacer"></div><button class="btn" id="ccsv">Export CSV</button></div>
    ${r.clusters.map((c, i) => `<details class="acc" ${i < 3 ? "open" : ""}><summary><b>${esc(c.primary)}</b><span class="muted small">${c.keywords.length} keywords${c.volume ? " · " + fmtK(c.volume) + " searches" : ""}</span></summary>
      <table><tbody>${c.keywords.map((k) => `<tr><td class="kw">${esc(k.keyword)}</td><td class="num small muted">${k.volume != null ? fmtK(k.volume) : ""}</td><td class="num small muted">${k.sim != null ? "similarity " + k.sim : k.shared != null ? k.shared + " shared URLs" : ""}</td></tr>`).join("")}</tbody></table>
      ${c.top_urls ? `<div class="feat" style="padding:6px 0 10px">Ranking pages: ${c.top_urls.map((u) => esc(u.u)).join(" · ")}</div>` : ""}</details>`).join("") || empty("No clusters at this setting", "Lower the threshold to group more loosely.")}
    ${r.unclustered.length ? `<details class="acc"><summary><b>Unclustered</b><span class="muted small">${r.unclustered.length} keywords</span></summary><p class="small">${r.unclustered.map(esc).join(", ")}</p></details>` : ""}</div>`;
  el.querySelector("#ccsv").onclick = () => downloadCsv(csvName, [["cluster", "keyword", "volume"], ...r.clusters.flatMap((c) => c.keywords.map((k) => [c.primary, k.keyword, k.volume ?? ""])), ...r.unclustered.map((k) => ["(unclustered)", k, ""])]);
}

function pageSemantic() {
  const { mount, $, esc, api, busy } = S();
  const pre = sessionStorage.getItem("clusterKeywords") || "";
  sessionStorage.removeItem("clusterKeywords");
  mount(`${head("Semantic Clustering", "Group keywords by meaning with multilingual embeddings (Workers AI, bge-m3). No DataForSEO credits.")}
    <form class="panel" id="smf"><label class="f">Keywords, one per line — optionally “keyword, volume”<textarea name="keywords" style="min-height:160px" placeholder="roof repair brisbane, 720\nfix leaking roof, 320\nroof restoration cost, 210">${esc(pre)}</textarea></label>
      <div class="row end" style="margin-top:12px"><label class="f">Similarity threshold <span class="muted" id="thv">0.80</span><input type="range" name="threshold" min="0.6" max="0.95" step="0.01" value="0.8" style="width:220px"></label><span class="muted small">Higher = tighter clusters</span><div class="spacer"></div><button class="btn primary">Cluster keywords</button></div></form><div id="smr"></div>`);
  const f = $("#smf");
  f.threshold.oninput = () => ($("#thv").textContent = Number(f.threshold.value).toFixed(2));
  f.onsubmit = (e) => { e.preventDefault(); busy(e.submitter, async () => clusterView($("#smr"), await api("POST", "/tools/semantic", form(f)), "semantic-clusters.csv"), "Clustering…"); };
}

// ================= SERP clustering =================
async function pageSerpCluster(id) {
  const { mount, $, esc, api, busy, ago, toast } = S();
  if (id) {
    let threshold = 4, algo = "default";
    mount(`${head("SERP Clustering", "Keywords that share ranking URLs belong on the same page.", `<a class="btn ghost" href="#/t/serp-cluster">All runs</a>`)}
      <div class="panel row end"><label class="f">Shared URLs needed<select id="th">${[3, 4, 5, 6, 7].map((x) => `<option ${x === 4 ? "selected" : ""}>${x}</option>`).join("")}</select></label>
        <label class="f">Algorithm<select id="al"><option value="default">Default — broad topics</option><option value="balanced">Balanced strict</option><option value="strict">Strict — tight clusters</option></select></label><span class="muted small" id="prog"></span><div class="spacer"></div><button class="btn" id="ref">Refresh</button></div><div id="scr"></div>`);
    const load = async () => {
      const r = await api("GET", `/tools/serp-cluster/${id}?threshold=${threshold}&algo=${algo}`);
      $("#prog").textContent = r.job.missing ? `Collecting SERPs: ${r.job.total - r.job.missing}/${r.job.total} — results fill in as they arrive` : `${r.job.total} keywords · all SERPs in`;
      clusterView($("#scr"), r, `serp-clusters-${id}.csv`);
    };
    $("#th").onchange = (e) => { threshold = +e.target.value; load(); };
    $("#al").onchange = (e) => { algo = e.target.value; load(); };
    $("#ref").onclick = (e) => busy(e.currentTarget, async () => { await api("POST", "/collect"); await load(); }, "Refreshing…");
    return load();
  }
  const pre = sessionStorage.getItem("clusterKeywords") || "";
  sessionStorage.removeItem("clusterKeywords");
  const jobs = await api("GET", "/tools/serp-cluster");
  mount(`${head("SERP Clustering", "Group keywords by the pages Google ranks for them — the most reliable way to plan one page per intent.")}
    <form class="panel" id="scf"><label class="f">Keywords, one per line — optionally “keyword, volume” (up to 1,000)<textarea name="keywords" style="min-height:150px" placeholder="roof repair brisbane, 720\nroof repairs brisbane, 590">${esc(pre)}</textarea></label>
      <div class="row end" style="margin-top:12px"><input name="name" placeholder="Run name (optional)" style="width:200px">${locFields({ device: true, city: true })}<label class="f">Reuse SERPs fetched within<select name="reuse_days"><option value="7">7 days</option><option value="14" selected>14 days</option><option value="30">30 days</option></select></label><span class="muted small">≈ $0.0006 per new SERP</span><div class="spacer"></div><button class="btn primary">Start clustering</button></div></form>
    <div class="panel"><div class="panel-head"><h2>Runs</h2></div>${jobs.length ? `<div class="tbl-wrap"><table><thead><tr><th>Run</th><th class="num">Keywords</th><th>Status</th><th>Started</th><th></th></tr></thead><tbody>${jobs.map((j) => `<tr class="clickable" data-go="#/t/serp-cluster/${j.id}"><td><b>${esc(j.name)}</b></td><td class="num">${j.keywords}</td><td>${j.status === "done" ? `<span class="badge ok">done</span>` : `<span class="badge plain">collecting</span>`}</td><td class="small muted">${ago(j.created_at)}</td><td class="num"><button class="btn ghost sm danger" data-del="${j.id}" aria-label="Delete run">✕</button></td></tr>`).join("")}</tbody></table></div>` : empty("No runs yet")}</div>`);
  $("#scf").onsubmit = (e) => {
    e.preventDefault();
    const f = form(e.target); setLoc(f);
    busy(e.submitter, async () => {
      const r = await api("POST", "/tools/serp-cluster", f);
      toast(r.queued ? `Fetching ${r.queued} SERPs (${r.reused} reused). Results fill in over the next minutes.` : "All SERPs reused from cache.", 5000);
      location.hash = `#/t/serp-cluster/${r.id}`;
    }, "Starting…");
  };
  $$q("[data-go]").forEach((tr) => (tr.onclick = (ev) => { if (!ev.target.closest("[data-del]")) location.hash = tr.dataset.go; }));
  $$q("[data-del]").forEach((b) => (b.onclick = async () => { if (confirm("Delete this run?")) { await api("DELETE", `/tools/serp-cluster/${b.dataset.del}`); pageSerpCluster(); } }));
}
const $$q = (s) => S().$$(s);

// ================= SERP Similarity =================
function pageSerpSimilarity() {
  const { mount, $, esc, api, busy } = S();
  mount(`${head("SERP Similarity", "Do these keywords need one page or separate pages? Compare their top 10 results.")}
    <form class="panel" id="ssf"><label class="f">2 to 6 keywords, one per line<textarea name="keywords" style="min-height:110px" placeholder="roof repair brisbane\nroof restoration brisbane"></textarea></label>
      <div class="row end" style="margin-top:12px">${locFields({ device: true, city: true })}<div class="spacer"></div><button class="btn primary">Compare SERPs</button></div></form><div id="ssr"></div>`);
  $("#ssf").onsubmit = (e) => {
    e.preventDefault();
    const f = form(e.target); setLoc(f);
    busy(e.submitter, async () => {
      const r = await api("POST", "/tools/serp-similarity", f);
      const verdict = { same: ["ok", "Target with one page"], maybe: ["cited", "Partly related — consider one page with sections"], separate: ["bad", "Use separate pages"] };
      const shared = new Set(r.pairs.flatMap((p) => p.urls.map((u) => u.replace(/^https?:\/\/(www\.)?/, "").replace(/\/$/, ""))));
      $("#ssr").innerHTML = `<div class="panel" style="margin-top:16px"><div class="panel-head"><h2>Overlap</h2><span class="muted small">4+ shared URLs out of 10 usually means the same intent</span></div><div class="tbl-wrap"><table><thead><tr><th>Keyword A</th><th>Keyword B</th><th class="num">Shared URLs</th><th>Similarity</th><th>Verdict</th></tr></thead><tbody>
        ${r.pairs.map((p) => `<tr><td class="kw">${esc(p.a)}</td><td class="kw">${esc(p.b)}</td><td class="num">${p.shared}/10</td><td><span class="score"><b>${p.pct}%</b><i style="width:${p.pct}%;background:${p.pct >= 40 ? "var(--up)" : p.pct >= 20 ? "var(--amber)" : "var(--ink-3)"}"></i></span></td><td><span class="badge ${verdict[p.verdict][0]}">${verdict[p.verdict][1]}</span></td></tr>`).join("")}</tbody></table></div></div>
        <div class="serp-cols">${r.serps.map((s) => `<div class="panel"><div class="panel-head"><h3>${esc(s.keyword)}</h3>${s.cached ? `<span class="badge plain">cached</span>` : ""}</div><ol class="serp-list">${s.urls.map((u) => `<li class="${shared.has(u.u.replace(/^https?:\/\/(www\.)?/, "").replace(/\/$/, "")) ? "shared" : ""}"><b>${esc(u.d)}</b><span class="url">${esc(S().shortUrl(u.u))}</span></li>`).join("")}</ol></div>`).join("")}</div>`;
    }, "Fetching SERPs…");
  };
}

// ================= SERP UULE =================
const UULE_KEY = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";
function uule(name) {
  const bytes = new TextEncoder().encode(name);
  if (bytes.length >= UULE_KEY.length) return null;
  return "w+CAIQICI" + UULE_KEY[bytes.length] + btoa(String.fromCharCode(...bytes));
}
function pageUule() {
  const { mount, $, esc, api, busy, toast } = S();
  const countries = [["au", "Australia", "en", "au"], ["nz", "New Zealand", "en", "nz"], ["us", "United States", "en", "us"], ["gb", "United Kingdom", "en", "uk"], ["vn", "Vietnam", "vi", "vn"], ["sg", "Singapore", "en", "sg"], ["ca", "Canada", "en", "ca"]];
  mount(`${head("SERP UULE", "See Google from any city: build a location-encoded search URL, or fetch that local top 10.")}
    <div class="panel"><div class="row end"><label class="f">Country<select id="uc">${countries.map(([c, l]) => `<option value="${c}">${l}</option>`).join("")}</select></label>
      <label class="f" style="flex:1;min-width:220px">Find a city or region<input id="uq" placeholder="Brisbane" autocomplete="off"></label>
      <label class="f" style="flex:1;min-width:220px">Keyword<input id="uk" placeholder="roof repair"></label></div>
      <ul class="loc-results" id="ul"></ul></div><div id="ur"></div>`);
  let timer, picked = null;
  const search = () => {
    clearTimeout(timer);
    timer = setTimeout(async () => {
      const list = await api("GET", `/tools/locations?country=${$("#uc").value}&q=${encodeURIComponent($("#uq").value)}`).catch((e) => { toast(e.message); return []; });
      $("#ul").innerHTML = list.map((l, i) => `<li><button data-i="${i}"><b>${esc(l.n)}</b><span class="muted small">${esc(l.t)} · ${l.c}</span></button></li>`).join("") || `<li class="muted small">No matches</li>`;
      $("#ul").querySelectorAll("[data-i]").forEach((b) => (b.onclick = () => { picked = list[+b.dataset.i]; show(); }));
    }, 300);
  };
  const show = () => {
    if (!picked) return;
    const c = countries.find((x) => x[0] === $("#uc").value);
    const code = uule(picked.n);
    const q = $("#uk").value.trim() || "plumber";
    const url = `https://www.google.com/search?q=${encodeURIComponent(q)}&gl=${c[0]}&hl=${c[2]}&pws=0&uule=${code ? encodeURIComponent(code).replace(/%2B/g, "+") : ""}`;
    $("#ur").innerHTML = `<div class="panel"><div class="panel-head"><h2>${esc(picked.n)}</h2><span class="badge plain">${esc(picked.t)}</span></div>
      ${code ? `<label class="f">UULE parameter<span class="row"><input readonly value="${esc(code)}" style="flex:1" id="uv"><button class="btn sm" data-copy="uv">Copy</button></span></label>
      <label class="f" style="margin-top:10px">Google search URL<span class="row"><input readonly value="${esc(url)}" style="flex:1" id="uu"><button class="btn sm" data-copy="uu">Copy</button><a class="btn sm primary" href="${esc(url)}" target="_blank" rel="noopener">Open in Google</a></span></label>
      <p class="muted small" style="margin-top:8px">Open in a private window — signed-in history can still personalise results.</p>` : `<p class="err">This location name is too long for UULE encoding.</p>`}
      <div class="row" style="margin-top:12px"><button class="btn" id="up">Fetch this local top 10 (DataForSEO)</button></div><div id="upr"></div></div>`;
    $("#ur").querySelectorAll("[data-copy]").forEach((b) => (b.onclick = () => { navigator.clipboard.writeText($("#" + b.dataset.copy).value); toast("Copied"); }));
    $("#up").onclick = (e) => busy(e.currentTarget, async () => {
      const r = await api("POST", "/tools/serp-preview", { keyword: q, location_name: picked.n, language_code: c[2], device: "mobile" });
      $("#upr").innerHTML = `<ol class="serp-list" style="margin-top:12px">${r.urls.map((u) => `<li><b>${esc(u.d)}</b><span class="url">${esc(u.t || "")}</span></li>`).join("")}</ol><div class="feat">SERP features: ${esc(r.features.join(", ") || "none")}</div>`;
    }, "Fetching…");
  };
  $("#uq").oninput = search; $("#uc").onchange = search; $("#uk").oninput = () => picked && show();
  search();
}

// ================= Search Console =================
async function pageGsc(property) {
  const { mount, $, esc, api, busy, toast, n, lineChart, css, downloadCsv } = S();
  if (!property) {
    const r = await api("GET", "/tools/gsc/sites");
    const savedSet = new Set(r.saved.map((s) => s.property));
    mount(`${head("Search Console", "Clicks, impressions, CTR and position for every property your service account can read.")}
      ${r.error ? `<div class="note err" style="margin-bottom:16px">${esc(r.error)} — set the GSC_SERVICE_ACCOUNT secret and add its email as a user on each property.</div>` : ""}
      <div class="panel"><div class="panel-head"><h2>Your sites</h2></div>${r.saved.length ? `<div class="tbl-wrap"><table><thead><tr><th>Site</th><th>Property</th><th></th></tr></thead><tbody>${r.saved.map((s) => `<tr class="clickable" data-go="#/t/gsc/${encodeURIComponent(s.property)}"><td><b>${esc(s.label)}</b></td><td class="small muted">${esc(s.property)}</td><td class="num"><button class="btn ghost sm danger" data-rm="${esc(s.property)}" aria-label="Remove site">✕</button></td></tr>`).join("")}</tbody></table></div>` : empty("No sites added yet", "Add one below.")}</div>
      <div class="panel"><div class="panel-head"><h2>Add site</h2></div>
        ${r.visible.filter((v) => !savedSet.has(v.property)).length ? `<p class="small">Properties the service account can already read:</p><div class="row" style="margin-bottom:14px">${r.visible.filter((v) => !savedSet.has(v.property)).map((v) => `<button class="btn sm" data-add="${esc(v.property)}">+ ${esc(v.property)}</button>`).join("")}</div>` : ""}
        <form class="row end" id="gaf"><label class="f" style="flex:1;min-width:220px">Property<input name="property" required placeholder="sc-domain:example.com or https://example.com/"></label><label class="f">Label<input name="label" placeholder="Example"></label><button class="btn primary">Add site</button></form>
        <p class="muted small" style="margin-top:10px">In Search Console → Settings → Users and permissions, add the service-account email (shown on Rank &amp; Rent → Alerts) as a Restricted user.</p></div>`);
    const add = async (property, label) => { await api("POST", "/tools/gsc/sites", { property, label }); toast("Site added"); pageGsc(); };
    $("#gaf").onsubmit = (e) => { e.preventDefault(); const f = form(e.target); busy(e.submitter, () => add(f.property, f.label), "Checking access…"); };
    $$q("[data-add]").forEach((b) => (b.onclick = () => busy(b, () => add(b.dataset.add, ""))));
    $$q("[data-go]").forEach((tr) => (tr.onclick = (ev) => { if (!ev.target.closest("[data-rm]")) location.hash = tr.dataset.go; }));
    $$q("[data-rm]").forEach((b) => (b.onclick = async () => { if (confirm("Remove this site from the list?")) { await api("DELETE", `/tools/gsc/sites?property=${encodeURIComponent(b.dataset.rm)}`); pageGsc(); } }));
    return;
  }
  const q = { days: 28, dimension: "query", filter: "" };
  mount(`${head(esc(property.replace(/^sc-domain:|^https?:\/\//, "").replace(/\/$/, "")), esc(property), `<a class="btn ghost" href="#/t/gsc">All sites</a>`)}
    <div class="panel row end"><div class="seg" id="rng">${[[7, "7 days"], [28, "28 days"], [90, "3 months"], [180, "6 months"], [365, "12 months"], [480, "16 months"]].map(([d, l]) => `<button data-d="${d}" class="${d === 28 ? "on" : ""}">${l}</button>`).join("")}</div><div class="spacer"></div><button class="btn" id="gcsv">Export CSV</button></div>
    <div id="gk" style="margin-top:16px"></div>
    <div class="panel" style="margin-top:16px"><div class="chart-box"><canvas id="gch"></canvas></div></div>
    <div class="panel"><nav class="tabs" style="margin-bottom:12px">${[["query", "Queries"], ["page", "Pages"], ["country", "Countries"], ["device", "Devices"], ["searchAppearance", "Search appearance"]].map(([k, l]) => `<a href="javascript:void 0" data-dim="${k}" class="${k === "query" ? "on" : ""}">${l}</a>`).join("")}</nav>
      <form class="row" id="gff"><input name="f" placeholder="Filter queries or pages (contains)" style="flex:1;max-width:360px"><button class="btn">Filter</button></form><div class="tbl-wrap" id="gt" style="margin-top:10px"></div></div>`);
  let data = null;
  const pct = (a, b) => (b ? Math.round(((a - b) / b) * 100) : null);
  const kpi = (label, now, prev, fmt, lowerBetter) => {
    const d = lowerBetter ? (prev && now ? prev - now : null) : pct(now, prev);
    return `<div class="kpi"><div class="v">${fmt(now)}</div><div class="l">${label}</div>${d != null && isFinite(d) && d !== 0 ? `<div class="d delta ${d > 0 ? "up" : "down"}">${d > 0 ? "▲" : "▼"} ${Math.abs(lowerBetter ? Math.round(d * 10) / 10 : d)}${lowerBetter ? "" : "%"} vs previous</div>` : ""}</div>`;
  };
  const load = async () => {
    $("#gt").innerHTML = `<div class="empty"><p>Loading…</p></div>`;
    try {
      data = await api("POST", "/tools/gsc/report", { property, days: q.days, dimension: q.dimension, filter: q.filter ? { dim: q.dimension === "page" ? "page" : "query", op: "contains", value: q.filter } : null });
    } catch (e) { $("#gt").innerHTML = empty("Couldn't load Search Console data", esc(e.message)); return; }
    const t = data.totals;
    $("#gk").innerHTML = `<div class="kpis">${kpi("Clicks", t.now.clicks, t.prev.clicks, (v) => n(v))}${kpi("Impressions", t.now.impressions, t.prev.impressions, (v) => n(v))}${kpi("CTR", t.now.ctr, t.prev.ctr, (v) => (v * 100).toFixed(1) + "%")}${kpi("Avg. position", t.now.position, t.prev.position, (v) => (v ? v.toFixed(1) : "—"), true)}</div>`;
    S().clearCharts();
    lineChart($("#gch"), data.daily.map((d) => d.d.slice(5)), [
      { label: "Clicks", data: data.daily.map((d) => d.clicks), borderColor: css("--blue"), backgroundColor: css("--blue"), yAxisID: "y" },
      { label: "Impressions", data: data.daily.map((d) => d.impressions), borderColor: css("--amber"), backgroundColor: css("--amber"), yAxisID: "y2" },
    ], { y2: { beginAtZero: true } });
    sortable($("#gt"), data.rows, [], (list, k, d) => `<table><thead><tr>${th("key", q.dimension === "page" ? "Page" : q.dimension === "query" ? "Query" : "Item", "", k, d)}${th("clicks", "Clicks", "num", k, d)}${th("d_clicks", "Change", "num", k, d)}${th("impressions", "Impressions", "num", k, d)}${th("ctr", "CTR", "num", k, d)}${th("position", "Position", "num", k, d)}</tr></thead><tbody>
      ${list.map((r) => `<tr><td class="${q.dimension === "page" ? "url" : "kw"}" style="max-width:520px">${q.dimension === "page" ? `<a href="${esc(r.key)}" target="_blank" rel="noopener">${esc(S().shortUrl(r.key))}</a>` : esc(r.key)}</td><td class="num">${n(r.clicks)}</td><td class="num">${r.d_clicks ? `<span class="delta ${r.d_clicks > 0 ? "up" : "down"}">${r.d_clicks > 0 ? "+" : ""}${r.d_clicks}</span>` : ""}</td><td class="num">${n(r.impressions)}</td><td class="num">${(r.ctr * 100).toFixed(1)}%</td><td class="num">${r.position.toFixed(1)}</td></tr>`).join("") || `<tr><td colspan="6">${empty("No data for this range")}</td></tr>`}</tbody></table>`, ["clicks", -1]);
  };
  $$q("#rng [data-d]").forEach((b) => (b.onclick = () => { $$q("#rng button").forEach((x) => x.classList.remove("on")); b.classList.add("on"); q.days = +b.dataset.d; load(); }));
  $$q("[data-dim]").forEach((a) => (a.onclick = () => { $$q("[data-dim]").forEach((x) => x.classList.remove("on")); a.classList.add("on"); q.dimension = a.dataset.dim; load(); }));
  $("#gff").onsubmit = (e) => { e.preventDefault(); q.filter = e.target.f.value.trim(); load(); };
  $("#gcsv").onclick = () => data && downloadCsv(`gsc-${q.dimension}.csv`, [[q.dimension, "clicks", "impressions", "ctr", "position"], ...data.rows.map((r) => [r.key, r.clicks, r.impressions, r.ctr, r.position])]);
  load();
}

// ================= Bulk domain analysis =================
function pageBulkDomains() {
  const { mount, $, esc, api, busy, downloadCsv } = S();
  mount(`${head("Bulk Domain Analysis", "Traffic, keywords, domain rank, referring domains and spam score for up to 1,000 domains or URLs.")}
    <form class="panel" id="bdf"><label class="f">Domains or URLs, one per line<textarea name="targets" style="min-height:150px" placeholder="competitor1.com\nhttps://site.com/blog/post/"></textarea></label>
      <div class="row end" style="margin-top:12px">${locFields()}<span class="muted small">Backlink columns need the Backlinks API</span><div class="spacer"></div><button class="btn primary">Analyze</button></div></form><div id="bdr"></div>`);
  $("#bdf").onsubmit = (e) => {
    e.preventDefault();
    const f = form(e.target); setLoc(f);
    busy(e.submitter, async () => {
      const r = await api("POST", "/tools/bulk-domains", f);
      $("#bdr").innerHTML = `${r.errors.length ? `<div class="note err" style="margin-top:12px">${esc(r.errors.join("; "))}</div>` : ""}<div class="panel" style="margin-top:16px"><div class="panel-head"><h2>${r.rows.length} targets</h2><div class="spacer"></div><button class="btn" id="bdcsv">Export CSV</button></div><div class="tbl-wrap" id="bdt"></div></div>`;
      sortable($("#bdt"), r.rows, [], (list, k, d) => `<table><thead><tr>${th("target", "Target", "", k, d)}${th("traffic", "Organic traffic", "num", k, d)}${th("keywords", "Keywords", "num", k, d)}${th("rank", "Domain rank", "num", k, d)}${th("referring_domains", "Ref. domains", "num", k, d)}${th("spam_score", "Spam", "num", k, d)}<th></th></tr></thead><tbody>
        ${list.map((x) => `<tr><td class="url" style="max-width:420px"><b>${esc(x.target)}</b></td><td class="num">${fmtK(x.traffic)}</td><td class="num">${fmtK(x.keywords)}</td><td class="num">${x.rank ?? "—"}</td><td class="num">${fmtK(x.referring_domains)}</td><td class="num">${x.spam_score ?? "—"}</td><td class="num"><a class="btn sm" href="#/t/traffic/${encodeURIComponent(x.target)}/overview">Analyze</a></td></tr>`).join("")}</tbody></table>`, ["traffic", -1]);
      $("#bdcsv").onclick = () => downloadCsv("bulk-domains.csv", [["target", "traffic", "keywords", "rank", "referring_domains", "spam_score"], ...r.rows.map((x) => [x.target, x.traffic, x.keywords, x.rank, x.referring_domains, x.spam_score])]);
    }, "Analyzing…");
  };
}

// ================= IndexNow =================
async function pageIndexNow() {
  const { mount, $, esc, api, busy, toast, ago } = S();
  const d = await api("GET", "/tools/indexnow");
  const pre = sessionStorage.getItem("indexnowUrls") || "";
  sessionStorage.removeItem("indexnowUrls");
  mount(`${head("IndexNow", "Tell Bing, Yandex, Naver, Seznam and Yep about new or changed URLs instantly.")}
    <div class="panel"><div class="panel-head"><h2>Sites</h2></div>
      ${d.hosts.length ? `<div class="tbl-wrap"><table><thead><tr><th>Host</th><th>Key file</th><th>Status</th><th></th></tr></thead><tbody>${d.hosts.map((h) => `<tr><td><b>${esc(h.host)}</b></td>
        <td class="small"><code>/${esc(h.key)}.txt</code> <a class="small" download="${esc(h.key)}.txt" href="data:text/plain;charset=utf-8,${esc(h.key)}">Download</a></td>
        <td>${h.verified_at ? `<span class="badge ok">verified</span>` : `<span class="badge plain">not verified</span>`}</td>
        <td class="num" style="white-space:nowrap"><button class="btn sm" data-ver="${esc(h.host)}">Verify key file</button><button class="btn ghost sm danger" data-del="${esc(h.host)}" aria-label="Remove host">✕</button></td></tr>`).join("")}</tbody></table></div>` : empty("No sites yet", "Add a host to get its key.")}
      <form class="row end" id="ihf" style="margin-top:14px"><label class="f" style="flex:1;max-width:360px">Add host<input name="host" required placeholder="brisbaneroofrepairs.com.au"></label><button class="btn">Add host</button></form>
      <p class="muted small" style="margin-top:10px">Upload the key file to the site root (for Astro: put it in <code>public/</code> and redeploy), then press “Verify key file”.</p></div>
    <form class="panel" id="isf"><div class="panel-head"><h2>Submit URLs</h2><span class="muted small">Grouped by host automatically · up to 10,000 per host</span></div>
      <textarea name="urls" style="min-height:140px" placeholder="https://example.com/new-page/">${esc(pre)}</textarea>
      <div class="row" style="margin-top:12px"><span class="muted small" id="ic"></span><div class="spacer"></div><button class="btn primary">Submit to IndexNow</button></div><div id="ir"></div></form>
    <div class="panel"><div class="panel-head"><h2>History</h2></div>${d.log.length ? `<ul class="src-list">${d.log.map((l) => `<li><span class="sev ${l.status === 200 || l.status === 202 ? "" : "critical"}"></span><span style="flex:1"><b>${esc(l.host)}</b> — ${l.urls} URLs · ${esc(l.message)}</span><span class="muted small">${ago(l.sent_at)}</span></li>`).join("")}</ul>` : `<p class="muted small">Nothing submitted yet.</p>`}</div>`);
  const ta = $("#isf").urls;
  const count = () => ($("#ic").textContent = `${lines(ta.value).length} URLs`);
  ta.oninput = count; count();
  $("#ihf").onsubmit = (e) => { e.preventDefault(); busy(e.submitter, async () => { await api("POST", "/tools/indexnow/hosts", form(e.target)); pageIndexNow(); }); };
  $$q("[data-ver]").forEach((b) => (b.onclick = () => busy(b, async () => { const r = await api("POST", "/tools/indexnow/verify", { host: b.dataset.ver }); toast(r.ok ? "Key file found — verified" : `Key file not found at ${r.url}`, 5000); if (r.ok) pageIndexNow(); }, "Checking…")));
  $$q("[data-del]").forEach((b) => (b.onclick = async () => { if (confirm("Remove this host and its key?")) { await api("DELETE", `/tools/indexnow/hosts?host=${encodeURIComponent(b.dataset.del)}`); pageIndexNow(); } }));
  $("#isf").onsubmit = (e) => {
    e.preventDefault();
    busy(e.submitter, async () => {
      const r = await api("POST", "/tools/indexnow/submit", { urls: ta.value });
      $("#ir").innerHTML = `<ul class="src-list" style="margin-top:12px">${r.map((x) => `<li><span class="sev ${x.status === 200 || x.status === 202 ? "" : "critical"}"></span><span style="flex:1"><b>${esc(x.host)}</b> — ${x.urls} URLs</span><span class="small">${esc(x.message)}</span></li>`).join("")}</ul>`;
    }, "Submitting…");
  };
}

// ================= router =================
window.TOOLS = {
  async route(p) {
    const tool = p[0], arg = p[1] ? decodeURIComponent(p[1].split("?")[0]) : "", tab = p[2] ? p[2].split("?")[0] : undefined;
    switch (tool && tool.split("?")[0]) {
      case "traffic": return pageTraffic(arg, tab);
      case "content-gap": return pageContentGap();
      case "sitemap": return pageSitemap();
      case "backlinks": return pageBacklinks(arg, tab);
      case "backlink-gap": return pageBacklinkGap();
      case "bulk-keywords": return pageBulkKeywords();
      case "paa": return pagePaa();
      case "autocomplete": return pageAutocomplete();
      case "semantic": return pageSemantic();
      case "serp-cluster": return pageSerpCluster(arg ? +arg : null);
      case "serp-similarity": return pageSerpSimilarity();
      case "uule": return pageUule();
      case "gsc": return pageGsc(arg);
      case "bulk-domains": return pageBulkDomains();
      case "indexnow": return pageIndexNow();
      default: location.hash = "#/";
    }
  },
};
})();
