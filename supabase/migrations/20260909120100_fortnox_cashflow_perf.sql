-- =============================================================================
-- Fortnox integration, round two (Erik) — the cash-flow views, set-based.
--
-- 20260909120000 defined v_ledger_vouchers, v_cashflow_items, v_cashflow, v_cash_position and
-- v_unmapped_accounts with fortnox.is_cash_account() and fortnox.map_row() evaluated per
-- posting and the VAT-per-month step re-classifying every voucher per month. On the dev
-- project's 1 290 postings that ran past PostgREST's statement timeout (the page reads with
-- the admin's session). Same columns, same rules, same results: the cash-account ranges are
-- read once, the account map is resolved once per distinct account (and once per supplier
-- invoice), the voucher classification is computed once per query, and the VAT sums are one
-- pass over the postings. The dev project ran the first shape; this file brings both
-- projects to the same definitions.
-- =============================================================================

create or replace view fortnox.v_ledger_vouchers with (security_invoker = true) as
with ranges as materialized (
  select lo, hi from fortnox.cash_account_ranges()
), legs as (
  select p.financial_year_id, p.voucher_series, p.voucher_number, p.transaction_date, p.description,
         p.account, p.amount, p.debit, p.credit,
         exists (select 1 from ranges r where p.account between r.lo and r.hi) as is_cash
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

create or replace view fortnox.v_cashflow_items with (security_invoker = true) as
with today as (
  select date_trunc('month', current_date)::date as month0
),
ranges as materialized (
  select lo, hi from fortnox.cash_account_ranges()
),
vouchers as materialized (
  select * from fortnox.v_ledger_vouchers
),
-- the account map resolved once per distinct account that carries a posting
acct as materialized (
  select a.account, fortnox.map_row(a.account, null, null) as row_key
  from (select distinct account from fortnox.ledger_postings) a
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
planned_src as materialized (
  select * from fortnox.planned_instalments()
),
planned as (
  select 'forecast_planned'::text as bucket, 'order'::text as source, order_id::text || ':' || n as ref,
         greatest(date_trunc('month', planned_due_date)::date, (select month0 from today)) as month,
         planned_due_date as date,
         fortnox.revenue_row(seller, null, project_code, screen_type, billing_frequency) as row_key,
         amount,
         company_name || ' · planerad delfaktura ' || n || '/' || count || ' · fakturadatum ' || planned_invoice_date::text
           || ' · förfaller ' || planned_due_date::text as label
  from planned_src
  union all
  select 'forecast_planned', 'order', order_id::text || ':' || n,
         greatest(date_trunc('month', planned_due_date)::date, (select month0 from today)),
         planned_due_date, 'utgaende_moms', vat,
         company_name || ' · moms på planerad delfaktura ' || n || '/' || count
  from planned_src where vat <> 0
),
sup as (
  select s.*,
         coalesce(m.row_key, 'ovriga_kostnader') as row_key,
         m.row_key is null as unmapped,
         coalesce(sp.name, s.supplier_name, 'Leverantör ' || s.supplier_number) as name
  from fortnox.supplier_invoices s
  left join fortnox.suppliers sp on sp.supplier_number = s.supplier_number
  cross join lateral (select fortnox.map_row(s.account, s.supplier_number, coalesce(sp.name, s.supplier_name)) as row_key) m
  where not s.cancelled
),
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
bank_special as (
  select 'actual'::text as bucket, 'posting'::text as source,
         voucher_series || ' ' || voucher_number || '/' || financial_year_id as ref,
         date_trunc('month', transaction_date)::date as month, transaction_date as date,
         case class when 'payroll' then 'loner' when 'tax_payment' then 'ag_skatt' else 'moms_att_betala' end as row_key,
         -cash_net as amount,
         'Verifikation ' || voucher_series || ' ' || voucher_number || ' · ' || coalesce(description, '') || ' · '
           || case class when 'payroll' then 'lönekörning (nettolön via bank)' when 'tax_payment' then 'skattebetalning' else 'momsavstämning' end as label
  from vouchers
  where class in ('payroll', 'tax_payment', 'vat_settlement')
),
bank_other as (
  select 'actual'::text as bucket, 'posting'::text as source,
         v.voucher_series || ' ' || v.voucher_number || '/' || v.financial_year_id || ':' || p.row_no as ref,
         date_trunc('month', p.transaction_date)::date as month, p.transaction_date as date,
         coalesce(ac.row_key, 'ovriga_kostnader') as row_key,
         case when r.income then -p.amount else p.amount end as amount,
         'Verifikation ' || v.voucher_series || ' ' || v.voucher_number || ' · konto ' || p.account
           || coalesce(' ' || a.description, '') || ' · ' || coalesce(v.description, '')
           || case when ac.row_key is null then ' · okopplat konto' else '' end as label
  from vouchers v
  join fortnox.ledger_postings p
    on p.financial_year_id = v.financial_year_id and p.voucher_series = v.voucher_series and p.voucher_number = v.voucher_number
  left join acct ac on ac.account = p.account
  left join fortnox.accounts a on a.account = p.account
  left join fortnox.cashflow_rows r on r.key = coalesce(ac.row_key, 'ovriga_kostnader')
  where v.class = 'other' and not exists (select 1 from ranges rg where p.account between rg.lo and rg.hi)
),
ag_liability as (
  select 'liability'::text as bucket, 'posting'::text as source,
         v.voucher_series || ' ' || v.voucher_number || '/' || v.financial_year_id as ref,
         (date_trunc('month', v.transaction_date) + interval '1 month')::date as month,
         (date_trunc('month', v.transaction_date) + interval '1 month' + interval '11 days')::date as date,
         'ag_skatt'::text as row_key,
         sum(p.credit - p.debit) as amount,
         'Skatt och avgifter bokade ' || to_char(v.transaction_date, 'YYYY-MM') || ' (verifikation ' || v.voucher_series || ' ' || v.voucher_number || '), betalas månaden efter' as label
  from vouchers v
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

create or replace view fortnox.v_cashflow with (security_invoker = true) as
with today as (
  select date_trunc('month', current_date)::date as month0
),
months as (
  select fy.id as financial_year_id, fy.from_date as fy_from, fy.to_date as fy_to, m::date as month
  from fortnox.financial_years fy
  cross join lateral generate_series(fy.from_date, fy.to_date, interval '1 month') as m
),
agg as materialized (
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
src_value as materialized (
  select s.*,
    case s.month_kind
      when 'closed' then s.actual
      when 'current' then s.actual + s.forecast_invoiced + s.forecast_planned + s.liability
                          + greatest(0, coalesce(s.plan, 0) - (s.actual + s.forecast_invoiced + s.forecast_planned + s.liability))
      else greatest(coalesce(s.plan, 0), s.forecast_invoiced + s.forecast_planned + s.liability)
    end as value
  from src s
),
vat_rows as materialized (
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
-- net VAT per month from the postings (26xx, settlements left out), one pass
vat_postings as materialized (
  select date_trunc('month', p.transaction_date)::date as month,
         sum(case when p.account between 2610 and 2639 then p.credit - p.debit else 0 end)
           - sum(case when p.account between 2640 and 2649 then p.debit - p.credit else 0 end) as net_vat
  from fortnox.ledger_postings p
  join fortnox.v_ledger_vouchers v
    on v.financial_year_id = p.financial_year_id and v.voucher_series = p.voucher_series and v.voucher_number = p.voucher_number
  where p.account between 2610 and 2649 and v.class <> 'vat_settlement'
  group by 1
),
vat_month as (
  select m.month,
         case when m.month <= t.month0 then coalesce(vp.net_vat, 0)
              else coalesce(vo.value, 0) - coalesce(vi.value, 0) end as net_vat,
         case fortnox.setting('cashflow_vat_period', 'monthly')
           when 'quarterly' then (date_trunc('quarter', m.month) + interval '3 months' - interval '1 month')::date
           when 'yearly' then (select fy.to_date - (extract(day from fy.to_date)::integer - 1) from fortnox.financial_years fy where m.month between fy.from_date and fy.to_date limit 1)
           else m.month
         end as period_end_month
  from (select distinct month from months) m
  cross join today t
  left join vat_postings vp on vp.month = m.month
  left join vat_rows vo on vo.month = m.month and vo.row_key = 'utgaende_moms'
  left join vat_rows vi on vi.month = m.month and vi.row_key = 'ingaende_moms'
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

create or replace view fortnox.v_cash_position with (security_invoker = true) as
with ranges as materialized (
  select lo, hi from fortnox.cash_account_ranges()
),
cash_balances as (
  select b.financial_year_id, sum(b.opening_balance) as opening, sum(b.closing_balance) as closing
  from fortnox.account_balances b
  where exists (select 1 from ranges r where b.account between r.lo and r.hi)
  group by b.financial_year_id
),
fy as (
  select fy.id, fy.from_date, fy.to_date,
         (select amount from fortnox.cashflow_plan_months pm where pm.row_key = 'kassa_arets_ingang' and pm.month = fy.from_date) as opening_override,
         coalesce(cb.opening, 0) as opening_ib,
         (select cbp.closing from cash_balances cbp join fortnox.financial_years prev on prev.id = cbp.financial_year_id and prev.to_date = fy.from_date - 1) as previous_ub
  from fortnox.financial_years fy
  left join cash_balances cb on cb.financial_year_id = fy.id
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
grid as materialized (
  select month,
         sum(value) filter (where section = 'in') as income_total,
         sum(value) filter (where section in ('out', 'out2')) as outflow_total,
         sum(actual) filter (where section = 'in') as income_actual,
         sum(actual) filter (where section in ('out', 'out2')) as outflow_actual,
         min(month_kind) as month_kind
  from fortnox.v_cashflow
  group by month
),
bank as materialized (
  select date_trunc('month', p.transaction_date)::date as month,
         sum(p.debit) filter (where is_cash) as bank_in,
         sum(p.credit) filter (where is_cash) as bank_out,
         sum(p.amount) filter (where is_cash) as bank_net,
         count(*) as postings
  from (select p.*, exists (select 1 from ranges r where p.account between r.lo and r.hi) as is_cash from fortnox.ledger_postings p) p
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
       coalesce(b.postings, 0) > 0 as has_postings
from months m
join fy2 f on f.id = m.financial_year_id
left join grid g on g.month = m.month
left join bank b on b.month = m.month;

create or replace view fortnox.v_unmapped_accounts with (security_invoker = true) as
with ranges as materialized (
  select lo, hi from fortnox.cash_account_ranges()
),
acct as materialized (
  select a.account, fortnox.map_row(a.account, null, null) as row_key
  from (select distinct account from fortnox.ledger_postings) a
)
select account, description, sum(amount) as amount, count(*) as postings, min(first_date) as first_date, max(last_date) as last_date,
       array_agg(distinct source) as sources
from (
  select p.account, a.description, p.amount, p.transaction_date as first_date, p.transaction_date as last_date, 'verifikation'::text as source
  from fortnox.v_ledger_vouchers v
  join fortnox.ledger_postings p
    on p.financial_year_id = v.financial_year_id and p.voucher_series = v.voucher_series and p.voucher_number = v.voucher_number
  join acct ac on ac.account = p.account
  left join fortnox.accounts a on a.account = p.account
  where v.class = 'other' and ac.row_key is null
    and not exists (select 1 from ranges r where p.account between r.lo and r.hi)
  union all
  select s.account, a.description, s.total - s.vat, s.invoice_date, s.invoice_date, 'leverantörsfaktura'
  from fortnox.supplier_invoices s
  left join fortnox.suppliers sp on sp.supplier_number = s.supplier_number
  left join fortnox.accounts a on a.account = s.account
  where not s.cancelled and s.account is not null
    and fortnox.map_row(s.account, s.supplier_number, coalesce(sp.name, s.supplier_name)) is null
) u
group by account, description;
