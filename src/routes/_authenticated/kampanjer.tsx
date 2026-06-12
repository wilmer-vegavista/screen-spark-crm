import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { PageHeader } from "@/components/page-header";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Plus, Calendar as CalIcon, MapPin, ShoppingCart } from "lucide-react";
import { CampaignDialog } from "@/components/campaign-dialog";
import { format, differenceInDays, isAfter, isBefore, addMonths, parseISO, getISOWeek, getISOWeekYear, setISOWeek, setISOWeekYear, startOfISOWeek, endOfISOWeek, min as dmin, max as dmax } from "date-fns";
import { sv } from "date-fns/locale";


export const Route = createFileRoute("/_authenticated/kampanjer")({
  component: Kampanjer,
});

const STATUS_META: Record<string, { label: string; color: string }> = {
  planerad: { label: "Planerad", color: "oklch(0.6 0.05 270)" },
  material_produktion: { label: "Material i produktion", color: "oklch(0.75 0.15 75)" },
  redo_for_live: { label: "Redo att gå live", color: "oklch(0.65 0.13 240)" },
  live: { label: "LIVE", color: "oklch(0.68 0.17 155)" },
  avslutad: { label: "Avslutad", color: "oklch(0.55 0.04 270)" },
  rapport_skickad: { label: "Rapport skickad", color: "oklch(0.68 0.18 275)" },
};

function Kampanjer() {
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<any | null>(null);

  const { data } = useQuery({
    queryKey: ["campaigns-with-customers"],
    queryFn: async () => {
      const [{ data: campaigns }, { data: customers }] = await Promise.all([
        supabase.from("campaigns").select("*").order("start_date", { ascending: true }),
        supabase.from("customers").select("id, company_name"),
      ]);
      const m = new Map((customers ?? []).map(c => [c.id, c.company_name]));
      return (campaigns ?? []).map(c => ({ ...c, customer_name: c.customer_id ? m.get(c.customer_id) : null }));
    },
  });

  const { data: scheduledOrders } = useQuery({
    queryKey: ["orders-scheduled"],
    queryFn: async () => {
      const { data: orders } = await supabase
        .from("orders")
        .select("id, company_name, status, order_type, selected_weeks, exact_dates, invoice_start_date, billing_duration_months, billing_frequency, total_excl_vat")
        .order("invoice_start_date", { ascending: true, nullsFirst: false });
      const today = new Date();
      const currentYear = today.getFullYear();
      return (orders ?? [])
        .map((o: any) => {
          let start: Date | null = null;
          let end: Date | null = null;
          if (o.exact_dates?.length) {
            const ds = o.exact_dates.map((d: string) => parseISO(d));
            start = dmin(ds);
            end = dmax(ds);
          } else if (o.invoice_start_date) {
            start = parseISO(o.invoice_start_date);
            end = addMonths(start, o.billing_duration_months || 1);
          } else if (o.selected_weeks?.length) {
            const weekDates = o.selected_weeks.map((w: number) => {
              const d = setISOWeek(setISOWeekYear(new Date(currentYear, 5, 1), currentYear), w);
              return { s: startOfISOWeek(d), e: endOfISOWeek(d) };
            });
            start = dmin(weekDates.map((x: any) => x.s));
            end = dmax(weekDates.map((x: any) => x.e));
          }
          return { ...o, _start: start, _end: end };
        })
        .filter((o: any) => o._start && o._end);
    },
  });


  const now = new Date();
  const grouped = {
    upcoming: (data ?? []).filter(c => isAfter(new Date(c.start_date), now)),
    live: (data ?? []).filter(c => !isAfter(new Date(c.start_date), now) && !isBefore(new Date(c.end_date), now)),
    finished: (data ?? []).filter(c => isBefore(new Date(c.end_date), now)),
  };

  return (
    <>
      <PageHeader
        title="Kampanjer"
        description="Översikt över alla kampanjer och deras status"
        actions={<Button onClick={() => { setEditing(null); setOpen(true); }}><Plus className="size-4 mr-1" /> Ny kampanj</Button>}
      />
      <div className="p-6 space-y-8">
        <Section title="Live just nu" campaigns={grouped.live} onOpen={(c) => { setEditing(c); setOpen(true); }} highlight />
        <Section title="Kommande" campaigns={grouped.upcoming} onOpen={(c) => { setEditing(c); setOpen(true); }} />
        <Section title="Avslutade" campaigns={grouped.finished} onOpen={(c) => { setEditing(c); setOpen(true); }} />
        <OrdersSchedule orders={scheduledOrders ?? []} />
      </div>

      <CampaignDialog open={open} onOpenChange={setOpen} campaign={editing} />
    </>
  );
}

