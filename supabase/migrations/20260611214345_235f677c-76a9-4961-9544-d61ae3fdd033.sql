ALTER TABLE public.product_packages 
  ADD COLUMN IF NOT EXISTS views integer,
  ADD COLUMN IF NOT EXISTS sov numeric;