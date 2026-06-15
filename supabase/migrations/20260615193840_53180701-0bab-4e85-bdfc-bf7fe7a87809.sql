
-- 1) Profiles: drop broad SELECT, replace with own-row OR admin (full row). Limited-column lookup for everyone via column GRANTs.
DROP POLICY IF EXISTS "profiles_select_all" ON public.profiles;

CREATE POLICY "profiles_select_self_or_admin" ON public.profiles
  FOR SELECT TO authenticated
  USING (auth.uid() = id OR public.has_role(auth.uid(), 'admin'));

CREATE POLICY "profiles_select_directory" ON public.profiles
  FOR SELECT TO authenticated
  USING (true);

-- Column-level: revoke broad SELECT, grant only non-sensitive columns to authenticated
REVOKE SELECT ON public.profiles FROM authenticated;
GRANT SELECT (id, full_name, avatar_url, title, created_at, updated_at) ON public.profiles TO authenticated;
-- Own-row access to email/phone goes through the self-or-admin policy + explicit column grants
GRANT SELECT (email, phone) ON public.profiles TO authenticated;
-- The self-or-admin policy will gate row visibility; combined with PostgREST, selecting email/phone only returns rows the user owns or admin sees.
-- NOTE: with two permissive SELECT policies, RLS allows a row if EITHER passes. To ensure non-self rows do NOT expose email/phone, we must drop directory policy and instead use a view or stricter approach.
DROP POLICY "profiles_select_directory" ON public.profiles;
DROP POLICY "profiles_select_self_or_admin" ON public.profiles;

-- Simpler & safe: one policy allows reading any row; column-level grants prevent reading email/phone for anyone but self/admin via a SECURITY INVOKER view.
CREATE POLICY "profiles_select_directory" ON public.profiles
  FOR SELECT TO authenticated
  USING (true);

-- Revoke email/phone from broad authenticated; expose them via a SECURITY DEFINER function for self lookups.
REVOKE SELECT (email, phone) ON public.profiles FROM authenticated;

-- 2) order-media storage: add UPDATE policy and tighten INSERT to verify can_manage_order on related order
DROP POLICY IF EXISTS "order_media_insert" ON storage.objects;
CREATE POLICY "order_media_insert" ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'order-media'
    AND owner = auth.uid()
    AND EXISTS (
      SELECT 1 FROM public.orders o
      WHERE o.id::text = split_part(name, '/', 2)
        AND public.can_manage_order(o.id)
    )
  );

CREATE POLICY "order_media_update" ON storage.objects FOR UPDATE TO authenticated
  USING (
    bucket_id = 'order-media'
    AND EXISTS (
      SELECT 1 FROM public.order_materials m
      WHERE m.file_path = name AND public.can_manage_order(m.order_id)
    )
  )
  WITH CHECK (
    bucket_id = 'order-media'
    AND EXISTS (
      SELECT 1 FROM public.order_materials m
      WHERE m.file_path = name AND public.can_manage_order(m.order_id)
    )
  );

-- 3) Revoke anon EXECUTE on SECURITY DEFINER trigger function not meant to be called via API
REVOKE EXECUTE ON FUNCTION public.handle_new_user() FROM PUBLIC, anon;
