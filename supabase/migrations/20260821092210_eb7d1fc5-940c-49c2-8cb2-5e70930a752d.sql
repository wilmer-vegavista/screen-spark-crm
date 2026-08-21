DO $$
DECLARE oid uuid;
BEGIN
  INSERT INTO public.orders (order_type, status, customer_id, company_name, contact_name, contact_email,
    total_excl_vat, total_commission, deal_id, owner_id, created_by, created_at, updated_at,
    billing_frequency, billing_duration_months, production_status, payment_terms, notes)
  VALUES ('bokning', 'ny', '1956d30e-d2bb-4888-baea-b4dd9d408b61', 'Grillska Gymnasiumet', 'Gustav Lorentz',
    'gustav.lorenz@stadsmissionensskolstiftelse.se', 15900, 3180,
    '23d451b7-1a0e-48d5-be06-8d0852ba61a1', 'a38ecb0d-0f3f-4be9-8c12-a2e2bf9508b2', 'a38ecb0d-0f3f-4be9-8c12-a2e2bf9508b2',
    '2026-08-18 13:28:00+00', now(), 'engang', 1, 'datum_ej_bestamt', '30 dagar netto från erlagd order',
    'Återskapad order (raderad av misstag).')
  RETURNING id INTO oid;

  INSERT INTO public.order_items (order_id, product_name, weeks, unit_price, commission_pct, commission_amount, position, period_unit)
  VALUES (oid, 'Grillska Gymnasiumet – bokning', 1, 15900, 20, 3180, 0, 'veckor');
END $$;