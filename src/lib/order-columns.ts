// Column lists excluding commission fields, which are protected at the database
// level (only the order owner/creator or an admin may read them, via RPC).
export const ORDER_SELECT =
  "id, order_type, status, customer_id, company_name, org_number, vat_number, billing_address, postal_code, city, contact_name, contact_email, contact_phone, total_excl_vat, notes, deal_id, owner_id, created_by, created_at, updated_at, selected_weeks, exact_dates, invoice_start_date, billing_frequency, billing_duration_months, invoice_reference, invoice_peppol_id, invoice_email, invoice_status, marked_ready_at, invoiced_at";

export const ORDER_ITEM_SELECT =
  "id, order_id, product_id, product_name, sov_pct, impressions, weeks, unit_price, position, created_at, period_unit";
