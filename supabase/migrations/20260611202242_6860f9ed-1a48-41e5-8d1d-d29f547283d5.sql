
CREATE TYPE order_type AS ENUM ('offert', 'bokning');

CREATE TABLE public.orders (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_type order_type NOT NULL DEFAULT 'offert',
  status text NOT NULL DEFAULT 'utkast',
  customer_id uuid REFERENCES public.customers(id) ON DELETE SET NULL,
  -- inline customer / billing
  company_name text NOT NULL,
  org_number text,
  vat_number text,
  billing_address text,
  postal_code text,
  city text,
  -- contact
  contact_name text,
  contact_email text,
  contact_phone text,
  -- totals
  total_excl_vat numeric(12,2) NOT NULL DEFAULT 0,
  total_commission numeric(12,2) NOT NULL DEFAULT 0,
  -- meta
  notes text,
  deal_id uuid REFERENCES public.deals(id) ON DELETE SET NULL,
  owner_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE public.order_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id uuid NOT NULL REFERENCES public.orders(id) ON DELETE CASCADE,
  product_id uuid REFERENCES public.products(id) ON DELETE SET NULL,
  product_name text NOT NULL,
  sov_pct numeric(5,2),
  impressions bigint,
  weeks integer NOT NULL DEFAULT 1,
  unit_price numeric(12,2) NOT NULL DEFAULT 0,
  commission_pct numeric(5,2) NOT NULL DEFAULT 0,
  commission_amount numeric(12,2) NOT NULL DEFAULT 0,
  position integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.orders TO authenticated;
GRANT ALL ON public.orders TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.order_items TO authenticated;
GRANT ALL ON public.order_items TO service_role;

ALTER TABLE public.orders ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.order_items ENABLE ROW LEVEL SECURITY;

CREATE POLICY "orders_select_owner_or_admin" ON public.orders FOR SELECT TO authenticated
  USING (owner_id = auth.uid() OR created_by = auth.uid() OR has_role(auth.uid(), 'admin'::app_role));
CREATE POLICY "orders_insert_self" ON public.orders FOR INSERT TO authenticated
  WITH CHECK ((owner_id IS NULL OR owner_id = auth.uid() OR has_role(auth.uid(), 'admin'::app_role))
              AND (created_by IS NULL OR created_by = auth.uid()));
CREATE POLICY "orders_update_owner_or_admin" ON public.orders FOR UPDATE TO authenticated
  USING (owner_id = auth.uid() OR created_by = auth.uid() OR has_role(auth.uid(), 'admin'::app_role))
  WITH CHECK (owner_id = auth.uid() OR created_by = auth.uid() OR has_role(auth.uid(), 'admin'::app_role));
CREATE POLICY "orders_delete_owner_or_admin" ON public.orders FOR DELETE TO authenticated
  USING (owner_id = auth.uid() OR created_by = auth.uid() OR has_role(auth.uid(), 'admin'::app_role));

CREATE POLICY "order_items_select_via_order" ON public.order_items FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.orders o WHERE o.id = order_items.order_id
    AND (o.owner_id = auth.uid() OR o.created_by = auth.uid() OR has_role(auth.uid(), 'admin'::app_role))));
CREATE POLICY "order_items_insert_via_order" ON public.order_items FOR INSERT TO authenticated
  WITH CHECK (EXISTS (SELECT 1 FROM public.orders o WHERE o.id = order_items.order_id
    AND (o.owner_id = auth.uid() OR o.created_by = auth.uid() OR has_role(auth.uid(), 'admin'::app_role))));
CREATE POLICY "order_items_update_via_order" ON public.order_items FOR UPDATE TO authenticated
  USING (EXISTS (SELECT 1 FROM public.orders o WHERE o.id = order_items.order_id
    AND (o.owner_id = auth.uid() OR o.created_by = auth.uid() OR has_role(auth.uid(), 'admin'::app_role))))
  WITH CHECK (EXISTS (SELECT 1 FROM public.orders o WHERE o.id = order_items.order_id
    AND (o.owner_id = auth.uid() OR o.created_by = auth.uid() OR has_role(auth.uid(), 'admin'::app_role))));
CREATE POLICY "order_items_delete_via_order" ON public.order_items FOR DELETE TO authenticated
  USING (EXISTS (SELECT 1 FROM public.orders o WHERE o.id = order_items.order_id
    AND (o.owner_id = auth.uid() OR o.created_by = auth.uid() OR has_role(auth.uid(), 'admin'::app_role))));

CREATE TRIGGER orders_set_updated_at BEFORE UPDATE ON public.orders
  FOR EACH ROW EXECUTE FUNCTION public.tg_set_updated_at();

CREATE INDEX idx_orders_owner ON public.orders(owner_id);
CREATE INDEX idx_order_items_order ON public.order_items(order_id);
