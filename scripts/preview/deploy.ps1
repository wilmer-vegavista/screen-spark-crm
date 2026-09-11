<#
.SYNOPSIS
  Builds the CRM against Erik's dev Supabase project and deploys it as the Cloudflare Worker
  "vega-vista-preview" (WO-124). Windows PowerShell 5.1, from the root of a checkout of the
  tip to preview:

    ./scripts/preview/deploy.ps1

.DESCRIPTION
  Needs the Supabase CLI logged in (npx supabase login) and CLOUDFLARE_API_TOKEN in the
  environment. The dev project's publishable key is fetched from the CLI at run time and set
  in this process only; nothing is written to a file. The committed .env names Vega Vista's
  own project; Vite lets variables already in the process win over it, and this script
  refuses to deploy a build that still names their project anywhere.

  The pages call the dev project's functions (VITE_FORTNOX_FUNCTIONS_URL is cleared). The
  Worker gets the dev project's URL and publishable key as plain vars for the server
  functions; no service-role key and no Slack token, so user administration and the Slack
  post answer with an error in the preview instead of acting.
#>
$env:npm_config_loglevel = "error"
$ProjectRef = "fcxmtlbrwfbbjudjmloh"  # Erik's vega-vista-dev
$Theirs = "llpribdacnlejtefnvtm"      # Vega Vista's own project: must not appear in the build
$Worker = "vega-vista-preview"
Set-Location (Split-Path -Parent (Split-Path -Parent $PSScriptRoot))

# Native tools write progress to stderr; judge them by exit code, not by stderr (PowerShell 5.1
# turns redirected stderr lines into errors).
function Invoke-Native([string]$What, [scriptblock]$Command) {
  & $Command
  if ($LASTEXITCODE -ne 0) { throw "$What failed (exit $LASTEXITCODE)." }
}

if (-not $env:CLOUDFLARE_API_TOKEN) { throw "CLOUDFLARE_API_TOKEN is not set." }
$keys = npx supabase projects api-keys --project-ref $ProjectRef --output json 2>$null | ConvertFrom-Json
$anon = ($keys | Where-Object { $_.name -eq "anon" }).api_key
Remove-Variable keys
if (-not $anon) { throw "Could not fetch the dev project's publishable key. Is the Supabase CLI logged in?" }

$env:VITE_SUPABASE_URL = "https://$ProjectRef.supabase.co"
$env:VITE_SUPABASE_PROJECT_ID = $ProjectRef
$env:VITE_SUPABASE_PUBLISHABLE_KEY = $anon
$env:SUPABASE_URL = $env:VITE_SUPABASE_URL
$env:SUPABASE_PROJECT_ID = $ProjectRef
$env:SUPABASE_PUBLISHABLE_KEY = $anon
Remove-Item Env:VITE_FORTNOX_FUNCTIONS_URL -ErrorAction SilentlyContinue

Invoke-Native "npm run build" { npm run build }

$built = Get-ChildItem .output -Recurse -File
$hits = $built | Select-String -SimpleMatch $Theirs -List
if ($hits) { throw "Refusing to deploy: the build names Vega Vista's own project in $(($hits | ForEach-Object Path) -join ', ')." }
if (-not ($built | Select-String -SimpleMatch $ProjectRef -List)) {
  throw "Refusing to deploy: the build does not name the dev project, so the VITE_ variables did not reach it."
}
Write-Host "Build checked: 0 files name $Theirs; the dev project $ProjectRef is baked in."

Invoke-Native "wrangler deploy" {
  npx --yes wrangler@4 deploy --name $Worker `
    --var "SUPABASE_URL:$($env:SUPABASE_URL)" `
    --var "SUPABASE_PROJECT_ID:$ProjectRef" `
    --var "SUPABASE_PUBLISHABLE_KEY:$anon"
}
