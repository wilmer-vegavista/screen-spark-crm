
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'period_unit') THEN
    CREATE TYPE public.period_unit AS ENUM ('veckor', 'manader', 'ar');
  END IF;
END $$;

ALTER TABLE public.order_items
  ADD COLUMN IF NOT EXISTS period_unit public.period_unit NOT NULL DEFAULT 'veckor';
