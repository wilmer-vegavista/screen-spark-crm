CREATE TABLE public.seller_credentials (
  user_id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  initial_password TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.seller_credentials TO authenticated;
GRANT ALL ON public.seller_credentials TO service_role;

ALTER TABLE public.seller_credentials ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins can view seller credentials"
ON public.seller_credentials FOR SELECT
TO authenticated
USING (public.has_role(auth.uid(), 'admin'));

CREATE POLICY "Admins can manage seller credentials"
ON public.seller_credentials FOR ALL
TO authenticated
USING (public.has_role(auth.uid(), 'admin'))
WITH CHECK (public.has_role(auth.uid(), 'admin'));

CREATE TRIGGER tg_seller_credentials_updated_at
BEFORE UPDATE ON public.seller_credentials
FOR EACH ROW EXECUTE FUNCTION public.tg_set_updated_at();