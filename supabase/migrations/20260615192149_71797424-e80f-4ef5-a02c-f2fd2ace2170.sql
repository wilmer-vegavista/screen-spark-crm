
ALTER TABLE public.orders
  ADD COLUMN IF NOT EXISTS invoice_reference text,
  ADD COLUMN IF NOT EXISTS invoice_peppol_id text,
  ADD COLUMN IF NOT EXISTS invoice_email text,
  ADD COLUMN IF NOT EXISTS invoice_status text,
  ADD COLUMN IF NOT EXISTS marked_ready_at timestamptz,
  ADD COLUMN IF NOT EXISTS invoiced_at timestamptz;

ALTER TABLE public.customers
  ADD COLUMN IF NOT EXISTS invoice_reference text,
  ADD COLUMN IF NOT EXISTS invoice_peppol_id text,
  ADD COLUMN IF NOT EXISTS invoice_email text;
