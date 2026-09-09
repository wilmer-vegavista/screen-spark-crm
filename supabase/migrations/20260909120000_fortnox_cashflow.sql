-- =============================================================================
-- Fortnox integration, round two (Erik) — the cash-flow page (offer package C).
--
-- The general ledger lands in schema `fortnox`: suppliers and supplier invoices (read
-- hourly like the customer invoices), every posting of the current and previous financial
-- year (from Fortnox's SIE export), the balances brought forward, and the chart of
-- accounts. On top of that: Filip's workbook rows as a reference table, the account map
-- (BAS account / account range / supplier → workbook row), the revenue category rule
-- (seller / project / screen type / billing shape → income row), the recurring plan
-- (a row amount plus month overrides, never overwritten by a sync once edited), and the
-- views the page reads: v_cashflow (one row per workbook row × month for a fiscal year,
-- with actual, forecast, plan, kind and the value the page shows) and v_cash_position
-- (opening cash, the computed running balance, and the ledger's own bank balance beside it).
--
-- How a cell decides (the same rules the meeting page states):
--   closed month   = actuals only. Money in = customer invoices paid that month (Fortnox's
--                    own final pay date), by the category rule; money out = supplier
--                    invoices paid that month by the account map, plus every other bank
--                    movement in the ledger by the counter account of its voucher — with
--                    three special voucher classes: a payroll voucher's bank leg is
--                    "Löner", a tax-payment voucher's is "Arbetsgivaravgifter & skatt",
--                    a VAT-settlement voucher's is "Moms att betala".
--   month ahead    = the plan is the floor; known invoices (customer by due date, supplier
--                    by due date) and the order book's planned instalments raise it.
--   current month  = actual to date + known invoices due + the plan's remainder.
--   VAT rows       = actual VAT in closed months; 25 % of the contributing rows in forecast
--                    months, exactly as the workbook computes them.
--   Moms att betala = the settlement voucher when paid; else each VAT period's net placed
--                    in its payment month (period and lag are settings).
-- Column choices and the why of each: supabase/functions/README.md.
--
-- Runs on pglite as one batch (no extension needed). Nothing here writes to Fortnox.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Housekeeping from round one: the comment on credit_invoice_reference said the column
-- lives on the credit note; the code, the live data and the seed put it on the ORIGINAL.
-- -----------------------------------------------------------------------------
comment on column fortnox.invoices.credit_invoice_reference is
  'On the ORIGINAL invoice: the DocumentNumber of the credit note that credits it (Fortnox keeps the reference there; the note carries "0" → null). The matcher links the note to the same order as the original, so "fakturerat" shrinks by what was credited.';

-- -----------------------------------------------------------------------------
-- financial_years — Fortnox''s own list (/financialyears). Every dated ledger read takes
-- an explicit id (voucher numbers restart each year; a fromdate outside the year is a
-- hard error), so the ids live here and the page''s year selector reads them.
-- -----------------------------------------------------------------------------
create table fortnox.financial_years (
  id integer primary key,
  from_date date not null,
  to_date date not null,
  accounting_method text,
  synced_at timestamptz not null default now(),
  constraint financial_years_dates check (to_date > from_date)
);

comment on table fortnox.financial_years is
  'Fortnox financial years (id, from, to). The cash-flow grid runs on these, never on calendar years.';

-- -----------------------------------------------------------------------------
-- accounts — the chart (SIE #KONTO): number → name, for the account-map page.
-- -----------------------------------------------------------------------------
create table fortnox.accounts (
  account integer primary key,
  description text not null,
  synced_at timestamptz not null default now()
);

-- -----------------------------------------------------------------------------
-- account_balances — balance brought forward / carried forward per account and financial
-- year (SIE #IB 0 / #UB 0). "Kassa årets ingång" is the cash accounts'' opening balance;
-- when a year is not closed in Fortnox its #IB is 0, so the previous year''s #UB stands in.
-- -----------------------------------------------------------------------------
create table fortnox.account_balances (
  financial_year_id integer not null references fortnox.financial_years (id) on delete cascade,
  account integer not null,
  opening_balance numeric(14, 2) not null default 0,
  closing_balance numeric(14, 2) not null default 0,
  synced_at timestamptz not null default now(),
  primary key (financial_year_id, account)
);

-- -----------------------------------------------------------------------------
-- ledger_postings — one row per voucher row (SIE #TRANS) for the financial years the
-- sync read. `amount` keeps the SIE sign (debit positive, credit negative); debit and
-- credit are the same figure split, for readability. A year is replaced whole on every
-- read (fortnox.replace_ledger_year) — the SIE file IS the ledger, so there is no
-- per-row cursor to keep.
-- -----------------------------------------------------------------------------
create table fortnox.ledger_postings (
  id bigint generated always as identity primary key,
  financial_year_id integer not null references fortnox.financial_years (id) on delete cascade,
  voucher_series text not null,
  voucher_number integer not null,
  row_no integer not null,
  transaction_date date not null,
  account integer not null,
  debit numeric(14, 2) not null default 0,
  credit numeric(14, 2) not null default 0,
  amount numeric(14, 2) not null,
  description text,
  reg_date date,
  synced_at timestamptz not null default now(),
  unique (financial_year_id, voucher_series, voucher_number, row_no)
);

comment on table fortnox.ledger_postings is
  'The posted ledger, one row per voucher row, from Fortnox''s SIE type-4 export per financial year. amount = debit − credit (SIE sign).';

create index ledger_postings_account_date_idx on fortnox.ledger_postings (account, transaction_date);
create index ledger_postings_date_idx on fortnox.ledger_postings (transaction_date);
create index ledger_postings_voucher_idx on fortnox.ledger_postings (financial_year_id, voucher_series, voucher_number);

-- Replace one financial year''s postings, balances and chart in one transaction.
create or replace function fortnox.replace_ledger_year(
  p_financial_year_id integer,
  p_postings jsonb,
  p_balances jsonb,
  p_accounts jsonb
)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_count integer;
begin
  delete from fortnox.ledger_postings where financial_year_id = p_financial_year_id;
  insert into fortnox.ledger_postings
    (financial_year_id, voucher_series, voucher_number, row_no, transaction_date, account, debit, credit, amount, description, reg_date)
  select p_financial_year_id,
         p->>'voucher_series', (p->>'voucher_number')::integer, (p->>'row_no')::integer,
         (p->>'transaction_date')::date, (p->>'account')::integer,
         (p->>'debit')::numeric, (p->>'credit')::numeric, (p->>'amount')::numeric,
         p->>'description', (p->>'reg_date')::date
  from jsonb_array_elements(p_postings) p;
  get diagnostics v_count = row_count;

  delete from fortnox.account_balances where financial_year_id = p_financial_year_id;
  insert into fortnox.account_balances (financial_year_id, account, opening_balance, closing_balance)
  select p_financial_year_id, (b->>'account')::integer, (b->>'opening_balance')::numeric, (b->>'closing_balance')::numeric
  from jsonb_array_elements(p_balances) b;

  insert into fortnox.accounts (account, description, synced_at)
  select (a->>'account')::integer, a->>'description', now()
  from jsonb_array_elements(p_accounts) a
  on conflict (account) do update set description = excluded.description, synced_at = now();

  return v_count;
end;
$$;

revoke all on function fortnox.replace_ledger_year(integer, jsonb, jsonb, jsonb) from public;
revoke all on function fortnox.replace_ledger_year(integer, jsonb, jsonb, jsonb) from anon, authenticated;
grant execute on function fortnox.replace_ledger_year(integer, jsonb, jsonb, jsonb) to service_role;

-- -----------------------------------------------------------------------------
-- suppliers — the register (Bron registers the invoices against these).
-- -----------------------------------------------------------------------------
create table fortnox.suppliers (
  supplier_number text primary key,
  name text not null,
  org_number text,
  active boolean not null default true,
  email text,
  city text,
  -- Fortnox PreDefinedAccount: the supplier''s default cost account, the map''s best hint.
  predefined_account integer,
  lastmodified_seen_at timestamptz,
  synced_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create trigger suppliers_set_updated_at
  before update on fortnox.suppliers
  for each row execute function fortnox.tg_set_updated_at();

-- -----------------------------------------------------------------------------
-- supplier_invoices — one row per Fortnox supplier invoice (GivenNumber is the key).
-- Total, VAT and Balance are read with requiredNum. "Paid" = balance zero and a final
-- pay date, which is the month the money left. `account` is the cost row with the largest
-- amount (what the map places), `cost_rows` every cost row for the hover.
-- -----------------------------------------------------------------------------
create table fortnox.supplier_invoices (
  given_number text primary key,
  supplier_number text not null,
  supplier_name text,
  -- The supplier''s own invoice number (the seed writes its VV-CF-<key> marker here).
  invoice_number text,
  invoice_date date not null,
  due_date date,
  final_pay_date date,
  total numeric(14, 2) not null,
  vat numeric(14, 2) not null,
  balance numeric(14, 2) not null,
  currency text not null default 'SEK',
  booked boolean not null default false,
  cancelled boolean not null default false,
  credit boolean not null default false,
  account integer,
  cost_rows jsonb not null default '[]'::jsonb,
  voucher_series text,
  voucher_number integer,
  voucher_year integer,
  project_number text,
  comments text,
  lastmodified_seen_at timestamptz,
  synced_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table fortnox.supplier_invoices is
  'One row per Fortnox supplier invoice. Figures and paid state are Fortnox''s (balance read with requiredNum). Placed on a workbook row by fortnox.account_map (supplier rule, then the cost account).';

create index supplier_invoices_due_date_idx on fortnox.supplier_invoices (due_date);
create index supplier_invoices_final_pay_date_idx on fortnox.supplier_invoices (final_pay_date);
create index supplier_invoices_supplier_idx on fortnox.supplier_invoices (supplier_number);

create trigger supplier_invoices_set_updated_at
  before update on fortnox.supplier_invoices
  for each row execute function fortnox.tg_set_updated_at();

-- -----------------------------------------------------------------------------
-- cashflow_rows — Filip''s Kassaflödesrapport tab, row for row (workbook rows 6–55, read
-- 9 Sept 2026; labels verbatim, trailing spaces trimmed). `position` is the workbook row
-- number, `section` the block, `kind` what the cell holds:
--   balance  running cash (rows 6, 19, 55)   header   a section title (8, 21, 45)
--   source   a fed row                        vat_out / vat_in   the two VAT rows (16, 42)
--   opening  Kassa årets ingång (17)          sum      a Summa row (18, 43, 52, 53)
-- `income`: money in (the rows the output-VAT formula reads); `vat_bearing`: the rows the
-- workbook''s input-VAT formula reads (24, 25, 29–35, 37–41 — not 23, 26, 27, 28, 36);
-- `plan_enabled`: the recurring plan applies (the workbook''s typed constants).
-- -----------------------------------------------------------------------------
create table fortnox.cashflow_rows (
  key text primary key,
  label text not null,
  section text not null check (section in ('cash', 'in', 'out', 'out2')),
  kind text not null check (kind in ('balance', 'header', 'source', 'vat_out', 'vat_in', 'opening', 'sum')),
  position integer not null unique,
  income boolean not null default false,
  vat_bearing boolean not null default false,
  plan_enabled boolean not null default false
);

comment on table fortnox.cashflow_rows is
  'The workbook''s Kassaflödesrapport rows in Filip''s order and wording; position = the workbook row number.';

insert into fortnox.cashflow_rows (key, label, section, kind, position, income, vat_bearing, plan_enabled) values
  ('kontanta_medel',      'Kontanta medel (i början av månaden)',          'cash', 'balance',  6, false, false, false),
  ('h_inbetalningar',     'Inbetalningar',                                 'in',   'header',   8, false, false, false),
  ('nationella',          'SKÄRM nationella intäkter',                     'in',   'source',  10, true,  false, false),
  ('extern',              'Skärm extern försäljning (Alta Outdoor)',       'in',   'source',  11, true,  false, false),
  ('egen',                'Skärm egen försäljning (VEGA VISTA)',           'in',   'source',  12, true,  false, false),
  ('abonnemang',          'Skärm abbonemang (VEGA VISTA)',                 'in',   'source',  13, true,  false, false),
  ('programmatisk',       'Programmatisk försäljningsintäkter',            'in',   'source',  14, true,  false, false),
  ('ovriga_intakter',     'Övriga intäkter',                               'in',   'source',  15, true,  false, false),
  ('utgaende_moms',       'Utgående moms',                                 'in',   'vat_out', 16, true,  false, false),
  ('kassa_arets_ingang',  'Kassa årets ingång',                            'in',   'opening', 17, false, false, false),
  ('summa_in',            'Summa',                                         'in',   'sum',     18, false, false, false),
  ('summa_kontanta',      'Summa kontanta medel (före kassaräkning)',      'cash', 'balance', 19, false, false, false),
  ('h_utbetalningar',     'Utbetalningar',                                 'out',  'header',  21, false, false, false),
  ('bygglov',             'Bygglovskostnader',                             'out',  'source',  23, false, false, true),
  ('leasing',             'Leasingkostnader',                              'out',  'source',  24, false, true,  true),
  ('ovriga_skarm',        'Övriga skärmkostnader',                         'out',  'source',  25, false, true,  true),
  ('loner',               'Löner exkl arbetsgivaravgifter & skatt',        'out',  'source',  26, false, false, true),
  ('ag_skatt',            'Arbetsgivaravgifter & skatt',                   'out',  'source',  27, false, false, true),
  ('moms_att_betala',     'Moms att betala',                               'out',  'source',  28, false, false, false),
  ('ovriga_personal',     'Övriga personalkostnader (utlägg, provision)',  'out',  'source',  29, false, true,  true),
  ('forsakring',          'Försäkringskostnader skärmar',                  'out',  'source',  30, false, true,  true),
  ('service',             'Servicekostnader skärmar',                      'out',  'source',  31, false, true,  true),
  ('el',                  'El-kostnader skärmar',                          'out',  'source',  32, false, true,  true),
  ('fasta_hyror',         'Fasta hyror',                                   'out',  'source',  33, false, true,  true),
  ('rorliga_hyror',       'Rörliga hyror',                                 'out',  'source',  34, false, true,  true),
  ('saljkostnader',       'Säljkostnader (media mm)',                      'out',  'source',  35, false, true,  true),
  ('utlagg',              'Utlägg',                                        'out',  'source',  36, false, false, true),
  ('google_workspace',    'Google workspace',                              'out',  'source',  37, false, true,  true),
  ('squarespace',         'Squarespace (hemsida)',                         'out',  'source',  38, false, true,  true),
  ('fortnox',             'Fortnox',                                       'out',  'source',  39, false, true,  true),
  ('kontorshyra',         'Kontorshyra',                                   'out',  'source',  40, false, true,  true),
  ('ovriga_kostnader',    'Övriga kostnader',                              'out',  'source',  41, false, true,  true),
  ('ingaende_moms',       'Ingående moms',                                 'out',  'vat_in',  42, false, false, false),
  ('summa_ut',            'Summa',                                         'out',  'sum',     43, false, false, false),
  ('h_ej_resultat',       'Utbetalningar (inte i resultaträkning)',        'out2', 'header',  45, false, false, false),
  ('kapitalkostnad',      'Kapitalkostnad',                                'out2', 'source',  47, false, false, true),
  ('investeringar',       'Investeringar (anges)',                         'out2', 'source',  48, false, false, true),
  ('startkostnader',      'Övriga startkostnader',                         'out2', 'source',  49, false, false, true),
  ('reserv',              'Reserv och/eller deposition',                   'out2', 'source',  50, false, false, true),
  ('eget_uttag',          'Eget uttag',                                    'out2', 'source',  51, false, false, true),
  ('summa_ej_resultat',   'Summa',                                         'out2', 'sum',     52, false, false, false),
  ('summa_utbetalningar', 'Summa utbetalningar',                           'out',  'sum',     53, false, false, false),
  ('kassa_manadsslut',    'Kassa (månadsslutet)',                          'cash', 'balance', 55, false, false, false);

-- -----------------------------------------------------------------------------
-- account_map — BAS account → workbook row. Three rule shapes, most specific wins:
--   supplier   `supplier_match` = a Fortnox SupplierNumber, or a name prefix (case-insensitive)
--   account    one account (`account`, `account_to` null)
--   range      `account`..`account_to` inclusive; the narrowest range wins
-- The defaults are the builder''s reading of BAS 2026 against the workbook''s rows
-- (source ''default''); an admin''s edit is ''manual''. Postings on an account no rule
-- covers land on Övriga kostnader AND are listed on the page (v_unmapped_accounts) —
-- nothing vanishes. Revenue accounts (3xxx) need no rule: money in is placed by the
-- category rule on the paid invoice, not by account.
-- -----------------------------------------------------------------------------
create table fortnox.account_map (
  id bigint generated always as identity primary key,
  account integer,
  account_to integer,
  supplier_match text,
  row_key text not null references fortnox.cashflow_rows (key),
  source text not null default 'default' check (source in ('default', 'manual')),
  note text,
  updated_by text,
  updated_at timestamptz not null default now(),
  constraint account_map_one_shape check (num_nonnulls(account, supplier_match) = 1),
  constraint account_map_range check (account_to is null or (account is not null and account_to >= account))
);

create unique index account_map_account_uniq on fortnox.account_map (account, coalesce(account_to, 0)) where account is not null;
create unique index account_map_supplier_uniq on fortnox.account_map (lower(supplier_match)) where supplier_match is not null;

comment on table fortnox.account_map is
  'BAS account (or range, or supplier) → workbook row. supplier > exact account > narrowest range. Defaults are guesses to confirm with Filip; edits on the cash-flow page.';

insert into fortnox.account_map (account, account_to, supplier_match, row_key, note) values
  -- the three SaaS rows: a supplier rule each (any project, no numbers needed)
  (null, null, 'Google',      'google_workspace', 'Leverantörsnamn som börjar på Google'),
  (null, null, 'Squarespace', 'squarespace',      'Leverantörsnamn som börjar på Squarespace'),
  (null, null, 'Fortnox',     'fortnox',          'Leverantörsnamn som börjar på Fortnox'),
  -- balance-sheet counters of bank movements
  (1200, 1299, null, 'investeringar',  'Maskiner och inventarier (skärmar som köps)'),
  (1380, 1389, null, 'reserv',         'Långfristiga fordringar: depositioner'),
  (1630, 1630, null, 'ag_skatt',       'Skattekontot'),
  (2010, 2019, null, 'eget_uttag',     'Eget kapital, enskild firma'),
  (2350, 2399, null, 'kapitalkostnad', 'Banklån och andra långfristiga skulder: amortering'),
  (2610, 2659, null, 'moms_att_betala','Momskonton (avräkning) när en verifikation inte är en momsavstämning'),
  (2640, 2649, null, 'ingaende_moms',  'Ingående moms på ett direktköp via bank'),
  (2700, 2799, null, 'ag_skatt',       'Personalskatt, sociala avgifter (Bron: 2710/2731)'),
  (2820, 2829, null, 'loner',          'Kortfristiga skulder till anställda (lön som betalas senare)'),
  (2890, 2899, null, 'eget_uttag',     'Utdelning, ägaruttag'),
  -- costs
  (3000, 3999, null, 'ovriga_intakter','Intäkt bokad direkt mot bank (kontantförsäljning)'),
  (5010, 5010, null, 'kontorshyra',    'Lokalhyra – kontoret'),
  (5011, 5011, null, 'fasta_hyror',    'Hyra skärmplats, fast (gissat konto)'),
  (5012, 5012, null, 'rorliga_hyror',  'Hyra skärmplats, rörlig (gissat konto)'),
  (5013, 5099, null, 'kontorshyra',    'Övriga lokalkostnader'),
  (5020, 5020, null, 'el',             'El för belysning'),
  (5200, 5299, null, 'leasing',        'Hyra av anläggningstillgångar (skärmar)'),
  (5400, 5499, null, 'ovriga_skarm',   'Förbrukningsinventarier och material'),
  (5500, 5599, null, 'service',        'Reparation och underhåll'),
  (5600, 5699, null, 'leasing',        'Kostnader för transportmedel (5615 leasing)'),
  (5700, 5799, null, 'ovriga_kostnader','Frakter och transporter'),
  (5800, 5899, null, 'utlagg',         'Resekostnader'),
  (5900, 5999, null, 'saljkostnader',  'Reklam och PR (media)'),
  (6000, 6099, null, 'utlagg',         'Övriga försäljningskostnader, representation'),
  (6100, 6299, null, 'ovriga_kostnader','Kontorsmateriel, tele och post'),
  (6300, 6399, null, 'forsakring',     'Företagsförsäkringar'),
  (6400, 6499, null, 'ovriga_kostnader','Förvaltningskostnader'),
  (6500, 6599, null, 'ovriga_kostnader','Övriga externa tjänster (IT-tjänster 6540 utan leverantörsregel)'),
  (6900, 6949, null, 'ovriga_kostnader','Övriga externa kostnader'),
  (6950, 6959, null, 'bygglov',        'Tillsynsavgifter myndigheter (bygglov)'),
  (6960, 6999, null, 'ovriga_kostnader','Övriga externa kostnader'),
  (7000, 7299, null, 'loner',          'Löner'),
  (7300, 7399, null, 'ovriga_personal','Kostnadsersättningar och förmåner'),
  (7400, 7499, null, 'ovriga_personal','Pensionskostnader'),
  (7500, 7599, null, 'ag_skatt',       'Sociala avgifter'),
  (7600, 7699, null, 'ovriga_personal','Övriga personalkostnader'),
  (7700, 7999, null, 'ovriga_kostnader','Nedskrivningar, avskrivningar (sällan kassa)'),
  (8300, 8399, null, 'ovriga_intakter','Ränteintäkter'),
  (8400, 8499, null, 'kapitalkostnad', 'Räntekostnader');

-- Which row an account (and optionally its supplier) lands on. null = unmapped.
create or replace function fortnox.map_row(p_account integer, p_supplier_number text, p_supplier_name text)
returns text
language sql
stable
set search_path = ''
as $$
  select row_key from (
    select m.row_key, 0 as rank, 0 as width
    from fortnox.account_map m
    where m.supplier_match is not null
      and (
        (m.supplier_match ~ '^\d+$' and m.supplier_match = p_supplier_number)
        or (m.supplier_match !~ '^\d+$' and p_supplier_name is not null
            and lower(p_supplier_name) like lower(m.supplier_match) || '%')
      )
    union all
    select m.row_key, 1, 0
    from fortnox.account_map m
    where m.account = p_account and m.account_to is null
    union all
    select m.row_key, 2, m.account_to - m.account
    from fortnox.account_map m
    where m.account_to is not null and p_account between m.account and m.account_to
  ) c
  order by rank, width
  limit 1
$$;

-- -----------------------------------------------------------------------------
-- revenue_rules — which income row a customer invoice (or a planned instalment) belongs
-- to. Evaluated in priority order, first match wins:
--   seller       the invoice''s seller (order owner, else Fortnox "Vår referens") starts with match_value
--   project      the Fortnox project number, or the screen''s four-digit code, equals match_value
--   screen_type  the CRM screen''s type (products.screen_type) equals match_value
--   billing      ''abonnemang'' = the order is billed monthly / quarterly / half-yearly
--                (what Rapport ekonomi''s Abonnemang tab counts); ''engang'' = one-off
--   default      everything else
-- Defaults: Alta (seller) and screens of type extern → extern försäljning; project 2102 →
-- programmatisk; subscriptions → abonnemang; else egen. Precedence stated: a subscription
-- sold by Alta is extern (the seller rule sits above the billing rule).
-- -----------------------------------------------------------------------------
create table fortnox.revenue_rules (
  id bigint generated always as identity primary key,
  priority integer not null,
  kind text not null check (kind in ('seller', 'project', 'screen_type', 'billing', 'default')),
  match_value text,
  row_key text not null references fortnox.cashflow_rows (key),
  source text not null default 'default' check (source in ('default', 'manual')),
  note text,
  updated_by text,
  updated_at timestamptz not null default now(),
  constraint revenue_rules_value check ((kind = 'default') = (match_value is null))
);

comment on table fortnox.revenue_rules is
  'Category rule for money in: seller / project / screen type / billing shape → income row, in priority order. Defaults are the builder''s reading of the workbook; edits on the cash-flow page.';

insert into fortnox.revenue_rules (priority, kind, match_value, row_key, note) values
  (10,  'seller',      'Alta',       'extern',        'Säljaren Alta är skärmägare, inte en Vega Vista-säljare (Budget-fliken utesluter säljaren)'),
  (20,  'screen_type', 'extern',     'extern',        'Skärm av typen extern i CRM:et (t.ex. Alta Outdoors skärmar)'),
  (30,  'project',     '2102',       'programmatisk', 'Projekt 2102 - Programmatisk Skärm'),
  (40,  'billing',     'abonnemang', 'abonnemang',    'Ordern faktureras månadsvis/kvartalsvis/halvårsvis (Abonnemang-fliken i Rapport ekonomi)'),
  (100, 'default',     null,         'egen',          'Allt annat');

create or replace function fortnox.revenue_row(
  p_seller text,
  p_project_number text,
  p_project_code text,
  p_screen_type text,
  p_billing text
)
returns text
language sql
stable
set search_path = ''
as $$
  select coalesce((
    select r.row_key
    from fortnox.revenue_rules r
    where case r.kind
      when 'seller' then p_seller is not null and lower(p_seller) like lower(r.match_value) || '%'
      when 'project' then r.match_value in (p_project_number, p_project_code)
      when 'screen_type' then p_screen_type is not null and lower(p_screen_type) = lower(r.match_value)
      when 'billing' then
        (r.match_value = 'abonnemang' and p_billing in ('manad', 'kvartal', 'halvar'))
        or (r.match_value = 'engang' and coalesce(p_billing, 'engang') = 'engang')
        or (r.match_value not in ('abonnemang', 'engang') and r.match_value = p_billing)
      when 'default' then true
      else false end
    order by r.priority, r.id
    limit 1
  ), 'egen')
$$;

-- -----------------------------------------------------------------------------
-- cashflow_plan — the recurring plan: one amount per row (what Filip types in the
-- workbook), prefilled by the sync from the last three closed months (source ''ledger'')
-- and edited on the page (source ''manual'' — a later sync never touches it).
-- cashflow_plan_months — a month''s own figure when it differs from the row amount; the
-- same table holds the manual "Kassa årets ingång" (row kassa_arets_ingang, month =
-- the fiscal year''s first day) when the ledger is not closed for the year.
-- -----------------------------------------------------------------------------
create table fortnox.cashflow_plan (
  row_key text primary key references fortnox.cashflow_rows (key),
  amount numeric(14, 2) not null,
  source text not null check (source in ('ledger', 'manual')),
  basis text,
  updated_by text,
  updated_at timestamptz not null default now()
);

create table fortnox.cashflow_plan_months (
  row_key text not null references fortnox.cashflow_rows (key),
  month date not null,
  amount numeric(14, 2) not null,
  note text,
  updated_by text,
  updated_at timestamptz not null default now(),
  primary key (row_key, month),
  constraint cashflow_plan_months_first_day check (month = date_trunc('month', month)::date)
);

comment on table fortnox.cashflow_plan is
  'Recurring plan per workbook row: amount, source (ledger = prefilled average of the last three closed months; manual = edited on the page, never overwritten by a sync), who and when.';
comment on table fortnox.cashflow_plan_months is
  'Per-month override of the plan (and the manual Kassa årets ingång on row kassa_arets_ingang at the fiscal year''s first day).';

-- -----------------------------------------------------------------------------
-- Settings this round reads (non-secret): the VAT period and its payment lag, which
-- accounts are "kassan", the dev-only fake supplier payments, the ledger cursor.
-- -----------------------------------------------------------------------------
insert into fortnox.settings (key, value) values
  ('cashflow_vat_period', 'monthly'),
  ('cashflow_vat_lag_months', '2'),
  ('cashflow_cash_accounts', '1900-1999')
on conflict (key) do nothing;

create or replace function fortnox.setting(p_key text, p_default text)
returns text
language sql
stable
set search_path = ''
as $$
  select coalesce((select value from fortnox.settings where key = p_key), p_default)
$$;

-- "1900-1999,1910" → the ranges that are the cash accounts.
create or replace function fortnox.cash_account_ranges()
returns table (lo integer, hi integer)
language sql
stable
set search_path = ''
as $$
  select
    (regexp_match(trim(part), '^(\d{4})'))[1]::integer as lo,
    coalesce((regexp_match(trim(part), '^\d{4}\s*-\s*(\d{4})$'))[1]::integer, (regexp_match(trim(part), '^(\d{4})'))[1]::integer) as hi
  from unnest(string_to_array(fortnox.setting('cashflow_cash_accounts', '1900-1999'), ',')) as part
  where trim(part) ~ '^\d{4}'
$$;

create or replace function fortnox.is_cash_account(p_account integer)
returns boolean
language sql
stable
set search_path = ''
as $$
  select exists (select 1 from fortnox.cash_account_ranges() r where p_account between r.lo and r.hi)
$$;

-- -----------------------------------------------------------------------------
-- sync_runs and health grow the ledger counters.
-- -----------------------------------------------------------------------------
alter table fortnox.sync_runs
  add column supplier_invoices_read integer not null default 0,
  add column postings_read integer not null default 0,
  add column ledger_synced_to date;

-- -----------------------------------------------------------------------------
-- The planned instalments the CRM expects but Fortnox has not invoiced yet: the order''s
-- plan (installments_planned / installment_amount, the SQL twins of buildInvoiceSchedule)
-- minus the invoices already matched to the order. The remaining instalments are the last
-- ones. Due date = planned invoice date + the order''s payment terms (the first number in
-- the text, default 30 days).
-- -----------------------------------------------------------------------------
create or replace function fortnox.planned_instalments()
returns table (
  order_id uuid,
  customer_id uuid,
  company_name text,
  n integer,
  count integer,
  planned_invoice_date date,
  planned_due_date date,
  amount numeric,
  vat numeric,
  seller text,
  project_code text,
  screen_type text,
  billing_frequency text
)
language sql
stable
set search_path = ''
as $$
  with o as (
    select o.id, o.customer_id, o.company_name, o.billing_frequency::text as billing_frequency,
           o.billing_duration_months, o.total_excl_vat, o.vat_exempt,
           coalesce(o.invoice_start_date, o.created_at::date) as start_date,
           coalesce(nullif((regexp_match(coalesce(o.payment_terms, ''), '(\d+)'))[1], '')::integer, 30) as terms_days,
           coalesce(nullif(trim(pr.full_name), ''), pr.email) as seller,
           fortnox.installments_planned(o.billing_frequency::text, o.billing_duration_months) as count,
           fortnox.installment_amount(o.billing_frequency::text, o.billing_duration_months, o.total_excl_vat) as per,
           case o.billing_frequency::text when 'manad' then 1 when 'kvartal' then 3 when 'halvar' then 6 else 0 end as step,
           (select count(*) from fortnox.invoices i where i.order_id = o.id and not i.cancelled and not i.credit) as invoiced,
           (select p.screen_type::text from public.order_items oi join public.products p on p.id = oi.product_id
              where oi.order_id = o.id order by oi.position nulls last limit 1) as screen_type,
           (select (regexp_match(p.name, '^\s*(\d{4})\b'))[1] from public.order_items oi join public.products p on p.id = oi.product_id
              where oi.order_id = o.id order by oi.position nulls last limit 1) as project_code
    from public.orders o
    left join public.profiles pr on pr.id = o.owner_id
    where o.order_type = 'bokning' and coalesce(o.total_excl_vat, 0) <> 0
  )
  select o.id, o.customer_id, o.company_name, g.n, o.count,
         (o.start_date + (g.n - 1) * o.step * interval '1 month')::date as planned_invoice_date,
         (o.start_date + (g.n - 1) * o.step * interval '1 month' + o.terms_days * interval '1 day')::date as planned_due_date,
         o.per as amount,
         case when coalesce(o.vat_exempt, false) then 0 else round(o.per * 0.25, 2) end as vat,
         o.seller, o.project_code, o.screen_type, o.billing_frequency
  from o
  cross join lateral generate_series(1, o.count) as g(n)
  where g.n > o.invoiced
$$;

grant execute on function fortnox.planned_instalments() to authenticated, service_role;
grant execute on function fortnox.map_row(integer, text, text) to authenticated, service_role;
grant execute on function fortnox.revenue_row(text, text, text, text, text) to authenticated, service_role;
grant execute on function fortnox.setting(text, text) to authenticated, service_role;
grant execute on function fortnox.cash_account_ranges() to authenticated, service_role;
grant execute on function fortnox.is_cash_account(integer) to authenticated, service_role;

-- -----------------------------------------------------------------------------
-- v_ledger_vouchers — every voucher with a bank leg, classified:
--   customer_receipt  a 15xx credit against the bank (covered by the invoice table)
--   supplier_payment  a 2440 debit against the bank (covered by supplier_invoices)
--   payroll           a 70xx–73xx debit: the bank leg is the net salary → Löner
--   tax_payment       only 27xx / 1630 counters: the bank leg → Arbetsgivaravgifter & skatt
--   vat_settlement    only 26xx / 1650 counters: the bank leg → Moms att betala
--   other             everything else: each counter leg through the account map
--   none              no bank leg (an invoice booking, a payroll accrual …)
-- cash_net > 0 = money in, < 0 = money out.
-- -----------------------------------------------------------------------------
create view fortnox.v_ledger_vouchers with (security_invoker = true) as
with legs as (
  select p.*, fortnox.is_cash_account(p.account) as is_cash
  from fortnox.ledger_postings p
), v as (
  select financial_year_id, voucher_series, voucher_number,
         min(transaction_date) as transaction_date,
         min(description) as description,
         coalesce(sum(amount) filter (where is_cash), 0) as cash_net,
         bool_or(is_cash) as has_cash,
         bool_or(not is_cash and account between 1500 and 1599 and credit > 0) as has_receivable_credit,
         bool_or(not is_cash and account between 2440 and 2449 and debit > 0) as has_payable_debit,
         bool_or(not is_cash and account between 7000 and 7399 and debit > 0) as has_salary_debit,
         bool_and(is_cash or account between 2700 and 2799 or account = 1630) as only_tax_legs,
         bool_and(is_cash or account between 2600 and 2699 or account = 1650) as only_vat_legs,
         count(*) filter (where not is_cash) as counter_legs
  from legs
  group by financial_year_id, voucher_series, voucher_number
)
select v.*,
  case
    when not has_cash or cash_net = 0 then 'none'
    when has_receivable_credit and cash_net > 0 then 'customer_receipt'
    when has_payable_debit and cash_net < 0 then 'supplier_payment'
    when has_salary_debit and cash_net < 0 then 'payroll'
    when only_tax_legs and counter_legs > 0 and cash_net < 0 then 'tax_payment'
    when only_vat_legs and counter_legs > 0 and cash_net < 0 then 'vat_settlement'
    else 'other'
  end as class
from v;

-- -----------------------------------------------------------------------------
-- v_cashflow_items — every leaf figure with where it goes and why. One row per
-- contributing thing (an invoice, a supplier invoice, a voucher leg, a planned
-- instalment, a booked liability), so the page''s hover can list a cell''s makeup.
--   bucket: actual | forecast_invoiced | forecast_planned | liability
--   amount: in the row''s own sign (income rows: money in; outflow rows: money out)
-- -----------------------------------------------------------------------------
create view fortnox.v_cashflow_items with (security_invoker = true) as
with today as (
  select date_trunc('month', current_date)::date as month0
),
-- customer invoices with what the category rule needs
inv as (
  select i.*,
         coalesce(nullif(trim(pr.full_name), ''), pr.email, nullif(trim(i.our_reference), '')) as seller,
         (regexp_match(coalesce(p.name, ''), '^\s*(\d{4})\b'))[1] as project_code,
         p.screen_type::text as screen_type,
         o.billing_frequency::text as billing_frequency,
         coalesce(c.company_name, i.customer_name) as kundnamn,
         p.name as screen_name
  from fortnox.invoices i
  left join public.orders o on o.id = i.order_id
  left join public.profiles pr on pr.id = o.owner_id
  left join fortnox.project_links pl on pl.status = 'linked' and pl.fortnox_project_number = i.project_number
  left join public.products p on p.id = pl.product_id
  left join fortnox.customer_links cl on cl.status = 'linked' and cl.fortnox_customer_number = i.customer_number
  left join public.customers c on c.id = cl.customer_id
  where not i.cancelled
),
inv_cat as (
  select inv.*, fortnox.revenue_row(seller, project_number, project_code, screen_type, billing_frequency) as row_key
  from inv
),
-- 1. money in, actual: paid customer invoices on their final pay date (net + VAT)
inv_paid as (
  select 'actual'::text as bucket, 'invoice'::text as source, document_number as ref,
         date_trunc('month', final_pay_date)::date as month, final_pay_date as date,
         row_key, amount_excl_vat as amount,
         kundnamn || ' · faktura ' || document_number || coalesce(' · ' || screen_name, '') || ' · betald ' || final_pay_date::text as label
  from inv_cat where balance = 0 and final_pay_date is not null
  union all
  select 'actual', 'invoice', document_number, date_trunc('month', final_pay_date)::date, final_pay_date,
         'utgaende_moms', vat,
         kundnamn || ' · moms på faktura ' || document_number
  from inv_cat where balance = 0 and final_pay_date is not null and vat <> 0
),
-- 2. money in, forecast: open customer invoices by due date (overdue → the current month)
inv_open as (
  select 'forecast_invoiced'::text as bucket, 'invoice'::text as source, document_number as ref,
         greatest(date_trunc('month', coalesce(due_date, invoice_date))::date, (select month0 from today)) as month,
         coalesce(due_date, invoice_date) as date,
         row_key,
         case when total <> 0 then round(amount_excl_vat * balance / total, 2) else 0 end as amount,
         kundnamn || ' · faktura ' || document_number || ' · förfaller ' || coalesce(due_date::text, '?')
           || case when due_date < current_date then ' (förfallen)' else '' end as label
  from inv_cat where balance <> 0
  union all
  select 'forecast_invoiced', 'invoice', document_number,
         greatest(date_trunc('month', coalesce(due_date, invoice_date))::date, (select month0 from today)),
         coalesce(due_date, invoice_date),
         'utgaende_moms',
         case when total <> 0 then round(vat * balance / total, 2) else 0 end,
         kundnamn || ' · moms på faktura ' || document_number
  from inv_cat where balance <> 0 and vat <> 0
),
-- 3. money in, planned: the order book''s instalments not yet invoiced
planned as (
  select 'forecast_planned'::text as bucket, 'order'::text as source, order_id::text || ':' || n as ref,
         greatest(date_trunc('month', planned_due_date)::date, (select month0 from today)) as month,
         planned_due_date as date,
         fortnox.revenue_row(seller, null, project_code, screen_type, billing_frequency) as row_key,
         amount,
         company_name || ' · planerad delfaktura ' || n || '/' || count || ' · fakturadatum ' || planned_invoice_date::text
           || ' · förfaller ' || planned_due_date::text as label
  from fortnox.planned_instalments()
  union all
  select 'forecast_planned', 'order', order_id::text || ':' || n,
         greatest(date_trunc('month', planned_due_date)::date, (select month0 from today)),
         planned_due_date, 'utgaende_moms', vat,
         company_name || ' · moms på planerad delfaktura ' || n || '/' || count
  from fortnox.planned_instalments() where vat <> 0
),
-- supplier invoices with their row
sup as (
  select s.*,
         coalesce(fortnox.map_row(s.account, s.supplier_number, coalesce(sp.name, s.supplier_name)), 'ovriga_kostnader') as row_key,
         fortnox.map_row(s.account, s.supplier_number, coalesce(sp.name, s.supplier_name)) is null as unmapped,
         coalesce(sp.name, s.supplier_name, 'Leverantör ' || s.supplier_number) as name
  from fortnox.supplier_invoices s
  left join fortnox.suppliers sp on sp.supplier_number = s.supplier_number
  where not s.cancelled
),
-- 4. money out, actual: paid supplier invoices on their final pay date (net + VAT)
sup_paid as (
  select 'actual'::text as bucket, 'supplier_invoice'::text as source, given_number as ref,
         date_trunc('month', final_pay_date)::date as month, final_pay_date as date,
         row_key, total - vat as amount,
         name || ' · levfaktura ' || coalesce(invoice_number, given_number) || ' · konto ' || coalesce(account::text, '?')
           || ' · betald ' || final_pay_date::text || case when unmapped then ' · okopplat konto' else '' end as label
  from sup where balance = 0 and final_pay_date is not null
  union all
  select 'actual', 'supplier_invoice', given_number, date_trunc('month', final_pay_date)::date, final_pay_date,
         'ingaende_moms', vat,
         name || ' · moms på levfaktura ' || coalesce(invoice_number, given_number)
  from sup where balance = 0 and final_pay_date is not null and vat <> 0
),
-- 5. money out, forecast: open supplier invoices by due date (overdue → the current month)
sup_open as (
  select 'forecast_invoiced'::text as bucket, 'supplier_invoice'::text as source, given_number as ref,
         greatest(date_trunc('month', coalesce(due_date, invoice_date))::date, (select month0 from today)) as month,
         coalesce(due_date, invoice_date) as date,
         row_key,
         case when total <> 0 then round((total - vat) * balance / total, 2) else 0 end as amount,
         name || ' · levfaktura ' || coalesce(invoice_number, given_number) || ' · förfaller ' || coalesce(due_date::text, '?')
           || case when due_date < current_date then ' (förfallen)' else '' end
           || case when unmapped then ' · okopplat konto' else '' end as label
  from sup where balance <> 0
  union all
  select 'forecast_invoiced', 'supplier_invoice', given_number,
         greatest(date_trunc('month', coalesce(due_date, invoice_date))::date, (select month0 from today)),
         coalesce(due_date, invoice_date), 'ingaende_moms',
         case when total <> 0 then round(vat * balance / total, 2) else 0 end,
         name || ' · moms på levfaktura ' || coalesce(invoice_number, given_number)
  from sup where balance <> 0 and vat <> 0
),
-- 6. money out, actual: the bank legs of the three special voucher classes
bank_special as (
  select 'actual'::text as bucket, 'posting'::text as source,
         voucher_series || ' ' || voucher_number || '/' || financial_year_id as ref,
         date_trunc('month', transaction_date)::date as month, transaction_date as date,
         case class when 'payroll' then 'loner' when 'tax_payment' then 'ag_skatt' else 'moms_att_betala' end as row_key,
         -cash_net as amount,
         'Verifikation ' || voucher_series || ' ' || voucher_number || ' · ' || coalesce(description, '') || ' · '
           || case class when 'payroll' then 'lönekörning (nettolön via bank)' when 'tax_payment' then 'skattebetalning' else 'momsavstämning' end as label
  from fortnox.v_ledger_vouchers
  where class in ('payroll', 'tax_payment', 'vat_settlement')
),
-- 7. money out (or in), actual: every other bank voucher, leg by leg through the map
bank_other as (
  select 'actual'::text as bucket, 'posting'::text as source,
         v.voucher_series || ' ' || v.voucher_number || '/' || v.financial_year_id || ':' || p.row_no as ref,
         date_trunc('month', p.transaction_date)::date as month, p.transaction_date as date,
         coalesce(fortnox.map_row(p.account, null, null), 'ovriga_kostnader') as row_key,
         case when r.income then -p.amount else p.amount end as amount,
         'Verifikation ' || v.voucher_series || ' ' || v.voucher_number || ' · konto ' || p.account
           || coalesce(' ' || a.description, '') || ' · ' || coalesce(v.description, '')
           || case when fortnox.map_row(p.account, null, null) is null then ' · okopplat konto' else '' end as label
  from fortnox.v_ledger_vouchers v
  join fortnox.ledger_postings p
    on p.financial_year_id = v.financial_year_id and p.voucher_series = v.voucher_series and p.voucher_number = v.voucher_number
  left join fortnox.accounts a on a.account = p.account
  left join fortnox.cashflow_rows r on r.key = coalesce(fortnox.map_row(p.account, null, null), 'ovriga_kostnader')
  where v.class = 'other' and not fortnox.is_cash_account(p.account)
),
-- 8. the employer contributions and tax booked this month, due next month (payroll vouchers'' 27xx credits)
ag_liability as (
  select 'liability'::text as bucket, 'posting'::text as source,
         v.voucher_series || ' ' || v.voucher_number || '/' || v.financial_year_id as ref,
         (date_trunc('month', v.transaction_date) + interval '1 month')::date as month,
         (date_trunc('month', v.transaction_date) + interval '1 month' + interval '11 days')::date as date,
         'ag_skatt'::text as row_key,
         sum(p.credit - p.debit) as amount,
         'Skatt och avgifter bokade ' || to_char(v.transaction_date, 'YYYY-MM') || ' (verifikation ' || v.voucher_series || ' ' || v.voucher_number || '), betalas månaden efter' as label
  from fortnox.v_ledger_vouchers v
  join fortnox.ledger_postings p
    on p.financial_year_id = v.financial_year_id and p.voucher_series = v.voucher_series and p.voucher_number = v.voucher_number
  where v.class in ('payroll', 'none') and p.account between 2700 and 2799
    and (date_trunc('month', v.transaction_date) + interval '1 month')::date >= (select month0 from today)
  group by v.financial_year_id, v.voucher_series, v.voucher_number, v.transaction_date
  having sum(p.credit - p.debit) > 0
)
select * from inv_paid
union all select * from inv_open
union all select * from planned
union all select * from sup_paid
union all select * from sup_open
union all select * from bank_special
union all select * from bank_other
union all select * from ag_liability;

-- -----------------------------------------------------------------------------
-- v_cashflow — one row per workbook row × month for every financial year the sync
-- read, with the four buckets, the plan, the month''s kind and the value the page shows.
-- Sum rows and the running cash rows are computed by the page and the PDF from these
-- (exactly as the workbook''s formulas); v_cash_position carries the cash rows.
-- -----------------------------------------------------------------------------
create view fortnox.v_cashflow with (security_invoker = true) as
with today as (
  select date_trunc('month', current_date)::date as month0
),
months as (
  select fy.id as financial_year_id, fy.from_date as fy_from, fy.to_date as fy_to, m::date as month
  from fortnox.financial_years fy
  cross join lateral generate_series(fy.from_date, fy.to_date, interval '1 month') as m
),
agg as (
  select month, row_key,
         coalesce(sum(amount) filter (where bucket = 'actual'), 0) as actual,
         coalesce(sum(amount) filter (where bucket = 'forecast_invoiced'), 0) as forecast_invoiced,
         coalesce(sum(amount) filter (where bucket = 'forecast_planned'), 0) as forecast_planned,
         coalesce(sum(amount) filter (where bucket = 'liability'), 0) as liability
  from fortnox.v_cashflow_items
  group by month, row_key
),
src as (
  select m.financial_year_id, m.fy_from, m.fy_to, m.month, r.key as row_key, r.label, r.position, r.section, r.kind,
         r.income, r.vat_bearing, r.plan_enabled,
         case when m.month < t.month0 then 'closed' when m.month = t.month0 then 'current' else 'ahead' end as month_kind,
         coalesce(a.actual, 0) as actual,
         coalesce(a.forecast_invoiced, 0) as forecast_invoiced,
         coalesce(a.forecast_planned, 0) as forecast_planned,
         coalesce(a.liability, 0) as liability,
         case when r.plan_enabled then coalesce(pm.amount, pl.amount) end as plan,
         pm.amount is not null as plan_overridden,
         pl.source as plan_source
  from months m
  cross join today t
  join fortnox.cashflow_rows r on r.kind = 'source'
  left join agg a on a.month = m.month and a.row_key = r.key
  left join fortnox.cashflow_plan pl on pl.row_key = r.key
  left join fortnox.cashflow_plan_months pm on pm.row_key = r.key and pm.month = m.month
),
src_value as (
  select s.*,
    case s.month_kind
      when 'closed' then s.actual
      when 'current' then s.actual + s.forecast_invoiced + s.forecast_planned + s.liability
                          + greatest(0, coalesce(s.plan, 0) - (s.actual + s.forecast_invoiced + s.forecast_planned + s.liability))
      else greatest(coalesce(s.plan, 0), s.forecast_invoiced + s.forecast_planned + s.liability)
    end as value
  from src s
),
-- the two VAT rows: actual VAT in closed months; 25 % of the contributing rows' forecast part otherwise
vat_rows as (
  select s.financial_year_id, s.fy_from, s.fy_to, s.month, r.key as row_key, r.label, r.position, r.section, r.kind,
         r.income, r.vat_bearing, r.plan_enabled, s.month_kind,
         coalesce(a.actual, 0) as actual,
         coalesce(a.forecast_invoiced, 0) as forecast_invoiced,
         coalesce(a.forecast_planned, 0) as forecast_planned,
         0::numeric as liability,
         null::numeric as plan, false as plan_overridden, null::text as plan_source,
         case s.month_kind
           when 'closed' then coalesce(a.actual, 0)
           else coalesce(a.actual, 0) + round(0.25 * sum(s.value - s.actual) filter (where case when r.kind = 'vat_out' then s.income else s.vat_bearing end), 2)
         end as value
  from src_value s
  join fortnox.cashflow_rows r on r.kind in ('vat_out', 'vat_in')
  left join agg a on a.month = s.month and a.row_key = r.key
  group by s.financial_year_id, s.fy_from, s.fy_to, s.month, r.key, r.label, r.position, r.section, r.kind, r.income, r.vat_bearing, r.plan_enabled,
           s.month_kind, a.actual, a.forecast_invoiced, a.forecast_planned
),
-- net VAT per month: postings for closed/current months, the VAT rows' values for months ahead
vat_month as (
  select m.month,
         case when m.month <= t.month0 then
           coalesce((select sum(p.credit - p.debit) from fortnox.ledger_postings p
                       join fortnox.v_ledger_vouchers v on v.financial_year_id = p.financial_year_id and v.voucher_series = p.voucher_series and v.voucher_number = p.voucher_number
                     where p.account between 2610 and 2639 and v.class <> 'vat_settlement'
                       and date_trunc('month', p.transaction_date)::date = m.month), 0)
           - coalesce((select sum(p.debit - p.credit) from fortnox.ledger_postings p
                       join fortnox.v_ledger_vouchers v on v.financial_year_id = p.financial_year_id and v.voucher_series = p.voucher_series and v.voucher_number = p.voucher_number
                     where p.account between 2640 and 2649 and v.class <> 'vat_settlement'
                       and date_trunc('month', p.transaction_date)::date = m.month), 0)
         else
           coalesce((select value from vat_rows vr where vr.month = m.month and vr.row_key = 'utgaende_moms'), 0)
           - coalesce((select value from vat_rows vr where vr.month = m.month and vr.row_key = 'ingaende_moms'), 0)
         end as net_vat,
         case fortnox.setting('cashflow_vat_period', 'monthly')
           when 'quarterly' then (date_trunc('quarter', m.month) + interval '3 months' - interval '1 month')::date
           when 'yearly' then (select fy.to_date - (extract(day from fy.to_date)::integer - 1) from fortnox.financial_years fy where m.month between fy.from_date and fy.to_date limit 1)
           else m.month
         end as period_end_month
  from (select distinct month from months) m
  cross join today t
),
vat_settle as (
  select (period_end_month + (fortnox.setting('cashflow_vat_lag_months', '2')::integer) * interval '1 month')::date as pay_month,
         sum(net_vat) as net_vat
  from vat_month
  group by period_end_month
),
rows_out as (
  select s.financial_year_id, s.fy_from, s.fy_to, s.month, s.row_key, s.label, s.position, s.section, s.kind,
         s.income, s.vat_bearing, s.plan_enabled, s.month_kind,
         s.actual, s.forecast_invoiced, s.forecast_planned,
         case when s.row_key = 'moms_att_betala' and s.month_kind <> 'closed' then greatest(0, coalesce(vs.net_vat, 0)) else s.liability end as liability,
         s.plan, s.plan_overridden, s.plan_source,
         case when s.row_key = 'moms_att_betala' and s.month_kind <> 'closed'
              then s.actual + greatest(0, coalesce(vs.net_vat, 0) - s.actual)
              else s.value end as value
  from src_value s
  left join vat_settle vs on s.row_key = 'moms_att_betala' and vs.pay_month = s.month
  union all
  select financial_year_id, fy_from, fy_to, month, row_key, label, position, section, kind,
         income, vat_bearing, plan_enabled, month_kind,
         actual, forecast_invoiced, forecast_planned, liability, plan, plan_overridden, plan_source, value
  from vat_rows
)
select * from rows_out;

comment on view fortnox.v_cashflow is
  'One row per workbook row × month per financial year: actual, forecast_invoiced, forecast_planned, liability, plan, month_kind (closed | current | ahead) and value (what the page shows). Sum and cash rows: v_cash_position and the page.';

-- -----------------------------------------------------------------------------
-- v_cash_position — per financial year and month: the opening cash (Kassa årets ingång:
-- the manual override, else the cash accounts'' balance brought forward, else the previous
-- year''s balance carried forward), the month''s income and outflow totals as the workbook
-- sums them, the computed month-end cash, and the ledger''s own bank balance beside it.
-- -----------------------------------------------------------------------------
create view fortnox.v_cash_position with (security_invoker = true) as
with fy as (
  select fy.id, fy.from_date, fy.to_date,
         (select amount from fortnox.cashflow_plan_months pm where pm.row_key = 'kassa_arets_ingang' and pm.month = fy.from_date) as opening_override,
         coalesce((select sum(b.opening_balance) from fortnox.account_balances b where b.financial_year_id = fy.id and fortnox.is_cash_account(b.account)), 0) as opening_ib,
         (select coalesce(sum(b.closing_balance), 0) from fortnox.account_balances b
            join fortnox.financial_years prev on prev.id = b.financial_year_id and prev.to_date = fy.from_date - 1
           where fortnox.is_cash_account(b.account)) as previous_ub,
         exists (select 1 from fortnox.account_balances b where b.financial_year_id = fy.id) as has_balances
  from fortnox.financial_years fy
),
fy2 as (
  select fy.*,
         case when opening_ib <> 0 then opening_ib else coalesce(previous_ub, 0) end as opening_ledger,
         case when opening_ib <> 0 then 'ib' when previous_ub is not null and previous_ub <> 0 then 'previous_ub' else 'none' end as opening_ledger_source
  from fy
),
months as (
  select f.id as financial_year_id, f.from_date as fy_from, f.to_date as fy_to, m::date as month,
         (m + interval '1 month' - interval '1 day')::date as month_end
  from fy2 f
  cross join lateral generate_series(f.from_date, f.to_date, interval '1 month') as m
),
grid as (
  select month,
         sum(value) filter (where section = 'in') as income_total,
         sum(value) filter (where section in ('out', 'out2')) as outflow_total,
         sum(actual) filter (where section = 'in') as income_actual,
         sum(actual) filter (where section in ('out', 'out2')) as outflow_actual,
         min(month_kind) as month_kind
  from fortnox.v_cashflow
  group by month
),
bank as (
  select date_trunc('month', p.transaction_date)::date as month,
         sum(p.debit) as bank_in, sum(p.credit) as bank_out, sum(p.amount) as bank_net
  from fortnox.ledger_postings p
  where fortnox.is_cash_account(p.account)
  group by 1
)
select m.financial_year_id, m.fy_from, m.fy_to, m.month, m.month_end,
       g.month_kind,
       coalesce(f.opening_override, f.opening_ledger) as opening_cash,
       f.opening_override is not null as opening_overridden,
       f.opening_ledger,
       f.opening_ledger_source,
       coalesce(g.income_total, 0) as income_total,
       coalesce(g.outflow_total, 0) as outflow_total,
       coalesce(g.income_actual, 0) as income_actual,
       coalesce(g.outflow_actual, 0) as outflow_actual,
       coalesce(f.opening_override, f.opening_ledger)
         + sum(coalesce(g.income_total, 0) - coalesce(g.outflow_total, 0)) over (partition by m.financial_year_id order by m.month) as computed_end,
       coalesce(b.bank_in, 0) as ledger_bank_in,
       coalesce(b.bank_out, 0) as ledger_bank_out,
       f.opening_ledger + sum(coalesce(b.bank_net, 0)) over (partition by m.financial_year_id order by m.month) as ledger_bank_end,
       (select count(*) from fortnox.ledger_postings p where date_trunc('month', p.transaction_date)::date = m.month) > 0 as has_postings
from months m
join fy2 f on f.id = m.financial_year_id
left join grid g on g.month = m.month
left join bank b on b.month = m.month;

comment on view fortnox.v_cash_position is
  'Per fiscal year and month: opening cash (override → balance brought forward → previous year''s carried forward), the workbook''s income and outflow totals, the computed month-end cash, and the ledger''s bank balance beside it.';

-- -----------------------------------------------------------------------------
-- v_unmapped_accounts — accounts that carry bank-driven postings (or supplier-invoice
-- cost rows) no map rule covers, with their amounts. Listed on the page so nothing
-- silently vanishes; until mapped they sit on Övriga kostnader.
-- -----------------------------------------------------------------------------
create view fortnox.v_unmapped_accounts with (security_invoker = true) as
select account, description, sum(amount) as amount, count(*) as postings, min(first_date) as first_date, max(last_date) as last_date,
       array_agg(distinct source) as sources
from (
  select p.account, a.description, p.amount, p.transaction_date as first_date, p.transaction_date as last_date, 'verifikation'::text as source
  from fortnox.v_ledger_vouchers v
  join fortnox.ledger_postings p
    on p.financial_year_id = v.financial_year_id and p.voucher_series = v.voucher_series and p.voucher_number = v.voucher_number
  left join fortnox.accounts a on a.account = p.account
  where v.class = 'other' and not fortnox.is_cash_account(p.account) and fortnox.map_row(p.account, null, null) is null
  union all
  select s.account, a.description, s.total - s.vat, s.invoice_date, s.invoice_date, 'leverantörsfaktura'
  from fortnox.supplier_invoices s
  left join fortnox.suppliers sp on sp.supplier_number = s.supplier_number
  left join fortnox.accounts a on a.account = s.account
  where not s.cancelled and s.account is not null
    and fortnox.map_row(s.account, s.supplier_number, coalesce(sp.name, s.supplier_name)) is null
) u
group by account, description;

-- -----------------------------------------------------------------------------
-- v_cashflow_plan — the plan with who edited it (a name, not a uuid) for the Plan tab.
-- -----------------------------------------------------------------------------
create view fortnox.v_cashflow_plan with (security_invoker = true) as
select r.key as row_key, r.label, r.position, r.section, r.plan_enabled,
       pl.amount, pl.source, pl.basis, pl.updated_at,
       coalesce(nullif(trim(pr.full_name), ''), pr.email, pl.updated_by) as updated_by_name,
       (select coalesce(jsonb_agg(jsonb_build_object('month', pm.month, 'amount', pm.amount, 'note', pm.note, 'updated_at', pm.updated_at,
                 'updated_by_name', coalesce(nullif(trim(pr2.full_name), ''), pr2.email, pm.updated_by)) order by pm.month), '[]'::jsonb)
          from fortnox.cashflow_plan_months pm
          left join public.profiles pr2 on pr2.id::text = replace(pm.updated_by, 'admin:', '')
          where pm.row_key = r.key) as months
from fortnox.cashflow_rows r
left join fortnox.cashflow_plan pl on pl.row_key = r.key
left join public.profiles pr on pr.id::text = replace(pl.updated_by, 'admin:', '')
where r.plan_enabled or r.key = 'kassa_arets_ingang';

-- -----------------------------------------------------------------------------
-- prefill_cashflow_plan — the sync''s step: for every plan-enabled row, the average of the
-- last N closed months'' actuals, rounded to 100 kr, written only where no plan exists or
-- the plan is the sync''s own (source ledger). A manual plan is never touched.
-- -----------------------------------------------------------------------------
create or replace function fortnox.prefill_cashflow_plan(p_months integer default 3)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_first date := (date_trunc('month', current_date) - (p_months * interval '1 month'))::date;
  v_last date := (date_trunc('month', current_date) - interval '1 month')::date;
  v_written integer := 0;
  r record;
begin
  for r in
    select c.row_key, round(avg(c.actual) / 100) * 100 as amount, count(*) as months_seen
    from fortnox.v_cashflow c
    where c.plan_enabled and c.month_kind = 'closed' and c.month between v_first and v_last
    group by c.row_key
  loop
    if coalesce(r.amount, 0) = 0 then
      -- No history → no plan line (a 0 would only be noise); a stale ledger prefill goes too.
      delete from fortnox.cashflow_plan where row_key = r.row_key and source = 'ledger';
      continue;
    end if;
    insert into fortnox.cashflow_plan (row_key, amount, source, basis, updated_by, updated_at)
    values (r.row_key, r.amount, 'ledger',
            'från bokföringen: snitt ' || to_char(v_first, 'YYYY-MM') || '–' || to_char(v_last, 'YYYY-MM') || ' (' || p_months || ' stängda månader), avrundat till 100 kr',
            'sync', now())
    on conflict (row_key) do update
      set amount = excluded.amount, basis = excluded.basis, updated_by = excluded.updated_by, updated_at = now()
      where fortnox.cashflow_plan.source = 'ledger';
    v_written := v_written + 1;
  end loop;
  return v_written;
end;
$$;

revoke all on function fortnox.prefill_cashflow_plan(integer) from public;
revoke all on function fortnox.prefill_cashflow_plan(integer) from anon, authenticated;
grant execute on function fortnox.prefill_cashflow_plan(integer) to service_role;

-- -----------------------------------------------------------------------------
-- health grows the ledger picture (append-only, as before).
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
  (select count(*) > 0 from fortnox.settings where key = 'dev_fake_payments') as dev_fake_payments,
  -- round two
  (select supplier_invoices_read from last_run) as last_run_supplier_invoices_read,
  (select postings_read from last_run) as last_run_postings_read,
  (select ledger_synced_to from last_ok) as ledger_synced_to,
  (select count(*) from fortnox.suppliers where active) as suppliers_total,
  (select count(*) from fortnox.supplier_invoices where not cancelled) as supplier_invoices_total,
  (select count(*) from fortnox.supplier_invoices where not cancelled and balance <> 0) as supplier_invoices_open,
  (select count(*) from fortnox.supplier_invoices where not cancelled and balance <> 0
     and due_date is not null and due_date < current_date) as supplier_invoices_overdue,
  (select count(*) from fortnox.ledger_postings) as postings_total,
  (select min(transaction_date) from fortnox.ledger_postings) as postings_first_date,
  (select max(transaction_date) from fortnox.ledger_postings) as postings_last_date,
  (select value::timestamptz from fortnox.settings where key = 'ledger_synced_at') as ledger_synced_at,
  (select count(*) from fortnox.financial_years) as financial_years_total,
  (select count(*) > 0 from fortnox.settings where key = 'dev_fake_supplier_payments') as dev_fake_supplier_payments,
  (select max(updated_at) from fortnox.cashflow_plan where source = 'manual') as cashflow_plan_edited_at,
  fortnox.setting('cashflow_vat_period', 'monthly') as vat_period,
  fortnox.setting('cashflow_vat_lag_months', '2')::integer as vat_lag_months,
  fortnox.setting('cashflow_cash_accounts', '1900-1999') as cash_accounts,
  (select count(*) from fortnox.v_unmapped_accounts) as unmapped_accounts;

-- -----------------------------------------------------------------------------
-- Row level security: admins read, service_role does everything (the page''s edits go
-- through fortnox-sync with the admin''s session, and the function writes as service role).
-- -----------------------------------------------------------------------------
alter table fortnox.financial_years enable row level security;
alter table fortnox.accounts enable row level security;
alter table fortnox.account_balances enable row level security;
alter table fortnox.ledger_postings enable row level security;
alter table fortnox.suppliers enable row level security;
alter table fortnox.supplier_invoices enable row level security;
alter table fortnox.cashflow_rows enable row level security;
alter table fortnox.account_map enable row level security;
alter table fortnox.revenue_rules enable row level security;
alter table fortnox.cashflow_plan enable row level security;
alter table fortnox.cashflow_plan_months enable row level security;

create policy financial_years_admin_select on fortnox.financial_years for select to authenticated using (public.has_role(auth.uid(), 'admin'));
create policy accounts_admin_select on fortnox.accounts for select to authenticated using (public.has_role(auth.uid(), 'admin'));
create policy account_balances_admin_select on fortnox.account_balances for select to authenticated using (public.has_role(auth.uid(), 'admin'));
create policy ledger_postings_admin_select on fortnox.ledger_postings for select to authenticated using (public.has_role(auth.uid(), 'admin'));
create policy suppliers_admin_select on fortnox.suppliers for select to authenticated using (public.has_role(auth.uid(), 'admin'));
create policy supplier_invoices_admin_select on fortnox.supplier_invoices for select to authenticated using (public.has_role(auth.uid(), 'admin'));
create policy cashflow_rows_admin_select on fortnox.cashflow_rows for select to authenticated using (public.has_role(auth.uid(), 'admin'));
create policy account_map_admin_select on fortnox.account_map for select to authenticated using (public.has_role(auth.uid(), 'admin'));
create policy revenue_rules_admin_select on fortnox.revenue_rules for select to authenticated using (public.has_role(auth.uid(), 'admin'));
create policy cashflow_plan_admin_select on fortnox.cashflow_plan for select to authenticated using (public.has_role(auth.uid(), 'admin'));
create policy cashflow_plan_months_admin_select on fortnox.cashflow_plan_months for select to authenticated using (public.has_role(auth.uid(), 'admin'));

grant select on fortnox.financial_years, fortnox.accounts, fortnox.account_balances, fortnox.ledger_postings,
  fortnox.suppliers, fortnox.supplier_invoices, fortnox.cashflow_rows, fortnox.account_map, fortnox.revenue_rules,
  fortnox.cashflow_plan, fortnox.cashflow_plan_months to authenticated;
grant select on fortnox.v_ledger_vouchers, fortnox.v_cashflow_items, fortnox.v_cashflow, fortnox.v_cash_position,
  fortnox.v_unmapped_accounts, fortnox.v_cashflow_plan to authenticated;
-- The default privileges from round zero give service_role everything on new tables and sequences.
grant all on fortnox.financial_years, fortnox.accounts, fortnox.account_balances, fortnox.ledger_postings,
  fortnox.suppliers, fortnox.supplier_invoices, fortnox.cashflow_rows, fortnox.account_map, fortnox.revenue_rules,
  fortnox.cashflow_plan, fortnox.cashflow_plan_months to service_role;
