ALTER TABLE public.orders 
  ADD COLUMN IF NOT EXISTS selected_weeks integer[] NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS exact_dates date[] NOT NULL DEFAULT '{}';