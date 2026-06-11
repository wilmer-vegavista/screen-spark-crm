
ALTER TABLE public.customers
  ADD COLUMN billing_address text,
  ADD COLUMN postal_code text,
  ADD COLUMN city text,
  ADD COLUMN vat_number text;

ALTER TABLE public.products
  ADD COLUMN material_spec text;
