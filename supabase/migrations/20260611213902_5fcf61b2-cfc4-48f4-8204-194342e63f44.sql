
CREATE TABLE IF NOT EXISTS public.package_products (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  package_id uuid NOT NULL REFERENCES public.product_packages(id) ON DELETE CASCADE,
  product_id uuid NOT NULL REFERENCES public.products(id) ON DELETE CASCADE,
  position int NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (package_id, product_id)
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.package_products TO authenticated;
GRANT ALL ON public.package_products TO service_role;

ALTER TABLE public.package_products ENABLE ROW LEVEL SECURITY;

CREATE POLICY "pp_select_auth" ON public.package_products
  FOR SELECT TO authenticated USING (true);

CREATE POLICY "pp_admin_write" ON public.package_products
  FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin'::app_role))
  WITH CHECK (public.has_role(auth.uid(), 'admin'::app_role));

CREATE INDEX IF NOT EXISTS package_products_package_id_idx ON public.package_products(package_id);
CREATE INDEX IF NOT EXISTS package_products_product_id_idx ON public.package_products(product_id);
