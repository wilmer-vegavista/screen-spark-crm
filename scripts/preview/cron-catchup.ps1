<#
.SYNOPSIS
  A catch-up for the hourly Fortnox sync on Erik's DEV project only (WO-124):

    ./scripts/preview/cron-catchup.ps1            schedule it (again: same name, replaced)
    ./scripts/preview/cron-catchup.ps1 -Remove    the way back

.DESCRIPTION
  On the dev project (Supabase free plan) the API gateway gives PostgREST 5 s, and the first
  database read of fortnox-sync after an idle hour often takes longer: 15 of 23 idle hours on
  13-14 Sept 2026 ended in a 504 before the sync wrote its row, so no sync that hour.

  This adds a second pg_cron job that runs at 5, 10, ... 55 past the hour (never at :00, where
  the hourly job already posts) and calls fortnox.run_sync('cron') only when no sync of any
  kind has started this hour. When the :00 run got through, it does nothing. A failed post
  stops at the function's first database read, before any call to Fortnox.

  Preview-only: nothing in the repo's migrations changes, so nothing here reaches Vega Vista's
  own project. The real fix is a retry in fortnox-sync itself, on its own pull request.
#>
param([switch]$Remove)
$env:npm_config_loglevel = "error"
$ProjectRef = "fcxmtlbrwfbbjudjmloh"  # Erik's vega-vista-dev, never Vega Vista's own project

if ($Remove) {
  $sql = "select cron.unschedule('fortnox-sync-catchup')"
} else {
  $sql = "select cron.schedule('fortnox-sync-catchup', '5,10,15,20,25,30,35,40,45,50,55 * * * *', " +
    "`$`$select fortnox.run_sync('cron') where not exists " +
    "(select 1 from fortnox.sync_runs where started_at >= date_trunc('hour', now()))`$`$)"
}
npx supabase db query --linked --project-ref $ProjectRef --agent no -o table $sql
if ($LASTEXITCODE -ne 0) { throw "cron change failed (exit $LASTEXITCODE)." }
npx supabase db query --linked --project-ref $ProjectRef --agent no -o table `
  "select jobid, jobname, schedule, active, command from cron.job where jobname like 'fortnox%' order by jobid"
