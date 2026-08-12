CREATE TABLE public.fortnox_tokens (
  id boolean PRIMARY KEY DEFAULT true CHECK (id),
  access_token text NOT NULL,
  refresh_token text NOT NULL,
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT ALL ON public.fortnox_tokens TO service_role;
ALTER TABLE public.fortnox_tokens ENABLE ROW LEVEL SECURITY;

CREATE POLICY "No client access to fortnox tokens"
ON public.fortnox_tokens FOR SELECT TO authenticated USING (false);

CREATE TRIGGER fortnox_tokens_set_updated_at
BEFORE UPDATE ON public.fortnox_tokens
FOR EACH ROW EXECUTE FUNCTION public.tg_set_updated_at();

ALTER TABLE public.orders
  ADD COLUMN IF NOT EXISTS fortnox_invoice_numbers text[] NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS fortnox_synced_at timestamptz,
  ADD COLUMN IF NOT EXISTS fortnox_customer_number text;

GRANT SELECT (fortnox_invoice_numbers, fortnox_synced_at, fortnox_customer_number) ON public.orders TO authenticated;
GRANT UPDATE (fortnox_invoice_numbers, fortnox_synced_at, fortnox_customer_number) ON public.orders TO authenticated;