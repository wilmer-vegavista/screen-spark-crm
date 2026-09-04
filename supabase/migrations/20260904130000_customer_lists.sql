-- Egna kundlistor per säljare (motsvarar deras kalkylark i Google Sheets)
CREATE TABLE public.customer_lists (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  source_url TEXT,
  columns JSONB NOT NULL DEFAULT '[]'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE public.customer_list_rows (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  list_id UUID NOT NULL REFERENCES public.customer_lists(id) ON DELETE CASCADE,
  position INTEGER NOT NULL DEFAULT 0,
  data JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX customer_lists_owner_id_idx ON public.customer_lists(owner_id);
CREATE INDEX customer_list_rows_list_id_idx ON public.customer_list_rows(list_id, position);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.customer_lists TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.customer_list_rows TO authenticated;
GRANT ALL ON public.customer_lists TO service_role;
GRANT ALL ON public.customer_list_rows TO service_role;

ALTER TABLE public.customer_lists ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.customer_list_rows ENABLE ROW LEVEL SECURITY;

-- Varje säljare ser och hanterar sina egna listor; admin ser alla
CREATE POLICY customer_lists_select_own_or_admin ON public.customer_lists
  FOR SELECT TO authenticated
  USING (owner_id = auth.uid() OR public.has_role(auth.uid(), 'admin'::app_role));
CREATE POLICY customer_lists_insert_self ON public.customer_lists
  FOR INSERT TO authenticated WITH CHECK (owner_id = auth.uid());
CREATE POLICY customer_lists_update_own_or_admin ON public.customer_lists
  FOR UPDATE TO authenticated
  USING (owner_id = auth.uid() OR public.has_role(auth.uid(), 'admin'::app_role))
  WITH CHECK (owner_id = auth.uid() OR public.has_role(auth.uid(), 'admin'::app_role));
CREATE POLICY customer_lists_delete_own_or_admin ON public.customer_lists
  FOR DELETE TO authenticated
  USING (owner_id = auth.uid() OR public.has_role(auth.uid(), 'admin'::app_role));

CREATE POLICY customer_list_rows_all_via_list ON public.customer_list_rows
  FOR ALL TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.customer_lists l
    WHERE l.id = list_id
      AND (l.owner_id = auth.uid() OR public.has_role(auth.uid(), 'admin'::app_role))
  ))
  WITH CHECK (EXISTS (
    SELECT 1 FROM public.customer_lists l
    WHERE l.id = list_id
      AND (l.owner_id = auth.uid() OR public.has_role(auth.uid(), 'admin'::app_role))
  ));

CREATE TRIGGER customer_lists_set_updated_at
  BEFORE UPDATE ON public.customer_lists
  FOR EACH ROW EXECUTE FUNCTION public.tg_set_updated_at();
CREATE TRIGGER customer_list_rows_set_updated_at
  BEFORE UPDATE ON public.customer_list_rows
  FOR EACH ROW EXECUTE FUNCTION public.tg_set_updated_at();
