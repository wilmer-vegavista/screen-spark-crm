-- =============================================================================
-- Fortnox integration, round two (Erik) — two corrections to the cash-flow views.
-- Round one of the review found both on a fresh pglite database; both are money on
-- the page, so both are fixed here rather than noted.
--
-- 1. Arbetsgivaravgifter & skatt was counted twice in the current month. A payroll
--    voucher's 27xx credits become next month's liability; when that next month is the
--    current one and Bron has already paid on the 12th, the same money is also an actual
--    from the payment voucher's bank leg, and the current month's value added the two
--    (89 673,20 + 89 673,20 = 179 346,40 where 89 673,20 left the bank). Moms att betala
--    already carries this guard in v_cashflow (`actual + greatest(0, owed − actual)`).
--    The guard is put here on the liability ITEM instead of on the row, because the page's
--    hover lists a cell's makeup from v_cashflow_items — with the guard on the row the cell
--    would say 89 673 and its hover would still add up to 179 346. Same arithmetic
--    (`actual + greatest(0, booked − actual)` ≡ `actual + the liability that is left`),
--    one place, so the cell and its makeup agree. A month with several payroll runs
--    consumes them in date order, so the remainder is `greatest(0, booked − paid)`
--    however many vouchers there are.
--
-- 2. A non-cash leg of a customer receipt or a supplier payment was dropped. Only vouchers
--    classed `other` had their legs read, on the assumption that a receipt or a payment is
--    fully covered by the invoice tables — but only its receivable / payable leg is. An
--    öresavrundning, a bank charge, a cash discount (ordinary on a Swedish receipt) fell out
--    of the grid, and when it sat on an account no rule covers it was not even listed, which
--    is the order's §3 verbatim. Those legs now go through the account map exactly like an
--    ordinary voucher's, and appear in v_unmapped_accounts on the same terms; the one leg
--    the invoice table already carries (1500–1599 on a receipt, 2440–2449 on a payment) and
--    the bank legs stay out, so nothing is counted twice.
--
-- Everything else in the two views is 20260909120100 unchanged. New file rather than an
-- edit of that one: it is already applied on the dev project, and an edited migration is
-- never re-run.
-- =============================================================================

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
-- Every leg of a bank voucher the invoice tables do not already carry, through the map.
-- `other`: every non-cash leg. A customer receipt or a supplier payment: every non-cash leg
-- EXCEPT the receivable / payable one, which is what fortnox.invoices and
-- fortnox.supplier_invoices already place on their pay date (fix 2).
bank_other as (
  select 'actual'::text as bucket, 'posting'::text as source,
         v.voucher_series || ' ' || v.voucher_number || '/' || v.financial_year_id || ':' || p.row_no as ref,
         date_trunc('month', p.transaction_date)::date as month, p.transaction_date as date,
         coalesce(ac.row_key, 'ovriga_kostnader') as row_key,
         case when r.income then -p.amount else p.amount end as amount,
         'Verifikation ' || v.voucher_series || ' ' || v.voucher_number || ' · konto ' || p.account
           || coalesce(' ' || a.description, '') || ' · ' || coalesce(v.description, '')
           || case v.class
                when 'customer_receipt' then ' · extra rad på en kundinbetalning'
                when 'supplier_payment' then ' · extra rad på en leverantörsbetalning'
                else '' end
           || case when ac.row_key is null then ' · okopplat konto' else '' end as label
  from vouchers v
  join fortnox.ledger_postings p
    on p.financial_year_id = v.financial_year_id and p.voucher_series = v.voucher_series and p.voucher_number = v.voucher_number
  left join acct ac on ac.account = p.account
  left join fortnox.accounts a on a.account = p.account
  left join fortnox.cashflow_rows r on r.key = coalesce(ac.row_key, 'ovriga_kostnader')
  where (
      v.class = 'other'
      or (v.class = 'customer_receipt' and p.account not between 1500 and 1599)
      or (v.class = 'supplier_payment' and p.account not between 2440 and 2449)
    )
    and not exists (select 1 from ranges rg where p.account between rg.lo and rg.hi)
),
-- The 27xx booked on a payroll voucher: paid the month after, by the 12th (fix 1).
ag_raw as (
  select v.financial_year_id, v.voucher_series, v.voucher_number, v.transaction_date,
         (date_trunc('month', v.transaction_date) + interval '1 month')::date as month,
         sum(p.credit - p.debit) as booked
  from vouchers v
  join fortnox.ledger_postings p
    on p.financial_year_id = v.financial_year_id and p.voucher_series = v.voucher_series and p.voucher_number = v.voucher_number
  where v.class in ('payroll', 'none') and p.account between 2700 and 2799
    and (date_trunc('month', v.transaction_date) + interval '1 month')::date >= (select month0 from today)
  group by v.financial_year_id, v.voucher_series, v.voucher_number, v.transaction_date
  having sum(p.credit - p.debit) > 0
),
-- what has already left the bank on the row that month: the tax payment itself, any bank
-- leg the map sends to the row, a supplier invoice on it
ag_paid as (
  select month, sum(amount) as paid
  from (
    select month, amount from bank_special where row_key = 'ag_skatt'
    union all select month, amount from bank_other where row_key = 'ag_skatt'
    union all select month, amount from sup_paid where row_key = 'ag_skatt'
  ) x
  group by month
),
-- the payment consumes the month's booked liabilities in date order; what is left is what
-- the row still has to pay
ag_net as (
  select r.*,
         greatest(0, r.booked - greatest(0, coalesce(ap.paid, 0) - coalesce(
           sum(r.booked) over (partition by r.month
                               order by r.transaction_date, r.voucher_series, r.voucher_number
                               rows between unbounded preceding and 1 preceding), 0))) as amount
  from ag_raw r
  left join ag_paid ap on ap.month = r.month
),
ag_liability as (
  select 'liability'::text as bucket, 'posting'::text as source,
         voucher_series || ' ' || voucher_number || '/' || financial_year_id as ref,
         month,
         (month + interval '11 days')::date as date,
         'ag_skatt'::text as row_key,
         amount,
         'Skatt och avgifter bokade ' || to_char(transaction_date, 'YYYY-MM') || ' (verifikation ' || voucher_series || ' ' || voucher_number || '), betalas månaden efter'
           || case when amount < booked then ' · minus ' || trim(to_char(booked - amount, '999999990.00')) || ' kr som redan betalats denna månad' else '' end as label
  from ag_net
  where amount > 0
)
select * from inv_paid
union all select * from inv_open
union all select * from planned
union all select * from sup_paid
union all select * from sup_open
union all select * from bank_special
union all select * from bank_other
union all select * from ag_liability;

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
  where (
      v.class = 'other'
      or (v.class = 'customer_receipt' and p.account not between 1500 and 1599)
      or (v.class = 'supplier_payment' and p.account not between 2440 and 2449)
    )
    and ac.row_key is null
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
