import { createFileRoute, Outlet, redirect } from "@tanstack/react-router";
import { supabase } from "@/integrations/supabase/client";
import { AppShell } from "@/components/app-shell";

export const Route = createFileRoute("/_authenticated")({
  ssr: false,
  beforeLoad: async () => {
    const { data, error } = await supabase.auth.getUser();
    if (error || !data.user) throw redirect({ to: "/auth" });
    // Skärmägarkonton hör hemma i portalen, inte i CRM:et
    const { data: ownerRow } = await supabase
      .from("screen_owners")
      .select("id")
      .eq("user_id", data.user.id)
      .maybeSingle();
    if (ownerRow) throw redirect({ to: "/skarmportal" });
    return { user: data.user };
  },
  component: () => (
    <AppShell>
      <Outlet />
    </AppShell>
  ),
});
