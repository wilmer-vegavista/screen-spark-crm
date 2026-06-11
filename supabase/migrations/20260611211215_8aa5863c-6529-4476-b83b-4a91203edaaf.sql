
CREATE TABLE IF NOT EXISTS public.seller_monthly_budgets (
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  year integer NOT NULL,
  month integer NOT NULL CHECK (month BETWEEN 1 AND 12),
  amount numeric(12,2) NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, year, month)
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.seller_monthly_budgets TO authenticated;
GRANT ALL ON public.seller_monthly_budgets TO service_role;

ALTER TABLE public.seller_monthly_budgets ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "smb_select_self_or_admin" ON public.seller_monthly_budgets;
CREATE POLICY "smb_select_self_or_admin" ON public.seller_monthly_budgets
  FOR SELECT TO authenticated
  USING (user_id = auth.uid() OR public.has_role(auth.uid(), 'admin'));

DROP POLICY IF EXISTS "smb_admin_write" ON public.seller_monthly_budgets;
CREATE POLICY "smb_admin_write" ON public.seller_monthly_budgets
  FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

DROP TRIGGER IF EXISTS smb_set_updated_at ON public.seller_monthly_budgets;
CREATE TRIGGER smb_set_updated_at
  BEFORE UPDATE ON public.seller_monthly_budgets
  FOR EACH ROW EXECUTE FUNCTION public.tg_set_updated_at();
