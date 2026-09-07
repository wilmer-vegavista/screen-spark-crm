<#
.SYNOPSIS
  Runs the Fortnox round-zero pieces locally against the sandbox pair
  (Fortnox test company 1848969 + the dev Supabase project). Windows PowerShell 5.1.

.DESCRIPTION
  ./scripts/fortnox-dev.ps1 refuse   the guard refusing tenant 1030384 before any request
  ./scripts/fortnox-dev.ps1 probe    company name, DatabaseNumber, counts in the test company
  ./scripts/fortnox-dev.ps1 seed     fill the dev project with the synthetic customers/screens/orders
                                     (add -Fortnox to also plant the hand-made-looking rows in the test company)
  ./scripts/fortnox-dev.ps1 sync     one sync run from the command line (add -Dry to write nothing)
  ./scripts/fortnox-dev.ps1 serve    the fortnox-sync function on http://localhost:8000
  ./scripts/fortnox-dev.ps1 crm      the CRM (vite dev) against the dev project and the local function

  Credentials: Fortnox comes from the env file named by FORTNOX_ENV_FILE (default: the
  fortnox-agent repo's .env), passed to Deno by path and never read here. Supabase keys
  are fetched at run time from the logged-in Supabase CLI and only ever set as process
  environment variables. Nothing is written to a file, nothing is printed.

  FORTNOX_TENANT_ID is forced to 1848969 (the guard's constant) in the process environment;
  Deno's --env-file does not override a variable that is already set.
#>
param(
  [Parameter(Position = 0)]
  [ValidateSet("refuse", "probe", "seed", "sync", "serve", "crm")]
  [string]$Command = "probe",
  [switch]$Dry,
  [switch]$Fortnox
)

$ErrorActionPreference = "Stop"
$ProjectRef = "fcxmtlbrwfbbjudjmloh"
$Root = Split-Path -Parent $PSScriptRoot
$EnvFile = if ($env:FORTNOX_ENV_FILE) { $env:FORTNOX_ENV_FILE } else { "C:\Users\erika\projects\fortnox-agent\.env" }

if (-not (Test-Path $EnvFile)) {
  throw "Fortnox env file not found at $EnvFile. Set FORTNOX_ENV_FILE to the fortnox-agent repo's .env."
}

function Load-SupabaseKeys {
  $json = npx supabase projects api-keys --project-ref $ProjectRef --output json 2>$null | ConvertFrom-Json
  $env:SUPABASE_URL = "https://$ProjectRef.supabase.co"
  $env:SUPABASE_ANON_KEY = ($json | Where-Object { $_.name -eq "anon" }).api_key
  $env:SUPABASE_SERVICE_ROLE_KEY = ($json | Where-Object { $_.name -eq "service_role" }).api_key
  if (-not $env:SUPABASE_SERVICE_ROLE_KEY -or -not $env:SUPABASE_ANON_KEY) {
    throw "Could not fetch the dev project's keys. Is the Supabase CLI logged in (npx supabase login)?"
  }
}

# The guard's constant. The env file's own tenant id is never used.
$env:FORTNOX_TENANT_ID = "1848969"

# Optional local values (ANTHROPIC_API_KEY, ANTHROPIC_MODEL) from .env.local, when present.
$EnvFiles = @("--env-file=$EnvFile")
if (Test-Path "$Root/.env.local") { $EnvFiles += "--env-file=$Root/.env.local" }

$Fx = "$Root/supabase/functions"

switch ($Command) {
  "refuse" {
    deno run --allow-env @EnvFiles "$Fx/_fortnox/probe.ts" refuse 1030384
  }
  "probe" {
    deno run --allow-env --allow-net @EnvFiles "$Fx/_fortnox/probe.ts"
  }
  "seed" {
    Load-SupabaseKeys
    $flags = @()
    if ($Fortnox) { $flags += "--fortnox" }
    deno run --allow-env --allow-net @EnvFiles "$Root/supabase/seed/seed.ts" @flags
  }
  "sync" {
    Load-SupabaseKeys
    $flags = @()
    if ($Dry) { $flags += "--dry" }
    deno run --allow-env --allow-net @EnvFiles "$Fx/fortnox-sync/cli.ts" @flags
  }
  "serve" {
    Load-SupabaseKeys
    Write-Host "fortnox-sync listening on http://localhost:8000 (Ctrl+C stops it)"
    deno run --allow-env --allow-net @EnvFiles "$Fx/fortnox-sync/index.ts"
  }
  "crm" {
    Load-SupabaseKeys
    # Vite: variables already in the process win over the committed .env (their project).
    $env:VITE_SUPABASE_URL = $env:SUPABASE_URL
    $env:VITE_SUPABASE_PROJECT_ID = $ProjectRef
    $env:VITE_SUPABASE_PUBLISHABLE_KEY = $env:SUPABASE_ANON_KEY
    $env:SUPABASE_PROJECT_ID = $ProjectRef
    $env:SUPABASE_PUBLISHABLE_KEY = $env:SUPABASE_ANON_KEY
    $env:VITE_FORTNOX_FUNCTIONS_URL = "http://localhost:8000"
    Set-Location $Root
    npm run dev
  }
}
