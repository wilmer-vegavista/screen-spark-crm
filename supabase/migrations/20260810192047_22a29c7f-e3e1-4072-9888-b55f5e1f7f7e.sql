CREATE TYPE public.lead_status_new AS ENUM ('tackat_nej','kallt_mail','ej_svar','pratat_telefon','offert','nara_avslut');

ALTER TABLE public.leads ALTER COLUMN status DROP DEFAULT;

ALTER TABLE public.leads
  ALTER COLUMN status TYPE public.lead_status_new
  USING (CASE status::text
    WHEN 'ny' THEN 'ej_svar'
    WHEN 'pagaende' THEN 'pratat_telefon'
    WHEN 'affar' THEN 'nara_avslut'
    WHEN 'forlorad' THEN 'tackat_nej'
    ELSE 'ej_svar'
  END)::public.lead_status_new;

ALTER TABLE public.leads ALTER COLUMN status SET DEFAULT 'ej_svar'::public.lead_status_new;

DROP TYPE public.lead_status;
ALTER TYPE public.lead_status_new RENAME TO lead_status;