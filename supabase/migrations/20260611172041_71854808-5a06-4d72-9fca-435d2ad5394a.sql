
-- Products with default commission
CREATE TABLE public.products (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  description text,
  default_commission_pct numeric(5,2) NOT NULL DEFAULT 0,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.products TO authenticated;
GRANT ALL ON public.products TO service_role;
ALTER TABLE public.products ENABLE ROW LEVEL SECURITY;
CREATE POLICY "products_select_all_auth" ON public.products FOR SELECT TO authenticated USING (true);
CREATE POLICY "products_admin_write" ON public.products FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));
CREATE TRIGGER products_set_updated_at BEFORE UPDATE ON public.products FOR EACH ROW EXECUTE FUNCTION public.tg_set_updated_at();

-- Per-seller compensation
CREATE TABLE public.seller_compensation (
  user_id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  base_salary numeric(12,2) NOT NULL DEFAULT 0,
  default_commission_pct numeric(5,2) NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.seller_compensation TO authenticated;
GRANT ALL ON public.seller_compensation TO service_role;
ALTER TABLE public.seller_compensation ENABLE ROW LEVEL SECURITY;
-- Sellers see their own row; admins see all
CREATE POLICY "comp_select_self_or_admin" ON public.seller_compensation FOR SELECT TO authenticated
  USING (user_id = auth.uid() OR public.has_role(auth.uid(), 'admin'));
CREATE POLICY "comp_admin_write" ON public.seller_compensation FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));
CREATE TRIGGER comp_set_updated_at BEFORE UPDATE ON public.seller_compensation FOR EACH ROW EXECUTE FUNCTION public.tg_set_updated_at();

-- Link deals to product + optional commission override + won_at
ALTER TABLE public.deals
  ADD COLUMN product_id uuid REFERENCES public.products(id) ON DELETE SET NULL,
  ADD COLUMN commission_pct_override numeric(5,2),
  ADD COLUMN won_at timestamptz;

-- Auto-set won_at when stage becomes 'vunnen'
CREATE OR REPLACE FUNCTION public.tg_deals_set_won_at()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.stage = 'vunnen' AND (OLD.stage IS DISTINCT FROM 'vunnen') AND NEW.won_at IS NULL THEN
    NEW.won_at = now();
  END IF;
  IF NEW.stage <> 'vunnen' THEN
    NEW.won_at = NULL;
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER deals_set_won_at BEFORE INSERT OR UPDATE ON public.deals
  FOR EACH ROW EXECUTE FUNCTION public.tg_deals_set_won_at();
