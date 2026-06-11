
-- 1. order_splits table
CREATE TABLE IF NOT EXISTS public.order_splits (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id uuid NOT NULL REFERENCES public.orders(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  share_pct numeric(5,2) NOT NULL CHECK (share_pct >= 0 AND share_pct <= 100),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (order_id, user_id)
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.order_splits TO authenticated;
GRANT ALL ON public.order_splits TO service_role;

ALTER TABLE public.order_splits ENABLE ROW LEVEL SECURITY;

-- Helper: can current user manage this order?
CREATE OR REPLACE FUNCTION public.can_manage_order(_order_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.orders o
    WHERE o.id = _order_id
      AND (o.owner_id = auth.uid() OR o.created_by = auth.uid() OR public.has_role(auth.uid(), 'admin'))
  )
$$;

CREATE POLICY "order_splits_select"
  ON public.order_splits FOR SELECT TO authenticated
  USING (
    user_id = auth.uid()
    OR public.can_manage_order(order_id)
  );

CREATE POLICY "order_splits_insert"
  ON public.order_splits FOR INSERT TO authenticated
  WITH CHECK (public.can_manage_order(order_id));

CREATE POLICY "order_splits_update"
  ON public.order_splits FOR UPDATE TO authenticated
  USING (public.can_manage_order(order_id))
  WITH CHECK (public.can_manage_order(order_id));

CREATE POLICY "order_splits_delete"
  ON public.order_splits FOR DELETE TO authenticated
  USING (public.can_manage_order(order_id));

-- 2. Relax orders RLS: any authenticated user can create/update assigning to any seller
DROP POLICY IF EXISTS "orders_insert_self" ON public.orders;
CREATE POLICY "orders_insert_self"
  ON public.orders FOR INSERT TO authenticated
  WITH CHECK (created_by = auth.uid() OR public.has_role(auth.uid(), 'admin'));

DROP POLICY IF EXISTS "orders_update_owner_or_admin" ON public.orders;
CREATE POLICY "orders_update_owner_or_admin"
  ON public.orders FOR UPDATE TO authenticated
  USING (owner_id = auth.uid() OR created_by = auth.uid() OR public.has_role(auth.uid(), 'admin'))
  WITH CHECK (owner_id = auth.uid() OR created_by = auth.uid() OR public.has_role(auth.uid(), 'admin'));

-- 3. Include split partners in SELECT
DROP POLICY IF EXISTS "orders_select_owner_or_admin" ON public.orders;
CREATE POLICY "orders_select_owner_or_admin"
  ON public.orders FOR SELECT TO authenticated
  USING (
    owner_id = auth.uid()
    OR created_by = auth.uid()
    OR public.has_role(auth.uid(), 'admin')
    OR EXISTS (
      SELECT 1 FROM public.order_splits s
      WHERE s.order_id = orders.id AND s.user_id = auth.uid()
    )
  );
