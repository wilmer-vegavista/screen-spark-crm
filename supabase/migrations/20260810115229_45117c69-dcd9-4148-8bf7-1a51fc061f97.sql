DROP POLICY IF EXISTS customers_select_owner_or_admin ON public.customers;
CREATE POLICY customers_select_all_authenticated ON public.customers FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS deals_select_owner_or_admin ON public.deals;
CREATE POLICY deals_select_all_authenticated ON public.deals FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS orders_select_owner_or_admin ON public.orders;
CREATE POLICY orders_select_all_authenticated ON public.orders FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS order_items_select_via_order ON public.order_items;
CREATE POLICY order_items_select_all_authenticated ON public.order_items FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS campaigns_select_owner_or_admin ON public.campaigns;
CREATE POLICY campaigns_select_all_authenticated ON public.campaigns FOR SELECT TO authenticated USING (true);