GRANT SELECT, INSERT, UPDATE, DELETE ON public.orders TO authenticated;
GRANT ALL ON public.orders TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.order_items TO authenticated;
GRANT ALL ON public.order_items TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.order_splits TO authenticated;
GRANT ALL ON public.order_splits TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.order_materials TO authenticated;
GRANT ALL ON public.order_materials TO service_role;