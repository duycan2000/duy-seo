# Duy SEO — one-command deploy to Cloudflare (Windows PowerShell)
# Run:  powershell -ExecutionPolicy Bypass -File .\deploy.ps1
# The D1 database "duy-seo" already exists and has its tables; its ID is in wrangler.jsonc.
$ErrorActionPreference = "Stop"
Set-Location $PSScriptRoot

Write-Host "1/4  Installing packages..."
npm install --no-audit --no-fund

Write-Host "2/4  Signing in to Cloudflare (a browser window opens the first time)..."
npx wrangler whoami *> $null
if ($LASTEXITCODE -ne 0) { npx wrangler login }

Write-Host "3/4  Deploying the Worker..."
npx wrangler deploy

Write-Host "4/4  Setting secrets (paste each value, then press Enter)..."
Write-Host "  DataForSEO API login (from app.dataforseo.com/api-access):"
npx wrangler secret put DFS_LOGIN
Write-Host "  DataForSEO API password:"
npx wrangler secret put DFS_PASSWORD
Write-Host "  Choose the password you will use to sign in to the dashboard:"
npx wrangler secret put ADMIN_PASSWORD
$bytes = New-Object byte[] 32
[Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($bytes)
$key = ($bytes | ForEach-Object { $_.ToString("x2") }) -join ""
$key | npx wrangler secret put SESSION_SECRET

Write-Host ""
Write-Host "Done. Open the workers.dev URL printed above and sign in with your ADMIN_PASSWORD."
