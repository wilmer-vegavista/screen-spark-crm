<#
.SYNOPSIS
  The hourly Fortnox sync's schedule on Erik's DEV project only (WO-124):

    ./scripts/preview/sync-schedule.ps1            off the hour, with a catch-up (idempotent)
    ./scripts/preview/sync-schedule.ps1 -Remove    the way back: on the hour, no catch-up

.DESCRIPTION
  On the dev project (Supabase free plan) the API answers slowly for the first ~20 s of every
  hour: the sync's first reads took 4.7-9 s at 05:00-08:00Z on 14 Sept 2026 and hit the
  gateway's timeout (504) in 15 of 23 hours on 13-14 Sept, so no sync that hour. The same
  reads a few minutes off the hour took 40-670 ms.

  So on the dev project the hourly job runs at 7 past the hour, and a catch-up at 22, 37 and
  52 past runs the sync again only when this hour has no run that succeeded or is still
  running, and fewer than three runs. The migration that created the hourly job is not
  touched, so nothing here reaches Vega Vista's own project. For go-live: schedule the job
  off the hour in the migration too, and retry the sync's first reads - both on the sync's
  own pull request.
#>
param([switch]$Remove)
$env:npm_config_loglevel = "error"
$ProjectRef = "fcxmtlbrwfbbjudjmloh"  # Erik's vega-vista-dev, never Vega Vista's own project

$run = "select fortnox.run_sync('cron')"
$thisHour = "from fortnox.sync_runs where started_at >= date_trunc('hour', now())"
if ($Remove) {
  $sqls = @(
    "select cron.schedule('fortnox-sync-hourly', '0 * * * *', `$`$$run`$`$)",
    "select cron.unschedule(jobid) from cron.job where jobname = 'fortnox-sync-catchup'"
  )
} else {
  $catchup = "$run where not exists (select 1 $thisHour and status in ('ok', 'running')) " +
    "and (select count(*) $thisHour) < 3"
  $sqls = @(
    "select cron.schedule('fortnox-sync-hourly', '7 * * * *', `$`$$run`$`$)",
    "select cron.schedule('fortnox-sync-catchup', '22,37,52 * * * *', `$`$$catchup`$`$)"
  )
}
foreach ($sql in $sqls) {
  npx supabase db query --linked --project-ref $ProjectRef --agent no -o table $sql
  if ($LASTEXITCODE -ne 0) { throw "cron change failed (exit $LASTEXITCODE)." }
}
npx supabase db query --linked --project-ref $ProjectRef --agent no -o table `
  "select jobid, jobname, schedule, active, command from cron.job where jobname like 'fortnox%' order by jobid"
