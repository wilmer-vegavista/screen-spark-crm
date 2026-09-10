-- Expose only the compensation *type* (not salary amounts) for any seller,
-- so the order dialog can pick the correct commission rate for the order's
-- owner even when someone else (e.g. an admin) creates or edits the order.
create or replace function public.get_compensation_type(_user_id uuid)
returns text
language sql
stable
security definer
set search_path = public
as $$
  select compensation_type
  from public.seller_compensation
  where user_id = _user_id
$$;

revoke all on function public.get_compensation_type(uuid) from public, anon;
grant execute on function public.get_compensation_type(uuid) to authenticated;
