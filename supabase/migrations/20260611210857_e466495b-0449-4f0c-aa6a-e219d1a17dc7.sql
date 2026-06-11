
DO $$ BEGIN
  CREATE TYPE billing_frequency AS ENUM ('engang', 'manad', 'kvartal', 'halvar');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

ALTER TABLE public.orders
  ADD COLUMN IF NOT EXISTS invoice_start_date date,
  ADD COLUMN IF NOT EXISTS billing_frequency billing_frequency NOT NULL DEFAULT 'engang',
  ADD COLUMN IF NOT EXISTS billing_duration_months integer NOT NULL DEFAULT 1;
