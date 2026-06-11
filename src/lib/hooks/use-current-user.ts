import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

export function useCurrentUser() {
  const { data } = useQuery({
    queryKey: ["current-user"],
    queryFn: async () => {
      const { data: userRes } = await supabase.auth.getUser();
      if (!userRes.user) return null;
      const [{ data: profile }, { data: rolesRows }] = await Promise.all([
        supabase.from("profiles").select("*").eq("id", userRes.user.id).maybeSingle(),
        supabase.from("user_roles").select("role").eq("user_id", userRes.user.id),
      ]);
      return {
        user: userRes.user,
        profile,
        roles: (rolesRows ?? []).map(r => r.role) as string[],
      };
    },
  });
  return {
    user: data?.user ?? null,
    profile: data?.profile ?? null,
    roles: data?.roles ?? [],
    isAdmin: (data?.roles ?? []).includes("admin"),
  };
}
