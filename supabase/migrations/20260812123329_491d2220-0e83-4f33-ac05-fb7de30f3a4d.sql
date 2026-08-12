ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS production_status text NOT NULL DEFAULT 'datum_ej_bestamt';

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'orders_production_status_check') THEN
    ALTER TABLE public.orders ADD CONSTRAINT orders_production_status_check
      CHECK (production_status IN ('datum_ej_bestamt','datum_bestamt','kampanj_skapad'));
  END IF;
END $$;

DROP POLICY IF EXISTS "Produktion can update production status" ON public.orders;
CREATE POLICY "Produktion can update production status"
ON public.orders FOR UPDATE TO authenticated
USING (public.has_role(auth.uid(), 'produktion') OR public.has_role(auth.uid(), 'admin'))
WITH CHECK (public.has_role(auth.uid(), 'produktion') OR public.has_role(auth.uid(), 'admin'));