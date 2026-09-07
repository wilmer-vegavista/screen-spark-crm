-- =============================================================================
-- Fortnox integration, round zero (Erik) — the foundation.
--
-- Everything Fortnox-related lives in schema `fortnox`. The only thing touched in
-- `public` is dropping the unused `fortnox_tokens` table (a refresh-token stub that
-- nothing reads; the service-account flow needs no stored token). The three
-- `orders.fortnox_*` columns are left alone — they are the CRM's to remove.
--
-- Source-of-truth rule: Fortnox owns the numbers (CustomerNumber, ProjectNumber)
-- and paid status; the CRM originates customers and screens (= products).
-- Column choices and the why of each: supabase/functions/README.md.
-- =============================================================================

create schema if not exists fortnox;

comment on schema fortnox is
  'Fortnox integration (Erik). Fortnox owns numbers and paid status; the CRM originates customers and screens.';

grant usage on schema fortnox to authenticated, service_role;

-- Own updated_at helper so the schema does not depend on public.tg_set_updated_at().
create or replace function fortnox.tg_set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

-- -----------------------------------------------------------------------------
-- Non-secret settings (the sync function URL the cron job calls). Secrets never
-- live here: Fortnox credentials are Supabase secrets, the cron token is in Vault.
-- -----------------------------------------------------------------------------
create table fortnox.settings (
  key text primary key,
  value text not null,
  updated_at timestamptz not null default now()
);

comment on table fortnox.settings is
  'Non-secret configuration, e.g. sync_url = the fortnox-sync function URL the hourly job posts to. Absent = the job does nothing.';

create trigger settings_set_updated_at
  before update on fortnox.settings
  for each row execute function fortnox.tg_set_updated_at();

