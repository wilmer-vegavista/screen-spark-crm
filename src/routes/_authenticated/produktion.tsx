import { createFileRoute, redirect } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { PageHeader } from "@/components/page-header";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { CalendarClock, CalendarCheck, Rocket, ArrowRight, ArrowLeft, CalendarRange } from "lucide-react";
import { OrderDialog } from "@/components/order-dialog";
import { OrderScheduleDialog } from "@/components/order-schedule-dialog";
import { format } from "date-fns";
import { toast } from "sonner";
import { ORDER_SELECT } from "@/lib/order-columns";

type Step = "datum_ej_bestamt" | "datum_bestamt" | "kampanj_skapad";

const STEPS: { key: Step; label: string; icon: React.ComponentType<{ className?: string }> }[] = [
  { key: "datum_ej_bestamt", label: "Datum ej bestämt", icon: CalendarClock },
  { key: "datum_bestamt", label: "Datum bestämt", icon: CalendarCheck },
  { key: "kampanj_skapad", label: "Kampanj skapad", icon: Rocket },
];

export const Route = createFileRoute("/_authenticated/produktion")({
  beforeLoad: async () => {
    const { data: u } = await supabase.auth.getUser();
    if (!u.user) throw redirect({ to: "/auth" });
    const { data: roles } = await supabase.from("user_roles").select("role").eq("user_id", u.user.id);
    const list = (roles ?? []).map((r: any) => r.role);
    if (!list.includes("admin") && !list.includes("produktion")) {
      throw redirect({ to: "/dashboard" });
    }
  },
  head: () => ({
    meta: [
      { title: "Produktion – orderflöde | Vega Vista" },
      { name: "description", content: "Flytta ordrar mellan datum ej bestämt, datum bestämt och kampanj skapad." },
      { property: "og:title", content: "Produktion – orderflöde" },
      { property: "og:description", content: "Produktionsflöde för ordrar hos Vega Vista." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: ProduktionPage,
});

const SEK = (n: number) =>
  new Intl.NumberFormat("sv-SE", { maximumFractionDigits: 0 }).format(n || 0);

const periodsLabel = (dates: string[]) => {
  const list = [...dates].sort();
  const out: string[] = [];
  for (let i = 0; i < list.length; i += 2) {
    out.push(list[i + 1] && list[i + 1] !== list[i] ? `${list[i]} – ${list[i + 1]}` : list[i]);
  }
  return out.join(" | ");
};

function ProduktionPage() {
  const qc = useQueryClient();
  const [tab, setTab] = useState<Step>("datum_ej_bestamt");
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<any | null>(null);
  const [scheduleOpen, setScheduleOpen] = useState(false);
  const [scheduling, setScheduling] = useState<any | null>(null);


  const { data: orders = [] } = useQuery({
    queryKey: ["produktion-orders"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("orders")
        .select(`${ORDER_SELECT}, production_status`)
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data ?? [];
    },
  });

  const { data: sellers = [] } = useQuery({
    queryKey: ["all-profiles-min"],
    queryFn: async () => {
      const { data } = await supabase.from("profiles").select("id, full_name, email").order("full_name");
      return data ?? [];
    },
  });

  const sellerName = (id: string | null) => {
    if (!id) return "—";
    const s = sellers.find((x: any) => x.id === id);
    return s?.full_name || s?.email || "—";
  };

  const grouped = useMemo(() => {
    const g: Record<Step, any[]> = { datum_ej_bestamt: [], datum_bestamt: [], kampanj_skapad: [] };
    for (const o of orders as any[]) {
      const k = (o.production_status ?? "datum_ej_bestamt") as Step;
      (g[k] ?? g.datum_ej_bestamt).push(o);
    }
    return g;
  }, [orders]);

  const move = async (id: string, to: Step) => {
    const { error } = await supabase.from("orders").update({ production_status: to }).eq("id", id);
    if (error) return toast.error(error.message);
    toast.success(`Flyttad till "${STEPS.find(s => s.key === to)!.label}"`);
    qc.invalidateQueries({ queryKey: ["produktion-orders"] });
    qc.invalidateQueries({ queryKey: ["orders"] });
  };

  const renderList = (list: any[], step: Step) => {
    if (list.length === 0) {
      return <Card className="p-8 text-center text-sm text-muted-foreground">Inga ordrar i detta steg</Card>;
    }
    const idx = STEPS.findIndex(s => s.key === step);
    const prev = STEPS[idx - 1];
    const next = STEPS[idx + 1];

    return list.map((o: any) => (
      <Card
        key={o.id}
        className="p-4 hover:border-primary/50 cursor-pointer transition-colors"
        onClick={() => { setEditing(o); setOpen(true); }}
      >
        <div className="flex items-center gap-4">
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="font-medium truncate">{o.company_name || "(saknar företagsnamn)"}</span>
              <Badge variant="secondary">{sellerName(o.owner_id)}</Badge>
              <Badge variant="outline">{o.order_type === "offert" ? "Offert" : "Bokning"}</Badge>
            </div>
            <div className="text-xs text-muted-foreground mt-1">
              {format(new Date(o.created_at), "yyyy-MM-dd")}
              {o.exact_dates?.length ? ` · ${periodsLabel(o.exact_dates)}` : ""}
              {o.selected_weeks?.length ? ` · v.${o.selected_weeks.join(", ")}` : ""}
            </div>
          </div>
          <div className="text-sm font-semibold whitespace-nowrap">{SEK(Number(o.total_excl_vat))} SEK</div>
          <div onClick={(e) => e.stopPropagation()} className="shrink-0 flex gap-2">
            <Button size="sm" variant="outline" onClick={() => { setScheduling(o); setScheduleOpen(true); }}>
              <CalendarRange className="size-4 mr-1" /> Datum
            </Button>
            {prev && (
              <Button size="sm" variant="outline" onClick={() => move(o.id, prev.key)}>
                <ArrowLeft className="size-4 mr-1" /> {prev.label}
              </Button>
            )}

            {next && (
              <Button size="sm" onClick={() => move(o.id, next.key)}>
                {next.label} <ArrowRight className="size-4 ml-1" />
              </Button>
            )}
          </div>
        </div>
      </Card>
    ));
  };

  return (
    <>
      <PageHeader title="Produktion" description="Flytta ordrar genom produktionsflödet" />
      <div className="p-6 space-y-4">
        <Tabs value={tab} onValueChange={(v) => setTab(v as Step)}>
          <TabsList className="grid w-full grid-cols-3">
            {STEPS.map(s => (
              <TabsTrigger key={s.key} value={s.key} className="gap-2">
                <s.icon className="size-4" /> {s.label}
                <Badge variant="secondary" className="ml-1">{grouped[s.key].length}</Badge>
              </TabsTrigger>
            ))}
          </TabsList>
          {STEPS.map(s => (
            <TabsContent key={s.key} value={s.key} className="space-y-3 pt-4">
              {renderList(grouped[s.key], s.key)}
            </TabsContent>
          ))}
        </Tabs>
      </div>
      <OrderDialog open={open} onOpenChange={setOpen} order={editing} />
      <OrderScheduleDialog open={scheduleOpen} onOpenChange={setScheduleOpen} order={scheduling} />
    </>
  );
}
