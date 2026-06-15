
-- 1) Tighten storage DELETE policy on order-media to use can_manage_order
DROP POLICY IF EXISTS order_media_delete ON storage.objects;

CREATE POLICY order_media_delete ON storage.objects
FOR DELETE TO authenticated
USING (
  bucket_id = 'order-media'
  AND EXISTS (
    SELECT 1 FROM public.order_materials m
    WHERE m.file_path = storage.objects.name
      AND public.can_manage_order(m.order_id)
  )
);

-- 2) Restrict realtime broadcast/presence channel subscriptions per user
ALTER TABLE realtime.messages ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can only access own user-scoped channels" ON realtime.messages;

CREATE POLICY "Users can only access own user-scoped channels"
ON realtime.messages
FOR SELECT
TO authenticated
USING (
  realtime.topic() = 'user:' || auth.uid()::text
);

DROP POLICY IF EXISTS "Users can only write to own user-scoped channels" ON realtime.messages;

CREATE POLICY "Users can only write to own user-scoped channels"
ON realtime.messages
FOR INSERT
TO authenticated
WITH CHECK (
  realtime.topic() = 'user:' || auth.uid()::text
);
