-- =============================================================================
-- Fortnox integration, round one (Erik) — the ledger (kundreskontran).
--
-- One row per Fortnox customer invoice, read hourly by fortnox-sync and matched to a
-- CRM order through round zero's link tables. Fortnox owns every figure here: amount,
-- VAT, total, balance ("paid" = balance zero), dates and flags. The CRM never writes an
-- invoice; this round creates nothing in Fortnox (the seed is the only writer, and only
-- into test company 1848969).
--
-- Views: v_ledger = Filip's eleven ledger columns per invoice (+ order id, instalment
-- counter, balance); v_order_invoice_state = one row per order with matched invoices.
-- Column choices and the why of each: supabase/functions/README.md.
--
-- Runs on pglite as one batch (no extension needed). The feed token lives in the next
-- migration (Vault), which pglite cannot run — same split as round zero's cron migration.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- invoices — one row per Fortnox DocumentNumber.
--
-- match_status:   unmatched (no candidate order) · proposed (candidate with a reason,
--                 waits for an admin) · linked (order_id set) · ignored (an admin chose
--                 "Lämna okopplad"; the sync never re-proposes it).
-- match_confidence: exact = all four rules held (customer link, project link, one
--                 instalment's amount, inside the billing window) — the only level the
--                 sync links by itself; high = customer + project + amount, date outside
--                 the window; medium = customer + project, amount off; low = customer
--                 (and amount) only; none.
-- match_method:   rules (the sync) · manual (an admin picked the order) · none.
-- matched_by:     'sync' or 'admin:<uuid>'. A row whose matched_by starts with admin: is
--                 never re-judged by a later run — that is the "never overwritten" rule.
-- -----------------------------------------------------------------------------
create table fortnox.invoices (
  document_number text primary key,
  customer_number text not null,
  customer_name text,
  project_number text,
  invoice_date date not null,
  due_date date,
  -- Net / TotalVAT / Total from the full Fortnox record (the list summary has only Total).
  amount_excl_vat numeric(14, 2) not null,
  vat numeric(14, 2) not null,
  total numeric(14, 2) not null,
  -- Fortnox Balance, read with requiredNum: missing or malformed fails the run, never 0.
  balance numeric(14, 2) not null,
  currency text not null default 'SEK',
  booked boolean not null default false,
  sent boolean not null default false,
  cancelled boolean not null default false,
  credit boolean not null default false,
  -- Fortnox InvoiceType: INVOICE, AGREEMENTINVOICE (made by Fortnox's avtal/recurring
  -- module), CASHINVOICE, INTRESTINVOICE, SUMMARYINVOICE. Tells the meeting whether Filip's
  -- twelve instalments are hand-made or contract-generated (meeting page, question 1).
  invoice_type text,
  final_pay_date date,
  terms_of_payment text,
  our_reference text,
  your_reference text,
  order_reference text,
  -- ExternalInvoiceReference1: where the seed writes its {VV inv <n>} marker.
  external_reference text,
  -- Fortnox exposes lastmodified only as a filter, not as a field. This is the start of
  -- the run in which the row last came back from a lastmodified read (or the first full read).
  lastmodified_seen_at timestamptz,
  order_id uuid references public.orders (id) on delete set null,
  candidate_order_id uuid references public.orders (id) on delete set null,
  match_status text not null default 'unmatched'
    check (match_status in ('unmatched', 'proposed', 'linked', 'ignored')),
  match_confidence text not null default 'none'
    check (match_confidence in ('exact', 'high', 'medium', 'low', 'none')),
  match_method text not null default 'none' check (match_method in ('rules', 'manual', 'none')),
  match_reason text,
  matched_by text,
  matched_at timestamptz,
  synced_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint invoices_linked_has_order check (match_status <> 'linked' or order_id is not null)
);

comment on table fortnox.invoices is
  'One row per Fortnox customer invoice (DocumentNumber). Figures and paid state are Fortnox''s; order_id is the match to a CRM order. An admin''s match (matched_by admin:…) is never overwritten by the sync.';

create index invoices_invoice_date_idx on fortnox.invoices (invoice_date);
create index invoices_order_id_idx on fortnox.invoices (order_id);
create index invoices_match_status_idx on fortnox.invoices (match_status);
create index invoices_customer_number_idx on fortnox.invoices (customer_number);

create trigger invoices_set_updated_at
  before update on fortnox.invoices
  for each row execute function fortnox.tg_set_updated_at();

-- -----------------------------------------------------------------------------
-- ledger_snapshot — the Google Sheet feed reads this, not the live view. One row per
-- year, refreshed at the end of every successful sync (and by the feed itself when the
-- snapshot is missing or old). A sheet polling every few minutes reads one indexed row.
-- -----------------------------------------------------------------------------
create table fortnox.ledger_snapshot (
  year integer primary key,
  rows jsonb not null,
  row_count integer not null,
  generated_at timestamptz not null default now(),
  sync_run_id bigint
);

comment on table fortnox.ledger_snapshot is
  'v_ledger frozen per year for the Google Sheet feed. Refreshed by the sync; the feed never hits the live view more than once per 15 minutes.';

-- -----------------------------------------------------------------------------
-- sync_runs grows the invoice counters (and remembers whether Claude was used, which
-- round zero computed but did not store — the ledger page states it).
-- -----------------------------------------------------------------------------
alter table fortnox.sync_runs
  add column invoices_read integer not null default 0,
  add column invoices_matched integer not null default 0,
  add column invoices_proposed integer not null default 0,
  add column invoices_unmatched integer not null default 0,
  add column claude_used boolean not null default false;

-- -----------------------------------------------------------------------------
-- The planned instalment count and amount, exactly as src/lib/billing.ts computes them
-- (buildInvoiceSchedule): engang → 1; otherwise ceil(max(1, duration) / step), where the
-- step is 1 / 3 / 6 months. Kept as SQL functions so the views and the matcher agree.
-- -----------------------------------------------------------------------------
create or replace function fortnox.installments_planned(p_frequency text, p_duration_months integer)
returns integer
language sql
immutable
set search_path = ''
as $$
  select case
    when p_frequency is null or p_frequency = 'engang' then 1
    else greatest(1, ceil(greatest(1, coalesce(p_duration_months, 0))::numeric
      / case p_frequency when 'manad' then 1 when 'kvartal' then 3 when 'halvar' then 6 else 1 end))::integer
  end
$$;

create or replace function fortnox.installment_amount(p_frequency text, p_duration_months integer, p_total numeric)
returns numeric
language sql
immutable
set search_path = ''
as $$
  select round(coalesce(p_total, 0) / fortnox.installments_planned(p_frequency, p_duration_months), 2)
$$;

-- -----------------------------------------------------------------------------
-- v_ledger — Filip's eleven columns, one row per Fortnox invoice, plus what the page
-- and the matcher need. security_invoker: admins only, because every row comes from
-- fortnox.invoices, whose policy is admin-only (unlike round zero's link views, a
-- non-admin gets zero rows here, not a row of nulls).
--
-- Säljare  = the order's owner (profiles), else Fortnox "Vår referens" (the seed writes
--            the seller there; assumed to be Filip's habit too — meeting page).
-- Projekt  = the CRM screen name via project_links, else "Fortnox-projekt <n>".
-- Kundnamn = the CRM customer via customer_links, else Fortnox's CustomerName.
-- Betald   = balance is zero and the invoice is not cancelled.
-- Såld / Inlagd i rapport = constants (true): nothing in the workbook reads Såld, and
--            "Inlagd i rapport" was the manual step this feed replaces.
-- installment_no / installments_invoiced count non-cancelled, non-credit invoices on
-- the order by invoice date; installments_planned is the CRM's plan.
-- -----------------------------------------------------------------------------
create view fortnox.v_ledger with (security_invoker = true) as
with numbered as (
  select
    document_number,
    row_number() over (partition by order_id order by invoice_date, document_number) as installment_no,
    count(*) over (partition by order_id) as installments_invoiced
  from fortnox.invoices
  where order_id is not null and not cancelled and not credit
)
select
  i.document_number,
  coalesce(nullif(trim(pr.full_name), ''), pr.email, nullif(trim(i.our_reference), '')) as saljare,
  coalesce(p.name, case when nullif(trim(i.project_number), '') is not null
                        then 'Fortnox-projekt ' || i.project_number end) as projekt,
  coalesce(c.company_name, i.customer_name) as kundnamn,
  i.invoice_date as fakturadatum,
  i.due_date as forfallodatum,
  i.amount_excl_vat as belopp_ex_moms,
  i.vat as moms,
  i.total as totalt,
  (i.balance = 0 and not i.cancelled) as betald,
  true as sald,
  true as inlagd_i_rapport,
  i.balance as kvar_att_betala,
  (i.balance <> 0 and not i.cancelled and i.due_date is not null and i.due_date < current_date) as forfallen,
  i.cancelled,
  i.credit,
  i.invoice_type,
  i.booked,
  i.sent,
  i.final_pay_date,
  i.currency,
  i.customer_number,
  i.customer_name as fortnox_customer_name,
  i.project_number,
  i.our_reference,
  i.external_reference,
  i.order_id,
  i.candidate_order_id,
  i.match_status,
  i.match_confidence,
  i.match_method,
  i.match_reason,
  i.matched_by,
  i.matched_at,
  n.installment_no,
  case when o.id is not null
       then fortnox.installments_planned(o.billing_frequency::text, o.billing_duration_months) end as installments_planned,
  n.installments_invoiced,
  case when o.id is not null
       then fortnox.installment_amount(o.billing_frequency::text, o.billing_duration_months, o.total_excl_vat) end as planned_installment_amount,
  o.billing_frequency::text as billing_frequency,
  o.owner_id as seller_id,
  p.id as product_id,
  c.id as customer_id,
  i.synced_at,
  i.lastmodified_seen_at
from fortnox.invoices i
left join public.orders o on o.id = i.order_id
left join public.profiles pr on pr.id = o.owner_id
left join numbered n on n.document_number = i.document_number
left join fortnox.project_links pl
  on pl.status = 'linked' and pl.fortnox_project_number = i.project_number
left join public.products p on p.id = pl.product_id
left join fortnox.customer_links cl
  on cl.status = 'linked' and cl.fortnox_customer_number = i.customer_number
left join public.customers c on c.id = cl.customer_id;

comment on view fortnox.v_ledger is
  'Filip''s ledger: one row per Fortnox invoice with Säljare, Projekt, Kundnamn, Fakturadatum, Förfallodatum, Belopp ex moms, Moms, Totalt, Betald, Såld, Inlagd i rapport — plus order id, instalment counter and balance (Kvar att betala).';

-- -----------------------------------------------------------------------------
-- v_order_invoice_state — one row per order that has at least one matched invoice:
-- "Fortnox: 8 av 12 fakturerade · 7 betalda · 1 förfallen (förfaller 2026-10-15)".
-- Orders without a matched invoice are absent, so the CRM's planned counter stays.
-- -----------------------------------------------------------------------------
create view fortnox.v_order_invoice_state with (security_invoker = true) as
select
  o.id as order_id,
  count(*) filter (where not i.cancelled and not i.credit) as invoices_matched,
  count(*) filter (where not i.cancelled and not i.credit and i.balance = 0) as invoices_paid,
  count(*) filter (where not i.cancelled and i.balance <> 0
                     and i.due_date is not null and i.due_date < current_date) as invoices_overdue,
  count(*) filter (where not i.cancelled and i.balance <> 0
                     and (i.due_date is null or i.due_date >= current_date)) as invoices_open,
  count(*) filter (where not i.cancelled and i.credit) as credit_notes,
  min(i.due_date) filter (where not i.cancelled and i.balance <> 0) as next_due_date,
  max(i.invoice_date) filter (where not i.cancelled) as last_invoice_date,
  coalesce(sum(i.amount_excl_vat) filter (where not i.cancelled), 0) as amount_invoiced,
  coalesce(sum(i.amount_excl_vat) filter (where not i.cancelled and i.balance = 0), 0) as amount_paid,
  coalesce(sum(i.balance) filter (where not i.cancelled), 0) as balance_open,
  fortnox.installments_planned(o.billing_frequency::text, o.billing_duration_months) as installments_planned,
  fortnox.installment_amount(o.billing_frequency::text, o.billing_duration_months, o.total_excl_vat) as planned_installment_amount,
  o.billing_frequency::text as billing_frequency,
  max(i.synced_at) as synced_at
from public.orders o
join fortnox.invoices i on i.order_id = o.id
group by o.id, o.billing_frequency, o.billing_duration_months, o.total_excl_vat;

comment on view fortnox.v_order_invoice_state is
  'Per order with matched invoices: how many are invoiced, paid, overdue and open in Fortnox, next due date, last invoice date, sums — against the CRM''s planned count.';

-- -----------------------------------------------------------------------------
-- health grows the invoice picture. create or replace may only append columns, so
-- the round-zero columns keep their order and the new ones follow.
-- -----------------------------------------------------------------------------
create or replace view fortnox.health with (security_invoker = true) as
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
                       where l.product_id = p.id and l.status = 'linked')) as projects_unlinked,
  -- round one
  (select invoices_read from last_run) as last_run_invoices_read,
  (select invoices_matched from last_run) as last_run_invoices_matched,
  (select invoices_proposed from last_run) as last_run_invoices_proposed,
  (select invoices_unmatched from last_run) as last_run_invoices_unmatched,
  (select claude_used from last_run) as last_run_claude_used,
  (select count(*) from fortnox.invoices where not cancelled) as invoices_total,
  (select count(*) from fortnox.invoices where not cancelled and match_status = 'linked') as invoices_linked,
  (select count(*) from fortnox.invoices where not cancelled and match_status = 'proposed') as invoices_proposed,
  (select count(*) from fortnox.invoices where not cancelled and match_status = 'unmatched') as invoices_unmatched,
  (select count(*) from fortnox.invoices where not cancelled and match_status = 'ignored') as invoices_ignored,
  (select count(*) from fortnox.invoices where not cancelled and balance = 0) as invoices_paid,
  (select count(*) from fortnox.invoices where not cancelled and balance <> 0
     and due_date is not null and due_date < current_date) as invoices_overdue,
  (select count(*) from fortnox.invoices where cancelled) as invoices_cancelled,
  (select min(invoice_date) from fortnox.invoices) as invoices_first_date,
  (select max(invoice_date) from fortnox.invoices) as invoices_last_date,
  (select value::timestamptz from fortnox.settings where key = 'invoices_cursor') as invoices_synced_at,
  (select value::timestamptz from fortnox.settings where key = 'feed_token_rotated_at') as feed_rotated_at,
  (select count(*) > 0 from fortnox.settings where key = 'dev_fake_payments') as dev_fake_payments;

