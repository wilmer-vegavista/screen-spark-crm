import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { PageHeader } from "@/components/page-header";
import { Card } from "@/components/ui/card";
import { TrendingUp, Users, Calendar, AlertCircle } from "lucide-react";
import { format, isAfter, isBefore, addDays } from "date-fns";
import { sv } from "date-fns/locale";

export const Route = createFileRoute("/_authenticated/dashboard")({
  component: Dashboard,
});

function Dashboard() {
  const { data } = useQuery({
    queryKey: ["dashboard"],
    queryFn: async () => {
      const [deals, campaigns, activities, customers] = await Promise.all([
        supabase.from("deals").select("*"),
        supabase.from("campaigns").select("*").order("end_date", { ascending: true }),
        supabase.from("activities").select("*").eq("completed", false).order("due_at", { ascending: true }).limit(8),
        supabase.from("customers").select("id"),
      ]);
      return {
        deals: deals.data ?? [],
        campaigns: campaigns.data ?? [],
        activities: activities.data ?? [],
        customers: customers.data ?? [],
      };
    },
  });

  const won = data?.deals.filter(d => d.stage === "vunnen") ?? [];
  const open = data?.deals.filter(d => !["vunnen", "forlorad"].includes(d.stage)) ?? [];
  const wonValue = won.reduce((s, d) => s + Number(d.value || 0), 0);
  const pipelineValue = open.reduce((s, d) => s + Number(d.value || 0), 0);

  const now = new Date();
  const liveCampaigns = (data?.campaigns ?? []).filter(c => {
    const s = new Date(c.start_date), e = new Date(c.end_date);
    return !isAfter(s, now) && !isBefore(e, now);
  });
  const endingSoon = (data?.campaigns ?? []).filter(c => {
    const e = new Date(c.end_date);
    return isAfter(e, now) && isBefore(e, addDays(now, 14));
  });

  return (
    <>
      <PageHeader title="Dashboard" description="Översikt över sälj och produktion" />
      <div className="p-6 space-y-6">
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
          <Stat label="Pipeline-värde" value={`${pipelineValue.toLocaleString("sv-SE")} kr`} icon={TrendingUp} sub={`${open.length} öppna affärer`} />
          <Stat label="Vunnet" value={`${wonValue.toLocaleString("sv-SE")} kr`} icon={TrendingUp} sub={`${won.length} affärer`} accent />
          <Stat label="Live-kampanjer" value={String(liveCampaigns.length)} icon={Calendar} sub={`${endingSoon.length} avslutas inom 14 dagar`} />
          <Stat label="Kunder" value={String(data?.customers.length ?? 0)} icon={Users} />
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <Card className="p-5">
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-sm font-semibold">Mina aktiviteter</h3>
              <AlertCircle className="size-4 text-muted-foreground" />
            </div>
            <div className="space-y-2">
              {(data?.activities ?? []).length === 0 && (
                <p className="text-sm text-muted-foreground">Inga öppna aktiviteter</p>
              )}
              {data?.activities.map(a => (
                <div key={a.id} className="flex items-center justify-between py-2 border-b last:border-0">
                  <div>
                    <div className="text-sm font-medium">{a.title}</div>
                    <div className="text-xs text-muted-foreground">{a.type}</div>
                  </div>
                  {a.due_at && (
                    <div className="text-xs text-muted-foreground">
                      {format(new Date(a.due_at), "d MMM", { locale: sv })}
                    </div>
                  )}
                </div>
              ))}
            </div>
          </Card>

          <Card className="p-5">
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-sm font-semibold">Kampanjer som snart avslutas</h3>
              <Calendar className="size-4 text-muted-foreground" />
            </div>
            <div className="space-y-2">
              {endingSoon.length === 0 && (
                <p className="text-sm text-muted-foreground">Inga kampanjer avslutas snart</p>
              )}
              {endingSoon.map(c => (
                <div key={c.id} className="flex items-center justify-between py-2 border-b last:border-0">
                  <div>
                    <div className="text-sm font-medium">{c.name}</div>
                    <div className="text-xs text-muted-foreground">Påminnelse: kontakta kund för förlängning</div>
                  </div>
                  <div className="text-xs text-warning">
                    {format(new Date(c.end_date), "d MMM", { locale: sv })}
                  </div>
                </div>
              ))}
            </div>
          </Card>
        </div>
      </div>
    </>
  );
}

function Stat({ label, value, icon: Icon, sub, accent }: { label: string; value: string; icon: React.ComponentType<{ className?: string }>; sub?: string; accent?: boolean }) {
  return (
    <Card className="p-5 relative overflow-hidden">
      {accent && <div className="absolute inset-0 opacity-20 pointer-events-none" style={{ background: "var(--gradient-primary)" }} />}
      <div className="relative">
        <div className="flex items-center justify-between mb-2">
          <span className="text-xs text-muted-foreground">{label}</span>
          <Icon className="size-4 text-muted-foreground" />
        </div>
        <div className="text-2xl font-semibold tracking-tight">{value}</div>
        {sub && <div className="text-xs text-muted-foreground mt-1">{sub}</div>}
      </div>
    </Card>
  );
}
