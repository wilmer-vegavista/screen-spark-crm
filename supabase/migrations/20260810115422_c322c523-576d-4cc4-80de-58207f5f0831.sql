-- Column-level protection for commission data
REVOKE SELECT ON public.orders FROM authenticated;
GRANT SELECT (id, order_type, status, customer_id, company_name, org_number, vat_number, billing_address, postal_code, city, contact_name, contact_email, contact_phone, total_excl_vat, notes, deal_id, owner_id, created_by, created_at, updated_at, selected_weeks, exact_dates, invoice_start_date, billing_frequency, billing_duration_months, invoice_reference, invoice_peppol_id, invoice_email, invoice_status, marked_ready_at, invoiced_at) ON public.orders TO authenticated;

REVOKE SELECT ON public.order_items FROM authenticated;
GRANT SELECT (id, order_id, product_id, product_name, sov_pct, impressions, weeks, unit_price, "position", created_at, period_unit) ON public.order_items TO authenticated;

CREATE OR REPLACE FUNCTION public.get_order_commission(_order_id uuid)
RETURNS TABLE (order_id uuid, total_commission numeric, item_id uuid, item_commission_pct numeric, item_commission_amount numeric)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT o.id, o.total_commission, i.id, i.commission_pct, i.commission_amount
  FROM public.orders o
  LEFT JOIN public.order_items i ON i.order_id = o.id
  WHERE o.id = _order_id
    AND public.can_manage_order(o.id)
$$;

REVOKE EXECUTE ON FUNCTION public.get_order_commission(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_order_commission(uuid) TO authenticated;