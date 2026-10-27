# Duy SEO

All-in-one SEO platform on Cloudflare Workers + D1, powered by the DataForSEO API.

| Module | What it does | DataForSEO endpoints |
|---|---|---|
| Rank tracking | Google + Bing positions, history, gains/drops, visibility % | `serp/google/organic`, `serp/bing/organic` |
| AI Overviews / AI Mode | Is your domain cited in Google's AI answers, at which position | `serp/google/organic` (`load_async_ai_overview`), `serp/google/ai_mode` |
| AI visibility (GEO/AEO) | Prompts → does ChatGPT / AI Mode mention your brand, cite your site, name competitors | `ai_optimization/chat_gpt/llm_scraper`, `serp/google/ai_mode`, `ai_optimization/llm_mentions/target_metrics` |
| Local SEO | Google Maps geo-grid heatmap (3×3 to 7×7), business finder | `serp/google/maps` |
| Site audit | Crawl, on-page score, issues per page | `on_page/task_post`, `on_page/summary`, `on_page/pages` |
| Domain overview | Semrush-style traffic, keywords, history, competitors, backlinks | `dataforseo_labs/google/*`, `backlinks/summary` |
| Keyword research | Ideas, suggestions, related, volume/KD/CPC/intent | `dataforseo_labs/google/keyword_*` |
| API usage | Spend per day and endpoint, live balance | `appendix/user_data` |

## Deploy (about 10 minutes)

Requires Node 20+ and a Cloudflare account. **Workers Paid ($5/mo) is recommended** — the free plan's 50-subrequest limit is too low for the scheduled checks.

```bash
npm install
npx wrangler login

# 1. Database
npx wrangler d1 create duy-seo          # copy the database_id into wrangler.jsonc
npm run db:init                          # creates the tables

# 2. Secrets
npx wrangler secret put DFS_LOGIN        # DataForSEO API login (app.dataforseo.com/api-access)
npx wrangler secret put DFS_PASSWORD     # DataForSEO API password
npx wrangler secret put ADMIN_PASSWORD   # your dashboard password
npx wrangler secret put SESSION_SECRET   # any long random string (e.g. openssl rand -hex 32)

# 3. Ship
npm run deploy
```

Then add a custom domain (e.g. `seo.duy.digital`) in Cloudflare → Workers → duy-seo → Settings → Domains & Routes.

### Local development

```bash
cp .dev.vars.example .dev.vars           # fill in values
npm run db:init:local
npm run dev                              # http://localhost:8787
```
Set `DFS_SANDBOX=1` in `.dev.vars` to use DataForSEO's free sandbox (fake data).

## How scheduling works

A cron runs every 15 minutes and:
1. collects finished DataForSEO tasks,
2. sends checks for keywords/prompts whose `next_run_at` is due (daily or weekly per project),
3. rescans local grids weekly and polls running audits.

`DFS_MODE` in `wrangler.jsonc`:
- `standard` (default) — scheduled checks use the queued Standard method, ~3× cheaper, results land in 1–45 min.
- `live` — instant results, higher cost.

Buttons like **Check**, **Run now** and **Scan now** always use Live so you see results immediately.
ChatGPT prompts always run Live.

## Cost guide (DataForSEO, approximate)

- Google rank check, top 50, Standard: ~$0.0015 per keyword (+ small fee when AI Overviews are on)
- 100 keywords daily ≈ $4–6 / month
- ChatGPT prompt: ~$0.004 · AI Mode: ~$0.002–0.004
- 5×5 local grid: 25 Maps calls ≈ $0.05 per scan
- Domain overview: ~$0.05 (cached 3 days) · Keyword research: ~$0.01–0.02 (cached 3 days)
- LLM Mentions index and Backlinks need those APIs enabled on your DataForSEO account; the app shows a note if they're not.

Check real spend on the **API usage** page.

## Notes

- Depth matters: Google bills per 10 results, so Top 100 costs ~2× Top 50.
- AI Mode and ChatGPT data are English-only; ChatGPT location falls back to the US where Vietnam isn't supported.
- For Local SEO, use **Find the business on Google Maps** first: it saves the Maps CID, the most reliable match.
- Single admin login. To add Google-account login instead, put the Worker behind Cloudflare Access.

---

# Rank & Rent module (Phase 1)

Separate `rr_*` / `market_*` tables — R&R sites never appear in client-SEO views.

| Feature | Where |
|---|---|
| Portfolio: sites by status, MRR (AUD/NZD), leads this month, avg money-keyword rank, occupancy | Rank & Rent → Portfolio |
| Money-keyword tracking: mobile Google from the site's city, organic + map pack, daily | Site → Money keywords |
| Niche & Market Finder: niche × AU/NZ city → R&R Opportunity Score, CSV, shortlist to portfolio | Rank & Rent → Niche finder |
| Leads: signed form ingestion, Twilio calls (answered/missed, recording, repeat caller), spam + duplicate detection | Rank & Rent → Leads |
| Search Console: clicks/impressions/CTR/position, top queries & pages, URL Inspection of key pages | Site → Search Console |
| Alerts + daily digest (email / Telegram) | Rank & Rent → Alerts |

