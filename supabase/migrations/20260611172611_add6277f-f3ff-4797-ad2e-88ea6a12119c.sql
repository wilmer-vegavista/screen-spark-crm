
CREATE TYPE public.compensation_type AS ENUM ('endast_provision', 'med_grundlon');

ALTER TABLE public.seller_compensation
  ADD COLUMN compensation_type public.compensation_type NOT NULL DEFAULT 'med_grundlon';

ALTER TABLE public.products
  ADD COLUMN commission_pct_provision_only numeric(5,2),
  ADD COLUMN commission_pct_with_base numeric(5,2);

-- Backfill the two new columns from the existing default so nothing breaks
UPDATE public.products
SET commission_pct_provision_only = COALESCE(commission_pct_provision_only, default_commission_pct),
    commission_pct_with_base      = COALESCE(commission_pct_with_base, default_commission_pct);
