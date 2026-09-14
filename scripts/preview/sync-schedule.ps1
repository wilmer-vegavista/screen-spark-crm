<#
.SYNOPSIS
  A catch-up for the hourly Fortnox sync on Erik's DEV project only (WO-124):

    ./scripts/preview/sync-schedule.ps1            the hourly job on the hour + the catch-up
    ./scripts/preview/sync-schedule.ps1 -Remove    the way back: the hourly job alone

.DESCRIPTION
  On the dev project (Supabase free plan) the first API call after a few quiet minutes often
  takes longer than the gateway's ~5 s, which answers 504: the sync's first read failed like
  that in 15 of 23 quiet hours on 13-14 Sept 2026, and at 08:00 and 08:07Z on 14 Sept, so no
  sync those hours. A second attempt minutes later, with the API awake, answers quickly
  (07:00:12Z 504, then 07:02:49Z 672 ms and every later read under 210 ms).

  So a second pg_cron job runs the sync again at 3, 6, 9 and 30 past the hour, only when this
  hour has no run that succeeded or is still running, and fewer than three runs. When the :00
  run got through it does nothing. A post that fails at the first read stops before any call
  to Fortnox. The hourly job keeps the migration's schedule; the migration is not touched, so
  nothing here reaches Vega Vista's own project. The real fix is a retry in fortnox-sync
  itself, on its own pull request.
#>
param([switch]$Remove)
$env:npm_config_loglevel = "error"
$ProjectRef = "fcxmtlbrwfbbjudjmloh"  # Erik's vega-vista-dev, never Vega Vista's own project

$run = "select fortnox.run_sync('cron')"
$thisHour = "from fortnox.sync_runs where started_at >= date_trunc('hour', now())"
$catchup = "$run where not exists (select 1 $thisHour and status in ('ok', 'running')) " +
  "and (select count(*) $thisHour) < 3"
$sqls = @("select cron.schedule('fortnox-sync-hourly', '0 * * * *', `$`$$run`$`$)")
if ($Remove) {
  $sqls += "select cron.unschedule(jobid) from cron.job where jobname = 'fortnox-sync-catchup'"
} else {
  $sqls += "select cron.schedule('fortnox-sync-catchup', '3,6,9,30 * * * *', `$`$$catchup`$`$)"
}
foreach ($sql in $sqls) {
  npx supabase db query --linked --project-ref $ProjectRef --agent no -o table $sql
  if ($LASTEXITCODE -ne 0) { throw "cron change failed (exit $LASTEXITCODE)." }
}
npx supabase db query --linked --project-ref $ProjectRef --agent no -o table `
  "select jobid, jobname, schedule, active, command from cron.job where jobname like 'fortnox%' order by jobid"
