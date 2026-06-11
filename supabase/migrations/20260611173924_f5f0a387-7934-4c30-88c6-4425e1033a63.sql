
ALTER TABLE public.products
  ADD COLUMN dimensions TEXT,
  ADD COLUMN contacts_per_week INTEGER,
  ADD COLUMN format TEXT,
  ADD COLUMN address TEXT,
  ADD COLUMN latitude DOUBLE PRECISION,
  ADD COLUMN longitude DOUBLE PRECISION;

ALTER TABLE public.deals
  ADD COLUMN sov_pct NUMERIC(5,2),
  ADD COLUMN impressions BIGINT,
  ADD COLUMN campaign_start DATE,
  ADD COLUMN campaign_end DATE,
  ADD COLUMN campaign_weeks INTEGER;