function Section({ title, campaigns, onOpen, highlight }: { title: string; campaigns: any[]; onOpen: (c: any) => void; highlight?: boolean }) {
  return (
    <div>
      <h3 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground mb-3">{title} <span className="text-xs">({campaigns.length})</span></h3>
      {campaigns.length === 0 ? (
        <p className="text-sm text-muted-foreground">Inga kampanjer</p>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
          {campaigns.map(c => {
            const meta = STATUS_META[c.status];
            const days = differenceInDays(new Date(c.end_date), new Date(c.start_date)) + 1;
            return (
              <Card key={c.id} className="p-4 cursor-pointer hover:border-primary/50 transition-colors" onClick={() => onOpen(c)}>
                <div className="flex items-start justify-between gap-2 mb-2">
                  <div className="min-w-0">
                    <div className="font-medium truncate">{c.name}</div>
                    {c.customer_name && <div className="text-xs text-muted-foreground truncate">{c.customer_name}</div>}
                  </div>
                  <span className="chip shrink-0" style={{ borderColor: meta.color, color: meta.color }}>
                    {highlight && c.status === "live" && <span className="size-1.5 rounded-full bg-current animate-pulse" />}
                    {meta.label}
                  </span>
                </div>
                <div className="flex items-center gap-3 text-xs text-muted-foreground mt-2">
                  <span className="flex items-center gap-1"><CalIcon className="size-3" />
                    {format(new Date(c.start_date), "d MMM", { locale: sv })} – {format(new Date(c.end_date), "d MMM", { locale: sv })}
                  </span>
                  <span>{days} dgr</span>
                </div>
                {c.cities?.length > 0 && (
                  <div className="flex items-center gap-1 text-xs text-muted-foreground mt-1">
                    <MapPin className="size-3" /> {c.cities.join(", ")}
                  </div>
                )}
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}

function OrdersSchedule({ orders }: { orders: any[] }) {
  const now = new Date();
  const upcoming = orders.filter(o => isAfter(o._start, now));
  const live = orders.filter(o => !isAfter(o._start, now) && !isBefore(o._end, now));
  const finished = orders.filter(o => isBefore(o._end, now));

  const renderGroup = (title: string, list: any[], highlight?: boolean) => (
    <div>
      <h4 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-2">{title} <span>({list.length})</span></h4>
      {list.length === 0 ? (
        <p className="text-sm text-muted-foreground">Inga ordrar</p>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
          {list.map(o => {
            const weeks: number[] = o.selected_weeks?.length
              ? o.selected_weeks
              : Array.from(new Set([getISOWeek(o._start), getISOWeek(o._end)]));
            return (
              <Card key={o.id} className="p-4">
                <div className="flex items-start justify-between gap-2 mb-2">
                  <div className="min-w-0">
                    <div className="font-medium truncate flex items-center gap-1"><ShoppingCart className="size-3.5 shrink-0" />{o.company_name}</div>
                    <div className="text-xs text-muted-foreground capitalize">{o.order_type} · {o.status}</div>
                  </div>
                  {highlight && (
                    <span className="chip shrink-0" style={{ borderColor: "oklch(0.68 0.17 155)", color: "oklch(0.68 0.17 155)" }}>
                      <span className="size-1.5 rounded-full bg-current animate-pulse" /> LIVE
                    </span>
                  )}
                </div>
                <div className="flex items-center gap-2 text-xs text-muted-foreground">
                  <CalIcon className="size-3" />
                  {format(o._start, "d MMM yyyy", { locale: sv })} – {format(o._end, "d MMM yyyy", { locale: sv })}
                </div>
                {weeks.length > 0 && (
                  <div className="text-xs text-muted-foreground mt-1">
                    Veckor: {weeks.sort((a, b) => a - b).map(w => `v${w}`).join(", ")}
                  </div>
                )}
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );

  return (
    <div className="space-y-6 pt-4 border-t">
      <h3 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">Ordrar – schemalagda perioder</h3>
      {renderGroup("Live just nu", live, true)}
      {renderGroup("Kommande", upcoming)}
      {renderGroup("Avslutade", finished)}
    </div>
  );
}

