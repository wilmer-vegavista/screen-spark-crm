UPDATE public.order_items i
SET unit_price = ROUND(i.unit_price / NULLIF(i.weeks,0), 2),
    commission_amount = ROUND((i.unit_price / NULLIF(i.weeks,0)) * i.weeks * i.commission_pct / 100, 2)
FROM public.orders o
WHERE i.order_id = o.id
  AND o.company_name IN ('Yoump Trampoline Parks Metro AB','JRF Mark AB','Select Friskvård AB')
  AND i.unit_price * i.weeks > o.total_excl_vat * 1.01;