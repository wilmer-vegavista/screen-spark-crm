alter table public.orders
  add column if not exists commission_upfront boolean not null default false;

comment on column public.orders.commission_upfront is
  'Ordern visas som månadsfakturerad utåt (skärmägarrapporter) men faktureras i sin helhet direkt; säljaren får hela provisionen direkt.';
