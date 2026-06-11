
ALTER TABLE public.seller_compensation
  ADD COLUMN IF NOT EXISTS quarterly_budget numeric(12,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS half_year_budget numeric(12,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS yearly_budget numeric(12,2) NOT NULL DEFAULT 0;
