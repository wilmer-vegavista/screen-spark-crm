CREATE OR REPLACE FUNCTION public.my_order_commissions()
RETURNS TABLE (order_id uuid, total_commission numeric)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT o.id, o.total_commission
  FROM public.orders o
  WHERE public.can_manage_order(o.id)
$$;

REVOKE EXECUTE ON FUNCTION public.my_order_commissions() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.my_order_commissions() TO authenticated;