-- -----------------------------------------------------------------------------
-- Row level security. invoices and ledger_snapshot: admins read, service_role does
-- everything. settings becomes readable by admins (it holds nothing secret: the sync
-- URL, the invoice cursor, when the feed link was last rotated) so health can show it.
-- -----------------------------------------------------------------------------
alter table fortnox.invoices enable row level security;
alter table fortnox.ledger_snapshot enable row level security;

create policy invoices_admin_select on fortnox.invoices
  for select to authenticated using (public.has_role(auth.uid(), 'admin'));
create policy ledger_snapshot_admin_select on fortnox.ledger_snapshot
  for select to authenticated using (public.has_role(auth.uid(), 'admin'));
create policy settings_admin_select on fortnox.settings
  for select to authenticated using (public.has_role(auth.uid(), 'admin'));

grant select on fortnox.invoices, fortnox.ledger_snapshot, fortnox.settings to authenticated;
grant select on fortnox.v_ledger, fortnox.v_order_invoice_state to authenticated;
grant execute on function fortnox.installments_planned(text, integer) to authenticated, service_role;
grant execute on function fortnox.installment_amount(text, integer, numeric) to authenticated, service_role;
-- The default privileges from round zero already give service_role everything on new tables.
grant all on fortnox.invoices, fortnox.ledger_snapshot to service_role;
