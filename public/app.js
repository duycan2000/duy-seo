/* Duy SEO — single-page dashboard (vanilla JS) */
(() => {
"use strict";

// ---------------- helpers ----------------
const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];
const app = $("#app");
const esc = (v) => String(v ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const n = (v) => (v == null || v === "" ? "—" : Number(v).toLocaleString("en-US"));
const money = (v) => (v == null ? "—" : "$" + Number(v).toFixed(v < 1 ? 4 : 2));
const ago = (s) => {
  if (!s) return "never";
  const d = (Date.now() - new Date(s.replace(" ", "T") + "Z")) / 1000;
  if (d < 90) return "just now";
  if (d < 3600) return Math.round(d / 60) + " min ago";
  if (d < 86400) return Math.round(d / 3600) + " h ago";
  return Math.round(d / 86400) + " d ago";
};
const shortUrl = (u) => { try { const x = new URL(u); return x.pathname === "/" ? x.hostname : x.pathname; } catch { return u || ""; } };

function toast(msg, ms = 3200) {
  const t = $("#toast");
  t.textContent = msg;
  t.classList.add("show");
  clearTimeout(toast._t);
  toast._t = setTimeout(() => t.classList.remove("show"), ms);
}

async function api(method, path, body) {
  const res = await fetch("/api" + path, {
    method,
    headers: body ? { "Content-Type": "application/json" } : {},
    body: body ? JSON.stringify(body) : undefined,
    credentials: "same-origin",
  });
  if (res.status === 401 && path !== "/login") { renderLogin(); throw new Error("Signed out"); }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `Request failed (${res.status})`);
  return data;
}

/** Run an async action from a button, with busy state + error toast. */
async function busy(btn, fn, label) {
  btn = btn || document.createElement("button"); // e.g. form.requestSubmit() has no submitter
  const old = btn.innerHTML;
  btn.disabled = true;
  if (label) btn.textContent = label;
  try { return await fn(); }
  catch (e) { toast(e.message, 6000); }
  finally { btn.disabled = false; btn.innerHTML = old; }
}

const LOCATIONS = [
  [2704, "Vietnam"], [2840, "United States"], [2826, "United Kingdom"], [2036, "Australia"], [2124, "Canada"],
  [2702, "Singapore"], [2764, "Thailand"], [2392, "Japan"], [2410, "South Korea"], [2276, "Germany"], [2250, "France"],
  [2158, "Taiwan"], [2344, "Hong Kong"], [2458, "Malaysia"], [2608, "Philippines"], [2360, "Indonesia"], [2356, "India"],
];
const LANGS = [["en", "English"], ["vi", "Vietnamese"], ["ko", "Korean"], ["ja", "Japanese"], ["zh-TW", "Chinese (Trad.)"], ["th", "Thai"], ["de", "German"], ["fr", "French"]];
const locName = (code) => (LOCATIONS.find((l) => l[0] === Number(code)) || [0, "Location " + code])[1];
const locSelect = (name, val) => `<select name="${name}">${LOCATIONS.map(([c, l]) => `<option value="${c}" ${Number(val) === c ? "selected" : ""}>${l}</option>`).join("")}</select>`;
const langSelect = (name, val) => `<select name="${name}">${LANGS.map(([c, l]) => `<option value="${c}" ${val === c ? "selected" : ""}>${l}</option>`).join("")}</select>`;
const ENGINES = [["google", "Google"], ["bing", "Bing"], ["ai_overview", "AI Overviews"], ["ai_mode", "AI Mode"]];

function chip(pos) {
  if (!pos) return `<span class="chip none" title="Not in the checked results">—</span>`;
  const t = pos <= 3 ? "t1" : pos <= 10 ? "t2" : pos <= 20 ? "t3" : "t4";
  return `<span class="chip ${t}">${pos}</span>`;
}
function delta(cur, prev) {
  if (prev === undefined) return "";
  if (!cur && !prev) return "";
  if (!prev && cur) return `<span class="delta up" title="New">new</span>`;
  if (prev && !cur) return `<span class="delta down" title="Dropped out">lost</span>`;
  const d = prev - cur;
  if (!d) return "";
  return `<span class="delta ${d > 0 ? "up" : "down"}">${d > 0 ? "▲" : "▼"}${Math.abs(d)}</span>`;
}
function spark(arr, w = 84, h = 24) {
  const pts = (arr || []).map((v) => (v ? v : null));
  if (pts.filter(Boolean).length < 2) return `<span class="muted small">—</span>`;
  const max = Math.max(10, ...pts.filter(Boolean));
  const step = w / (pts.length - 1);
  let d = "", pen = false;
  pts.forEach((v, i) => {
    if (v == null) { pen = false; return; }
    const y = 2 + ((v - 1) / (max - 1 || 1)) * (h - 4);
    d += `${pen ? "L" : "M"}${(i * step).toFixed(1)},${y.toFixed(1)}`;
    pen = true;
  });
  return `<svg class="spark" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" aria-hidden="true"><path d="${d}" fill="none" stroke="var(--blue)" stroke-width="1.6" stroke-linejoin="round"/></svg>`;
}

// charts
let charts = [];
function clearCharts() { charts.forEach((c) => c.destroy()); charts = []; }
const css = (v) => getComputedStyle(document.documentElement).getPropertyValue(v).trim();
function lineChart(canvas, labels, datasets, opts = {}) {
  if (!window.Chart) return;
  const grid = css("--line"), ink = css("--ink-3");
  if (opts.type === "bar") datasets.forEach((d) => { d.maxBarThickness ??= 42; d.borderRadius ??= 3; });
  const c = new Chart(canvas, {
    type: opts.type || "line",
    data: { labels, datasets },
    options: {
      responsive: true, maintainAspectRatio: false, interaction: { mode: "index", intersect: false },
      plugins: { legend: { display: datasets.length > 1, labels: { color: ink, boxWidth: 10, boxHeight: 10 } } },
      scales: {
        x: { grid: { display: false }, ticks: { color: ink, maxTicksLimit: 8, maxRotation: 0 }, stacked: !!opts.stacked },
        y: { grid: { color: grid }, ticks: { color: ink }, reverse: !!opts.reverse, beginAtZero: !opts.reverse, stacked: !!opts.stacked, ...(opts.y || {}) },
        ...(opts.y2 ? { y2: { position: "right", grid: { display: false }, ticks: { color: ink }, ...opts.y2 } } : {}),
      },
      elements: { point: { radius: 0, hitRadius: 8 }, line: { tension: 0.25, borderWidth: 2 } },
    },
  });
  charts.push(c);
  return c;
}

function drawer(html) {
  const bg = document.createElement("div");
  bg.className = "drawer-bg";
  bg.innerHTML = `<div class="drawer" role="dialog" aria-modal="true">${html}</div>`;
  const close = () => { bg.remove(); document.removeEventListener("keydown", onKey); };
  const onKey = (e) => e.key === "Escape" && close();
  bg.addEventListener("click", (e) => { if (e.target === bg || e.target.closest("[data-close]")) close(); });
  document.addEventListener("keydown", onKey);
  document.body.appendChild(bg);
  return { el: $(".drawer", bg), close };
}

// ---------------- auth ----------------
function renderLogin() {
  clearCharts();
  app.innerHTML = `<div class="login">
    <div class="login-art"><div class="brand"><span class="brand-mark">1</span><span>Duy SEO</span></div>
      <div><h2>Rankings, local and AI search visibility in one place.</h2>
      <ul><li>Google, Bing, AI Overviews, AI Mode and ChatGPT</li><li>Local map grids and site audits</li><li>Rank &amp; Rent portfolio, leads and alerts</li></ul></div>
      <span class="small" style="color:#6E7A90">Powered by DataForSEO</span></div>
    <div class="login-form"><form id="lf">
      <h1>Sign in</h1><p class="muted">Enter your admin password to continue.</p>
      <label class="f">Password<input type="password" name="password" autocomplete="current-password" required autofocus></label>
      <button class="btn primary" type="submit">Sign in</button>
      <div class="err" id="lerr" role="alert"></div></form></div></div>`;
  $("#lf").onsubmit = async (e) => {
    e.preventDefault();
    try {
      await api("POST", "/login", { password: e.target.password.value });
      start();
    } catch (err) { $("#lerr").textContent = err.message; }
  };
}

// ---------------- shell ----------------
let state = { projects: [], me: null, rrSites: null };

async function loadProjects() { state.projects = await api("GET", "/projects"); }

const ICON = {
  home: '<path d="M3 10.5 12 3l9 7.5V20a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z"/>',
  folder: '<path d="M3 6a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/>',
  globe: '<circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3a14 14 0 0 1 0 18M12 3a14 14 0 0 0 0 18"/>',
  search: '<circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/>',
  grid: '<rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/><rect x="14" y="14" width="7" height="7" rx="1.5"/>',
  target: '<circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="5"/><circle cx="12" cy="12" r="1"/>',
  phone: '<path d="M5 4h4l2 5-2.5 1.5a11 11 0 0 0 5 5L15 13l5 2v4a2 2 0 0 1-2 2A16 16 0 0 1 3 6a2 2 0 0 1 2-2"/>',
  bell: '<path d="M6 8a6 6 0 1 1 12 0c0 7 3 9 3 9H3s3-2 3-9M10 21a2 2 0 0 0 4 0"/>',
  card: '<rect x="2" y="5" width="20" height="14" rx="2"/><path d="M2 10h20"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  menu: '<path d="M4 6h16M4 12h16M4 18h16"/>',
  logout: '<path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4M16 17l5-5-5-5M21 12H9"/>',
  chevron: '<path d="m9 6 6 6-6 6"/>',
  down: '<path d="m6 9 6 6 6-6"/>',
  tag: '<path d="M3 12V4a1 1 0 0 1 1-1h8l9 9-9 9z"/><circle cx="7.5" cy="7.5" r="1.5"/>',
  layers: '<path d="m12 3 9 5-9 5-9-5z"/><path d="m3 13 9 5 9-5"/>',
  stack: '<rect x="4" y="4" width="16" height="6" rx="1.5"/><rect x="4" y="14" width="16" height="6" rx="1.5"/>',
  help: '<circle cx="12" cy="12" r="9"/><path d="M9.5 9a2.5 2.5 0 1 1 3.5 2.3c-.7.3-1 .9-1 1.7M12 17h.01"/>',
  type: '<path d="M4 7V5h16v2M9 19h6M12 5v14"/>',
  chart: '<path d="M4 20V10M10 20V4M16 20v-7M22 20H2"/>',
  map: '<path d="m3 6 6-3 6 3 6-3v15l-6 3-6-3-6 3z"/><path d="M9 3v15M15 6v15"/>',
  gap: '<rect x="3" y="4" width="7" height="16" rx="1.5"/><rect x="14" y="4" width="7" height="10" rx="1.5"/>',
  link: '<path d="M10 14a4 4 0 0 0 5.66 0l3-3a4 4 0 0 0-5.66-5.66l-1 1M14 10a4 4 0 0 0-5.66 0l-3 3a4 4 0 0 0 5.66 5.66l1-1"/>',
  copy: '<rect x="8" y="8" width="13" height="13" rx="2"/><path d="M4 16V5a1 1 0 0 1 1-1h11"/>',
  pin: '<path d="M12 21s7-6.2 7-12a7 7 0 1 0-14 0c0 5.8 7 12 7 12z"/><circle cx="12" cy="9" r="2.5"/>',
  db: '<ellipse cx="12" cy="5" rx="8" ry="3"/><path d="M4 5v14c0 1.7 3.6 3 8 3s8-1.3 8-3V5M4 12c0 1.7 3.6 3 8 3s8-1.3 8-3"/>',
  zap: '<path d="M13 2 4 14h7l-1 8 9-12h-7z"/>',
};
const icon = (k, cls = "ic") => `<svg class="${cls}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICON[k] || ""}</svg>`;

/** Navigation tree — mirrors the research workflow: keywords → competitors → links → SERPs → GSC. */
const NAV = [
  { id: "client", label: "Client SEO", items: [["#/projects", "projects", "folder", "Projects"]] },
  { id: "kw", label: "Keyword Research", items: [
    ["#/research/keywords", "kwr", "search", "Keyword Explorer"], ["#/t/semantic", "t-semantic", "tag", "Semantic Clustering"],
    ["#/t/serp-cluster", "t-serp-cluster", "layers", "SERP Clustering"], ["#/t/bulk-keywords", "t-bulk-keywords", "stack", "Bulk Analysis"],
    ["#/t/paa", "t-paa", "help", "Bulk Google PAA"], ["#/t/autocomplete", "t-autocomplete", "type", "Bulk Autocomplete"]] },
  { id: "comp", label: "Competitive Research", items: [
    ["#/t/traffic", "t-traffic", "chart", "Traffic Analytics"], ["#/t/sitemap", "t-sitemap", "map", "Sitemap Extractor"], ["#/t/content-gap", "t-content-gap", "gap", "Content Gap"]] },
  { id: "links", label: "Link Building", items: [["#/t/backlinks", "t-backlinks", "link", "Backlink Analytics"], ["#/t/backlink-gap", "t-backlink-gap", "gap", "Backlink Gap"]] },
  { id: "serp", label: "SERP Research", items: [["#/t/serp-similarity", "t-serp-similarity", "copy", "SERP Similarity"], ["#/t/uule", "t-uule", "pin", "SERP UULE"]] },
  { id: "gsc", label: "Search Console", items: [["#/t/gsc", "t-gsc", "db", "Sites"]] },
  { id: "rr", label: "Rank & Rent", items: [["#/rr", "rr", "grid", "Portfolio"], ["#/rr/market", "rr-market", "target", "Niche finder"], ["#/rr/leads", "rr-leads", "phone", "Leads"], ["#/rr/alerts", "rr-alerts", "bell", "Alerts"]] },
  { id: "util", label: "Utilities", items: [["#/t/bulk-domains", "t-bulk-domains", "stack", "Bulk Domain Analysis"], ["#/t/indexnow", "t-indexnow", "zap", "IndexNow"], ["#/usage", "usage", "card", "API usage"]] },
];
const navFind = (key) => { for (const g of NAV) for (const it of g.items) if (it[1] === key) return { g, it }; return null; };
let navOpen;
try { navOpen = new Set(JSON.parse(localStorage.getItem("navOpen") || '["client","kw","comp","rr"]')); } catch { navOpen = new Set(["client", "kw", "comp", "rr"]); }
const saveNav = () => { try { localStorage.setItem("navOpen", JSON.stringify([...navOpen])); } catch {} };

/** Shared search location for research tools (topbar selector). */
state.loc = (() => { try { return JSON.parse(localStorage.getItem("loc")) || { location_code: 2704, language_code: "en" }; } catch { return { location_code: 2704, language_code: "en" }; } })();

/** Section a route belongs to, used for nav highlight and breadcrumbs. */
function where() {
  const p = location.hash.replace(/^#\/?/, "").split("?")[0].split("/").filter(Boolean);
  const proj = p[0] === "p" ? state.projects.find((x) => x.id === +p[1]) : null;
  if (!p.length) return { key: "dash", crumbs: [["Dashboard"]] };
  if (p[0] === "projects" || p[0] === "new") return { key: "projects", crumbs: [["Client SEO", "#/projects"], [p[0] === "new" ? "New project" : "Projects"]] };
  if (p[0] === "p") return { key: "projects", pid: +p[1], crumbs: [["Client SEO", "#/projects"], [proj ? proj.name : "Project"]] };
  if (p[0] === "research") return p[1] === "keywords" ? { key: "kwr", crumbs: [["Keyword Research"], ["Keyword Explorer"]] } : { key: "t-traffic", crumbs: [["Competitive Research"], ["Traffic Analytics"]] };
  if (p[0] === "usage") return { key: "usage", crumbs: [["Utilities"], ["API usage"]] };
  if (p[0] === "t") {
    const f = navFind("t-" + p[1]);
    const extra = p[2] ? [[decodeURIComponent(p[2])]] : [];
    return { key: "t-" + p[1], crumbs: f ? [[f.g.label], [f.it[3], extra.length ? f.it[0] : undefined], ...extra] : [] };
  }
  if (p[0] === "rr") {
    const sub = { market: "Niche finder", leads: "Leads", alerts: "Alerts" }[p[1]];
    if (p[1] === "site") {
      const s = (state.rrSites || []).find((x) => x.id === +p[2]);
      return { key: "rr", crumbs: [["Rank & Rent", "#/rr"], ["Portfolio", "#/rr"], [s ? s.domain : "Site"]] };
    }
    return { key: sub ? "rr-" + p[1] : "rr", crumbs: [["Rank & Rent", "#/rr"], [sub || "Portfolio"]] };
  }
  return { key: "", crumbs: [] };
}

function shell(content) {
  const w = where();
  const projs = state.projects.slice(0, 6);
  const extra = (key) => key === "projects" ? `<span class="count plain">${state.projects.length}</span>` : key === "rr-alerts" && state.rrAlerts ? `<span class="count">${state.rrAlerts}</span>` : "";
  const link = ([href, key, ic, label]) => `<a href="${href}" class="${w.key === key ? "on" : ""}">${icon(ic)}<span class="name">${label}</span>${extra(key)}</a>`;
  const groups = NAV.map((g) => {
    const active = g.items.some((it) => it[1] === w.key);
    const open = active || navOpen.has(g.id);
    return `<div class="nav-group ${open ? "open" : ""}" data-g="${g.id}">
      <button class="nav-title" aria-expanded="${open}">${esc(g.label)}${icon("down", "caret")}</button>
      <div class="nav-items">${g.items.map(link).join("")}
      ${g.id === "client" && projs.length ? `<div class="sub-nav">${projs.map((x) => `<a href="#/p/${x.id}" class="${w.pid === x.id ? "on" : ""}" title="${esc(x.domain)}">${esc(x.name)}</a>`).join("")}${state.projects.length > 6 ? `<a href="#/projects" class="more">All ${state.projects.length} projects</a>` : ""}</div>` : ""}</div>
    </div>`;
  }).join("");
  const L = state.loc;
  return `<div class="shell">
  <aside class="side" id="side" aria-label="Main navigation">
    <a class="brand" href="#/"><span class="brand-mark">1</span><span>Duy SEO</span></a>
    <button class="jump" id="jump">${icon("search")}<span>Search or jump to…</span><kbd>⌘K</kbd></button>
    <nav class="nav">
      <a href="#/" class="${w.key === "dash" ? "on" : ""}">${icon("home")}<span class="name">Dashboard</span></a>
      ${groups}
    </nav>
    <div class="side-foot">
      <span class="mode" title="How scheduled checks are sent to DataForSEO">${state.me?.sandbox ? "Sandbox · " : ""}${esc(state.me?.mode || "standard")} mode</span>
      <button class="side-btn" id="logout" title="Sign out">${icon("logout")}<span>Sign out</span></button>
    </div>
  </aside>
  <div class="scrim" id="scrim"></div>
  <div class="workspace">
    <header class="topbar">
      <button class="icon-btn menu-toggle" id="menu" aria-label="Open menu">${icon("menu")}</button>
      <form class="domain-search" id="ds" role="search">
        ${icon("search")}<input name="d" placeholder="Enter a domain or URL" aria-label="Domain or URL to analyze" autocomplete="off">
        <select name="loc" aria-label="Database">${LOCATIONS.map(([c, l]) => `<option value="${c}" ${L.location_code === c ? "selected" : ""}>${l}</option>`).join("")}</select>
        <select name="lang" aria-label="Language">${LANGS.map(([c, l]) => `<option value="${c}" ${L.language_code === c ? "selected" : ""}>${l}</option>`).join("")}</select>
        <button class="btn primary sm">Analyze</button>
      </form>
      <div class="spacer"></div>
      <button class="icon-btn" id="jump2" aria-label="Quick switcher">${icon("search")}</button>
      <a class="icon-btn bell" href="#/rr/alerts" aria-label="Alerts">${icon("bell")}${state.rrAlerts ? `<span class="dot-count">${state.rrAlerts}</span>` : ""}</a>
    </header>
    <div class="crumb-row"><nav class="crumbs" aria-label="Breadcrumb">${w.crumbs.map(([l, h], i) => `${i ? icon("chevron", "sep") : ""}${h && i < w.crumbs.length - 1 ? `<a href="${h}">${esc(l)}</a>` : `<span${i === w.crumbs.length - 1 ? ' aria-current="page"' : ""}>${esc(l)}</span>`}`).join("")}</nav></div>
    <main class="main" id="main">${content}</main>
  </div></div>`;
}

function mount(html) {
  clearCharts();
  app.innerHTML = shell(html);
  const side = $("#side"), scrim = $("#scrim");
  const close = () => { side.classList.remove("open"); scrim.classList.remove("on"); };
  $("#logout").onclick = async () => { await api("POST", "/logout"); renderLogin(); };
  $("#menu").onclick = () => { side.classList.add("open"); scrim.classList.add("on"); };
  scrim.onclick = close;
  $$("#side a").forEach((a) => a.addEventListener("click", close));
  $("#jump").onclick = openPalette;
  $("#jump2").onclick = openPalette;
  $$(".nav-title").forEach((b) => (b.onclick = () => {
    const g = b.parentElement, id = g.dataset.g;
    g.classList.toggle("open");
    const open = g.classList.contains("open");
    b.setAttribute("aria-expanded", open);
    open ? navOpen.add(id) : navOpen.delete(id);
    saveNav();
  }));
  const ds = $("#ds");
  ds.loc.onchange = ds.lang.onchange = () => {
    state.loc = { location_code: +ds.loc.value, language_code: ds.lang.value };
    try { localStorage.setItem("loc", JSON.stringify(state.loc)); } catch {}
  };
  ds.onsubmit = (e) => {
    e.preventDefault();
    const d = ds.d.value.trim().replace(/^https?:\/\//, "").replace(/\/$/, "");
    if (d) location.hash = `#/t/traffic/${encodeURIComponent(d)}/overview`;
  };
  window.scrollTo(0, 0);
}

// ---------------- quick switcher (Ctrl/Cmd+K) ----------------
async function openPalette() {
  if ($(".palette-bg")) return;
  if (!state.rrSites) { try { state.rrSites = (await api("GET", "/rr/overview")).sites; } catch { state.rrSites = []; } }
  const items = [
    ["Dashboard", "#/", "Page"], ["Projects", "#/projects", "Page"], ["New project", "#/new", "Action"],
    ...NAV.flatMap((g) => g.items.map((it) => [it[3], it[0], g.label])),
    ...state.projects.flatMap((p) => [[p.name, `#/p/${p.id}`, "Project · " + p.domain], [`${p.name} — rankings`, `#/p/${p.id}/rankings`, "Project"], [`${p.name} — AI visibility`, `#/p/${p.id}/ai`, "Project"]]),
    ...state.rrSites.map((s) => [s.domain, `#/rr/site/${s.id}`, "R&R site · " + (s.niche || "")]),
  ];
  const bg = document.createElement("div");
  bg.className = "palette-bg";
  bg.innerHTML = `<div class="palette" role="dialog" aria-modal="true" aria-label="Quick switcher"><div class="palette-in">${icon("search")}<input id="pq" placeholder="Jump to a page, project or site…" autocomplete="off"></div><ul id="pl" role="listbox"></ul><div class="palette-foot"><kbd>↑</kbd><kbd>↓</kbd> move · <kbd>Enter</kbd> open · <kbd>Esc</kbd> close</div></div>`;
  document.body.appendChild(bg);
  let sel = 0, list = items;
  const close = () => { bg.remove(); document.removeEventListener("keydown", key, true); };
  const draw = () => {
    $("#pl", bg).innerHTML = list.slice(0, 12).map((it, i) => `<li role="option" class="${i === sel ? "on" : ""}" data-i="${i}"><span>${esc(it[0])}</span><small>${esc(it[2])}</small></li>`).join("") || `<li class="none">No matches</li>`;
    $$("#pl li[data-i]", bg).forEach((li) => { li.onmousemove = () => { sel = +li.dataset.i; draw(); }; li.onclick = () => go(+li.dataset.i); });
  };
  const go = (i) => { const it = list[i]; if (it) { close(); location.hash = it[1]; } };
  const key = (e) => {
    if (e.key === "Escape") { e.preventDefault(); close(); }
    else if (e.key === "ArrowDown") { e.preventDefault(); sel = Math.min(sel + 1, Math.min(list.length, 12) - 1); draw(); }
    else if (e.key === "ArrowUp") { e.preventDefault(); sel = Math.max(sel - 1, 0); draw(); }
    else if (e.key === "Enter") { e.preventDefault(); go(sel); }
  };
  document.addEventListener("keydown", key, true);
  bg.onclick = (e) => { if (e.target === bg) close(); };
  $("#pq", bg).oninput = (e) => {
    const q = e.target.value.toLowerCase().trim();
    list = !q ? items : items.filter((it) => (it[0] + " " + it[2]).toLowerCase().includes(q)).sort((a, b) => a[0].toLowerCase().indexOf(q) - b[0].toLowerCase().indexOf(q));
    sel = 0; draw();
  };
  draw();
  $("#pq", bg).focus();
}
document.addEventListener("keydown", (e) => {
  if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") { e.preventDefault(); if (state.me) openPalette(); }
});

// ---------------- router ----------------
async function route() {
  const parts = location.hash.replace(/^#\/?/, "").split("/").filter(Boolean);
  try {
    if (!parts.length) return await pageDashboard();
    if (parts[0] === "projects") return await pageHome();
    if (parts[0] === "new") return pageNewProject();
    if (parts[0] === "p") return await pageProject(+parts[1], parts[2] || "overview");
    if (parts[0] === "research" && parts[1] === "keywords") return pageKeywordResearch();
    if (parts[0] === "research" && parts[1] === "domain") { location.hash = parts[2] ? `#/t/traffic/${parts[2]}/overview` : "#/t/traffic"; return; }
    if (parts[0] === "t" && window.TOOLS) return await window.TOOLS.route(parts.slice(1));
    if (parts[0] === "usage") return await pageUsage();
    if (parts[0] === "rr" && window.RR) return await window.RR.route(parts.slice(1));
    location.hash = "#/";
  } catch (e) {
    if (e.message !== "Signed out") mount(`<div class="panel empty"><h3>This page didn't load</h3><p>${esc(e.message)}</p><a class="btn" href="#/">Back to dashboard</a></div>`);
  }
}
window.addEventListener("hashchange", route);

// ---------------- dashboard ----------------
async function pageDashboard() {
  await loadProjects();
  const [rr, alerts] = await Promise.all([api("GET", "/rr/overview").catch(() => null), api("GET", "/rr/alerts?open=1").catch(() => [])]);
  if (rr) state.rrSites = rr.sites;
  state.rrAlerts = alerts.length;
  const P = state.projects;
  const kw = P.reduce((a, p) => a + (p.keyword_count || 0), 0);
  const vis = P.filter((p) => p.visibility != null);
  const avgVis = vis.length ? (vis.reduce((a, p) => a + p.visibility, 0) / vis.length).toFixed(1) + "%" : "—";
  const t = rr?.totals;
  const mrr = t ? Object.entries(t.mrr).map(([c, v]) => `${c === "NZD" ? "NZ$" : "A$"}${Number(v).toLocaleString("en-US")}`).join(" + ") || "A$0" : "—";
  const today = new Date().toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long" });
  mount(`
  <div class="page-head"><div><h1>Dashboard</h1><div class="sub">${today}</div></div></div>
  <section class="kpi-group"><div class="kpi-label"><a href="#/projects">Client SEO</a></div><div class="kpis">
    <div class="kpi"><div class="v">${n(P.length)}</div><div class="l">Projects</div></div>
    <div class="kpi"><div class="v">${n(kw)}</div><div class="l">Keywords tracked</div></div>
    <div class="kpi"><div class="v">${avgVis}</div><div class="l">Avg. visibility</div></div>
    <div class="kpi"><div class="v">${n(P.reduce((a, p) => a + (p.top10 || 0), 0))}</div><div class="l">Keywords in top 10</div></div>
  </div></section>
  ${t ? `<section class="kpi-group"><div class="kpi-label"><a href="#/rr">Rank &amp; Rent</a></div><div class="kpis">
    <div class="kpi"><div class="v">${mrr}</div><div class="l">Monthly rent</div></div>
    <div class="kpi"><div class="v">${n(t.leads_month)}</div><div class="l">Leads this month</div></div>
    <div class="kpi"><div class="v">${t.occupancy == null ? "—" : t.occupancy + "%"}</div><div class="l">Occupancy</div></div>
    <div class="kpi"><div class="v ${t.open_alerts ? "warn" : ""}">${n(t.open_alerts)}</div><div class="l">Open alerts</div></div>
  </div></section>` : ""}
  <div class="split">
    <div class="panel"><div class="panel-head"><h2>Projects</h2><div class="spacer"></div><a class="btn sm" href="#/projects">View all</a></div>
      ${P.length ? `<div class="tbl-wrap"><table><thead><tr><th>Project</th><th class="num">Visibility</th><th class="num">Avg. pos.</th><th class="num">Top 10</th><th class="num">AI cited</th></tr></thead><tbody>
        ${P.slice(0, 8).map((p) => `<tr class="clickable" data-go="#/p/${p.id}"><td><b>${esc(p.name)}</b><div class="muted small">${esc(p.domain)}</div></td><td class="num">${p.visibility == null ? "—" : p.visibility + "%"}</td><td class="num">${p.avg_position ?? "—"}</td><td class="num">${n(p.top10)}</td><td class="num">${p.ai_cited == null ? "—" : p.ai_cited + "%"}</td></tr>`).join("")}
      </tbody></table></div>` : `<div class="empty"><p>No projects yet.</p><a class="btn primary" href="#/new">New project</a></div>`}</div>
    <div class="panel"><div class="panel-head"><h2>Needs attention</h2><div class="spacer"></div><a class="btn sm" href="#/rr/alerts">All alerts</a></div>
      ${alerts.length ? `<ul class="src-list">${alerts.slice(0, 8).map((a) => `<li><span class="sev ${a.severity}"></span><span style="flex:1">${esc(a.message)}</span><span class="muted small">${ago(a.created_at)}</span></li>`).join("")}</ul>` : `<div class="empty small"><p>All clear. No open alerts.</p></div>`}</div>
  </div>
  <div class="quick">
    <a href="#/projects" class="quick-card">${icon("folder")}<b>Check a ranking</b><span>Any site, any keyword, one live check</span></a>
    <a href="#/t/traffic" class="quick-card">${icon("globe")}<b>Analyze a domain</b><span>Traffic, keywords, competitors, backlinks</span></a>
    <a href="#/research/keywords" class="quick-card">${icon("search")}<b>Find keywords</b><span>Volume, difficulty and intent</span></a>
    <a href="#/rr/market" class="quick-card">${icon("target")}<b>Find R&amp;R niches</b><span>Score niche × city opportunities</span></a>
  </div>`);
  $$("[data-go]").forEach((r) => (r.onclick = () => (location.hash = r.dataset.go)));
}

// ---------------- projects ----------------
async function pageHome() {
  await loadProjects();
  const rows = state.projects;
  mount(`
  <div class="page-head"><div><h1>Projects</h1><div class="sub">Client and own websites, each with its keywords, AI prompts, map grids and audits.</div></div>
    <div class="spacer"></div><a class="btn primary" href="#/new">New project</a></div>
  ${rows.length ? `<div class="panel"><div class="tbl-wrap"><table>
    <thead><tr><th>Project</th><th class="num">Keywords</th><th class="num">Visibility</th><th class="num">Avg. position</th><th class="num">Top 3</th><th class="num">Top 10</th><th class="num">Cited in AI answers</th><th class="num">Mentioned by AI</th></tr></thead>
    <tbody>${rows.map((p) => `<tr class="clickable" data-go="#/p/${p.id}">
      <td><b>${esc(p.name)}</b><div class="muted small">${esc(p.domain)} · ${esc(locName(p.location_code))}</div></td>
      <td class="num">${n(p.keyword_count)}</td><td class="num">${p.visibility == null ? "—" : p.visibility + "%"}</td>
      <td class="num">${p.avg_position ?? "—"}</td><td class="num">${n(p.top3)}</td><td class="num">${n(p.top10)}</td>
      <td class="num">${p.ai_cited == null ? "—" : p.ai_cited + "%"}</td><td class="num">${p.ai_mentioned == null ? "—" : p.ai_mentioned + "%"}</td></tr>`).join("")}
    </tbody></table></div></div>` : `<div class="panel empty"><h3>Add your first project</h3><p>A project is one website: its keywords, AI prompts, map grids and audits.</p><a class="btn primary" href="#/new">New project</a></div>`}
  <div class="panel"><div class="panel-head"><h2>Check a ranking</h2><span class="muted small">One-off check of any site, nothing saved. Costs one live SERP call.</span></div>
    <form id="qc" class="row end">
      <label class="f">Domain<input name="domain" placeholder="client-site.com" required></label>
      <label class="f" style="flex:1;min-width:200px">Keyword<input name="keyword" placeholder="web design da nang" required></label>
      <label class="f">Location${locSelect("location_code", 2704)}</label>
      <label class="f">Language${langSelect("language_code", "en")}</label>
      <label class="f">Engine<select name="engine"><option value="google">Google</option><option value="bing">Bing</option></select></label>
      <button class="btn primary">Check</button></form>
    <div id="qcr"></div></div>`, "home");
  $$("[data-go]").forEach((r) => (r.onclick = () => (location.hash = r.dataset.go)));
  $("#qc").onsubmit = (e) => {
    e.preventDefault();
    const f = Object.fromEntries(new FormData(e.target));
    busy(e.submitter, async () => {
      const r = await api("POST", "/research/serp", f);
      $("#qcr").innerHTML = `<div class="row" style="margin:16px 0 8px"><span class="pos">${chip(r.position)}</span>
        <span>${r.position ? `<b>${esc(f.domain)}</b> ranks #${r.position} for “${esc(f.keyword)}”` : `<b>${esc(f.domain)}</b> is not in the top 100 for “${esc(f.keyword)}”`}</span>
        ${r.url ? `<a href="${esc(r.url)}" target="_blank" rel="noopener" class="small">${esc(shortUrl(r.url))}</a>` : ""}</div>
        <div class="feat">SERP features: ${esc(r.features.join(", ") || "none")}</div>
        <div class="tbl-wrap"><table><tbody>${r.top.map((t) => `<tr><td style="width:50px">${chip(t.p)}</td><td><b>${esc(t.d)}</b><div class="small muted">${esc(t.t || "")}</div></td></tr>`).join("")}</tbody></table></div>`;
    }, "Checking…");
  };
}

// ---------------- project form ----------------
function projectForm(p = {}) {
  return `<div class="grid2">
    <label class="f">Project name<input name="name" value="${esc(p.name)}" required placeholder="Dui Social"></label>
    <label class="f">Domain<input name="domain" value="${esc(p.domain)}" required placeholder="duisocial.com"></label>
    <label class="f">Location${locSelect("location_code", p.location_code ?? 2704)}</label>
    <label class="f">Language${langSelect("language_code", p.language_code ?? "en")}</label>
    <label class="f">Device<select name="device"><option value="desktop">Desktop</option><option value="mobile" ${p.device === "mobile" ? "selected" : ""}>Mobile</option></select></label>
    <label class="f">Check frequency<select name="frequency">${[["daily", "Daily"], ["weekly", "Weekly"], ["manual", "Manual only"]].map(([v, l]) => `<option value="${v}" ${(p.frequency || "daily") === v ? "selected" : ""}>${l}</option>`).join("")}</select></label>
    <label class="f">Results depth<select name="depth">${[20, 30, 50, 100].map((d) => `<option value="${d}" ${(p.depth || 50) === d ? "selected" : ""}>Top ${d}</option>`).join("")}</select></label>
  </div>
  <div class="grid2" style="margin-top:14px">
    <label class="f">Brand names (for AI mentions)<input name="brand_names" value="${esc(p.brand_names)}" placeholder="Dui Social, Dui Bar"></label>
    <label class="f">Competitor domains<input name="competitors" value="${esc(p.competitors)}" placeholder="rival1.com, rival2.com"></label>
    <label class="f">Google Maps business name<input name="business_name" value="${esc(p.business_name)}" placeholder="Dui Social"></label>
    <label class="f">Google Maps CID (optional)<input name="place_cid" value="${esc(p.place_cid)}" placeholder="Set from the Local tab"></label>
  </div>
  <label class="f" style="margin-top:14px">Notes<textarea name="notes" style="min-height:60px">${esc(p.notes)}</textarea></label>
  <p class="muted small" style="margin-top:10px">Deeper results and daily checks cost more. Top 50 daily for 100 keywords is roughly $3–6 a month in standard mode.</p>`;
}

function pageNewProject() {
  mount(`<div class="page-head"><div><h1>New project</h1><div class="sub">One website you want to track.</div></div></div>
    <form class="panel" id="pf">${projectForm()}<div class="row" style="margin-top:16px"><button class="btn primary">Create project</button><a class="btn ghost" href="#/">Cancel</a></div></form>`, "new");
  $("#pf").onsubmit = (e) => {
    e.preventDefault();
    busy(e.submitter, async () => {
      const r = await api("POST", "/projects", Object.fromEntries(new FormData(e.target)));
      await loadProjects();
      location.hash = `#/p/${r.id}/rankings`;
      toast("Project created. Add keywords to start tracking.");
    });
  };
}

// ---------------- project ----------------
const TABS = [["overview", "Overview"], ["rankings", "Rankings"], ["ai", "AI visibility"], ["local", "Local"], ["audit", "Site audit"], ["settings", "Settings"]];

async function pageProject(id, tab) {
  if (!state.projects.length) await loadProjects();
  const p = await api("GET", `/projects/${id}`);
  mount(`<div class="page-head"><div><h1>${esc(p.name)}</h1>
      <div class="sub"><a href="https://${esc(p.domain)}" target="_blank" rel="noopener">${esc(p.domain)}</a> · ${esc(locName(p.location_code))} · ${esc(p.device)} · ${esc(p.frequency)} checks</div></div>
      <div class="spacer"></div><button class="btn" id="checkAll">Check all keywords now</button></div>
    <nav class="tabs">${TABS.map(([k, l]) => `<a href="#/p/${id}/${k}" class="${tab === k ? "on" : ""}">${l}</a>`).join("")}</nav>
    <div id="tab"></div>`, "p" + id);
  $("#checkAll").onclick = (e) => busy(e.currentTarget, async () => {
    const r = await api("POST", `/projects/${id}/check-all`);
    toast(r.mode === "live" ? `Checking ${r.queued} keywords…` : `Queued ${r.queued} keywords. Results arrive within ~15–45 minutes.`, 5000);
  });
  const el = $("#tab");
  const fn = { overview: tabOverview, rankings: tabRankings, ai: tabAI, local: tabLocal, audit: tabAudit, settings: tabSettings }[tab] || tabOverview;
  await fn(el, p);
}

async function tabOverview(el, p) {
  const [ov, kws] = await Promise.all([api("GET", `/projects/${p.id}/overview?days=90`), api("GET", `/projects/${p.id}/keywords`)]);
  const s = ov.series;
  const last = s[s.length - 1] || {};
  const weekAgo = s[Math.max(0, s.length - 8)] || {};
  const d = (a, b, rev, unit = "") => (a == null || b == null || a === b ? "" : `<span class="d ${(rev ? b - a : a - b) > 0 ? "delta up" : "delta down"}">${a - b > 0 ? "+" : ""}${Math.round((a - b) * 10) / 10}${unit} vs 7 days</span>`);
  // movers
  const movers = kws.map((k) => ({ k: k.keyword, g: k.data.google })).filter((x) => x.g && x.g.week !== undefined)
    .map((x) => ({ ...x, change: (x.g.week || 101) - (x.g.position || 101) })).filter((x) => x.change);
  const up = movers.filter((x) => x.change > 0).sort((a, b) => b.change - a.change).slice(0, 6);
  const down = movers.filter((x) => x.change < 0).sort((a, b) => a.change - b.change).slice(0, 6);
  const moverList = (arr) => arr.length ? `<table><tbody>${arr.map((x) => `<tr><td class="kw">${esc(x.k)}</td><td class="num"><span class="pos">${chip(x.g.position)}${delta(x.g.position, x.g.week)}</span></td></tr>`).join("")}</tbody></table>` : `<p class="muted small">No changes this week.</p>`;

  el.innerHTML = !s.length ? `<div class="panel empty"><h3>No ranking data yet</h3><p>Add keywords on the Rankings tab, then check them now or wait for the next scheduled run.</p>
      ${ov.pending ? `<p class="small muted">${ov.pending} checks are waiting at DataForSEO.</p>` : ""}<a class="btn primary" href="#/p/${p.id}/rankings">Add keywords</a></div>` : `
    <div class="kpis">
      <div class="kpi"><div class="v">${last.visibility ?? "—"}%</div><div class="l">Visibility</div>${d(last.visibility, weekAgo.visibility, false, "%")}</div>
      <div class="kpi"><div class="v">${last.avg ?? "—"}</div><div class="l">Avg. Google position</div>${d(last.avg, weekAgo.avg, true)}</div>
      <div class="kpi"><div class="v">${n(last.top3)}</div><div class="l">In top 3</div>${d(last.top3, weekAgo.top3)}</div>
      <div class="kpi"><div class="v">${n(last.top10)}</div><div class="l">In top 10</div>${d(last.top10, weekAgo.top10)}</div>
      <div class="kpi"><div class="v">${last.ai_cited == null ? "—" : last.ai_cited + "%"}</div><div class="l">Cited in AI Overviews / AI Mode</div>${d(last.ai_cited, weekAgo.ai_cited, false, "%")}</div>
    </div>
    ${ov.pending ? `<div class="note" style="margin-top:12px">${ov.pending} checks are queued at DataForSEO and will appear after the next collection run.</div>` : ""}
    <div class="panel" style="margin-top:16px"><div class="panel-head"><h2>Visibility and AI citations</h2><span class="muted small">Last 90 days</span></div><div class="chart-box"><canvas id="c1"></canvas></div></div>
    <div class="grid2" style="margin-top:16px">
      <div class="panel"><div class="panel-head"><h3>Top 3 / top 10 keywords</h3></div><div class="chart-box short"><canvas id="c2"></canvas></div></div>
      <div class="panel"><div class="panel-head"><h3>Average position</h3></div><div class="chart-box short"><canvas id="c3"></canvas></div></div>
    </div>
    <div class="grid2" style="margin-top:16px">
      <div class="panel"><div class="panel-head"><h3>Biggest gains this week</h3></div>${moverList(up)}</div>
      <div class="panel"><div class="panel-head"><h3>Biggest drops this week</h3></div>${moverList(down)}</div>
    </div>`;
  if (!s.length) return;
  const labels = s.map((x) => x.d.slice(5));
  lineChart($("#c1"), labels, [
    { label: "Visibility %", data: s.map((x) => x.visibility), borderColor: css("--blue"), backgroundColor: css("--blue") },
    { label: "AI citation rate %", data: s.map((x) => x.ai_cited), borderColor: css("--amber"), backgroundColor: css("--amber"), borderDash: [5, 4] },
  ]);
  lineChart($("#c2"), labels, [
    { label: "Top 3", data: s.map((x) => x.top3), borderColor: css("--blue"), backgroundColor: css("--blue") },
    { label: "Top 10", data: s.map((x) => x.top10), borderColor: css("--ink-3"), backgroundColor: css("--ink-3") },
  ]);
  lineChart($("#c3"), labels, [{ label: "Avg. position", data: s.map((x) => x.avg), borderColor: css("--blue") }], { reverse: true });
}

// ---- rankings ----
async function tabRankings(el, p) {
  const kws = await api("GET", `/projects/${p.id}/keywords`);
  const used = ENGINES.filter(([e]) => kws.some((k) => k.engines.includes(e)));
  let sortKey = "keyword", sortDir = 1, filter = "";
  const val = (k, key) => {
    if (key === "keyword") return k.keyword;
    if (key === "volume") return k.search_volume ?? -1;
    const d = k.data[key];
    return d && d.position ? d.position : 999;
  };
  const cell = (k, e) => {
    const d = k.data[e];
    if (!k.engines.includes(e)) return `<td class="muted small">off</td>`;
    if (!d) return `<td><span class="muted small">pending</span></td>`;
    if (e === "ai_overview" || e === "ai_mode") {
      if (!d.present) return `<td><span class="badge plain" title="No AI answer shown for this query">no answer</span></td>`;
      return `<td>${d.cited ? `<span class="badge cited" title="${esc(d.url)}">cited #${d.position}</span>` : `<span class="badge plain">not cited</span>`}</td>`;
    }
    return `<td><span class="pos">${chip(d.position)}${delta(d.position, d.prev)}</span></td>`;
  };
  const draw = () => {
    const rows = kws.filter((k) => !filter || k.keyword.includes(filter) || (k.tags || "").includes(filter))
      .sort((a, b) => { const x = val(a, sortKey), y = val(b, sortKey); return (x > y ? 1 : x < y ? -1 : 0) * sortDir; });
    $("#kwt").innerHTML = rows.length ? `<table><thead><tr>
      <th class="sortable" data-s="keyword">Keyword</th><th class="sortable num" data-s="volume">Volume</th>
      ${used.map(([e, l]) => `<th class="sortable" data-s="${e}">${l}</th>`).join("")}
      <th>Ranking URL</th><th>30 days</th><th></th></tr></thead><tbody>
      ${rows.map((k) => { const g = k.data.google || k.data.bing; return `<tr>
        <td class="kw clickable" data-hist="${k.id}">${esc(k.keyword)}${k.tags ? `<div class="feat">${esc(k.tags)}</div>` : ""}</td>
        <td class="num">${n(k.search_volume)}</td>
        ${used.map(([e]) => cell(k, e)).join("")}
        <td class="url">${g?.url ? `<a href="${esc(g.url)}" target="_blank" rel="noopener">${esc(shortUrl(g.url))}</a>` : ""}</td>
        <td>${spark(g?.spark)}</td>
        <td class="num" style="white-space:nowrap"><button class="btn ghost sm" data-check="${k.id}" title="Live check now">Check</button><button class="btn ghost sm danger" data-del="${k.id}" aria-label="Delete keyword">✕</button></td></tr>`; }).join("")}
      </tbody></table>` : `<div class="empty"><p>No keywords match.</p></div>`;
    $$("#kwt th[data-s]").forEach((th) => (th.onclick = () => { sortDir = sortKey === th.dataset.s ? -sortDir : 1; sortKey = th.dataset.s; draw(); }));
    $$("#kwt [data-hist]").forEach((td) => (td.onclick = () => keywordDrawer(kws.find((k) => k.id == td.dataset.hist), p)));
    $$("#kwt [data-check]").forEach((b) => (b.onclick = () => busy(b, async () => {
      const r = await api("POST", `/keywords/${b.dataset.check}/check`);
      toast(r.errors?.length ? r.errors.join("; ") : "Checked");
      tabRankings(el, p);
    }, "…")));
    $$("#kwt [data-del]").forEach((b) => (b.onclick = async () => {
      if (!confirm("Delete this keyword and its history?")) return;
      await api("DELETE", `/keywords/${b.dataset.del}`);
      tabRankings(el, p);
    }));
  };
  el.innerHTML = `
    <div class="panel"><div class="panel-head"><h2>Tracked keywords</h2><span class="muted small">${kws.length} keywords · click a keyword for its history</span>
      <div class="spacer"></div><input id="flt" placeholder="Filter keywords or tags" style="width:220px"><button class="btn primary" id="addBtn">Add keywords</button></div>
      <div class="tbl-wrap" id="kwt"></div></div>`;
  if (!kws.length) $("#kwt").innerHTML = `<div class="empty"><h3>No keywords yet</h3><p>Add the searches your customers use. One per line.</p></div>`;
  else draw();
  $("#flt").oninput = (e) => { filter = e.target.value.toLowerCase(); if (kws.length) draw(); };
  $("#addBtn").onclick = () => addKeywordsDrawer(p, () => tabRankings(el, p));
}

function addKeywordsDrawer(p, done, preset = "") {
  const d = drawer(`<div class="panel-head"><h2>Add keywords</h2><div class="spacer"></div><button class="btn ghost" data-close>Close</button></div>
    <form id="akf" class="stack">
      <label class="f">Keywords, one per line<textarea name="keywords" style="min-height:180px" placeholder="cocktail bar da nang\nbest bars an thuong">${esc(preset)}</textarea></label>
      <div><div class="small muted" style="margin-bottom:6px">Track in</div><div class="row">${ENGINES.map(([e, l]) => `<label class="chk"><input type="checkbox" name="eng" value="${e}" ${["google", "ai_overview"].includes(e) ? "checked" : ""}>${l}</label>`).join("")}</div>
      <p class="muted small" style="margin-top:6px">AI Overviews come from the same Google check (small extra cost). AI Mode is a separate call and English-only.</p></div>
      <label class="f">Tags (optional)<input name="tags" placeholder="service, brand, blog"></label>
      <button class="btn primary">Add and check</button></form>`);
  $("#akf", d.el).onsubmit = (e) => {
    e.preventDefault();
    const f = e.target;
    const engines = $$("input[name=eng]:checked", f).map((x) => x.value).join(",");
    if (!engines) return toast("Pick at least one engine.");
    busy(e.submitter, async () => {
      const r = await api("POST", `/projects/${p.id}/keywords`, { keywords: f.keywords.value, engines, tags: f.tags.value });
      await api("POST", `/projects/${p.id}/check-all`);
      d.close();
      toast(`Added ${r.added} keywords. First results arrive shortly.`, 5000);
      done && done();
    });
  };
}

async function keywordDrawer(k, p) {
  const d = drawer(`<div class="panel-head"><h2>${esc(k.keyword)}</h2><div class="spacer"></div><button class="btn ghost" data-close>Close</button></div><p class="muted">Loading history…</p>`);
  const hist = await api("GET", `/keywords/${k.id}/history`);
  const byE = {};
  hist.forEach((h) => (byE[h.engine] = byE[h.engine] || []).push(h));
  const dates = [...new Set(hist.filter((h) => h.engine === "google" || h.engine === "bing").map((h) => h.checked_at.slice(0, 10)))];
  const pick = (e) => dates.map((dt) => { const r = (byE[e] || []).filter((h) => h.checked_at.startsWith(dt)).pop(); return r ? r.position : null; });
  const lastG = (byE.google || []).slice(-1)[0];
  const lastAio = (byE.ai_overview || []).slice(-1)[0];
  const lastAim = (byE.ai_mode || []).slice(-1)[0];
  const comps = (p.competitors || "").split(",").map((s) => s.trim()).filter(Boolean);
  const topList = (rows, me) => rows ? `<ul class="src-list">${rows.map((t) => `<li class="${t.d && (t.d === p.domain || t.d.endsWith("." + p.domain)) ? "me" : ""}"><span class="n">${t.p}</span><span>${esc(t.d)}${comps.includes(t.d) ? ` <span class="badge plain">competitor</span>` : ""}</span></li>`).join("")}</ul>` : `<p class="muted small">${me}</p>`;
  d.el.innerHTML = `<div class="panel-head"><h2>${esc(k.keyword)}</h2><div class="spacer"></div><button class="btn ghost" data-close>Close</button></div>
    <p class="muted small">Volume ${n(k.search_volume)} · tracked in ${esc(k.engines.replace(/,/g, ", "))}</p>
    ${dates.length > 1 ? `<div class="chart-box short"><canvas id="hc"></canvas></div>` : `<p class="muted">Position history appears after two checks.</p>`}
    <h3 style="margin:20px 0 8px">Google top results (last check)</h3>${topList(lastG && lastG.top, "No Google check yet.")}
    ${lastG?.features ? "" : ""}
    ${k.engines.includes("ai_overview") ? `<h3 style="margin:20px 0 8px">AI Overview sources</h3>${lastAio ? (lastAio.present ? topList(lastAio.top, "") : `<p class="muted small">Google showed no AI Overview for this query.</p>`) : `<p class="muted small">Not checked yet.</p>`}` : ""}
    ${k.engines.includes("ai_mode") ? `<h3 style="margin:20px 0 8px">AI Mode sources</h3>${lastAim ? topList(lastAim.top, "No sources.") : `<p class="muted small">Not checked yet.</p>`}` : ""}
    <div class="row" style="margin-top:18px"><label class="f">Engines<input id="engEdit" value="${esc(k.engines)}"></label><label class="f">Tags<input id="tagEdit" value="${esc(k.tags)}"></label><button class="btn" id="saveK" style="align-self:flex-end">Save</button></div>`;
  if (dates.length > 1) {
    const ds = [];
    if (byE.google) ds.push({ label: "Google", data: pick("google"), borderColor: css("--blue"), backgroundColor: css("--blue"), spanGaps: true });
    if (byE.bing) ds.push({ label: "Bing", data: pick("bing"), borderColor: css("--ink-3"), backgroundColor: css("--ink-3"), spanGaps: true });
    lineChart($("#hc", d.el), dates.map((x) => x.slice(5)), ds, { reverse: true, y: { min: 1, suggestedMax: 20 } });
  }
  $("#saveK", d.el).onclick = (e) => busy(e.currentTarget, async () => {
    await api("PUT", `/keywords/${k.id}`, { engines: $("#engEdit", d.el).value.replace(/\s/g, ""), tags: $("#tagEdit", d.el).value });
    toast("Saved");
  });
}

// ---- AI visibility ----
async function tabAI(el, p) {
  const prompts = await api("GET", `/projects/${p.id}/prompts`);
  const plats = [["chatgpt", "ChatGPT"], ["ai_mode", "Google AI Mode"]];
  const latest = prompts.flatMap((x) => Object.values(x.data).filter(Boolean));
  const mentioned = latest.filter((r) => r.brand_mentioned || r.domain_cited).length;
  const cited = latest.filter((r) => r.domain_cited).length;
  // share of voice: which domains get cited most across all prompts
  const sov = {};
  latest.forEach((r) => (r.sources || []).forEach((s) => (sov[s.d] = (sov[s.d] || 0) + 1)));
  const sovTop = Object.entries(sov).sort((a, b) => b[1] - a[1]).slice(0, 10);
  const cell = (r) => {
    if (r === undefined) return `<td class="muted small">off</td>`;
    if (!r) return `<td class="muted small">pending</td>`;
    const b = r.domain_cited ? `<span class="badge cited">cited #${r.cited_position}</span>` : r.brand_mentioned ? `<span class="badge ok">mentioned</span>` : `<span class="badge plain">absent</span>`;
    return `<td>${b} <span class="history-dots" title="Older → newer: amber cited, blue mentioned">${r.history.map((h) => `<i class="${h === 2 ? "c" : h === 1 ? "m" : ""}"></i>`).join("")}</span></td>`;
  };
  el.innerHTML = `
    <div class="kpis">
      <div class="kpi"><div class="v">${prompts.length}</div><div class="l">Prompts tracked</div></div>
      <div class="kpi"><div class="v">${latest.length ? Math.round((mentioned / latest.length) * 100) + "%" : "—"}</div><div class="l">Answers mentioning you</div></div>
      <div class="kpi"><div class="v">${latest.length ? Math.round((cited / latest.length) * 100) + "%" : "—"}</div><div class="l">Answers citing ${esc(p.domain)}</div></div>
    </div>
    <div class="panel" style="margin-top:16px"><div class="panel-head"><h2>Prompts</h2><span class="muted small">Questions your customers ask AI assistants. Click one for the full answer.</span><div class="spacer"></div><button class="btn primary" id="addP">Add prompts</button></div>
      ${prompts.length ? `<div class="tbl-wrap"><table><thead><tr><th>Prompt</th>${plats.map(([, l]) => `<th>${l}</th>`).join("")}<th>Competitors in answer</th><th></th></tr></thead><tbody>
        ${prompts.map((x) => { const comp = [...new Set(Object.values(x.data).filter(Boolean).flatMap((r) => r.competitors_hit))]; return `<tr>
          <td class="kw clickable" data-open="${x.id}">${esc(x.prompt)}</td>
          ${plats.map(([k]) => cell(x.platforms.includes(k) ? x.data[k] : undefined)).join("")}
          <td class="small">${comp.length ? esc(comp.join(", ")) : `<span class="muted">none</span>`}</td>
          <td class="num" style="white-space:nowrap"><button class="btn ghost sm" data-run="${x.id}">Run now</button><button class="btn ghost sm danger" data-del="${x.id}" aria-label="Delete prompt">✕</button></td></tr>`; }).join("")}
      </tbody></table></div>` : `<div class="empty"><h3>No prompts yet</h3><p>Add questions like “best cocktail bar in Da Nang” or “who builds websites for expats in Vietnam”.</p></div>`}
    </div>
    <div class="grid2" style="margin-top:16px">
      <div class="panel"><div class="panel-head"><h3>Most cited domains</h3><span class="muted small">Across latest answers</span></div>
        ${sovTop.length ? `<ul class="src-list">${sovTop.map(([dmn, c], i) => `<li class="${dmn === p.domain || dmn.endsWith("." + p.domain) ? "me" : ""}"><span class="n">${i + 1}</span><span style="flex:1">${esc(dmn)}</span><span>${c}</span></li>`).join("")}</ul>` : `<p class="muted small">Run some prompts first.</p>`}</div>
      <div class="panel"><div class="panel-head"><h3>AI mentions index</h3><span class="muted small">DataForSEO LLM Mentions database (US, English)</span></div>
        <div id="aiIdx"><p class="muted small">Shows how often ChatGPT and Google AI mention your domain across millions of tracked questions. Needs the LLM Mentions API on your DataForSEO plan.</p><button class="btn" id="loadIdx">Load index</button></div></div>
    </div>`;
  $("#addP").onclick = () => {
    const d = drawer(`<div class="panel-head"><h2>Add prompts</h2><div class="spacer"></div><button class="btn ghost" data-close>Close</button></div>
      <form id="apf" class="stack"><label class="f">Prompts, one per line<textarea name="prompts" style="min-height:180px" placeholder="best cocktail bar in da nang\nwhere to drink cocktails near my khe beach"></textarea></label>
      <div class="row">${plats.map(([k, l]) => `<label class="chk"><input type="checkbox" name="pl" value="${k}" checked>${l}</label>`).join("")}</div>
      <p class="muted small">ChatGPT runs live (about $0.004 each). AI Mode is English-only.</p>
      <button class="btn primary">Add prompts</button></form>`);
    $("#apf", d.el).onsubmit = (e) => {
      e.preventDefault();
      const platforms = $$("input[name=pl]:checked", e.target).map((x) => x.value).join(",");
      busy(e.submitter, async () => {
        const r = await api("POST", `/projects/${p.id}/prompts`, { prompts: e.target.prompts.value, platforms });
        d.close(); toast(`Added ${r.added} prompts. Use “Run now” or wait for the schedule.`); tabAI(el, p);
      });
    };
  };
  $$("[data-run]", el).forEach((b) => (b.onclick = () => busy(b, async () => {
    const r = await api("POST", `/prompts/${b.dataset.run}/run`);
    toast(r.errors?.length ? r.errors.join("; ") : "Done"); tabAI(el, p);
  }, "Asking…")));
  $$("[data-del]", el).forEach((b) => (b.onclick = async () => { if (confirm("Delete this prompt and its results?")) { await api("DELETE", `/prompts/${b.dataset.del}`); tabAI(el, p); } }));
  $$("[data-open]", el).forEach((td) => (td.onclick = () => {
    const x = prompts.find((q) => q.id == td.dataset.open);
    drawer(`<div class="panel-head"><h2>${esc(x.prompt)}</h2><div class="spacer"></div><button class="btn ghost" data-close>Close</button></div>
      ${plats.filter(([k]) => x.data[k]).map(([k, l]) => { const r = x.data[k]; return `<h3 style="margin:18px 0 8px">${l} <span class="muted small">${ago(r.checked_at)}</span></h3>
        <div class="row" style="margin-bottom:8px">${r.domain_cited ? `<span class="badge cited">cited #${r.cited_position}</span>` : ""}${r.brand_mentioned ? `<span class="badge ok">brand mentioned</span>` : `<span class="badge plain">brand not mentioned</span>`}</div>
        <div class="excerpt">${esc(r.excerpt || "")}</div>
        ${r.brands?.length ? `<p class="small" style="margin-top:8px"><b>Brands named:</b> ${esc(r.brands.join(", "))}</p>` : ""}
        <h4 style="margin:12px 0 4px">Sources</h4><ul class="src-list">${(r.sources || []).map((s, i) => `<li class="${s.d === p.domain || (s.d || "").endsWith("." + p.domain) ? "me" : ""}"><span class="n">${i + 1}</span><a href="${esc(s.u)}" target="_blank" rel="noopener">${esc(s.d)}</a> <span class="muted">${esc(s.t || "")}</span></li>`).join("") || "<li class='muted'>No sources cited.</li>"}</ul>`; }).join("") || `<p class="muted">No results yet. Run the prompt first.</p>`}`);
  }));
  $("#loadIdx").onclick = (e) => busy(e.currentTarget, async () => {
    const r = await api("GET", `/projects/${p.id}/ai-index`);
    const grp = (g) => (g || []).map((x) => `<li><span style="flex:1">${esc(x.key)}</span><span>${n(x.mentions)} mentions</span></li>`).join("");
    const dm = r.domain || {};
    $("#aiIdx").innerHTML = `<h4 style="margin:0 0 4px">By platform</h4><ul class="src-list">${grp(dm.platform) || "<li class='muted'>No mentions found.</li>"}</ul>
      ${dm.sources_domain ? `<h4 style="margin:12px 0 4px">Cited alongside</h4><ul class="src-list">${grp(dm.sources_domain)}</ul>` : ""}
      ${r.brand?.platform ? `<h4 style="margin:12px 0 4px">Brand name mentions</h4><ul class="src-list">${grp(r.brand.platform)}</ul>` : ""}`;
  }, "Loading…");
}

// ---- local ----
async function tabLocal(el, p) {
  const grids = await api("GET", `/projects/${p.id}/grids`);
  el.innerHTML = `
    <div class="panel"><div class="panel-head"><h2>Find the business on Google Maps</h2><span class="muted small">Sets the CID used to spot it in map results.</span></div>
      <form id="fb" class="row end"><label class="f" style="flex:1;min-width:220px">Business name and city<input name="q" value="${esc((p.business_name || p.name) + " da nang")}"></label><button class="btn">Search Maps</button></form>
      <div id="fbr"></div>
      ${p.place_cid ? `<p class="small" style="margin-top:10px">Matching on CID <b>${esc(p.place_cid)}</b>${p.business_name ? ` and name “${esc(p.business_name)}”` : ""}.</p>` : `<p class="small muted" style="margin-top:10px">No CID set. Matching falls back to the domain and business name.</p>`}
    </div>
    <div class="panel"><div class="panel-head"><h2>Rank grids</h2><span class="muted small">Your Maps position at each point around the business.</span><div class="spacer"></div><button class="btn primary" id="newGrid">New grid</button></div>
      ${grids.length ? `<div class="tbl-wrap"><table><thead><tr><th>Keyword</th><th>Grid</th><th class="num">Avg. rank</th><th class="num">Top 3 points</th><th>Last scan</th><th></th></tr></thead><tbody>
        ${grids.map((g) => { const s = g.scans[0]; return `<tr><td class="kw clickable" data-view="${g.id}">${esc(g.keyword)}</td><td class="small">${g.size}×${g.size}, ${g.spacing_km} km apart${g.next_run_at ? " · weekly" : ""}</td>
          <td class="num">${s && s.points_done ? (Math.round(s.avg_rank * 10) / 10) : "—"}</td><td class="num">${s ? `${s.top3 || 0} / ${s.points_total}` : "—"}</td>
          <td class="small">${s ? `${ago(s.started_at)}${s.points_done < s.points_total ? ` (${s.points_done}/${s.points_total} in)` : ""}` : "never"}</td>
          <td class="num" style="white-space:nowrap"><button class="btn ghost sm" data-run="${g.id}">Scan now</button><button class="btn ghost sm danger" data-del="${g.id}" aria-label="Delete grid">✕</button></td></tr>`; }).join("")}</tbody></table></div>`
      : `<div class="empty"><p>Create a grid to see how you rank on Maps across the neighbourhood.</p></div>`}
    </div>
    <div class="panel" id="gridView" ${grids.length ? "" : "hidden"}><div class="panel-head"><h2 id="gvTitle">Grid</h2><div class="spacer"></div><select id="scanSel"></select></div>
      <div id="map"></div>
      <div class="legend"><span><i style="background:#1F8A5B"></i>1–3</span><span><i style="background:#8FB339"></i>4–7</span><span><i style="background:#E0A100"></i>8–12</span><span><i style="background:#D9622B"></i>13–20</span><span><i style="background:#9AA3AF"></i>not in top 20</span></div></div>`;
  $("#fb").onsubmit = (e) => {
    e.preventDefault();
    busy(e.submitter, async () => {
      const list = await api("GET", `/local/find?q=${encodeURIComponent(e.target.q.value)}&location_code=${p.location_code}&language_code=${p.language_code}`);
      $("#fbr").innerHTML = list.length ? `<div class="tbl-wrap"><table><tbody>${list.map((b, i) => `<tr><td><b>${esc(b.title)}</b><div class="small muted">${esc(b.address || "")} · ${esc(b.category || "")} · ${b.rating ?? "–"}★ (${n(b.votes)})</div></td>
        <td class="num"><button class="btn sm" data-pick="${i}">This is mine</button></td></tr>`).join("")}</tbody></table></div>` : `<p class="muted">No businesses found. Try a different name.</p>`;
      $$("[data-pick]").forEach((b) => (b.onclick = async () => {
        const x = list[b.dataset.pick];
        await api("PUT", `/projects/${p.id}`, { place_cid: String(x.cid || ""), business_name: x.title });
        p.place_cid = String(x.cid || ""); p.business_name = x.title; p._center = [x.lat, x.lng];
        toast("Business saved. New grids will centre on it.");
        tabLocal(el, p);
      }));
    }, "Searching…");
  };
  $("#newGrid").onclick = () => {
    const c = p._center || [16.0544, 108.2022];
    const d = drawer(`<div class="panel-head"><h2>New rank grid</h2><div class="spacer"></div><button class="btn ghost" data-close>Close</button></div>
      <form id="gf" class="stack"><label class="f">Keyword<input name="keyword" required placeholder="cocktail bar"></label>
      <div class="grid2"><label class="f">Centre latitude<input name="center_lat" value="${c[0]}" required></label><label class="f">Centre longitude<input name="center_lng" value="${c[1]}" required></label></div>
      <div class="grid2"><label class="f">Grid size<select name="size"><option value="3">3×3 (9 points)</option><option value="5" selected>5×5 (25 points)</option><option value="7">7×7 (49 points)</option></select></label>
      <label class="f">Point spacing (km)<input name="spacing_km" value="0.8" type="number" step="0.1" min="0.1"></label>
      <label class="f">Map zoom<input name="zoom" value="15" type="number" min="10" max="20"></label></div>
      <label class="chk"><input type="checkbox" name="weekly" checked>Rescan weekly</label>
      <p class="muted small">Tip: find the business above first to centre on it. A 5×5 scan is 25 Maps calls.</p>
      <button class="btn primary">Create and scan</button></form>`);
    $("#gf", d.el).onsubmit = (e) => {
      e.preventDefault();
      const f = Object.fromEntries(new FormData(e.target));
      f.weekly = !!e.target.weekly.checked;
      busy(e.submitter, async () => {
        const r = await api("POST", `/projects/${p.id}/grids`, f);
        toast("Scanning grid… this takes up to a minute.", 6000);
        await api("POST", `/grids/${r.id}/run`);
        d.close(); tabLocal(el, p);
      });
    };
  };
  $$("[data-run]", el).forEach((b) => (b.onclick = () => busy(b, async () => { await api("POST", `/grids/${b.dataset.run}/run`); tabLocal(el, p); }, "Scanning…")));
  $$("[data-del]", el).forEach((b) => (b.onclick = async () => { if (confirm("Delete this grid and its scans?")) { await api("DELETE", `/grids/${b.dataset.del}`); tabLocal(el, p); } }));
  $$("[data-view]", el).forEach((td) => (td.onclick = () => showGrid(grids.find((g) => g.id == td.dataset.view))));
  if (grids.length) showGrid(grids[0]);
}

let map;
function rankColor(r) { return !r ? "#9AA3AF" : r <= 3 ? "#1F8A5B" : r <= 7 ? "#8FB339" : r <= 12 ? "#E0A100" : "#D9622B"; }
async function showGrid(g) {
  $("#gridView").hidden = false;
  $("#gvTitle").textContent = `“${g.keyword}”`;
  const sel = $("#scanSel");
  sel.innerHTML = g.scans.map((s) => `<option value="${s.id}">${s.started_at.slice(0, 16)} UTC</option>`).join("") || `<option>No scans yet</option>`;
  if (!window.L) return;
  if (map) map.remove();
  map = L.map("map", { scrollWheelZoom: false }).setView([g.center_lat, g.center_lng], 14);
  L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", { maxZoom: 19, attribution: "&copy; OpenStreetMap" }).addTo(map);
  const layer = L.layerGroup().addTo(map);
  const draw = async (sid) => {
    layer.clearLayers();
    if (!sid) return;
    const pts = await api("GET", `/scans/${sid}`);
    const bounds = [];
    pts.forEach((pt) => {
      bounds.push([pt.lat, pt.lng]);
      const icon = L.divIcon({ className: "", html: `<div class="grid-pin" style="background:${rankColor(pt.rank)}">${pt.rank || "20+"}</div>`, iconSize: [32, 32], iconAnchor: [16, 16] });
      L.marker([pt.lat, pt.lng], { icon }).addTo(layer)
        .bindPopup(`<b>${pt.rank ? "Rank " + pt.rank : "Not in top 20"}</b><br>${(pt.top || []).map((t, i) => `${i + 1}. ${esc(t.t)} ${t.r ? `(${t.r}★)` : ""}`).join("<br>")}`);
    });
    if (bounds.length) map.fitBounds(bounds, { padding: [30, 30] });
  };
  sel.onchange = () => draw(sel.value);
  draw(g.scans[0]?.id);
}

// ---- audit ----
async function tabAudit(el, p) {
  const audits = await api("GET", `/projects/${p.id}/audits`);
  el.innerHTML = `<div class="panel"><div class="panel-head"><h2>Site audit</h2><span class="muted small">Crawls ${esc(p.domain)} and checks technical SEO on every page.</span><div class="spacer"></div>
      <select id="maxp"><option value="50">50 pages</option><option value="100" selected>100 pages</option><option value="300">300 pages</option><option value="1000">1,000 pages</option></select><button class="btn primary" id="startA">Start audit</button></div>
      ${audits.length ? `<div class="tbl-wrap"><table><thead><tr><th>Started</th><th>Status</th><th class="num">Pages</th><th class="num">Score</th><th class="num">Issues</th><th></th></tr></thead><tbody>
        ${audits.map((a) => `<tr><td>${esc(a.started_at.slice(0, 16))}</td><td>${a.status === "finished" ? `<span class="badge ok">finished</span>` : `<span class="badge plain">crawling</span>`}</td>
          <td class="num">${n(a.summary?.crawled)}</td><td class="num">${a.summary?.score != null ? Math.round(a.summary.score) : "—"}</td>
          <td class="num">${a.summary ? n(a.summary.issues.reduce((s, x) => s + x.n, 0)) : "—"}</td><td class="num"><button class="btn sm" data-open="${a.id}">Open</button></td></tr>`).join("")}</tbody></table></div>`
      : `<div class="empty"><p>No audits yet. A 100-page crawl costs about $0.02.</p></div>`}</div><div id="auditView"></div>`;
  $("#startA").onclick = (e) => busy(e.currentTarget, async () => {
    const r = await api("POST", `/projects/${p.id}/audits`, { max_pages: +$("#maxp").value });
    toast("Crawl started. Open it in a few minutes.");
    await tabAudit(el, p); openAudit(r.id);
  });
  $$("[data-open]", el).forEach((b) => (b.onclick = () => busy(b, () => openAudit(b.dataset.open), "…")));
}
const ISSUE_NAMES = {
  no_title: "Missing title", no_description: "Missing meta description", no_h1_tag: "Missing H1", duplicate_title: "Duplicate title",
  duplicate_description: "Duplicate description", title_too_long: "Title too long", title_too_short: "Title too short", is_broken: "Broken page",
  is_4xx_code: "4xx error", is_5xx_code: "5xx error", is_redirect: "Redirect", low_content_rate: "Low text-to-HTML ratio", no_image_alt: "Images without alt",
  no_image_title: "Images without title", high_loading_time: "Slow page load", large_page_size: "Large page size", has_render_blocking_resources: "Render-blocking resources",
  is_orphan_page: "Orphan page", has_links_to_redirects: "Links to redirects", no_content_encoding: "No compression", high_waiting_time: "Slow server response",
  irrelevant_description: "Description doesn't match content", irrelevant_title: "Title doesn't match content", deprecated_html_tags: "Deprecated HTML", low_readability_rate: "Hard to read",
  lorem_ipsum: "Placeholder text", small_page_size: "Very little content", https_to_http_links: "Links to HTTP pages", canonical_to_redirect: "Canonical points to redirect",
  canonical_to_broken: "Canonical points to broken page", is_http: "Served over HTTP", recursive_canonical: "Recursive canonical", no_doctype: "Missing doctype", has_frame: "Uses frames",
  no_favicon: "No favicon", duplicate_meta_tags: "Duplicate meta tags", has_meta_refresh_redirect: "Meta refresh redirect", is_link_relation_conflict: "Link rel conflict",
};
const issueName = (k) => ISSUE_NAMES[k] || k.replace(/_/g, " ").replace(/^./, (c) => c.toUpperCase());
async function openAudit(id) {
  const a = await api("GET", `/audits/${id}`);
  const s = a.summary;
  $("#auditView").innerHTML = !s ? `<div class="panel note">Crawl queued at DataForSEO. Check back in a few minutes.</div>` : `
    <div class="kpis" style="margin-top:16px">
      <div class="kpi"><div class="v">${s.score != null ? Math.round(s.score) : "—"}</div><div class="l">On-page score / 100</div></div>
      <div class="kpi"><div class="v">${n(s.crawled)}</div><div class="l">Pages crawled${s.progress !== "finished" ? ` (${n(s.in_queue)} queued)` : ""}</div></div>
      <div class="kpi"><div class="v">${n(s.broken_links)}</div><div class="l">Broken links</div></div>
      <div class="kpi"><div class="v">${n(s.duplicate_title + s.duplicate_description)}</div><div class="l">Duplicate titles/descriptions</div></div>
      <div class="kpi"><div class="v">${n(s.non_indexable)}</div><div class="l">Non-indexable pages</div></div>
    </div>
    <div class="panel" style="margin-top:16px"><div class="panel-head"><h2>Issues</h2><span class="muted small">${s.domain.cms ? esc(s.domain.cms) + " · " : ""}SSL ${s.domain.ssl ? "ok" : "missing"} · sitemap ${s.domain.sitemap ? "found" : "missing"} · robots.txt ${s.domain.robots_txt ? "found" : "missing"}</span></div>
      ${s.issues.length ? `<div class="issues">${s.issues.map((x) => `<div><span>${esc(issueName(x.k))}</span><b>${n(x.n)}</b></div>`).join("")}</div>` : `<p class="muted">No issues found.</p>`}</div>
    ${a.pages ? `<div class="panel"><div class="panel-head"><h2>Pages</h2><span class="muted small">Lowest score first</span></div><div class="tbl-wrap"><table><thead><tr><th>Page</th><th class="num">Status</th><th class="num">Score</th><th class="num">Words</th><th>Issues</th></tr></thead><tbody>
      ${a.pages.slice(0, 300).map((pg) => `<tr><td class="url"><a href="${esc(pg.url)}" target="_blank" rel="noopener" title="${esc(pg.title || "")}">${esc(shortUrl(pg.url))}</a></td><td class="num">${pg.status}</td><td class="num">${pg.score != null ? Math.round(pg.score) : "—"}</td><td class="num">${n(pg.words)}</td>
        <td class="small">${pg.issues.slice(0, 5).map(issueName).map(esc).join(", ")}${pg.issues.length > 5 ? ` +${pg.issues.length - 5}` : ""}</td></tr>`).join("")}</tbody></table></div></div>` : ""}`;
  $("#auditView").scrollIntoView({ behavior: "smooth", block: "start" });
}

// ---- settings ----
async function tabSettings(el, p) {
  el.innerHTML = `<form class="panel" id="sf"><div class="panel-head"><h2>Project settings</h2></div>${projectForm(p)}
    <div class="row" style="margin-top:16px"><button class="btn primary">Save changes</button><div class="spacer"></div><button type="button" class="btn danger" id="delP">Delete project</button></div></form>`;
  $("#sf").onsubmit = (e) => {
    e.preventDefault();
    busy(e.submitter, async () => { await api("PUT", `/projects/${p.id}`, Object.fromEntries(new FormData(e.target))); await loadProjects(); toast("Saved"); route(); });
  };
  $("#delP").onclick = async () => {
    if (!confirm(`Delete ${p.name} and all its history? This can't be undone.`)) return;
    await api("DELETE", `/projects/${p.id}`); await loadProjects(); location.hash = "#/projects";
  };
}

// ---------------- research ----------------
function pageKeywordResearch() {
  mount(`<div class="page-head"><div><h1>Keyword research</h1><div class="sub">Volumes, difficulty and intent from Google data. Results are cached for 3 days.</div></div></div>
    <form class="panel row end" id="krf">
      <label class="f" style="flex:1;min-width:220px">Seed keyword<input name="seed" required placeholder="cocktail bar"></label>
      <label class="f">Method<select name="mode"><option value="ideas">Ideas (same topic)</option><option value="suggestions">Suggestions (contains seed)</option><option value="related">Related (“people also search”)</option></select></label>
      <label class="f">Location${locSelect("location_code", 2704)}</label><label class="f">Language${langSelect("language_code", "en")}</label>
      <button class="btn primary">Find keywords</button></form>
    <div id="krr"></div>`, "kwr");
  $("#krf").onsubmit = (e) => {
    e.preventDefault();
    const f = Object.fromEntries(new FormData(e.target));
    busy(e.submitter, async () => {
      const r = await api("POST", "/research/keywords", f);
      let rows = r.items, sk = "volume", sd = -1;
      const intentBadge = (i) => i ? `<span class="badge plain">${esc(i)}</span>` : "";
      const draw = () => {
        rows.sort((a, b) => ((a[sk] ?? -1) > (b[sk] ?? -1) ? 1 : -1) * sd);
        $("#krt").innerHTML = `<table><thead><tr><th><input type="checkbox" id="all" aria-label="Select all"></th><th class="sortable" data-s="keyword">Keyword</th><th class="sortable num" data-s="volume">Volume</th><th class="sortable num" data-s="kd">Difficulty</th><th class="sortable num" data-s="cpc">CPC</th><th>Intent</th><th>12 months</th></tr></thead><tbody>
          ${rows.map((x, i) => `<tr><td><input type="checkbox" data-i="${i}"></td><td class="kw">${esc(x.keyword)}</td><td class="num">${n(x.volume)}</td><td class="num">${x.kd ?? "—"}</td><td class="num">${x.cpc != null ? "$" + x.cpc.toFixed(2) : "—"}</td><td>${intentBadge(x.intent)}</td><td>${volSpark(x.trend)}</td></tr>`).join("")}</tbody></table>`;
        $$("#krt th[data-s]").forEach((th) => (th.onclick = () => { sd = sk === th.dataset.s ? -sd : -1; sk = th.dataset.s; draw(); }));
        $("#all").onchange = (ev) => $$("#krt [data-i]").forEach((c) => (c.checked = ev.target.checked));
      };
      if (!state.projects.length) await loadProjects();
      $("#krr").innerHTML = `<div class="panel"><div class="panel-head"><h2>${n(r.total)} keywords</h2><span class="muted small">Showing ${rows.length}</span><div class="spacer"></div>
        ${state.projects.length ? `<select id="toProj">${state.projects.map((p) => `<option value="${p.id}">${esc(p.name)}</option>`).join("")}</select><button class="btn" id="track">Track selected</button>` : ""}
        <button class="btn ghost" id="csv">Export CSV</button></div><div class="tbl-wrap" id="krt"></div></div>`;
      draw();
      $("#csv").onclick = () => downloadCsv(`keywords-${f.seed}.csv`, [["keyword", "volume", "kd", "cpc", "intent"], ...rows.map((x) => [x.keyword, x.volume, x.kd, x.cpc, x.intent])]);
      const tr = $("#track");
      if (tr) tr.onclick = () => {
        const sel = $$("#krt [data-i]:checked").map((c) => rows[c.dataset.i].keyword);
        if (!sel.length) return toast("Select some keywords first.");
        const p = state.projects.find((x) => x.id == $("#toProj").value);
        addKeywordsDrawer(p, () => (location.hash = `#/p/${p.id}/rankings`), sel.join("\n"));
      };
    }, "Searching…");
  };
}
function volSpark(arr) {
  const v = (arr || []).filter((x) => x != null);
  if (v.length < 2) return "";
  const max = Math.max(...v, 1), w = 72, h = 20, bw = w / v.length;
  return `<svg width="${w}" height="${h}" aria-hidden="true">${v.map((x, i) => { const bh = Math.max(1, (x / max) * h); return `<rect x="${(i * bw).toFixed(1)}" y="${(h - bh).toFixed(1)}" width="${(bw - 1).toFixed(1)}" height="${bh.toFixed(1)}" fill="var(--blue)" opacity=".7"/>`; }).join("")}</svg>`;
}
function downloadCsv(name, rows) {
  const csv = rows.map((r) => r.map((c) => `"${String(c ?? "").replace(/"/g, '""')}"`).join(",")).join("\n");
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob([csv], { type: "text/csv" }));
  a.download = name; a.click();
}

/** Traffic Analytics → Overview tab body (used by tools.js). */
function renderDomainOverview(el, r, f) {
  const o = r.organic;
  const b = r.backlinks || {};
  const dist = o ? [["#1", o.pos_1, "var(--blue)"], ["2–3", o.pos_2_3, "#4C63E8"], ["4–10", o.pos_4_10, "#8394F0"], ["11–20", o.pos_11_20, "#B3BEF5"], ["21–50", o.pos_21_50, "#C9CFDA"], ["51–100", o.pos_51_100, "#DDE2E8"]] : [];
  const tot = dist.reduce((s, x) => s + (x[1] || 0), 0) || 1;
  const base = `#/t/traffic/${encodeURIComponent(r.target)}`;
  el.innerHTML = `
    ${r.errors?.length ? `<div class="note err" style="margin-bottom:12px">${esc(r.errors[0])}</div>` : ""}
    <div class="kpis">
      <div class="kpi"><div class="v">${n(o?.traffic)}</div><div class="l">Organic traffic / month (est.)</div></div>
      <div class="kpi"><div class="v">${n(o?.keywords)}</div><div class="l">Ranking keywords</div></div>
      <div class="kpi"><div class="v">${o ? "$" + n(o.traffic_value) : "—"}</div><div class="l">Traffic value</div></div>
      <div class="kpi"><div class="v">${b.error ? "—" : n(b.referring_domains)}</div><div class="l">${b.error ? "Referring domains (needs Backlinks API)" : `<a href="#/t/backlinks/${encodeURIComponent(r.target)}">Referring domains</a>`}</div></div>
      <div class="kpi"><div class="v">${b.error ? "—" : n(b.rank)}</div><div class="l">Domain rank</div></div>
    </div>
    ${o ? `<div class="panel" style="margin-top:16px"><div class="panel-head"><h3>Where its keywords rank</h3><span class="muted small">${o.new ?? 0} new · ${o.up ?? 0} up · ${o.down ?? 0} down · ${o.lost ?? 0} lost this month</span></div>
      <div class="dist">${dist.map(([l, v, c]) => `<span style="width:${((v || 0) / tot) * 100}%;background:${c};color:${c.startsWith("#D") || c.startsWith("#C") ? "#16202E" : "#fff"}" title="${l}: ${n(v)}">${(v || 0) / tot > 0.06 ? n(v) : ""}</span>`).join("")}</div>
      <div class="legend">${dist.map(([l, v, c]) => `<span><i style="background:${c}"></i>${l}: ${n(v)}</span>`).join("")}</div></div>` : ""}
    ${r.history.length ? `<div class="panel"><div class="panel-head"><h3>Traffic and keywords over time</h3></div><div class="chart-box"><canvas id="dh"></canvas></div></div>` : ""}
    <div class="split" style="margin-top:16px">
      <div class="panel"><div class="panel-head"><h3>Top keywords</h3><div class="spacer"></div>${state.projects ? `<button class="btn sm" id="mkProj">Track as a project</button>` : ""}<a class="btn sm" href="${base}/keywords">All keywords</a></div>
        <div class="tbl-wrap"><table><thead><tr><th>Keyword</th><th class="num">Pos.</th><th class="num">Volume</th><th class="num">Visits</th></tr></thead><tbody>
        ${r.keywords.slice(0, 10).map((k) => `<tr><td class="kw">${esc(k.keyword)}<div class="feat">${esc(shortUrl(k.url))}</div></td><td class="num">${chip(k.position)}</td><td class="num">${n(k.volume)}</td><td class="num">${n(k.traffic)}</td></tr>`).join("") || `<tr><td colspan="4" class="muted">No ranking keywords in this database. Try another location in the top bar.</td></tr>`}
        </tbody></table></div></div>
      <div class="panel"><div class="panel-head"><h3>Organic competitors</h3><div class="spacer"></div><a class="btn sm" href="${base}/competitors">All competitors</a></div>
        <div class="tbl-wrap"><table><thead><tr><th>Domain</th><th class="num">Common kws</th><th class="num">Traffic</th></tr></thead><tbody>
        ${r.competitors.slice(0, 10).map((c) => `<tr><td><a href="#/t/traffic/${encodeURIComponent(c.domain)}/overview"><b>${esc(c.domain)}</b></a></td><td class="num">${n(c.common)}</td><td class="num">${n(c.traffic)}</td></tr>`).join("") || `<tr><td colspan="3" class="muted">No competitors found.</td></tr>`}
        </tbody></table></div></div>
    </div>`;
  if (r.history.length) lineChart($("#dh", el), r.history.map((h) => `${h.y}-${String(h.m).padStart(2, "0")}`), [
    { label: "Traffic", data: r.history.map((h) => h.traffic), borderColor: css("--blue"), backgroundColor: css("--blue"), yAxisID: "y" },
    { label: "Keywords", data: r.history.map((h) => h.keywords), borderColor: css("--amber"), backgroundColor: css("--amber"), yAxisID: "y2" },
  ], { y2: { beginAtZero: true } });
  const mk = $("#mkProj", el);
  if (mk) mk.onclick = () => busy(mk, async () => {
    const res = await api("POST", "/projects", { name: r.target, domain: r.target, location_code: f.location_code, language_code: f.language_code, frequency: "weekly" });
    await api("POST", `/projects/${res.id}/keywords`, { keywords: r.keywords.slice(0, 30).map((k) => k.keyword).join("\n"), engines: "google,ai_overview" });
    await loadProjects();
    location.hash = `#/p/${res.id}/rankings`;
    toast("Project created with its top 30 keywords (weekly checks).", 5000);
  });
}

// ---------------- usage ----------------
async function pageUsage() {
  if (!state.projects.length) await loadProjects();
  const u = await api("GET", "/usage");
  const total = u.daily.reduce((s, d) => s + d.cost, 0);
  mount(`<div class="page-head"><div><h1>API usage</h1><div class="sub">DataForSEO spend recorded by this app over the last 30 days.</div></div></div>
    <div class="kpis"><div class="kpi"><div class="v">${u.balance != null ? "$" + Number(u.balance).toFixed(2) : "—"}</div><div class="l">DataForSEO balance</div></div>
      <div class="kpi"><div class="v">${money(total)}</div><div class="l">Spent, 30 days</div></div>
      <div class="kpi"><div class="v">${n(u.daily.reduce((s, d) => s + d.calls, 0))}</div><div class="l">API calls</div></div>
      <div class="kpi"><div class="v">${n(u.pending)}</div><div class="l">Tasks waiting at DataForSEO</div></div></div>
    <div class="panel" style="margin-top:16px"><div class="panel-head"><h2>Daily spend</h2><div class="spacer"></div><button class="btn" id="collect">Collect finished tasks now</button></div><div class="chart-box short"><canvas id="uc"></canvas></div></div>
    <div class="panel"><div class="panel-head"><h2>By endpoint</h2></div><div class="tbl-wrap"><table><thead><tr><th>Endpoint</th><th class="num">Calls</th><th class="num">Cost</th></tr></thead><tbody>
      ${u.byEndpoint.map((x) => `<tr><td>${esc(x.endpoint)}</td><td class="num">${n(x.calls)}</td><td class="num">${money(x.cost)}</td></tr>`).join("") || `<tr><td colspan="3" class="muted">No calls yet.</td></tr>`}</tbody></table></div></div>`, "usage");
  lineChart($("#uc"), u.daily.map((d) => d.day.slice(5)), [{ label: "USD", data: u.daily.map((d) => d.cost), backgroundColor: css("--blue") }], { type: "bar" });
  $("#collect").onclick = (e) => busy(e.currentTarget, async () => { const r = await api("POST", "/collect"); toast(`Collected ${r.collected} results.`); pageUsage(); }, "Collecting…");
}

// shared helpers for rr.js
window.SEO = { icon, LOCATIONS, LANGS, locSelect, langSelect, locName, renderDomainOverview, $, $$, esc, n, money, ago, shortUrl, toast, api, busy, chip, delta, spark, lineChart, clearCharts, css, drawer, mount, downloadCsv, volSpark, state, loadProjects, route };

// ---------------- start ----------------
async function start() {
  try {
    state.me = await api("GET", "/me");
    await loadProjects();
    try { state.rrAlerts = (await api("GET", "/rr/alerts?open=1")).length; } catch { state.rrAlerts = 0; }
    route();
  } catch (e) {
    if (e.message !== "Signed out") toast(e.message);
  }
}
start();
})();
