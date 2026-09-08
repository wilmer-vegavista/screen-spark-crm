-- =============================================================================
-- Fortnox integration, round one (Erik) — the Google Sheet feed's token.
--
-- The feed (edge function fortnox-ledger-feed) answers GET
--   https://<ref>.supabase.co/functions/v1/fortnox-ledger-feed/<token>
-- with the ledger as CSV. Google Sheets' IMPORTDATA sends no headers, so the token in
-- the URL is the whole authentication. It is generated INSIDE the database into Vault
-- (like round zero's cron token), on an admin's request from the Fortnox-koppling page:
-- rotate returns the new token exactly once, revoke deletes it. No key is typed anywhere
-- and the token is never stored outside Vault (the page shows it once, in a dialog).
--
-- Not runnable on pglite (no Vault in the WASM build); proved on the dev project.
-- =============================================================================

-- Called by the feed function (service role) to check the path segment it received.
create or replace function fortnox.verify_feed_token(p_token text)
returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if p_token is null or length(p_token) < 32 then
    return false;
  end if;
  return exists (
    select 1 from vault.decrypted_secrets
    where name = 'fortnox_feed_token' and decrypted_secret = p_token
  );
end;
$$;

-- Called by fortnox-sync on the admin's "Skapa länk" / "Skapa ny länk": creates or
-- replaces the secret and returns the token — the only moment it leaves the database.
create or replace function fortnox.rotate_feed_token()
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_token text := encode(extensions.gen_random_bytes(32), 'hex');
  v_id uuid;
begin
  select id into v_id from vault.secrets where name = 'fortnox_feed_token';
  if v_id is null then
    perform vault.create_secret(
      v_token,
      'fortnox_feed_token',
      'Token in the fortnox-ledger-feed URL Filip pastes into Google Sheets; verified by fortnox.verify_feed_token()'
    );
  else
    perform vault.update_secret(v_id, v_token);
  end if;
  insert into fortnox.settings (key, value)
    values ('feed_token_rotated_at', now()::text)
    on conflict (key) do update set value = excluded.value;
  return v_token;
end;
$$;

-- Called by fortnox-sync on the admin's "Återkalla länk": the URL stops working at once.
create or replace function fortnox.revoke_feed_token()
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  delete from vault.secrets where name = 'fortnox_feed_token';
  delete from fortnox.settings where key = 'feed_token_rotated_at';
end;
$$;

revoke all on function fortnox.verify_feed_token(text) from public;
revoke all on function fortnox.verify_feed_token(text) from anon, authenticated;
grant execute on function fortnox.verify_feed_token(text) to service_role;

revoke all on function fortnox.rotate_feed_token() from public;
revoke all on function fortnox.rotate_feed_token() from anon, authenticated;
grant execute on function fortnox.rotate_feed_token() to service_role;

revoke all on function fortnox.revoke_feed_token() from public;
revoke all on function fortnox.revoke_feed_token() from anon, authenticated;
grant execute on function fortnox.revoke_feed_token() to service_role;
