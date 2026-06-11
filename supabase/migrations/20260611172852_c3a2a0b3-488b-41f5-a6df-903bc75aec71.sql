
CREATE TYPE public.screen_type AS ENUM ('egen', 'extern');

ALTER TABLE public.products
  ADD COLUMN screen_type public.screen_type NOT NULL DEFAULT 'egen';
