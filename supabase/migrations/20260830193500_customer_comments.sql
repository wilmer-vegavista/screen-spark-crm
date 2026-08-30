CREATE TABLE public.customer_comments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_id UUID NOT NULL REFERENCES public.customers(id) ON DELETE CASCADE,
  body TEXT NOT NULL,
  created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX customer_comments_customer_id_idx ON public.customer_comments(customer_id);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.customer_comments TO authenticated;
GRANT ALL ON public.customer_comments TO service_role;

ALTER TABLE public.customer_comments ENABLE ROW LEVEL SECURITY;

-- Kommentarer är synliga för hela teamet; bara författaren eller admin kan ändra/ta bort
CREATE POLICY customer_comments_select_authenticated ON public.customer_comments
  FOR SELECT TO authenticated USING (true);
CREATE POLICY customer_comments_insert_self ON public.customer_comments
  FOR INSERT TO authenticated WITH CHECK (created_by = auth.uid());
CREATE POLICY customer_comments_update_own_or_admin ON public.customer_comments
  FOR UPDATE TO authenticated
  USING (created_by = auth.uid() OR public.has_role(auth.uid(), 'admin'::app_role))
  WITH CHECK (created_by = auth.uid() OR public.has_role(auth.uid(), 'admin'::app_role));
CREATE POLICY customer_comments_delete_own_or_admin ON public.customer_comments
  FOR DELETE TO authenticated
  USING (created_by = auth.uid() OR public.has_role(auth.uid(), 'admin'::app_role));

CREATE TRIGGER customer_comments_set_updated_at
  BEFORE UPDATE ON public.customer_comments
  FOR EACH ROW EXECUTE FUNCTION public.tg_set_updated_at();
