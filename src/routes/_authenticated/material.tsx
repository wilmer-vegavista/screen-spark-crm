import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { PageHeader } from "@/components/page-header";
import { Card } from "@/components/ui/card";
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from "@/components/ui/select";
import { format } from "date-fns";
import { sv } from "date-fns/locale";
import { toast } from "sonner";

export const Route = createFileRoute("/_authenticated/material")({
  component: Material,
});

const STATUS = [
  { key: "ej_inkommet", label: "Ej inkommet", color: "oklch(0.55 0.04 270)" },
  { key: "under_produktion", label: "Under produktion", color: "oklch(0.75 0.15 75)" },
  { key: "kundgranskning", label: "Kundgranskning", color: "oklch(0.65 0.13 240)" },
  { key: "godkant", label: "Godkänt", color: "oklch(0.68 0.17 155)" },
  { key: "levererat", label: "Levererat", color: "oklch(0.68 0.18 275)" },
] as const;

function Material() {
  const qc = useQueryClient();
  const { data } = useQuery({
    queryKey: ["materials-with-campaigns"],
    queryFn: async () => {
      const [{ data: materials }, { data: campaigns }] = await Promise.all([
        supabase.from("materials").select("*").order("deadline", { ascending: true, nullsFirst: false }),
        supabase.from("campaigns").select("id, name, customer_id"),
      ]);
      const map = new Map((campaigns ?? []).map(c => [c.id, c.name]));
      return (materials ?? []).map(m => ({ ...m, campaign_name: map.get(m.campaign_id) }));
    },
  });

  const updateStatus = async (id: string, status: string) => {
    const { error } = await supabase.from("materials").update({ status: status as any }).eq("id", id);
    if (error) toast.error(error.message);
    else { toast.success("Status uppdaterad"); qc.invalidateQueries({ queryKey: ["materials-with-campaigns"] }); }
  };

  return (
    <>
      <PageHeader title="Material" description="Material läggs till per kampanj. Uppdatera status här." />
      <div className="p-6">
        {(data ?? []).length === 0 ? (
          <Card className="p-8 text-center text-sm text-muted-foreground">Inget material än — öppna en kampanj och lägg till material där.</Card>
        ) : (
          <Card className="overflow-hidden">
            <table className="w-full text-sm">
              <thead className="bg-secondary/50 text-xs text-muted-foreground uppercase tracking-wider">
                <tr>
                  <th className="text-left px-4 py-3">Titel</th>
                  <th className="text-left px-4 py-3">Kampanj</th>
                  <th className="text-left px-4 py-3">Format</th>
                  <th className="text-left px-4 py-3">Deadline</th>
                  <th className="text-left px-4 py-3">Status</th>
                </tr>
              </thead>
              <tbody>
                {data?.map(m => (
                  <tr key={m.id} className="border-t hover:bg-accent/30">
                    <td className="px-4 py-3 font-medium">{m.title}</td>
                    <td className="px-4 py-3 text-muted-foreground">{m.campaign_name}</td>
                    <td className="px-4 py-3 text-muted-foreground">{m.format || "—"} {m.dimensions ? `· ${m.dimensions}` : ""}</td>
                    <td className="px-4 py-3 text-muted-foreground">{m.deadline ? format(new Date(m.deadline), "d MMM", { locale: sv }) : "—"}</td>
                    <td className="px-4 py-3">
                      <Select value={m.status} onValueChange={(v) => updateStatus(m.id, v)}>
                        <SelectTrigger className="w-48 h-8"><SelectValue /></SelectTrigger>
                        <SelectContent>
                          {STATUS.map(s => (
                            <SelectItem key={s.key} value={s.key}>
                              <span className="flex items-center gap-2"><span className="size-2 rounded-full" style={{ background: s.color }} /> {s.label}</span>
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Card>
        )}
      </div>
    </>
  );
}
