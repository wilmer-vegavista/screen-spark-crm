ALTER TABLE public.products
  ADD COLUMN IF NOT EXISTS owner_name text,
  ADD COLUMN IF NOT EXISTS revenue_share_pct numeric NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS live_date date;