<#
.SYNOPSIS
  Erik's hand (WO-124 §6, step 2): a fresh generated password for each preview login in
  Erik's DEV project, printed ONCE to this terminal. Nothing is written to a file.

    ./scripts/preview/set-passwords.ps1 -Email <filip's address>, <wilmer's address>

.DESCRIPTION
  The users already exist: copy-crm.mjs created them with their production ids (so the orders
  and customers they own stay theirs) and the admin role, but with no password. This sets one
  through the dev project's Auth admin API, with the service-role key fetched from the
  logged-in Supabase CLI into this process only. Run it again to rotate.

  Refuses a placeholder user (banned, made-up address): those stand in for production users
  who get no login in the preview.
#>
param([Parameter(Mandatory = $true)][string[]]$Email)
$env:npm_config_loglevel = "error"
$ProjectRef = "fcxmtlbrwfbbjudjmloh"  # Erik's vega-vista-dev, never Vega Vista's own project

$keys = npx supabase projects api-keys --project-ref $ProjectRef --output json 2>$null | ConvertFrom-Json
$key = ($keys | Where-Object { $_.name -eq "service_role" }).api_key
Remove-Variable keys
if (-not $key) { throw "Could not fetch the dev project's service-role key. Is the Supabase CLI logged in?" }
$headers = @{ apikey = $key; Authorization = "Bearer $key"; "Content-Type" = "application/json" }
$base = "https://$ProjectRef.supabase.co/auth/v1/admin/users"
$users = (Invoke-RestMethod -Method Get -Uri "${base}?per_page=1000" -Headers $headers).users

$alphabet = "abcdefghjkmnpqrstuvwxyzABCDEFGHJKMNPQRSTUVWXYZ23456789"
$rng = [System.Security.Cryptography.RandomNumberGenerator]::Create()
$out = @()
foreach ($e in $Email) {
  $user = $users | Where-Object { $_.email -eq $e.Trim().ToLower() }
  if (-not $user) { throw "No user $e in the dev project. Run copy-crm.mjs with --login $e first." }
  if ($user.banned_until) { throw "$e is a placeholder (banned); it gets no login in the preview." }
  $bytes = New-Object byte[] 20
  $rng.GetBytes($bytes)
  $pw = -join ($bytes | ForEach-Object { $alphabet[$_ % $alphabet.Length] })
  Invoke-RestMethod -Method Put -Uri "$base/$($user.id)" -Headers $headers -Body (@{ password = $pw } | ConvertTo-Json) | Out-Null
  $out += "  $($user.email)   $pw"
}
Remove-Variable key, headers, pw

Write-Host ""
Write-Host "Preview logins (shown once; send each by one-time link, never in the mail):"
$out | ForEach-Object { Write-Host $_ }
Write-Host ""
Remove-Variable out
