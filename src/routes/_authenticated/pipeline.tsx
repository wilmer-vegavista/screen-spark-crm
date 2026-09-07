import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useCurrentUser } from "@/lib/hooks/use-current-user";
import { PageHeader } from "@/components/page-header";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
} from "@/components/ui/select";
import { Plus, ChevronLeft, ChevronRight } from "lucide-react";
import { DealDialog } from "@/components/deal-dialog";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import {
  format,
  startOfMonth,
  endOfMonth,
  addMonths,
  startOfQuarter,
  endOfQuarter,
  addQuarters,
  getQuarter,
  startOfYear,
  endOfYear,
  addYears,
} from "date-fns";
import { sv } from "date-fns/locale";

export const Route = createFileRoute("/_authenticated/pipeline")({
  component: Pipeline,
});

const STAGES = [
  { key: "ny", label: "Nya", color: "oklch(0.6 0.05 270)" },
  { key: "kontaktad", label: "Kontaktade", color: "oklch(0.65 0.13 240)" },
  { key: "offert", label: "Offert skickad", color: "oklch(0.68 0.16 275)" },
  { key: "forhandling", label: "Förhandling", color: "oklch(0.75 0.16 75)" },
  { key: "vunnen", label: "Vunnen", color: "oklch(0.68 0.17 155)" },
  { key: "forlorad", label: "Förlorad", color: "oklch(0.55 0.18 25)" },
] as const;

type PeriodType = "alla" | "manad" | "kvartal" | "halvar" | "ar";

const PERIOD_OPTIONS: { value: PeriodType; label: string }[] = [
  { value: "alla", label: "Alla perioder" },
  { value: "manad", label: "Månad" },
  { value: "kvartal", label: "Kvartal" },
  { value: "halvar", label: "Halvår" },
  { value: "ar", label: "År" },
];

function getPeriodRange(type: PeriodType, offset: number) {
  const now = new Date();
  if (type === "manad") {
    const base = addMonths(now, offset);
    return {
      start: startOfMonth(base),
      end: endOfMonth(base),
      label: format(base, "LLLL yyyy", { locale: sv }),
    };
  }
  if (type === "kvartal") {
    const base = addQuarters(now, offset);
    return {
      start: startOfQuarter(base),
      end: endOfQuarter(base),
      label: `Q${getQuarter(base)} ${format(base, "yyyy")}`,
    };
  }
  if (type === "halvar") {
    const base = addMonths(now, offset * 6);
    const firstHalf = base.getMonth() < 6;
    const start = new Date(base.getFullYear(), firstHalf ? 0 : 6, 1);
    return {
      start,
      end: endOfMonth(addMonths(start, 5)),
      label: `${firstHalf ? "H1" : "H2"} ${base.getFullYear()}`,
    };
  }
  if (type === "ar") {
    const base = addYears(now, offset);
    return {
      start: startOfYear(base),
      end: endOfYear(base),
      label: format(base, "yyyy"),
    };
  }
  return null;
}

