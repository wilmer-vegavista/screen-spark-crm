
CREATE TABLE public.order_materials (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id uuid NOT NULL REFERENCES public.orders(id) ON DELETE CASCADE,
  customer_id uuid REFERENCES public.customers(id) ON DELETE SET NULL,
  file_path text NOT NULL,
  file_name text NOT NULL,
  mime_type text,
  size_bytes bigint,
  notes text,
  uploaded_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_order_materials_order ON public.order_materials(order_id);
CREATE INDEX idx_order_materials_customer ON public.order_materials(customer_id);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.order_materials TO authenticated;
GRANT ALL ON public.order_materials TO service_role;

ALTER TABLE public.order_materials ENABLE ROW LEVEL SECURITY;

CREATE POLICY "order_materials_select" ON public.order_materials FOR SELECT TO authenticated
  USING (public.can_manage_order(order_id));
CREATE POLICY "order_materials_insert" ON public.order_materials FOR INSERT TO authenticated
  WITH CHECK (public.can_manage_order(order_id) AND (uploaded_by IS NULL OR uploaded_by = auth.uid()));
CREATE POLICY "order_materials_update" ON public.order_materials FOR UPDATE TO authenticated
  USING (public.can_manage_order(order_id));
CREATE POLICY "order_materials_delete" ON public.order_materials FOR DELETE TO authenticated
  USING (public.can_manage_order(order_id));

-- Storage RLS for the order-media bucket (bucket itself is created via the storage tool)
CREATE POLICY "order_media_select" ON storage.objects FOR SELECT TO authenticated
  USING (bucket_id = 'order-media' AND EXISTS (
    SELECT 1 FROM public.order_materials m
    WHERE m.file_path = name AND public.can_manage_order(m.order_id)
  ));
CREATE POLICY "order_media_insert" ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'order-media' AND owner = auth.uid());
CREATE POLICY "order_media_delete" ON storage.objects FOR DELETE TO authenticated
  USING (bucket_id = 'order-media' AND (owner = auth.uid() OR public.has_role(auth.uid(),'admin')));
