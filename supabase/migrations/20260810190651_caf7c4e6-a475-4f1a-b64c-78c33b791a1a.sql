CREATE TYPE public.lead_status AS ENUM ('ny', 'pagaende', 'affar', 'forlorad');

CREATE TABLE public.leads (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_name text NOT NULL,
  contact_name text,
  phone text,
  email text,
  comment text,
  status public.lead_status NOT NULL DEFAULT 'ny',
  followup_date date,
  customer_id uuid REFERENCES public.customers(id) ON DELETE SET NULL,
  owner_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.leads TO authenticated;
GRANT ALL ON public.leads TO service_role;

ALTER TABLE public.leads ENABLE ROW LEVEL SECURITY;

CREATE POLICY "leads_select_authenticated" ON public.leads
  FOR SELECT TO authenticated USING (true);

CREATE POLICY "leads_insert_own" ON public.leads
  FOR INSERT TO authenticated WITH CHECK (created_by = auth.uid());

CREATE POLICY "leads_update_own_or_admin" ON public.leads
  FOR UPDATE TO authenticated
  USING (owner_id = auth.uid() OR created_by = auth.uid() OR public.has_role(auth.uid(), 'admin'))
  WITH CHECK (owner_id = auth.uid() OR created_by = auth.uid() OR public.has_role(auth.uid(), 'admin'));

CREATE POLICY "leads_delete_own_or_admin" ON public.leads
  FOR DELETE TO authenticated
  USING (owner_id = auth.uid() OR created_by = auth.uid() OR public.has_role(auth.uid(), 'admin'));

CREATE TRIGGER leads_set_updated_at BEFORE UPDATE ON public.leads
  FOR EACH ROW EXECUTE FUNCTION public.tg_set_updated_at();

CREATE INDEX leads_owner_idx ON public.leads(owner_id);
CREATE INDEX leads_followup_idx ON public.leads(followup_date);

ALTER PUBLICATION supabase_realtime ADD TABLE public.leads;