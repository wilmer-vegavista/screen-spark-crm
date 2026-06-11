ALTER TABLE public.products
  ADD COLUMN IF NOT EXISTS file_format text,
  ADD COLUMN IF NOT EXISTS ad_duration_seconds integer;