**Opportunity Score (0–100)** = volume 25 · CPC 20 · directories in top 10 = 20 · weak backlinks of the top-3 real sites 20 · advertisers 15.
City-level volume uses Google Ads city targets (resolved automatically from DataForSEO's location list). Cities with no Google Ads city target fall back to national volume for "niche + city" and are marked "nat.".
Runs are queued (5–45 min). Rough cost: ~$0.002 per niche × city pair + ~$0.05 per city.

### Extra secrets (all optional)

```bash
npx wrangler secret put TWILIO_ACCOUNT_SID
npx wrangler secret put TWILIO_AUTH_TOKEN        # also verifies Twilio webhook signatures
npx wrangler secret put GSC_SERVICE_ACCOUNT      # paste the whole service-account JSON key
npx wrangler secret put RESEND_API_KEY           # email digest
npx wrangler secret put ALERT_EMAIL_TO           # comma-separated
npx wrangler secret put ALERT_EMAIL_FROM         # e.g. "Duy SEO <alerts@duy.digital>" (verified in Resend)
npx wrangler secret put TELEGRAM_BOT_TOKEN
npx wrangler secret put TELEGRAM_CHAT_ID
```

Existing install? Run `npx wrangler d1 execute duy-seo --remote --file=schema-rr.sql` once to add the new tables.

### Connecting a site
1. **Forms** — Site → Setup shows the lead endpoint, the per-site `LEAD_SECRET` and a copy-paste snippet for the site's contact Worker (HMAC-SHA256 over `timestamp.body`, 5-minute replay window).
2. **Calls** — either point the Twilio number's *A call comes in* webhook at `/hooks/twilio/voice` (platform forwards to "Forward calls to", records, logs missed calls), or keep your own flow and set *Call status changes* to `/hooks/twilio/status`.
3. **Search Console** — add the service-account email (shown on the Alerts page) as a Restricted user on each property.
4. **Weekly form test** — set "Form endpoint for weekly test". The platform POSTs `{"test":true}` with `X-Synthetic-Test: 1`; the site must pass `test: true` through when forwarding (and skip emailing the tenant). No test lead within 30 min → alert.

### Alerts
Rank drop > X on money keywords · leads below X% of the 4-week weekly average · site down (2 failed checks, 15-min interval) · HTTPS errors · domain expiry (RDAP; `.au` doesn't publish expiry, so enter it manually) · form test failed · Twilio balance low · SMS/call spikes (pumping / toll fraud) · rent unpaid past "Rent paid until" (until Billing ships in Phase 2).
Everything is collected into one daily digest (hour set in Alerts → Thresholds, UTC). Site-down and spike alerts can also go to Telegram immediately. "Run all checks now" runs the daily set on demand.

### Privacy
Leads and call logs older than the retention window (default 12 months) are deleted daily. No lead data goes in URLs. Strongly recommended: put the whole Worker behind **Cloudflare Access** (Zero Trust → Access → Applications), excluding `/hooks/*` so forms and Twilio can still reach it.

## Interface

- Left navigation grouped by workspace: Dashboard · Client SEO · Research · Rank & Rent · Settings.
- Breadcrumbs in the top bar; alert bell with open-alert count.
- **Ctrl/⌘ + K** opens a quick switcher for any page, project or R&R site.
- Light and dark mode follow the system setting; works on mobile.

---

# Research & utility tools

| Group | Tool | What it does | Data source |
|---|---|---|---|
| Keyword Research | Keyword Explorer | Ideas / suggestions / related keywords | DataForSEO Labs |
| | Semantic Clustering | Groups keywords by meaning (multilingual embeddings) | Workers AI `@cf/baai/bge-m3` |
| | SERP Clustering | Groups keywords that share ranking URLs (3–7 shared, default / balanced / strict) | SERP API, queued + 14-day cache |
| | Bulk Analysis | Volume, CPC, KD, intent for up to 1,000 keywords | Google Ads + Labs |
| | Bulk Google PAA | People-also-ask questions, 1–4 layers deep | SERP API `people_also_ask_click_depth` |
| | Bulk Autocomplete | Google / Bing / YouTube suggestions, a–z and question expansion | Free suggest endpoints |
| Competitive Research | Traffic Analytics | Overview, Organic Keywords (paginated, filters, intent, trend, KD, CPC, position, visits), Competitors, Top Pages | Labs |
| | Sitemap Extractor | All URLs from robots.txt / sitemap indexes / .gz | Direct fetch |
| | Content Gap | Keywords competitors rank for and you don't | Labs domain intersection |
| Link Building | Backlink Analytics | Summary, 12-month history, backlinks, referring domains, anchors | Backlinks API |
| | Backlink Gap | Domains linking to competitors but not you | Backlinks domain intersection |
| SERP Research | SERP Similarity | Top-10 overlap between 2–6 keywords → one page or separate | SERP API (7-day cache) |
| | SERP UULE | Location-encoded Google URL + local top 10 | Google locations list |
| Search Console | Sites | Any property the service account can read: clicks, impressions, CTR, position, queries/pages/countries/devices, period comparison | GSC API |
| Utilities | Bulk Domain Analysis | Traffic, keywords, rank, referring domains, spam score for up to 1,000 targets | Labs + Backlinks |
| | IndexNow | Per-host keys, key-file check, URL submission (Bing, Yandex, Naver, Seznam, Yep) | api.indexnow.org |

The top-bar search ("Enter a domain or URL" + database) opens Traffic Analytics for any site.
Backlink tools need the **Backlinks API** on your DataForSEO plan. Semantic clustering uses the Workers AI binding in `wrangler.jsonc` (≈ $0.01 per million tokens).
Existing install? Apply `schema-tools.sql` once: `npx wrangler d1 execute duy-seo --remote --file=schema-tools.sql`.
