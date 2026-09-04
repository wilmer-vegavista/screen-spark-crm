-- Skärmägarportal: externa skärmägare får konton som bara kan se försäljning på sina egna skärmar.

-- 1) Koppling auth-användare -> skärmägare (products.owner_name)
create table if not exists public.screen_owners (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null unique references auth.users(id) on delete cascade,
  owner_name text not null,
  created_at timestamptz not null default now()
);

alter table public.screen_owners enable row level security;

create or replace function public.is_screen_owner(_user_id uuid)
returns boolean
language sql stable security definer
set search_path to 'public'
as $$
  select exists (select 1 from public.screen_owners where user_id = _user_id)
$$;

create or replace function public.get_screen_owner_name(_user_id uuid)
returns text
language sql stable security definer
set search_path to 'public'
as $$
  select owner_name from public.screen_owners where user_id = _user_id limit 1
$$;

create policy screen_owners_select_own on public.screen_owners
  for select to authenticated
  using (user_id = auth.uid() or has_role(auth.uid(), 'admin'::app_role));

create policy screen_owners_admin_manage on public.screen_owners
  for all to authenticated
  using (has_role(auth.uid(), 'admin'::app_role))
  with check (has_role(auth.uid(), 'admin'::app_role));

-- 2) Spärra all CRM-data för skärmägarkonton (restriktiva policies AND:as med befintliga)
do $$
declare t text;
begin
  foreach t in array array[
    'customers','deals','activities','campaigns','materials','seller_compensation',
    'product_packages','seller_credentials','orders','order_items','company_settings',
    'seller_monthly_budgets','package_products','order_splits','order_materials',
    'leads','fortnox_tokens','customer_comments','user_roles'
  ] loop
    execute format(
      'create policy %I on public.%I as restrictive for all to authenticated using (not public.is_screen_owner(auth.uid())) with check (not public.is_screen_owner(auth.uid()))',
      t || '_block_screen_owners', t
    );
  end loop;
end $$;

-- Skärmägare ser bara sina egna skärmar bland produkterna
create policy products_screen_owner_scope on public.products
  as restrictive for select to authenticated
  using (
    not public.is_screen_owner(auth.uid())
    or owner_name = public.get_screen_owner_name(auth.uid())
  );

-- ...och bara sin egen profil
create policy profiles_screen_owner_scope on public.profiles
  as restrictive for select to authenticated
  using (not public.is_screen_owner(auth.uid()) or id = auth.uid());

-- 3) RPC: allt portalen behöver, filtrerat till inloggad skärmägares skärmar.
-- Security definer eftersom orders/order_items är helt spärrade för skärmägare via RLS.
create or replace function public.get_screen_owner_report()
returns jsonb
language sql stable security definer
set search_path to 'public'
as $$
  with me as (
    select owner_name from public.screen_owners where user_id = auth.uid()
  ),
  my_products as (
    select p.id, p.name, p.city, p.address, p.image_url, p.revenue_share_pct, p.live_date, p.active
    from public.products p
    join me on p.owner_name = me.owner_name
  ),
  my_items as (
    select oi.order_id, oi.product_id, oi.product_name, oi.unit_price, oi.weeks,
           oi.sov_pct, oi.impressions, oi.period_unit
    from public.order_items oi
    where oi.product_id in (select id from my_products)
  ),
  my_orders as (
    select o.id, o.company_name, o.invoice_start_date, o.created_at, o.status,
           o.billing_frequency, o.billing_duration_months, o.selected_weeks, o.exact_dates
    from public.orders o
    where o.id in (select order_id from my_items)
  )
  select case when not exists (select 1 from me) then null else jsonb_build_object(
    'owner_name', (select owner_name from me),
    'products', coalesce((select jsonb_agg(to_jsonb(p) order by p.name) from my_products p), '[]'::jsonb),
    'items', coalesce((select jsonb_agg(to_jsonb(i)) from my_items i), '[]'::jsonb),
    'orders', coalesce((select jsonb_agg(to_jsonb(o)) from my_orders o), '[]'::jsonb)
  ) end
$$;
