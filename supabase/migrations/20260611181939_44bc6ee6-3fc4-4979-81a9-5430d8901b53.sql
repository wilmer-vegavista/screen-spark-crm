
DROP POLICY IF EXISTS customers_all_authenticated ON public.customers;
CREATE POLICY customers_select_owner_or_admin ON public.customers FOR SELECT TO authenticated USING (owner_id = auth.uid() OR created_by = auth.uid() OR public.has_role(auth.uid(), 'admin'::app_role));
CREATE POLICY customers_insert_self ON public.customers FOR INSERT TO authenticated WITH CHECK ((owner_id IS NULL OR owner_id = auth.uid() OR public.has_role(auth.uid(), 'admin'::app_role)) AND (created_by IS NULL OR created_by = auth.uid()));
CREATE POLICY customers_update_owner_or_admin ON public.customers FOR UPDATE TO authenticated USING (owner_id = auth.uid() OR created_by = auth.uid() OR public.has_role(auth.uid(), 'admin'::app_role)) WITH CHECK (owner_id = auth.uid() OR created_by = auth.uid() OR public.has_role(auth.uid(), 'admin'::app_role));
CREATE POLICY customers_delete_owner_or_admin ON public.customers FOR DELETE TO authenticated USING (owner_id = auth.uid() OR created_by = auth.uid() OR public.has_role(auth.uid(), 'admin'::app_role));

DROP POLICY IF EXISTS deals_all_authenticated ON public.deals;
CREATE POLICY deals_select_owner_or_admin ON public.deals FOR SELECT TO authenticated USING (owner_id = auth.uid() OR created_by = auth.uid() OR public.has_role(auth.uid(), 'admin'::app_role));
CREATE POLICY deals_insert_self ON public.deals FOR INSERT TO authenticated WITH CHECK ((owner_id IS NULL OR owner_id = auth.uid() OR public.has_role(auth.uid(), 'admin'::app_role)) AND (created_by IS NULL OR created_by = auth.uid()));
CREATE POLICY deals_update_owner_or_admin ON public.deals FOR UPDATE TO authenticated USING (owner_id = auth.uid() OR created_by = auth.uid() OR public.has_role(auth.uid(), 'admin'::app_role)) WITH CHECK (owner_id = auth.uid() OR created_by = auth.uid() OR public.has_role(auth.uid(), 'admin'::app_role));
CREATE POLICY deals_delete_owner_or_admin ON public.deals FOR DELETE TO authenticated USING (owner_id = auth.uid() OR created_by = auth.uid() OR public.has_role(auth.uid(), 'admin'::app_role));

DROP POLICY IF EXISTS activities_all_authenticated ON public.activities;
CREATE POLICY activities_select_related_or_admin ON public.activities FOR SELECT TO authenticated USING (assigned_to = auth.uid() OR created_by = auth.uid() OR public.has_role(auth.uid(), 'admin'::app_role));
CREATE POLICY activities_insert_self ON public.activities FOR INSERT TO authenticated WITH CHECK (created_by IS NULL OR created_by = auth.uid());
CREATE POLICY activities_update_related_or_admin ON public.activities FOR UPDATE TO authenticated USING (assigned_to = auth.uid() OR created_by = auth.uid() OR public.has_role(auth.uid(), 'admin'::app_role)) WITH CHECK (assigned_to = auth.uid() OR created_by = auth.uid() OR public.has_role(auth.uid(), 'admin'::app_role));
CREATE POLICY activities_delete_related_or_admin ON public.activities FOR DELETE TO authenticated USING (created_by = auth.uid() OR public.has_role(auth.uid(), 'admin'::app_role));