function Pipeline() {
  const qc = useQueryClient();
  const { user, isAdmin } = useCurrentUser();
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<any | null>(null);
  const [sellerFilter, setSellerFilter] = useState<string>("alla");
  const [periodType, setPeriodType] = useState<PeriodType>("alla");
  const [periodOffset, setPeriodOffset] = useState(0);
  const period = getPeriodRange(periodType, periodOffset);

  const { data: sellers } = useQuery({
    queryKey: ["all-profiles-min"],
    enabled: isAdmin,
    queryFn: async () => {
      const { data } = await supabase
        .from("profiles")
        .select("id, full_name, email")
        .order("full_name");
      return data ?? [];
    },
  });
  const sellerName = new Map((sellers ?? []).map((s) => [s.id, s.full_name || s.email]));

  const { data } = useQuery({
    queryKey: ["deals-with-customers"],
    queryFn: async () => {
      const [{ data: deals }, { data: customers }] = await Promise.all([
        supabase.from("deals").select("*").order("created_at", { ascending: false }),
        supabase.from("customers").select("id, company_name"),
      ]);
      const customerMap = new Map((customers ?? []).map(c => [c.id, c.company_name]));
      return (deals ?? []).map(d => ({ ...d, customer_name: d.customer_id ? customerMap.get(d.customer_id) : null }));
    },
  });

  const visibleDeals = (data ?? []).filter((d) => {
    if (period) {
      const created = d.created_at ? new Date(d.created_at) : null;
      if (!created || created < period.start || created > period.end) return false;
    }
    if (!isAdmin) return d.owner_id === user?.id || d.created_by === user?.id;
    if (sellerFilter === "alla") return true;
    return d.owner_id === sellerFilter;
  });

  const onDragStart = (e: React.DragEvent, id: string) => {
    e.dataTransfer.setData("text/plain", id);
  };
  const onDrop = async (e: React.DragEvent, stage: string) => {
    e.preventDefault();
    const id = e.dataTransfer.getData("text/plain");
    if (!id) return;
    const { error } = await supabase.from("deals").update({ stage: stage as any }).eq("id", id);
    if (error) toast.error(error.message);
    else { toast.success("Affär flyttad"); qc.invalidateQueries({ queryKey: ["deals-with-customers"] }); }
  };

  return (
    <>
      <PageHeader
        title="Pipeline"
        description={
          isAdmin
            ? "Dra och släpp affärer mellan stegen"
            : "Dina affärer – dra och släpp mellan stegen"
        }
        actions={
          <div className="flex items-center gap-2 flex-wrap justify-end">
            <Select
              value={periodType}
              onValueChange={(v) => {
                setPeriodType(v as PeriodType);
                setPeriodOffset(0);
              }}
            >
              <SelectTrigger className="w-40">
                <SelectValue placeholder="Alla perioder" />
              </SelectTrigger>
              <SelectContent>
                {PERIOD_OPTIONS.map((o) => (
                  <SelectItem key={o.value} value={o.value}>
                    {o.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {period && (
              <div className="flex items-center gap-1">
                <Button
                  variant="outline"
                  size="icon"
                  className="size-9"
                  onClick={() => setPeriodOffset((o) => o - 1)}
                >
                  <ChevronLeft className="size-4" />
                </Button>
                <span className="text-sm font-medium px-1 capitalize whitespace-nowrap min-w-24 text-center">
                  {period.label}
                </span>
                <Button
                  variant="outline"
                  size="icon"
                  className="size-9"
                  onClick={() => setPeriodOffset((o) => o + 1)}
                >
                  <ChevronRight className="size-4" />
                </Button>
              </div>
            )}
            {isAdmin && (
              <Select value={sellerFilter} onValueChange={setSellerFilter}>
                <SelectTrigger className="w-56">
                  <SelectValue placeholder="Alla säljare" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="alla">Alla säljare</SelectItem>
                  {(sellers ?? []).map((s) => (
                    <SelectItem key={s.id} value={s.id}>
                      {s.full_name || s.email}
                      {s.id === user?.id ? " (jag)" : ""}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
            <Button
              onClick={() => {
                setEditing(null);
                setOpen(true);
              }}
            >
              <Plus className="size-4 mr-1" /> Ny affär
            </Button>
          </div>
        }
      />
      <div className="flex-1 overflow-x-auto p-6">
        <div className="flex gap-3 min-w-max">
          {STAGES.map(s => {
            const deals = visibleDeals.filter((d) => d.stage === s.key);
            const total = deals.reduce((sum, d) => sum + Number(d.value || 0), 0);
            return (
              <div
                key={s.key}
                className="w-72 shrink-0 rounded-lg bg-card/50 border flex flex-col"
                onDragOver={(e) => e.preventDefault()}
                onDrop={(e) => onDrop(e, s.key)}
              >
                <div className="px-3 py-2.5 border-b flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <div className="size-2 rounded-full" style={{ background: s.color }} />
                    <span className="text-sm font-medium">{s.label}</span>
                    <span className="text-xs text-muted-foreground">{deals.length}</span>
                  </div>
                  <span className="text-xs text-muted-foreground">{total.toLocaleString("sv-SE")} kr</span>
                </div>
                <div className="p-2 space-y-2 min-h-[200px]">
                  {deals.map(d => (
                    <Card
                      key={d.id}
                      draggable
                      onDragStart={(e) => onDragStart(e, d.id)}
                      onClick={() => { setEditing(d); setOpen(true); }}
                      className={cn("p-3 cursor-grab active:cursor-grabbing hover:border-primary/50 transition-colors")}
                    >
                      <div className="text-sm font-medium">{d.title}</div>
                      {d.customer_name && <div className="text-xs text-muted-foreground mt-0.5">{d.customer_name}</div>}
                      {isAdmin &&
                        sellerFilter === "alla" &&
                        d.owner_id &&
                        sellerName.get(d.owner_id) && (
                          <div className="text-[10px] text-muted-foreground mt-0.5">
                            {sellerName.get(d.owner_id)}
                          </div>
                        )}
                      <div className="flex items-center justify-between mt-2">
                        <span className="text-xs font-medium">{Number(d.value || 0).toLocaleString("sv-SE")} kr</span>
                        {d.probability != null && <span className="text-[10px] text-muted-foreground">{d.probability}%</span>}
                      </div>
                    </Card>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      </div>
      <DealDialog open={open} onOpenChange={setOpen} deal={editing} />
    </>
  );
}
