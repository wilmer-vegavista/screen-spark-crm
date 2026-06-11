
CREATE TABLE public.product_packages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id uuid REFERENCES public.products(id) ON DELETE CASCADE,
  name text NOT NULL,
  description text,
  sov_pct numeric(5,2),
  price numeric(12,2) NOT NULL DEFAULT 0,
  weeks integer,
  impressions bigint,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.product_packages TO authenticated;
GRANT ALL ON public.product_packages TO service_role;
ALTER TABLE public.product_packages ENABLE ROW LEVEL SECURITY;
CREATE POLICY "packages_select_all_auth" ON public.product_packages FOR SELECT TO authenticated USING (true);
CREATE POLICY "packages_admin_write" ON public.product_packages FOR ALL TO authenticated USING (public.has_role(auth.uid(), 'admin')) WITH CHECK (public.has_role(auth.uid(), 'admin'));
CREATE TRIGGER packages_set_updated_at BEFORE UPDATE ON public.product_packages FOR EACH ROW EXECUTE FUNCTION public.tg_set_updated_at();

ALTER TABLE public.deals ADD COLUMN package_id uuid REFERENCES public.product_packages(id) ON DELETE SET NULL;