DROP POLICY IF EXISTS campaigns_all_authenticated ON public.campaigns;
CREATE POLICY campaigns_select_owner_or_admin ON public.campaigns FOR SELECT TO authenticated USING (owner_id = auth.uid() OR created_by = auth.uid() OR public.has_role(auth.uid(), 'admin'::app_role));
CREATE POLICY campaigns_insert_self ON public.campaigns FOR INSERT TO authenticated WITH CHECK ((owner_id IS NULL OR owner_id = auth.uid() OR public.has_role(auth.uid(), 'admin'::app_role)) AND (created_by IS NULL OR created_by = auth.uid()));
CREATE POLICY campaigns_update_owner_or_admin ON public.campaigns FOR UPDATE TO authenticated USING (owner_id = auth.uid() OR created_by = auth.uid() OR public.has_role(auth.uid(), 'admin'::app_role)) WITH CHECK (owner_id = auth.uid() OR created_by = auth.uid() OR public.has_role(auth.uid(), 'admin'::app_role));
CREATE POLICY campaigns_delete_owner_or_admin ON public.campaigns FOR DELETE TO authenticated USING (owner_id = auth.uid() OR created_by = auth.uid() OR public.has_role(auth.uid(), 'admin'::app_role));

DROP POLICY IF EXISTS materials_all_authenticated ON public.materials;
CREATE POLICY materials_select_related_or_admin ON public.materials FOR SELECT TO authenticated USING (assigned_to = auth.uid() OR created_by = auth.uid() OR public.has_role(auth.uid(), 'admin'::app_role) OR EXISTS (SELECT 1 FROM public.campaigns c WHERE c.id = materials.campaign_id AND (c.owner_id = auth.uid() OR c.created_by = auth.uid())));
CREATE POLICY materials_insert_related ON public.materials FOR INSERT TO authenticated WITH CHECK ((created_by IS NULL OR created_by = auth.uid()) AND (public.has_role(auth.uid(), 'admin'::app_role) OR EXISTS (SELECT 1 FROM public.campaigns c WHERE c.id = materials.campaign_id AND (c.owner_id = auth.uid() OR c.created_by = auth.uid()))));
CREATE POLICY materials_update_related_or_admin ON public.materials FOR UPDATE TO authenticated USING (assigned_to = auth.uid() OR created_by = auth.uid() OR public.has_role(auth.uid(), 'admin'::app_role) OR EXISTS (SELECT 1 FROM public.campaigns c WHERE c.id = materials.campaign_id AND (c.owner_id = auth.uid() OR c.created_by = auth.uid()))) WITH CHECK (assigned_to = auth.uid() OR created_by = auth.uid() OR public.has_role(auth.uid(), 'admin'::app_role) OR EXISTS (SELECT 1 FROM public.campaigns c WHERE c.id = materials.campaign_id AND (c.owner_id = auth.uid() OR c.created_by = auth.uid())));
CREATE POLICY materials_delete_related_or_admin ON public.materials FOR DELETE TO authenticated USING (created_by = auth.uid() OR public.has_role(auth.uid(), 'admin'::app_role) OR EXISTS (SELECT 1 FROM public.campaigns c WHERE c.id = materials.campaign_id AND (c.owner_id = auth.uid() OR c.created_by = auth.uid())));

CREATE OR REPLACE FUNCTION public.tg_set_updated_at()
RETURNS trigger LANGUAGE plpgsql SET search_path = public
AS $function$ BEGIN NEW.updated_at = now(); RETURN NEW; END; $function$;

CREATE OR REPLACE FUNCTION public.tg_deals_set_won_at()
RETURNS trigger LANGUAGE plpgsql SET search_path = public
AS $function$
BEGIN
  IF NEW.stage = 'vunnen' AND (OLD.stage IS DISTINCT FROM 'vunnen') AND NEW.won_at IS NULL THEN
    NEW.won_at = now();
  END IF;
  IF NEW.stage <> 'vunnen' THEN
    NEW.won_at = NULL;
  END IF;
  RETURN NEW;
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.has_role(uuid, public.app_role) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.has_role(uuid, public.app_role) TO authenticated, service_role;
