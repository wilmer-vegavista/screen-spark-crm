-- =============================================================================
-- Fortnox integration, round zero (Erik) — the hourly schedule.
--
-- pg_cron fires fortnox.run_sync('cron') every hour. It posts to the fortnox-sync
-- function with a token that was generated INSIDE the database and lives in Supabase
-- Vault; the function verifies it through fortnox.verify_cron_token. No key is typed
-- anywhere. The function URL is a non-secret setting (fortnox.settings.sync_url);
-- while it is absent — as on a project where nothing has been configured yet — the
-- job does nothing at all.
--
-- Not runnable on pglite (no pg_cron, pg_net or Vault in the WASM build); proved on
-- the dev project instead. Their project gets it when Wilmer merges and pushes.
-- =============================================================================

create extension if not exists pg_cron with schema pg_catalog;
grant usage on schema cron to postgres;
grant all privileges on all tables in schema cron to postgres;

create extension if not exists pg_net with schema extensions;

-- The cron token: random, generated here, never seen by a person.
do $$
begin
  if not exists (select 1 from vault.secrets where name = 'fortnox_cron_token') then
    perform vault.create_secret(
      encode(extensions.gen_random_bytes(24), 'hex'),
      'fortnox_cron_token',
      'Token the hourly fortnox-sync job sends; verified by fortnox.verify_cron_token()'
    );
  end if;
end;
$$;

-- Called by the function (service role) to check the header the cron job sent.
create or replace function fortnox.verify_cron_token(p_token text)
returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if p_token is null or p_token = '' then
    return false;
  end if;
  return exists (
    select 1 from vault.decrypted_secrets
    where name = 'fortnox_cron_token' and decrypted_secret = p_token
  );
end;
$$;

revoke all on function fortnox.verify_cron_token(text) from public;
revoke all on function fortnox.verify_cron_token(text) from anon, authenticated;
grant execute on function fortnox.verify_cron_token(text) to service_role;

-- What the schedule runs: one pg_net POST to the function. Returns the pg_net request id,
-- or null when sync_url is not configured on this project.
create or replace function fortnox.run_sync(p_trigger text default 'cron')
returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_url text;
  v_token text;
  v_request bigint;
begin
  select value into v_url from fortnox.settings where key = 'sync_url';
  if v_url is null or v_url = '' then
    return null;
  end if;
  select decrypted_secret into v_token from vault.decrypted_secrets where name = 'fortnox_cron_token';
  select net.http_post(
    url := v_url,
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-fortnox-cron-token', coalesce(v_token, '')
    ),
    body := jsonb_build_object('action', 'sync', 'trigger', p_trigger),
    timeout_milliseconds := 120000
  ) into v_request;
  return v_request;
end;
$$;

revoke all on function fortnox.run_sync(text) from public;
revoke all on function fortnox.run_sync(text) from anon, authenticated;
grant execute on function fortnox.run_sync(text) to service_role;

-- Every hour, on the hour. cron.schedule by name replaces an existing job with that name.
select cron.schedule('fortnox-sync-hourly', '0 * * * *', $$select fortnox.run_sync('cron')$$);
