
ALTER TABLE public.seller_compensation
  ADD COLUMN IF NOT EXISTS monthly_budget numeric(12,2) NOT NULL DEFAULT 0;

CREATE TABLE IF NOT EXISTS public.company_settings (
  id boolean PRIMARY KEY DEFAULT true CHECK (id = true),
  monthly_budget numeric(12,2) NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT ON public.company_settings TO authenticated;
GRANT ALL ON public.company_settings TO service_role;

ALTER TABLE public.company_settings ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "company_settings_select" ON public.company_settings;
CREATE POLICY "company_settings_select" ON public.company_settings
  FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS "company_settings_admin_write" ON public.company_settings;
CREATE POLICY "company_settings_admin_write" ON public.company_settings
  FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

GRANT UPDATE, INSERT ON public.company_settings TO authenticated;

INSERT INTO public.company_settings (id, monthly_budget) VALUES (true, 0)
  ON CONFLICT (id) DO NOTHING;

DROP TRIGGER IF EXISTS company_settings_set_updated_at ON public.company_settings;
CREATE TRIGGER company_settings_set_updated_at
  BEFORE UPDATE ON public.company_settings
  FOR EACH ROW EXECUTE FUNCTION public.tg_set_updated_at();
