<#
.SYNOPSIS
  Runs the Fortnox round-zero pieces locally against the sandbox pair
  (Fortnox test company 1848969 + the dev Supabase project). Windows PowerShell 5.1.

.DESCRIPTION
  ./scripts/fortnox-dev.ps1 refuse   the guard refusing tenant 1030384 before any request
  ./scripts/fortnox-dev.ps1 probe    company name, DatabaseNumber, counts in the test company
  ./scripts/fortnox-dev.ps1 writerefuse
                                     proof (c): 1848969 as a read-only tenant (WRITE_TENANT
                                     forced elsewhere for this run only) -- one write refused,
                                     then a read still succeeds
  ./scripts/fortnox-dev.ps1 seed     fill the dev project with the synthetic customers/screens/orders
                                     (add -Fortnox to also plant the hand-made-looking rows in the test company;
                                      add -Invoices for round one's year of invoices in the test company, and
                                      -FakePayments if the company refuses to bookkeep payments;
                                      add -Cashflow for round two's ledger: suppliers, supplier invoices,
                                      salary / tax / VAT vouchers and bank payments in the test company)
  ./scripts/fortnox-dev.ps1 sync     one sync run from the command line (add -Dry to write nothing;
                                     -FullLedger to re-read the previous financial year's ledger too)
  ./scripts/fortnox-dev.ps1 serve    the fortnox-sync function on http://localhost:8000
  ./scripts/fortnox-dev.ps1 feed     the fortnox-ledger-feed function on http://localhost:8001 (round one)
  ./scripts/fortnox-dev.ps1 crm      the CRM (vite dev) against the dev project and the local function
  ./scripts/fortnox-dev.ps1 read "v_cashflow?row_key=eq.ag_skatt"
                                     one read of the dev project over PostgREST (schema fortnox)

  Credentials: Fortnox comes from the env file named by FORTNOX_ENV_FILE (default: the
  fortnox-agent repo's .env), passed to Deno by path and never read here. Supabase keys
  are fetched at run time from the logged-in Supabase CLI and only ever set as process
  environment variables. Nothing is written to a file, nothing is printed.

  FORTNOX_TENANT_ID is forced to 1848969 (the guard's constant) in the process environment;
  Deno's --env-file does not override a variable that is already set.
#>
param(
  [Parameter(Position = 0)]
  [ValidateSet("refuse", "probe", "writerefuse", "seed", "sync", "serve", "feed", "crm", "read")]
  [string]$Command = "probe",
  [Parameter(Position = 1)]
  [string]$Path,
  [switch]$Dry,
  [switch]$Fortnox,
  [switch]$Invoices,
  [switch]$FakePayments,
  [switch]$Cashflow,
  [switch]$FullLedger
)

$ErrorActionPreference = "Stop"
# npx prints "package not found, will be installed" on stderr the first time it fetches the
# Supabase CLI; Windows PowerShell 5.1 turns any stderr line from a native command into a
# terminating error under "Stop". Quieting npm to errors only keeps a fresh machine running.
$env:npm_config_loglevel = "error"
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

# Default to the test company. A tenant already set in the process environment wins, so a
# run against Vega Vista is `$env:FORTNOX_TENANT_ID = "1571636"` before the call. The env
# file's own tenant line is never used (Deno does not override a set variable).
if (-not $env:FORTNOX_TENANT_ID) { $env:FORTNOX_TENANT_ID = "1848969" }

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
  "writerefuse" {
    # A number that is never WRITE_TENANT, for this proof run only -- read solely by
    # probe.ts's "writerefuse" mode, which passes it into GuardedFortnox's constructor.
    # guard.ts's company check still requires the connected company to equal the
    # WRITE_TENANT constant as well, so this variable can only narrow the write target,
    # never widen it -- see guard.ts's fetchAndGuard.
    $env:PROBE_FORCE_WRITE_TENANT = "1030384"
    deno run --allow-env --allow-net @EnvFiles "$Fx/_fortnox/probe.ts" writerefuse
  }
  "seed" {
    Load-SupabaseKeys
    $flags = @()
    if ($Fortnox) { $flags += "--fortnox" }
    if ($Invoices) { $flags += "--invoices" }
    if ($FakePayments) { $flags += "--fake-payments" }
    if ($Cashflow) { $flags += "--cashflow" }
    deno run --allow-env --allow-net @EnvFiles "$Root/supabase/seed/seed.ts" @flags
  }
  "sync" {
    Load-SupabaseKeys
    $flags = @()
    if ($Dry) { $flags += "--dry" }
    if ($FullLedger) { $flags += "--full-ledger" }
    deno run --allow-env --allow-net @EnvFiles "$Fx/fortnox-sync/cli.ts" @flags
  }
  "serve" {
    Load-SupabaseKeys
    if (-not $env:PORT) { $env:PORT = "8000" }
    Write-Host "fortnox-sync listening on http://localhost:$($env:PORT) (Ctrl+C stops it; set PORT for another port)"
    deno run --allow-env --allow-net @EnvFiles "$Fx/fortnox-sync/index.ts"
  }
  "feed" {
    Load-SupabaseKeys
    # No Fortnox credentials needed: the feed reads the snapshot table only.
    $env:PORT = "8001"
    Write-Host "fortnox-ledger-feed listening on http://localhost:8001/<token> (Ctrl+C stops it)"
    deno run --allow-env --allow-net "$Fx/fortnox-ledger-feed/index.ts"
  }
  "read" {
    # One read of the dev project over PostgREST - the same route the browser uses.
    # This COMPLEMENTS `npx supabase db query --linked --project-ref <ref> "<sql>"`, which runs
    # as `postgres` over the Management API and therefore hides two failures this verb catches:
    # a schema that is not exposed to PostgREST, and a missing grant or RLS policy.
    # On that command: BOTH flags are required. `--linked` alone falls back to
    # supabase/config.toml, which names Vega Vista's OWN project (llpribdacnlejtefnvtm), and
    # then dies on a direct, IPv6-only connection. $ProjectRef above is a constant, so this
    # verb can only ever read the dev project. GET only.
    if (-not $Path) {
      throw 'Usage: ./scripts/fortnox-dev.ps1 read "v_cashflow?row_key=eq.ag_skatt&select=month,value" - a PostgREST path, schema fortnox.'
    }
    Load-SupabaseKeys
    $headers = @{
      apikey           = $env:SUPABASE_SERVICE_ROLE_KEY
      Authorization    = "Bearer $($env:SUPABASE_SERVICE_ROLE_KEY)"
      "Accept-Profile" = "fortnox"
    }
    $uri = "$($env:SUPABASE_URL)/rest/v1/" + $Path.TrimStart('/')
    Invoke-RestMethod -Method Get -Uri $uri -Headers $headers | ConvertTo-Json -Depth 6
  }
  "crm" {
    Load-SupabaseKeys
    # Vite: variables already in the process win over the committed .env (their project).
    $env:VITE_SUPABASE_URL = $env:SUPABASE_URL
    $env:VITE_SUPABASE_PROJECT_ID = $ProjectRef
    $env:VITE_SUPABASE_PUBLISHABLE_KEY = $env:SUPABASE_ANON_KEY
    $env:SUPABASE_PROJECT_ID = $ProjectRef
    $env:SUPABASE_PUBLISHABLE_KEY = $env:SUPABASE_ANON_KEY
    if (-not $env:VITE_FORTNOX_FUNCTIONS_URL) { $env:VITE_FORTNOX_FUNCTIONS_URL = "http://localhost:8000" }
    Set-Location $Root
    npm run dev
  }
}
