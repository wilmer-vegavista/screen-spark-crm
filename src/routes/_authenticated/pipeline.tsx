import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { PageHeader } from "@/components/page-header";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Plus } from "lucide-react";
import { DealDialog } from "@/components/deal-dialog";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

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

function Pipeline() {
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<any | null>(null);

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
        description="Dra och släpp affärer mellan stegen"
        actions={<Button onClick={() => { setEditing(null); setOpen(true); }}><Plus className="size-4 mr-1" /> Ny affär</Button>}
      />
      <div className="flex-1 overflow-x-auto p-6">
        <div className="flex gap-3 min-w-max">
          {STAGES.map(s => {
            const deals = (data ?? []).filter(d => d.stage === s.key);
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
