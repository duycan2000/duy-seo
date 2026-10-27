/* Duy SEO — Rank & Rent module UI */
(() => {
"use strict";
const S = () => window.SEO;

const STATUS = [
  ["researching", "Researching"], ["building", "Building"], ["ranking", "Ranking"], ["trial", "Trial"],
  ["rented", "Rented"], ["for_sale", "For sale"], ["sold", "Sold"],
];
const statusLabel = (s) => (STATUS.find((x) => x[0] === s) || [s, s])[1];
const statusBadge = (s) => {
  const cls = s === "rented" ? "ok" : s === "trial" ? "cited" : s === "sold" ? "plain" : s === "for_sale" ? "cited" : "plain";
  return `<span class="badge ${cls}">${statusLabel(s)}</span>`;
};
const LEAD_STATUS = ["new", "sent", "qualified", "spam", "duplicate"];
const cur = (v, c) => (v == null ? "—" : `${c === "NZD" ? "NZ$" : "A$"}${Number(v).toLocaleString("en-US")}`);
const scoreBar = (s) => {
  if (s == null) return `<span class="muted small">pending</span>`;
  const col = s >= 70 ? "var(--up)" : s >= 50 ? "var(--blue)" : s >= 35 ? "var(--amber)" : "var(--ink-3)";
  return `<span class="score"><b>${s}</b><i style="width:${s}%;background:${col}"></i></span>`;
};
const dot = (ok) => `<span class="hdot ${ok == null ? "" : ok ? "ok" : "bad"}" title="${ok == null ? "not checked" : ok ? "ok" : "failing"}"></span>`;

async function refreshAlertCount() {
  try { S().state.rrAlerts = (await S().api("GET", "/rr/alerts?open=1")).length; } catch {}
}

// ============ Portfolio ============
async function pagePortfolio(filter) {
  const { api, mount, esc, n, $, $$, lineChart, css, busy, toast } = S();
  await refreshAlertCount();
  const d = await api("GET", "/rr/overview");
  S().state.rrSites = d.sites;
  const t = d.totals;
  const sites = filter ? d.sites.filter((s) => s.status === filter) : d.sites;
  const mrr = Object.entries(t.mrr).map(([c, v]) => cur(v, c)).join(" + ") || "A$0";
  mount(`
    <div class="page-head"><div><h1>R&amp;R portfolio</h1><div class="sub">Lead-gen sites, tenants and the leads they send. Kept separate from client projects.</div></div>
      <div class="spacer"></div><button class="btn primary" id="addSite">Add site</button></div>
    <div class="kpis">
      <div class="kpi"><div class="v">${n(t.sites)}</div><div class="l">Sites (excl. sold)</div></div>
      <div class="kpi"><div class="v">${mrr}</div><div class="l">Monthly rent (MRR)</div></div>
      <div class="kpi"><div class="v">${n(t.leads_month)}</div><div class="l">Leads this month</div><div class="d muted">${n(t.leads_prev)} last month</div></div>
      <div class="kpi"><div class="v">${t.avg_rank ?? "—"}</div><div class="l">Avg. money-keyword rank</div></div>
      <div class="kpi"><div class="v">${t.occupancy == null ? "—" : t.occupancy + "%"}</div><div class="l">Occupancy (rented / sites)</div></div>
      <div class="kpi"><div class="v">${n(t.open_alerts)}</div><div class="l"><a href="#/rr/alerts">Open alerts</a></div></div>
    </div>
    <nav class="pipeline" aria-label="Filter by status">
      <a href="#/rr" class="${!filter ? "on" : ""}"><b>${d.sites.length}</b>All</a>
      ${STATUS.map(([k, l]) => `<a href="#/rr/status/${k}" class="${filter === k ? "on" : ""}"><b>${t.by_status[k] || 0}</b>${l}</a>`).join("")}
    </nav>
    <div class="panel"><div class="panel-head"><h2>Sites</h2><span class="muted small">Click a site for keywords, leads, Search Console and setup.</span></div>
      ${sites.length ? `<div class="tbl-wrap"><table><thead><tr><th>Site</th><th>Status</th><th>Tenant</th><th class="num">Rent</th><th class="num">Leads (month)</th><th class="num">Avg. rank</th><th class="num">In map pack</th><th>Health</th></tr></thead><tbody>
        ${sites.map((s) => `<tr class="clickable" data-go="#/rr/site/${s.id}">
          <td><b>${esc(s.domain)}</b><div class="muted small">${esc(s.niche)} · ${esc(s.city || "no city")}${s.regional ? " · regional" : ""}</div></td>
          <td>${statusBadge(s.status)}</td><td class="small">${esc(s.tenant_name || "—")}</td>
          <td class="num">${s.monthly_rent ? cur(s.monthly_rent, s.currency) : "—"}</td>
          <td class="num"><b>${n(s.leads_month)}</b> <span class="muted small">/ ${n(s.leads_prev)}</span></td>
          <td class="num">${s.avg_rank ?? "—"}</td><td class="num">${s.kw_count ? `${s.in_pack}/${s.kw_count}` : "—"}</td>
          <td>${dot(s.up)} ${s.open_alerts ? `<span class="badge bad">${s.open_alerts} alert${s.open_alerts > 1 ? "s" : ""}</span>` : ""}</td></tr>`).join("")}
      </tbody></table></div>` : `<div class="empty"><h3>${filter ? "No sites with this status" : "No R&R sites yet"}</h3><p>Add a site you run, or shortlist one from the niche finder.</p></div>`}
    </div>
    ${d.monthly.length ? `<div class="panel"><div class="panel-head"><h2>Leads per month</h2><span class="muted small">All sites, excluding spam and duplicates</span></div><div class="chart-box short"><canvas id="lm"></canvas></div></div>` : ""}`, "rr");
  $$("[data-go]").forEach((r) => (r.onclick = () => (location.hash = r.dataset.go)));
  $("#addSite").onclick = () => siteDrawer();
  if (d.monthly.length) {
    const months = [...new Set(d.monthly.map((x) => x.m))];
    const get = (k) => months.map((m) => (d.monthly.find((x) => x.m === m && x.kind === k) || { n: 0 }).n);
    lineChart($("#lm"), months, [
      { label: "Calls", data: get("call"), backgroundColor: css("--blue") },
      { label: "Forms", data: get("form"), backgroundColor: css("--amber") },
    ], { type: "bar", stacked: true });
  }
}

async function cityOptions(selected) {
  const cities = await S().api("GET", "/rr/cities");
  return `<option value="">—</option>` + ["AU", "NZ"].map((cc) => `<optgroup label="${cc === "AU" ? "Australia" : "New Zealand"}">${cities.filter((c) => c.country === cc)
    .map((c) => `<option value="${c.id}" ${Number(selected) === c.id ? "selected" : ""}>${S().esc(c.name)}${c.regional ? " (regional)" : ""}</option>`).join("")}</optgroup>`).join("");
}

function siteForm(s = {}, cityOpts = "") {
  const { esc } = S();
  const f = (name, label, ph = "", type = "text") => `<label class="f">${label}<input name="${name}" type="${type}" value="${esc(s[name] ?? "")}" placeholder="${esc(ph)}"></label>`;
  return `<div class="grid2">
    ${f("domain", "Domain", "brisbaneroofrepairs.com.au")}${f("niche", "Niche", "roof repairs")}
    <label class="f">City<select name="city_id">${cityOpts}</select></label>
    <label class="f">Country<select name="country"><option value="AU" ${s.country !== "NZ" ? "selected" : ""}>Australia</option><option value="NZ" ${s.country === "NZ" ? "selected" : ""}>New Zealand</option></select></label>
    <label class="f">Status<select name="status">${STATUS.map(([k, l]) => `<option value="${k}" ${(s.status || "building") === k ? "selected" : ""}>${l}</option>`).join("")}</select></label>
    ${f("theme", "Theme", "astro-trades-v2")}${f("launch_date", "Launch date", "", "date")}
  </div>
  <h3 style="margin:18px 0 8px">Calls &amp; leads</h3><div class="grid2">
    ${f("tracking_phone", "Phone shown on site", "07 3000 0000")}${f("twilio_number", "Twilio number (E.164)", "+61730000000")}
    ${f("forward_to", "Forward calls to", "+61400000000")}${f("lead_destination", "Lead destination", "email / SMS / webhook")}
  </div>
  <h3 style="margin:18px 0 8px">Tenant</h3><div class="grid2">
    ${f("tenant_name", "Tenant business", "")}${f("tenant_contact", "Tenant contact", "name, phone, email")}
    ${f("monthly_rent", "Monthly rent", "", "number")}
    <label class="f">Currency<select name="currency"><option ${s.currency !== "NZD" ? "selected" : ""}>AUD</option><option ${s.currency === "NZD" ? "selected" : ""}>NZD</option></select></label>
    ${f("rent_paid_until", "Rent paid until", "", "date")}
  </div>
  <h3 style="margin:18px 0 8px">Monitoring</h3><div class="grid2">
    ${f("gsc_property", "Search Console property", "sc-domain:" + (s.domain || "example.com.au"))}
    ${f("uptime_url", "Uptime URL (optional)", "https://" + (s.domain || "example.com.au") + "/")}
    ${f("form_test_url", "Form endpoint for weekly test", "https://example.com.au/api/contact")}
    ${f("domain_expiry", "Domain expiry (if RDAP has none)", "", "date")}
  </div>
  <label class="f" style="margin-top:12px">Key pages to check indexing (one URL per line)<textarea name="key_pages" style="min-height:70px">${esc(s.key_pages || "")}</textarea></label>
  <label class="f" style="margin-top:12px">Notes<textarea name="notes" style="min-height:60px">${esc(s.notes || "")}</textarea></label>`;
}

async function siteDrawer(site) {
  const { drawer, $, busy, api, toast } = S();
  const d = drawer(`<div class="panel-head"><h2>${site ? "Edit site" : "Add R&R site"}</h2><div class="spacer"></div><button class="btn ghost" data-close>Close</button></div>
    <form id="sf">${siteForm(site || {}, await cityOptions(site?.city_id))}<div class="row" style="margin-top:16px"><button class="btn primary">${site ? "Save changes" : "Add site"}</button></div></form>`);
  $("#sf", d.el).onsubmit = (e) => {
    e.preventDefault();
    busy(e.submitter, async () => {
      const body = Object.fromEntries(new FormData(e.target));
      if (site) await api("PUT", `/rr/sites/${site.id}`, body);
      else { const r = await api("POST", "/rr/sites", body); location.hash = `#/rr/site/${r.id}/setup`; }
      d.close(); toast(site ? "Saved" : "Site added. Connect leads and calls on the Setup tab.");
      if (site) S().route();
    });
  };
}

// ============ Site detail ============
const SITE_TABS = [["overview", "Overview"], ["keywords", "Money keywords"], ["search", "Search Console"], ["health", "Health"], ["setup", "Setup"]];

async function pageSite(id, tab) {
  const { api, mount, esc, n, $, $$, chip, delta, spark, lineChart, css, busy, toast, ago, shortUrl } = S();
  const d = await api("GET", `/rr/sites/${id}`);
  const s = d.site;
  const st = S().state;
  if (!(st.rrSites || []).some((x) => x.id === s.id)) st.rrSites = [...(st.rrSites || []), { id: s.id, domain: s.domain, niche: s.niche }];
  const kws = d.keywords;
  const ranked = kws.filter((k) => k.position);
  const avg = ranked.length ? (ranked.reduce((a, k) => a + k.position, 0) / ranked.length).toFixed(1) : "—";
  const gsc28 = d.gsc.slice(-28);
  const clicks = gsc28.reduce((a, r) => a + r.clicks, 0);
  const thisMonth = new Date().toISOString().slice(0, 7);
  const leadsMonth = d.leadsMonthly.filter((x) => x.m === thisMonth).reduce((a, x) => a + x.n, 0);
  const answeredPct = d.calls?.total ? Math.round(((d.calls.answered || 0) / d.calls.total) * 100) : null;
  const check = (k) => d.checks.find((c) => c.kind === k);

  mount(`<div class="page-head"><div><h1>${esc(s.domain)}</h1>
      <div class="sub">${statusBadge(s.status)} ${esc(s.niche)} · ${esc(s.city || "no city")}${s.population ? ` (pop. ${n(s.population)})` : ""}${s.tenant_name ? ` · rented to ${esc(s.tenant_name)} for ${cur(s.monthly_rent, s.currency)}/mo` : ""}</div></div>
      <div class="spacer"></div><a class="btn ghost" href="#/rr/leads/${s.id}">Leads</a><button class="btn" id="edit">Edit site</button></div>
    <nav class="tabs">${SITE_TABS.map(([k, l]) => `<a href="#/rr/site/${id}/${k}" class="${tab === k ? "on" : ""}">${l}</a>`).join("")}</nav>
    <div id="tab"></div>`, "rr");
  $("#edit").onclick = () => siteDrawer(s);
  const el = $("#tab");

  if (tab === "overview") {
    el.innerHTML = `<div class="kpis">
        <div class="kpi"><div class="v">${n(leadsMonth)}</div><div class="l">Leads this month</div></div>
        <div class="kpi"><div class="v">${answeredPct == null ? "—" : answeredPct + "%"}</div><div class="l">Calls answered (30 days, ${n(d.calls?.total || 0)} calls)</div></div>
        <div class="kpi"><div class="v">${avg}</div><div class="l">Avg. money-keyword rank</div></div>
        <div class="kpi"><div class="v">${kws.filter((k) => k.map_pack).length}/${kws.length}</div><div class="l">Keywords in map pack</div></div>
        <div class="kpi"><div class="v">${d.gsc.length ? n(clicks) : "—"}</div><div class="l">Search clicks (28 days)</div></div>
      </div>
      ${d.alerts.filter((a) => !a.resolved_at).length ? `<div class="panel" style="margin-top:16px"><div class="panel-head"><h3>Open alerts</h3></div><ul class="src-list">${d.alerts.filter((a) => !a.resolved_at).map((a) => `<li><span class="sev ${a.severity}"></span><span style="flex:1">${esc(a.message)}</span><span class="muted small">${ago(a.created_at)}</span></li>`).join("")}</ul></div>` : ""}
      <div class="panel" style="margin-top:16px"><div class="panel-head"><h3>Leads per month</h3><div class="spacer"></div><a class="btn sm" href="#/rr/leads/${s.id}">Open lead list</a></div>
        ${d.leadsMonthly.length ? `<div class="chart-box short"><canvas id="lc"></canvas></div>` : `<p class="muted">No leads yet. Connect the site's contact form and Twilio number on the Setup tab.</p>`}</div>`;
    if (d.leadsMonthly.length) {
      const months = [...new Set(d.leadsMonthly.map((x) => x.m))];
      const get = (k) => months.map((m) => (d.leadsMonthly.find((x) => x.m === m && x.kind === k) || { n: 0 }).n);
      lineChart($("#lc"), months, [{ label: "Calls", data: get("call"), backgroundColor: css("--blue") }, { label: "Forms", data: get("form"), backgroundColor: css("--amber") }], { type: "bar", stacked: true });
    }
  }

  if (tab === "keywords") {
    el.innerHTML = `<div class="panel"><div class="panel-head"><h2>Money keywords</h2><span class="muted small">Mobile Google, searched from ${esc(s.city || s.country)}${s.location_code ? "" : " (approximate location)"} · checked daily</span>
        <div class="spacer"></div><button class="btn" id="chk">Check now</button></div>
      ${kws.length ? `<div class="tbl-wrap"><table><thead><tr><th>Keyword</th><th>Organic</th><th>Map pack</th><th>URL</th><th>30 days</th><th>Checked</th><th></th></tr></thead><tbody>
        ${kws.map((k) => `<tr><td class="kw">${esc(k.keyword)}</td><td><span class="pos">${chip(k.position)}${delta(k.position, k.prev)}</span></td>
          <td>${k.map_pack ? `<span class="badge ok">#${k.map_pack}</span>` : `<span class="muted small">—</span>`}</td>
          <td class="url">${k.url ? `<a href="${esc(k.url)}" target="_blank" rel="noopener">${esc(shortUrl(k.url))}</a>` : ""}</td>
          <td>${spark(k.spark)}</td><td class="small muted">${ago(k.checked_at)}</td>
          <td class="num"><button class="btn ghost sm danger" data-del="${k.id}" aria-label="Delete keyword">✕</button></td></tr>`).join("")}</tbody></table></div>`
      : `<div class="empty"><p>Add the 3–10 searches that bring jobs, e.g. “${esc(s.niche)} ${esc((s.city || "").toLowerCase())}”.</p></div>`}
      <form id="kf" class="row end" style="margin-top:14px"><label class="f" style="flex:1"><span>Add keywords (one per line)</span><textarea name="keywords" style="min-height:70px" placeholder="${esc(s.niche)} ${esc((s.city || "").toLowerCase())}\n${esc(s.niche)} near me\nemergency ${esc(s.niche)}"></textarea></label><button class="btn primary">Add</button></form></div>`;
    $("#chk").onclick = (e) => busy(e.currentTarget, async () => { const r = await api("POST", `/rr/sites/${id}/check`); toast(r.errors?.length ? r.errors[0] : `Checked ${r.checked} keywords`); pageSite(id, tab); }, "Checking…");
    $("#kf").onsubmit = (e) => { e.preventDefault(); busy(e.submitter, async () => { await api("POST", `/rr/sites/${id}/keywords`, { keywords: e.target.keywords.value }); pageSite(id, tab); }); };
    $$("[data-del]").forEach((b) => (b.onclick = async () => { if (confirm("Remove this keyword?")) { await api("DELETE", `/rr/keywords/${b.dataset.del}`); pageSite(id, tab); } }));
  }

  if (tab === "search") {
    const impr = gsc28.reduce((a, r) => a + r.impressions, 0);
    const pos = gsc28.length ? (gsc28.reduce((a, r) => a + r.position * r.impressions, 0) / (impr || 1)).toFixed(1) : "—";
    const topTable = (rows, label) => rows.length ? `<table><thead><tr><th>${label}</th><th class="num">Clicks</th><th class="num">Impr.</th><th class="num">CTR</th><th class="num">Pos.</th></tr></thead><tbody>
      ${rows.slice(0, 25).map((r) => `<tr><td class="${label === "Page" ? "url" : "kw"}">${label === "Page" ? `<a href="${esc(r.key)}" target="_blank" rel="noopener">${esc(shortUrl(r.key))}</a>` : esc(r.key)}</td><td class="num">${n(r.clicks)}</td><td class="num">${n(r.impressions)}</td><td class="num">${(r.ctr * 100).toFixed(1)}%</td><td class="num">${r.position.toFixed(1)}</td></tr>`).join("")}</tbody></table>` : `<p class="muted small">No data yet.</p>`;
    el.innerHTML = `<div class="kpis">
        <div class="kpi"><div class="v">${n(clicks)}</div><div class="l">Clicks (28 days)</div></div>
        <div class="kpi"><div class="v">${n(impr)}</div><div class="l">Impressions</div></div>
        <div class="kpi"><div class="v">${impr ? ((clicks / impr) * 100).toFixed(1) + "%" : "—"}</div><div class="l">CTR</div></div>
        <div class="kpi"><div class="v">${pos}</div><div class="l">Avg. position</div></div>
      </div>
      <div class="panel" style="margin-top:16px"><div class="panel-head"><h2>Search Console</h2><span class="muted small">${esc(s.gsc_property || "sc-domain:" + s.domain)} · ${check("gsc") ? `last sync ${ago(check("gsc").checked_at)}${check("gsc").ok ? "" : " — " + esc(check("gsc").detail)}` : "never synced"}</span>
        <div class="spacer"></div><button class="btn" id="sync">Sync now</button><button class="btn ghost" id="insp">Check indexing</button></div>
        ${d.gsc.length ? `<div class="chart-box short"><canvas id="gc"></canvas></div>` : `<p class="muted">No data yet. Add the service account email (shown on the Alerts page) as a user on this property, then sync.</p>`}</div>
      <div class="grid2" style="margin-top:16px"><div class="panel"><div class="panel-head"><h3>Top queries</h3></div><div class="tbl-wrap">${topTable(d.top_queries, "Query")}</div></div>
        <div class="panel"><div class="panel-head"><h3>Top pages</h3></div><div class="tbl-wrap">${topTable(d.top_pages, "Page")}</div></div></div>
      <div class="panel" style="margin-top:16px"><div class="panel-head"><h3>Indexing of key pages</h3><span class="muted small">URL Inspection API, weekly</span></div>
        ${d.index.length ? `<div class="tbl-wrap"><table><thead><tr><th>URL</th><th>Verdict</th><th>Coverage</th><th>Last crawl</th></tr></thead><tbody>${d.index.map((x) => `<tr><td class="url">${esc(shortUrl(x.url))}</td><td>${x.verdict === "PASS" ? `<span class="badge ok">indexed</span>` : `<span class="badge bad">${esc(x.verdict || "?")}</span>`}</td><td class="small">${esc(x.coverage || "")}</td><td class="small muted">${esc((x.last_crawl || "").slice(0, 10))}</td></tr>`).join("")}</tbody></table></div>` : `<p class="muted small">Not checked yet. Add key pages in Edit site, then “Check indexing”.</p>`}</div>`;
    if (d.gsc.length) lineChart($("#gc"), d.gsc.map((r) => r.date.slice(5)), [
      { label: "Clicks", data: d.gsc.map((r) => r.clicks), borderColor: css("--blue"), backgroundColor: css("--blue"), yAxisID: "y" },
      { label: "Impressions", data: d.gsc.map((r) => r.impressions), borderColor: css("--amber"), backgroundColor: css("--amber"), yAxisID: "y2" },
    ], { y2: { beginAtZero: true } });
    $("#sync").onclick = (e) => busy(e.currentTarget, async () => { await api("POST", `/rr/sites/${id}/gsc`, {}); toast("Synced"); pageSite(id, tab); }, "Syncing…");
    $("#insp").onclick = (e) => busy(e.currentTarget, async () => { await api("POST", `/rr/sites/${id}/gsc`, { inspect: true }); toast("Indexing checked"); pageSite(id, tab); }, "Checking…");
  }

  if (tab === "health") {
    const rows = [["uptime", "Uptime", "Every 15 minutes"], ["ssl", "HTTPS / SSL", "With each uptime check"], ["domain", "Domain expiry", "Daily"], ["form", "Form test", "Weekly synthetic lead"], ["gsc", "Search Console sync", "Daily"]];
    el.innerHTML = `<div class="panel"><div class="panel-head"><h2>Health checks</h2><div class="spacer"></div>${s.form_test_url ? `<button class="btn" id="ft">Run form test now</button>` : ""}</div>
      <div class="tbl-wrap"><table><thead><tr><th>Check</th><th>Status</th><th>Detail</th><th>Last run</th><th>Last OK</th></tr></thead><tbody>
      ${rows.map(([k, l, when]) => { const c = check(k); return `<tr><td><b>${l}</b><div class="muted small">${when}</div></td><td>${c ? (c.ok == null ? `<span class="badge plain">waiting</span>` : c.ok ? `<span class="badge ok">OK</span>` : `<span class="badge bad">Failing</span>`) : `<span class="muted small">not run</span>`}</td>
        <td class="small">${esc(c?.detail || (k === "form" && !s.form_test_url ? "Set a form endpoint in Edit site" : ""))}</td><td class="small muted">${c ? ago(c.checked_at) : ""}</td><td class="small muted">${c?.last_ok_at ? ago(c.last_ok_at) : ""}</td></tr>`; }).join("")}
      </tbody></table></div></div>
      <div class="panel"><div class="panel-head"><h3>Alert history</h3></div>${d.alerts.length ? `<ul class="src-list">${d.alerts.map((a) => `<li><span class="sev ${a.severity}"></span><span style="flex:1">${esc(a.message)}</span><span class="muted small">${a.resolved_at ? "resolved" : "open"} · ${ago(a.created_at)}</span></li>`).join("")}</ul>` : `<p class="muted small">No alerts for this site.</p>`}</div>`;
    const ft = $("#ft");
    if (ft) ft.onclick = (e) => busy(e.currentTarget, async () => { await api("POST", `/rr/sites/${id}/form-test`); toast("Test lead sent. The result shows here within 30 minutes."); pageSite(id, tab); }, "Sending…");
  }

  if (tab === "setup") {
    const i = d.integration;
    el.innerHTML = `<div class="panel"><div class="panel-head"><h2>1. Forward form leads</h2></div>
        <p class="small">Your site's contact Worker keeps saving leads to its own D1, and also POSTs a signed copy here.</p>
        <div class="grid2"><label class="f">Lead endpoint<input readonly value="${esc(i.lead_url)}"></label>
        <label class="f">Signing secret (store as LEAD_SECRET on the site)<span class="row"><input readonly id="sec" value="••••••••••••" style="flex:1"><button class="btn sm" id="show">Show</button><button class="btn sm ghost" id="rot">Rotate</button></span></label></div>
        <pre class="code" id="snip">${esc(i.snippet)}</pre><button class="btn sm" data-copy="snip">Copy snippet</button></div>
      <div class="panel"><div class="panel-head"><h2>2. Track calls (Twilio)</h2></div>
        <p class="small">Option A — let the platform route calls: in Twilio, set this number's <b>A call comes in</b> webhook to the voice URL (HTTP POST). Calls ring <b>${esc(s.forward_to || "the “Forward calls to” number")}</b>, are recorded, and missed calls are logged.</p>
        <label class="f">Voice webhook<input readonly value="${esc(i.voice_url)}"></label>
        <p class="small" style="margin-top:12px">Option B — keep your own call flow and only log calls: set <b>Call status changes</b> to the status URL.</p>
        <label class="f">Status callback<input readonly value="${esc(i.status_url)}"></label>
        <p class="muted small" style="margin-top:10px">Twilio number on file: <b>${esc(s.twilio_number || "not set")}</b>. Webhooks are verified with your Twilio auth token. Tell callers about recording if your flow records.</p></div>
      <div class="panel"><div class="panel-head"><h2>3. Search Console</h2></div>
        <p class="small">Add the platform's service account as a <b>Restricted</b> user on <b>${esc(s.gsc_property || "sc-domain:" + s.domain)}</b>. The account email is on the Alerts page.</p></div>`;
    $$("[data-copy]").forEach((b) => (b.onclick = () => { navigator.clipboard.writeText($("#" + b.dataset.copy).textContent); toast("Copied"); }));
    $("#show").onclick = () => { $("#sec").value = s.lead_secret; };
    $("#rot").onclick = async () => {
      if (!confirm("Rotate the secret? The site stops forwarding leads until you update LEAD_SECRET there.")) return;
      const r = await api("POST", `/rr/sites/${id}/rotate-secret`); s.lead_secret = r.lead_secret; $("#sec").value = r.lead_secret; toast("New secret created");
    };
  }
}

// ============ Niche finder ============
async function pageMarket(jobId) {
  if (jobId) return pageJob(jobId);
  const { api, mount, esc, n, $, $$, busy, toast, ago } = S();
  const [cities, jobs] = await Promise.all([api("GET", "/rr/cities"), api("GET", "/rr/market/jobs")]);
  mount(`<div class="page-head"><div><h1>Niche &amp; market finder</h1><div class="sub">Scores every niche × city on demand, lead value, weak competition and potential tenants.</div></div></div>
    <form class="panel" id="mf">
      <div class="grid2">
        <label class="f">Niches, one per line or comma-separated<textarea name="niches" style="min-height:150px" placeholder="roof repairs\ntree removal\nconcrete contractor\npest control"></textarea></label>
        <div><div class="row" style="margin-bottom:6px"><span class="small muted">Cities</span><div class="spacer"></div>
          <button type="button" class="btn sm ghost" data-pick="au-major">AU major</button><button type="button" class="btn sm ghost" data-pick="au-regional">AU regional</button><button type="button" class="btn sm ghost" data-pick="nz">NZ</button><button type="button" class="btn sm ghost" data-pick="none">Clear</button></div>
          <div class="city-list">${["AU", "NZ"].map((cc) => cities.filter((c) => c.country === cc).map((c) => `<label class="chk"><input type="checkbox" name="city" value="${c.id}" data-cc="${c.country}" data-reg="${c.regional}">${esc(c.name)} <span class="muted small">${c.population >= 1e6 ? (c.population / 1e6).toFixed(1) + "M" : Math.round(c.population / 1000) + "k"}${c.regional ? " · regional" : ""}</span></label>`).join("")).join("")}</div></div>
      </div>
      <div class="row" style="margin-top:14px"><input name="name" placeholder="Run name (optional)" style="width:240px"><span class="muted small" id="est">Pick niches and cities to see the estimated cost.</span><div class="spacer"></div><button class="btn primary">Run research</button></div>
    </form>
    <div class="panel"><div class="panel-head"><h2>Research runs</h2><span class="muted small">Results arrive in 5–45 minutes (queued DataForSEO tasks).</span></div>
      ${jobs.length ? `<div class="tbl-wrap"><table><thead><tr><th>Run</th><th class="num">Pairs</th><th>Progress</th><th>Started</th><th></th></tr></thead><tbody>
        ${jobs.map((j) => `<tr class="clickable" data-go="#/rr/market/${j.id}"><td><b>${esc(j.name)}</b></td><td class="num">${n(j.pairs)}</td>
          <td>${j.status === "done" ? `<span class="badge ok">done</span>` : j.status === "error" ? `<span class="badge bad">error</span>` : `<span class="badge plain">${j.complete}/${j.pairs} collected</span>`}</td>
          <td class="small muted">${ago(j.created_at)}</td><td class="num"><button class="btn ghost sm danger" data-del="${j.id}" aria-label="Delete run">✕</button></td></tr>`).join("")}</tbody></table></div>`
      : `<div class="empty"><p>No runs yet.</p></div>`}</div>`, "rr-market");
  const form = $("#mf");
  const est = () => {
    const niches = form.niches.value.split(/[\n,]/).map((x) => x.trim()).filter(Boolean).length;
    const ids = $$("input[name=city]:checked", form);
    const pairs = niches * ids.length;
    // ≈ SERP (mobile, 20 results) $0.0012 + Ads Advertisers $0.0006 per pair; Google Ads volume ≈ $0.05 per city; KD + backlinks ≈ $0.04 per run
    const cost = pairs * 0.0018 + ids.length * 0.05 + (pairs ? 0.04 : 0);
    $("#est").textContent = pairs ? `${pairs} pairs · ≈ $${cost.toFixed(2)} in DataForSEO credits` : "Pick niches and cities to see the estimated cost.";
  };
  form.oninput = est;
  $$("[data-pick]").forEach((b) => (b.onclick = () => {
    $$("input[name=city]", form).forEach((c) => {
      const p = b.dataset.pick;
      c.checked = p === "au-major" ? c.dataset.cc === "AU" && c.dataset.reg === "0" : p === "au-regional" ? c.dataset.cc === "AU" && c.dataset.reg === "1" : p === "nz" ? c.dataset.cc === "NZ" : false;
    });
    est();
  }));
  form.onsubmit = (e) => {
    e.preventDefault();
    busy(e.submitter, async () => {
      const r = await api("POST", "/rr/market/jobs", { name: form.name.value, niches: form.niches.value.split(/[\n,]/).map((x) => x.trim()).filter(Boolean), city_ids: $$("input[name=city]:checked", form).map((c) => +c.value) });
      toast(`Research started for ${r.pairs} pairs.`);
      location.hash = `#/rr/market/${r.id}`;
    }, "Starting…");
  };
  $$("[data-go]").forEach((r) => (r.onclick = (ev) => { if (!ev.target.closest("[data-del]")) location.hash = r.dataset.go; }));
  $$("[data-del]").forEach((b) => (b.onclick = async () => { if (confirm("Delete this research run?")) { await api("DELETE", `/rr/market/jobs/${b.dataset.del}`); pageMarket(); } }));
}

async function pageJob(id) {
  const { api, mount, esc, n, $, $$, busy, toast, downloadCsv, drawer } = S();
  const d = await api("GET", `/rr/market/jobs/${id}`);
  let rows = d.rows, sk = "score", sd = -1, country = "";
  const done = d.job.status === "done";
  mount(`<div class="page-head"><div><h1>${esc(d.job.name)}</h1><div class="sub">${n(rows.length)} niche × city pairs · ${done ? "scored" : "collecting data — refresh in a few minutes"}</div></div>
      <div class="spacer"></div><button class="btn" id="ref">Refresh</button><button class="btn ghost" id="csv">Export CSV</button></div>
    <div class="panel"><div class="panel-head"><h2>Opportunities</h2>
      <span class="muted small">Score = volume 25 · CPC 20 · directories in top 10 = 20 · weak top-3 backlinks 20 · advertisers 15</span><div class="spacer"></div>
      <select id="cf"><option value="">All countries</option><option value="AU">Australia</option><option value="NZ">New Zealand</option></select></div>
      <div class="tbl-wrap" id="mt"></div></div>`, "rr-market");
  const val = (r, k) => (k === "city" ? r.city : k === "niche" ? r.niche : r[k] ?? -1);
  const draw = () => {
    const list = rows.filter((r) => !country || r.country === country).sort((a, b) => (val(a, sk) > val(b, sk) ? 1 : val(a, sk) < val(b, sk) ? -1 : 0) * sd);
    $("#mt").innerHTML = `<table><thead><tr>
      <th class="sortable" data-s="niche">Niche</th><th class="sortable" data-s="city">City</th><th class="sortable" data-s="score">Score</th>
      <th class="sortable num" data-s="volume">Searches/mo</th><th class="sortable num" data-s="cpc">CPC</th><th class="sortable num" data-s="kd">KD</th>
      <th class="sortable num" data-s="directories">Directories</th><th class="sortable num" data-s="top3_rd">Top-3 ref. domains</th><th class="sortable num" data-s="advertisers">Advertisers</th><th></th></tr></thead><tbody>
      ${list.map((r) => `<tr class="clickable" data-row="${r.id}">
        <td class="kw">${esc(r.niche)}</td><td>${esc(r.city)} <span class="muted small">${r.country}${r.regional ? " · regional" : ""}</span></td>
        <td>${scoreBar(r.score)}</td>
        <td class="num">${r.vol_done ? n(r.volume) : "…"}${r.volume_scope === "country" ? ` <span class="muted small" title="No city target in Google Ads — national volume for “${esc(r.niche)} ${esc(r.city)}”">nat.</span>` : ""}</td>
        <td class="num">${r.cpc != null ? "$" + r.cpc.toFixed(2) : "—"}</td><td class="num">${r.kd ?? "—"}</td>
        <td class="num">${r.serp_done ? `${r.directories ?? 0}/10` : "…"}</td><td class="num">${r.top3_rd ?? (done ? "—" : "…")}</td>
        <td class="num">${r.ads_done ? `${n(r.advertisers)}${r.ads_in_serp ? ` <span class="muted small">(${r.ads_in_serp} ads)</span>` : ""}` : "…"}</td>
        <td class="num">${r.shortlisted_site_id ? `<a class="btn sm" href="#/rr/site/${r.shortlisted_site_id}">In portfolio</a>` : `<button class="btn sm" data-short="${r.id}">Shortlist</button>`}</td></tr>`).join("")}
      </tbody></table>`;
    $$("#mt th[data-s]").forEach((th) => (th.onclick = () => { sd = sk === th.dataset.s ? -sd : -1; sk = th.dataset.s; draw(); }));
    $$("#mt [data-short]").forEach((b) => (b.onclick = (ev) => { ev.stopPropagation(); busy(b, async () => {
      const r = await api("POST", `/rr/market/rows/${b.dataset.short}/shortlist`);
      rows.find((x) => x.id == b.dataset.short).shortlisted_site_id = r.site_id; toast("Added to portfolio as “researching”."); draw();
    }); }));
    $$("#mt [data-row]").forEach((tr) => (tr.onclick = (ev) => { if (!ev.target.closest("button,a")) rowDrawer(rows.find((x) => x.id == tr.dataset.row)); }));
  };
  const rowDrawer = (r) => drawer(`<div class="panel-head"><h2>${esc(r.niche)} · ${esc(r.city)}</h2><div class="spacer"></div><button class="btn ghost" data-close>Close</button></div>
    <p>${scoreBar(r.score)}</p><p class="small muted">Population ≈ ${n(r.population)} · ${n(r.volume)} searches/mo (${r.volume_scope || "?"} level) · CPC ${r.cpc != null ? "$" + r.cpc.toFixed(2) : "—"} · top bid ${r.top_bid != null ? "$" + r.top_bid.toFixed(2) : "—"}</p>
    <h3 style="margin:16px 0 6px">Map pack</h3>${r.map_pack.length ? `<ul class="src-list">${r.map_pack.map((m, i) => `<li><span class="n">${i + 1}</span><span style="flex:1">${esc(m.t)}</span><span class="muted">${m.r ?? "–"}★ (${n(m.v)})</span></li>`).join("")}</ul>` : `<p class="muted small">No map pack shown.</p>`}
    <h3 style="margin:16px 0 6px">Top 10 organic (mobile)</h3><ul class="src-list">${r.top10.map((t) => { const rd = r.top3.find((x) => x.d === t.d); return `<li><span class="n">${t.p}</span><span style="flex:1">${esc(t.d)}</span>${t.dir ? `<span class="badge plain">directory</span>` : rd && rd.rd != null ? `<span class="muted small">${n(rd.rd)} ref. domains</span>` : ""}</li>`; }).join("") || "<li class='muted'>Not collected yet.</li>"}</ul>`);
  draw();
  $("#cf").onchange = (e) => { country = e.target.value; draw(); };
  $("#ref").onclick = () => pageJob(id);
  $("#csv").onclick = () => downloadCsv(`rr-research-${id}.csv`, [["niche", "city", "country", "population", "score", "volume", "volume_scope", "cpc", "kd", "directories", "top3_rd", "advertisers", "ads_in_serp"],
    ...rows.map((r) => [r.niche, r.city, r.country, r.population, r.score, r.volume, r.volume_scope, r.cpc, r.kd, r.directories, r.top3_rd, r.advertisers, r.ads_in_serp])]);
}

// ============ Leads ============
async function pageLeads(siteId) {
  const { api, mount, esc, n, $, $$, lineChart, css, ago, downloadCsv, toast } = S();
  const ov = await api("GET", "/rr/overview");
  const f = { site_id: siteId || "", status: "", kind: "", month: "" };
  mount(`<div class="page-head"><div><h1>Leads</h1><div class="sub">Calls and form submissions from every R&amp;R site. Leads older than the retention window are deleted automatically.</div></div></div>
    <div class="grid2"><div class="panel"><div class="panel-head"><h3>Leads per site per month</h3></div><div class="chart-box short"><canvas id="ps"></canvas></div></div>
      <div class="panel"><div class="panel-head"><h3>Missed-call rate (30 days)</h3></div><div id="missed"></div></div></div>
    <div class="panel" style="margin-top:16px"><div class="panel-head"><h2>Lead list</h2><div class="spacer"></div>
      <select id="fs"><option value="">All sites</option>${ov.sites.map((s) => `<option value="${s.id}" ${String(siteId) === String(s.id) ? "selected" : ""}>${esc(s.domain)}</option>`).join("")}</select>
      <select id="fk"><option value="">Calls and forms</option><option value="call">Calls</option><option value="form">Forms</option></select>
      <select id="fst"><option value="">Any status</option>${LEAD_STATUS.map((s) => `<option>${s}</option>`).join("")}</select>
      <input id="fm" type="month"><button class="btn ghost" id="csv">Export CSV</button></div><div class="tbl-wrap" id="lt"></div></div>`, "rr-leads");
  const stats = await api("GET", "/rr/leads/stats");
  const months = [...new Set(stats.perSite.map((x) => x.m))];
  const domains = [...new Set(stats.perSite.map((x) => x.domain))].slice(0, 8);
  const palette = [css("--blue"), css("--amber"), css("--up"), css("--down"), "#8B5CF6", "#0EA5E9", "#64748B", "#DB2777"];
  if (months.length) lineChart($("#ps"), months, domains.map((dmn, i) => ({ label: dmn, data: months.map((m) => { const r = stats.perSite.find((x) => x.m === m && x.domain === dmn); return r ? r.forms + r.calls : 0; }), backgroundColor: palette[i] })), { type: "bar", stacked: true });
  else $("#ps").parentElement.innerHTML = `<p class="muted">No leads yet.</p>`;
  $("#missed").innerHTML = stats.missed.length ? `<table><tbody>${stats.missed.map((m) => `<tr><td>${esc(m.domain)}</td><td class="num">${n(m.total)} calls</td><td class="num"><b class="${m.missed / m.total > 0.25 ? "err" : ""}">${Math.round((m.missed / m.total) * 100)}% missed</b></td></tr>`).join("")}</tbody></table>` : `<p class="muted small">No calls in the last 30 days.</p>`;

  let rows = [];
  const load = async () => {
    const q = new URLSearchParams(Object.entries(f).filter(([, v]) => v));
    rows = await api("GET", "/rr/leads?" + q);
    $("#lt").innerHTML = rows.length ? `<table><thead><tr><th>Received</th><th>Site</th><th>Type</th><th>Contact</th><th>Message</th><th>Status</th><th></th></tr></thead><tbody>
      ${rows.map((l) => `<tr><td class="small" style="white-space:nowrap">${esc(l.received_at.slice(0, 16))}<div class="muted">${ago(l.received_at)}</div></td><td class="small">${esc(l.domain)}</td>
        <td>${l.kind === "call" ? `<span class="badge ${l.answered ? "ok" : "bad"}">${l.answered ? "call" : "missed"}</span>${l.first_time === 0 ? `<div class="muted small">repeat caller</div>` : ""}` : `<span class="badge cited">form</span>`}</td>
        <td class="small"><b>${esc(l.name || "")}</b><div>${esc(l.phone || "")}</div><div class="muted">${esc(l.email || "")}</div></td>
        <td class="small" style="max-width:320px">${esc((l.message || "").slice(0, 160))}${l.recording_url ? ` <a href="${esc(l.recording_url)}" target="_blank" rel="noopener">recording</a>` : ""}${l.spam_reasons ? `<div class="muted">flags: ${esc(l.spam_reasons)}</div>` : ""}</td>
        <td><select data-st="${l.id}">${LEAD_STATUS.map((s) => `<option ${l.status === s ? "selected" : ""}>${s}</option>`).join("")}</select></td>
        <td class="num"><button class="btn ghost sm danger" data-del="${l.id}" aria-label="Delete lead">✕</button></td></tr>`).join("")}</tbody></table>` : `<div class="empty"><p>No leads match these filters.</p></div>`;
    $$("#lt [data-st]").forEach((s) => (s.onchange = async () => { await api("PUT", `/rr/leads/${s.dataset.st}`, { status: s.value }); toast("Status updated"); }));
    $$("#lt [data-del]").forEach((b) => (b.onclick = async () => { if (confirm("Delete this lead permanently?")) { await api("DELETE", `/rr/leads/${b.dataset.del}`); load(); } }));
  };
  $("#fs").onchange = (e) => { f.site_id = e.target.value; load(); };
  $("#fk").onchange = (e) => { f.kind = e.target.value; load(); };
  $("#fst").onchange = (e) => { f.status = e.target.value; load(); };
  $("#fm").onchange = (e) => { f.month = e.target.value; load(); };
  $("#csv").onclick = () => downloadCsv("rr-leads.csv", [["received_at", "site", "kind", "name", "phone", "email", "message", "status"], ...rows.map((l) => [l.received_at, l.domain, l.kind, l.name, l.phone, l.email, l.message, l.status])]);
  load();
}

// ============ Alerts & settings ============
async function pageAlerts() {
  const { api, mount, esc, $, $$, busy, toast, ago } = S();
  const [open, all, cfg] = await Promise.all([api("GET", "/rr/alerts?open=1"), api("GET", "/rr/alerts"), api("GET", "/rr/settings")]);
  S().state.rrAlerts = open.length;
  const st = cfg.settings, ig = cfg.integrations;
  const yes = (b, label) => b ? `<span class="badge ok">${label} connected</span>` : `<span class="badge plain">${label} not set</span>`;
  const field = (k, label, help) => `<label class="f">${label}<input name="${k}" value="${esc(st[k])}" inputmode="decimal"><span class="muted small">${help}</span></label>`;
  mount(`<div class="page-head"><div><h1>Alerts</h1><div class="sub">Collected all day and sent as one digest. Site-down and SMS-pumping alerts can go to Telegram immediately.</div></div>
      <div class="spacer"></div><button class="btn" id="runChecks">Run all checks now</button><button class="btn" id="digest">Send digest now</button></div>
    <div class="panel"><div class="panel-head"><h2>Open alerts</h2></div>
      ${open.length ? `<ul class="src-list">${open.map((a) => `<li><span class="sev ${a.severity}"></span><span style="flex:1">${esc(a.message)}${a.domain ? ` <a class="small" href="#/rr/site/${a.site_id}/health">site</a>` : ""}</span><span class="muted small">${ago(a.created_at)}${a.sent_at ? " · sent" : ""}</span><button class="btn ghost sm" data-res="${a.id}">Resolve</button></li>`).join("")}</ul>` : `<p class="muted">Nothing needs attention.</p>`}</div>
    <div class="panel"><div class="panel-head"><h2>Connections</h2></div>
      <div class="row">${yes(ig.email, "Email")}${yes(ig.telegram, "Telegram")}${yes(ig.twilio, "Twilio")}${yes(ig.gsc, "Search Console")}${ig.telegram ? `<button class="btn sm" id="tg">Send Telegram test</button>` : ""}</div>
      ${ig.gsc_email ? `<p class="small" style="margin-top:10px">Search Console service account: <b>${esc(ig.gsc_email)}</b> — add it as a Restricted user on every site's property.</p>` : ""}
      ${cfg.twilio_last_balance ? `<p class="small">Twilio balance at last check: <b>${esc(cfg.twilio_last_balance)}</b></p>` : ""}
      <p class="muted small">Secrets are set with <code>wrangler secret put</code>: RESEND_API_KEY, ALERT_EMAIL_TO, ALERT_EMAIL_FROM, TELEGRAM_BOT_TOKEN, TELEGRAM_CHAT_ID, TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, GSC_SERVICE_ACCOUNT.</p></div>
    <form class="panel" id="stf"><div class="panel-head"><h2>Thresholds</h2></div><div class="grid2">
      ${field("rank_drop_threshold", "Rank drop (positions)", "Money keyword falls by more than this")}
      ${field("lead_drop_pct", "Lead drop (%)", "Last 7 days below this % of the 4-week weekly average")}
      ${field("lead_drop_min_avg", "Lead drop minimum", "Only for sites averaging at least this many leads a week")}
      ${field("twilio_low_balance", "Twilio low balance (USD)", "")}
      ${field("sms_spike_factor", "SMS/call spike factor", "Today vs 7-day average")}
      ${field("sms_spike_min", "Spike minimum count", "Ignore spikes below this")}
      ${field("domain_expiry_days", "Domain expiry warning (days)", "")}
      ${field("retention_months", "Lead retention (months)", "Older leads and calls are deleted")}
      ${field("digest_hour_utc", "Digest hour (UTC)", "0 = 7:00 in Vietnam, 21 = 7:00 Sydney (AEST)")}
      <label class="f">Critical alerts to Telegram right away<select name="critical_telegram_now"><option value="1" ${st.critical_telegram_now === "1" ? "selected" : ""}>Yes</option><option value="0" ${st.critical_telegram_now !== "1" ? "selected" : ""}>No, digest only</option></select></label>
    </div><div class="row" style="margin-top:14px"><button class="btn primary">Save thresholds</button></div></form>
    <div class="panel"><div class="panel-head"><h2>History</h2></div>${all.length ? `<ul class="src-list">${all.slice(0, 80).map((a) => `<li><span class="sev ${a.severity}"></span><span style="flex:1">${esc(a.message)}</span><span class="muted small">${a.resolved_at ? "resolved" : "open"} · ${ago(a.created_at)}</span></li>`).join("")}</ul>` : `<p class="muted small">No alerts yet.</p>`}</div>`, "rr-alerts");
  $$("[data-res]").forEach((b) => (b.onclick = async () => { await api("POST", `/rr/alerts/${b.dataset.res}/resolve`); pageAlerts(); }));
  $("#digest").onclick = (e) => busy(e.currentTarget, async () => {
    const r = await api("POST", "/rr/digest");
    toast(r.sent ? `Digest sent via ${r.channels.filter((c) => !c.includes("failed")).join(" + ")}` : `Not sent: ${r.channels?.join("; ") || r.reason || "connect email or Telegram first"}`, 6000);
  }, "Sending…");
  $("#runChecks").onclick = (e) => busy(e.currentTarget, async () => { const r = await api("POST", "/rr/run-checks"); toast(`Checks done. ${r.open_alerts} open alerts.`); pageAlerts(); }, "Checking…");
  const tg = $("#tg");
  if (tg) tg.onclick = (e) => busy(e.currentTarget, async () => { await api("POST", "/rr/telegram-test"); toast("Telegram message sent"); });
  $("#stf").onsubmit = (e) => { e.preventDefault(); busy(e.submitter, async () => { await api("PUT", "/rr/settings", Object.fromEntries(new FormData(e.target))); toast("Thresholds saved"); }); };
}

// ============ router ============
window.RR = {
  async route(parts) {
    if (!parts.length) return pagePortfolio();
    if (parts[0] === "status") return pagePortfolio(parts[1]);
    if (parts[0] === "site") return pageSite(+parts[1], parts[2] || "overview");
    if (parts[0] === "market") return pageMarket(parts[1] ? +parts[1] : null);
    if (parts[0] === "leads") return pageLeads(parts[1] || "");
    if (parts[0] === "alerts") return pageAlerts();
    location.hash = "#/rr";
  },
};
})();
