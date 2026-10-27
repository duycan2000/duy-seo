#!/usr/bin/env bash
# Duy SEO — one-command deploy to Cloudflare (macOS / Linux)
# The D1 database "duy-seo" already exists and has its tables; its ID is in wrangler.jsonc.
set -e
cd "$(dirname "$0")"

echo "1/4  Installing packages…"
npm install --no-audit --no-fund

echo "2/4  Signing in to Cloudflare (a browser window opens the first time)…"
npx wrangler whoami >/dev/null 2>&1 || npx wrangler login

echo "3/4  Deploying the Worker…"
npx wrangler deploy

echo "4/4  Setting secrets (paste each value, then press Enter)…"
echo "  DataForSEO API login (from app.dataforseo.com/api-access):"
npx wrangler secret put DFS_LOGIN
echo "  DataForSEO API password:"
npx wrangler secret put DFS_PASSWORD
echo "  Choose the password you will use to sign in to the dashboard:"
npx wrangler secret put ADMIN_PASSWORD
# random session key, generated for you
if command -v openssl >/dev/null; then KEY=$(openssl rand -hex 32); else KEY=$(node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"); fi
printf "%s" "$KEY" | npx wrangler secret put SESSION_SECRET

echo ""
echo "Done. Open the workers.dev URL printed above and sign in with your ADMIN_PASSWORD."
echo "Optional (Rank & Rent): npx wrangler secret put TWILIO_ACCOUNT_SID | TWILIO_AUTH_TOKEN | GSC_SERVICE_ACCOUNT | RESEND_API_KEY | ALERT_EMAIL_TO | ALERT_EMAIL_FROM | TELEGRAM_BOT_TOKEN | TELEGRAM_CHAT_ID"
