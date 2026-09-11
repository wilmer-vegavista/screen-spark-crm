<#
.SYNOPSIS
  Erik's hand (WO-124 §6, step 1): the three Fortnox function secrets on the DEV project, so
  the deployed fortnox-sync reads Vega Adscreens AB (tenant 1571636) every hour.

    ./scripts/preview/set-fortnox-secrets.ps1

.DESCRIPTION
  Takes FORTNOX_CLIENT_ID and FORTNOX_CLIENT_SECRET from the env file (FORTNOX_ENV_FILE, default
  C:\Users\erika\.secrets\vegavista-fortnox.env) and asks, with hidden input, for whichever is
  missing there. FORTNOX_TENANT_ID is 1571636, not a secret. Prints no value: `secrets list`
  at the end shows names and digests only.

  Writes still reach no company but the test company 1848969: guard.ts's WRITE_TENANT decides
  that, whatever these secrets say.
#>
param(
  [string]$EnvFile = $(if ($env:FORTNOX_ENV_FILE) { $env:FORTNOX_ENV_FILE } else { "C:\Users\erika\.secrets\vegavista-fortnox.env" })
)
$env:npm_config_loglevel = "error"
$ProjectRef = "fcxmtlbrwfbbjudjmloh"  # Erik's vega-vista-dev, never Vega Vista's own project

$vals = @{}
if (Test-Path $EnvFile) {
  foreach ($line in Get-Content $EnvFile) {
    if ($line -match '^\s*(FORTNOX_CLIENT_ID|FORTNOX_CLIENT_SECRET)\s*=\s*"?([^"#\s]+)"?\s*(#.*)?$') { $vals[$Matches[1]] = $Matches[2] }
  }
}
if (-not $vals["FORTNOX_CLIENT_ID"]) { $vals["FORTNOX_CLIENT_ID"] = Read-Host "Fortnox Client ID" }
if (-not $vals["FORTNOX_CLIENT_SECRET"]) {
  $secure = Read-Host "Fortnox Client Secret" -AsSecureString
  $vals["FORTNOX_CLIENT_SECRET"] = [Runtime.InteropServices.Marshal]::PtrToStringBSTR(
    [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure))
  Remove-Variable secure
}

npx supabase secrets set --project-ref $ProjectRef `
  "FORTNOX_CLIENT_ID=$($vals["FORTNOX_CLIENT_ID"])" `
  "FORTNOX_CLIENT_SECRET=$($vals["FORTNOX_CLIENT_SECRET"])" `
  "FORTNOX_TENANT_ID=1571636"
$ok = $LASTEXITCODE -eq 0
$vals.Clear()
if (-not $ok) { throw "supabase secrets set failed." }
npx supabase secrets list --project-ref $ProjectRef