-- -----------------------------------------------------------------------------
-- sync_runs — one row per run (Synka nu, hourly cron, or CLI). health reads the latest.
-- -----------------------------------------------------------------------------
create table fortnox.sync_runs (
  id bigint generated always as identity primary key,
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  triggered_by text not null check (triggered_by in ('manual', 'cron', 'cli')),
  status text not null default 'running' check (status in ('running', 'ok', 'error')),
  -- Fortnox DatabaseNumber the run was guarded against (1848969 = the test company in round zero).
  tenant_id integer,
  company_name text,
  -- The lastmodified value this run read Fortnox changes from (= previous run's started_at).
  lastmodified_cursor timestamptz,
  fortnox_customers_read integer not null default 0,
  fortnox_projects_read integer not null default 0,
  proposals_written integer not null default 0,
  auto_linked integer not null default 0,
  customers_created integer not null default 0,
  projects_created integer not null default 0,
  mismatches_found integer not null default 0,
  error text,
  log jsonb not null default '[]'::jsonb
);

comment on table fortnox.sync_runs is
  'One row per sync run. status running → ok | error. Counts say what the run did; log is a short list of human-readable lines.';

create index sync_runs_started_at_idx on fortnox.sync_runs (started_at desc);

-- -----------------------------------------------------------------------------
-- customer_links — CRM customer ↔ Fortnox CustomerNumber, with the proposal that led there.
--
-- status:      unmatched (no candidate; the sync will create it in Fortnox)
--              proposed  (a candidate with a reason; waits for an admin to confirm)
--              linked    (fortnox_customer_number is set — confirmed, auto-linked on an
--                         exact match, or created by the sync)
-- confidence:  exact = org number; high = normalised name; medium/low = fuzzy; none.
-- method:      how the candidate/link was found: orgnr | name | code | fuzzy | marker
--              ({VV <id>} read back from Fortnox) | manual (admin picked) | created | none.
-- -----------------------------------------------------------------------------
create table fortnox.customer_links (
  customer_id uuid primary key references public.customers (id) on delete cascade,
  status text not null default 'unmatched' check (status in ('unmatched', 'proposed', 'linked')),
  fortnox_customer_number text unique,
  fortnox_name text,
  fortnox_org_number text,
  candidate_number text,
  candidate_name text,
  confidence text not null default 'none' check (confidence in ('exact', 'high', 'medium', 'low', 'none')),
  method text not null default 'none'
    check (method in ('orgnr', 'name', 'code', 'fuzzy', 'marker', 'manual', 'created', 'none')),
  reason text,
  proposed_at timestamptz,
  linked_at timestamptz,
  linked_by text,
  created_in_fortnox_at timestamptz,
  -- null = Fortnox and the CRM agree; text = what disagrees, found on an incremental read.
  mismatch text,
  mismatch_seen_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint customer_links_linked_has_number
    check (status <> 'linked' or fortnox_customer_number is not null)
);

comment on table fortnox.customer_links is
  'CRM customer ↔ Fortnox customer. One row per CRM customer once the proposer has run; the row is the idempotency guard for creates.';

create trigger customer_links_set_updated_at
  before update on fortnox.customer_links
  for each row execute function fortnox.tg_set_updated_at();

-- -----------------------------------------------------------------------------
-- project_links — CRM screen (products row) ↔ Fortnox ProjectNumber. Same shape.
-- crm_code is the four-digit code parsed from the screen name ("1101 - Stenungstorg");
-- when the sync creates the project it becomes the Fortnox ProjectNumber.
-- -----------------------------------------------------------------------------
create table fortnox.project_links (
  product_id uuid primary key references public.products (id) on delete cascade,
  status text not null default 'unmatched' check (status in ('unmatched', 'proposed', 'linked')),
  fortnox_project_number text unique,
  fortnox_description text,
  crm_code text,
  candidate_number text,
  candidate_name text,
  confidence text not null default 'none' check (confidence in ('exact', 'high', 'medium', 'low', 'none')),
  method text not null default 'none'
    check (method in ('orgnr', 'name', 'code', 'fuzzy', 'marker', 'manual', 'created', 'none')),
  reason text,
  proposed_at timestamptz,
  linked_at timestamptz,
  linked_by text,
  created_in_fortnox_at timestamptz,
  mismatch text,
  mismatch_seen_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint project_links_linked_has_number
    check (status <> 'linked' or fortnox_project_number is not null)
);

comment on table fortnox.project_links is
  'CRM screen (products row) ↔ Fortnox project. One row per screen once the proposer has run.';

create trigger project_links_set_updated_at
  before update on fortnox.project_links
  for each row execute function fortnox.tg_set_updated_at();

-- -----------------------------------------------------------------------------
-- Views the CRM reads. security_invoker: the caller's own rights apply, so the
-- admin-only policies below decide who sees rows (Supabase's lint prefers this
-- over security-definer views).
-- -----------------------------------------------------------------------------
create view fortnox.v_customer_numbers with (security_invoker = true) as
select
  c.id as customer_id,
  c.company_name,
  c.org_number,
  coalesce(l.status, 'unmatched') as status,
  l.fortnox_customer_number,
  l.fortnox_name,
  l.candidate_number,
  l.candidate_name,
  coalesce(l.confidence, 'none') as confidence,
  coalesce(l.method, 'none') as method,
  l.reason,
  l.proposed_at,
  l.linked_at,
  l.linked_by,
  l.created_in_fortnox_at,
  l.mismatch
from public.customers c
left join fortnox.customer_links l on l.customer_id = c.id;

comment on view fortnox.v_customer_numbers is
  'Every CRM customer with its Fortnox customer number (or the pending proposal). Read by the Fortnox-koppling page and by the CRM when it needs the number.';

create view fortnox.v_project_numbers with (security_invoker = true) as
select
  p.id as product_id,
  p.name,
  p.city,
  p.screen_type::text as screen_type,
  p.active,
  coalesce(l.status, 'unmatched') as status,
  l.fortnox_project_number,
  l.fortnox_description,
  l.crm_code,
  l.candidate_number,
  l.candidate_name,
  coalesce(l.confidence, 'none') as confidence,
  coalesce(l.method, 'none') as method,
  l.reason,
  l.proposed_at,
  l.linked_at,
  l.linked_by,
  l.created_in_fortnox_at,
  l.mismatch
from public.products p
left join fortnox.project_links l on l.product_id = p.id;

comment on view fortnox.v_project_numbers is
  'Every CRM screen with its Fortnox project number (or the pending proposal).';

create view fortnox.health with (security_invoker = true) as
with last_run as (
  select * from fortnox.sync_runs order by started_at desc limit 1
), last_ok as (
  select * from fortnox.sync_runs where status = 'ok' order by started_at desc limit 1
), last_error as (
  select * from fortnox.sync_runs where status = 'error' order by started_at desc limit 1
)
select
  (select id from last_run) as last_run_id,
  (select started_at from last_run) as last_run_at,
  (select finished_at from last_run) as last_run_finished_at,
  (select status from last_run) as last_run_status,
  (select triggered_by from last_run) as last_run_trigger,
  (select customers_created + projects_created from last_run) as last_run_created,
  (select started_at from last_ok) as last_ok_at,
  (select started_at from last_error) as last_error_at,
  (select error from last_error) as last_error,
  (select count(*) from fortnox.customer_links where mismatch is not null)
    + (select count(*) from fortnox.project_links where mismatch is not null) as mismatch_count,
  (select count(*) from fortnox.customer_links where status = 'linked') as customers_linked,
  (select count(*) from fortnox.customer_links where status = 'proposed') as customers_proposed,
  (select count(*) from public.customers c
     where not exists (select 1 from fortnox.customer_links l
                       where l.customer_id = c.id and l.status = 'linked')) as customers_unlinked,
  (select count(*) from fortnox.project_links where status = 'linked') as projects_linked,
  (select count(*) from fortnox.project_links where status = 'proposed') as projects_proposed,
  (select count(*) from public.products p
     where not exists (select 1 from fortnox.project_links l
                       where l.product_id = p.id and l.status = 'linked')) as projects_unlinked;

comment on view fortnox.health is
  'One row: when the sync last ran and how it went, the last error, and how many links disagree with Fortnox.';

-- -----------------------------------------------------------------------------
-- Row level security. Tables: service_role does everything (it bypasses RLS),
-- authenticated admins may read. Nobody else sees anything; settings is
-- service_role-only.
-- -----------------------------------------------------------------------------
alter table fortnox.settings enable row level security;
alter table fortnox.sync_runs enable row level security;
alter table fortnox.customer_links enable row level security;
alter table fortnox.project_links enable row level security;

create policy sync_runs_admin_select on fortnox.sync_runs
  for select to authenticated using (public.has_role(auth.uid(), 'admin'));
create policy customer_links_admin_select on fortnox.customer_links
  for select to authenticated using (public.has_role(auth.uid(), 'admin'));
create policy project_links_admin_select on fortnox.project_links
  for select to authenticated using (public.has_role(auth.uid(), 'admin'));

grant select on fortnox.sync_runs, fortnox.customer_links, fortnox.project_links to authenticated;
grant select on fortnox.v_customer_numbers, fortnox.v_project_numbers, fortnox.health to authenticated;

grant all on all tables in schema fortnox to service_role;
grant all on all sequences in schema fortnox to service_role;
alter default privileges in schema fortnox grant all on tables to service_role;
alter default privileges in schema fortnox grant all on sequences to service_role;

-- -----------------------------------------------------------------------------
-- Retire the unused refresh-token stub. Nothing in the CRM reads it, and the
-- client-credentials flow keeps no token in the database.
-- -----------------------------------------------------------------------------
drop table if exists public.fortnox_tokens;
