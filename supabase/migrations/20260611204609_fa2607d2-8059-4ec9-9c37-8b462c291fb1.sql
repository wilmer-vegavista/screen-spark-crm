WITH recalculated_items AS (
  SELECT
    oi.id,
    COALESCE(
      CASE
        WHEN sc.compensation_type = 'endast_provision' THEN p.commission_pct_provision_only
        WHEN sc.compensation_type = 'med_grundlon' THEN p.commission_pct_with_base
        ELSE NULL
      END,
      p.default_commission_pct,
      sc.default_commission_pct,
      0
    )::numeric AS pct,
    (COALESCE(oi.unit_price, 0) * COALESCE(oi.weeks, 1))::numeric AS line_total
  FROM public.order_items oi
  JOIN public.orders o ON o.id = oi.order_id
  LEFT JOIN public.products p ON p.id = oi.product_id
  LEFT JOIN public.seller_compensation sc ON sc.user_id = o.owner_id
)
UPDATE public.order_items oi
SET
  commission_pct = r.pct,
  commission_amount = round((r.line_total * r.pct / 100)::numeric, 2)
FROM recalculated_items r
WHERE oi.id = r.id;

WITH order_totals AS (
  SELECT
    order_id,
    round(SUM(COALESCE(unit_price, 0) * COALESCE(weeks, 1))::numeric, 2) AS total_excl_vat,
    round(SUM(COALESCE(commission_amount, 0))::numeric, 2) AS total_commission
  FROM public.order_items
  GROUP BY order_id
)
UPDATE public.orders o
SET
  total_excl_vat = ot.total_excl_vat,
  total_commission = ot.total_commission
FROM order_totals ot
WHERE o.id = ot.order_id;

UPDATE public.deals d
SET
  value = o.total_excl_vat,
  commission_pct_override = CASE
    WHEN o.total_excl_vat > 0 THEN round((o.total_commission / o.total_excl_vat * 100)::numeric, 2)
    ELSE NULL
  END
FROM public.orders o
WHERE d.id = o.deal_id;