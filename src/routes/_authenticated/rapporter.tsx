import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { PageHeader } from "@/components/page-header";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { format, differenceInDays, isPast } from "date-fns";
import { sv } from "date-fns/locale";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { FileBarChart, Send } from "lucide-react";

export const Route = createFileRoute("/_authenticated/rapporter")({
  component: Rapporter,
});

function Rapporter() {
  const qc = useQueryClient();
  const { data } = useQuery({
    queryKey: ["reports-schedule"],
    queryFn: async () => {
      const [{ data: campaigns }, { data: customers }] = await Promise.all([
        supabase.from("campaigns").select("*"),
        supabase.from("customers").select("id, company_name"),
      ]);
      const m = new Map((customers ?? []).map(c => [c.id, c.company_name]));
      return (campaigns ?? [])
        .map(c => ({
          ...c,
          customer_name: c.customer_id ? m.get(c.customer_id) : null,
          report_due: c.report_due_date ? new Date(c.report_due_date) : new Date(c.end_date),
        }))
        .sort((a, b) => a.report_due.getTime() - b.report_due.getTime());
    },
  });

  const markSent = async (id: string) => {
    const { error } = await supabase.from("campaigns").update({
      report_sent_at: new Date().toISOString(),
      status: "rapport_skickad" as any,
    }).eq("id", id);
    if (error) toast.error(error.message);
    else { toast.success("Markerad som skickad"); qc.invalidateQueries({ queryKey: ["reports-schedule"] }); }
  };

  const pending = (data ?? []).filter(c => !c.report_sent_at);
  const sent = (data ?? []).filter(c => c.report_sent_at);

  return (
    <>
      <PageHeader title="Rapporter" description="Schemalägg och håll koll på rapporter till kund" />
      <div className="p-6 space-y-6">
        <div>
          <h3 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground mb-3">Att skicka ({pending.length})</h3>
          {pending.length === 0 ? (
            <Card className="p-6 text-sm text-muted-foreground text-center">Inga rapporter att skicka</Card>
          ) : (
            <Card className="divide-y">
              {pending.map(c => {
                const days = differenceInDays(c.report_due, new Date());
                const overdue = isPast(c.report_due);
                return (
                  <div key={c.id} className="flex items-center gap-4 p-4">
                    <div className="size-9 rounded-md bg-accent flex items-center justify-center"><FileBarChart className="size-4" /></div>
                    <div className="flex-1 min-w-0">
                      <div className="font-medium truncate">{c.name}</div>
                      <div className="text-xs text-muted-foreground">{c.customer_name} · Slut: {format(new Date(c.end_date), "d MMM yyyy", { locale: sv })}</div>
                    </div>
                    <div className={cn("text-xs", overdue ? "text-destructive font-medium" : days <= 3 ? "text-warning" : "text-muted-foreground")}>
                      {overdue ? `Försenad ${Math.abs(days)} dgr` : `Om ${days} dgr`}
                    </div>
                    <Button size="sm" variant="outline" onClick={() => markSent(c.id)}>
                      <Send className="size-3.5 mr-1" /> Markera skickad
                    </Button>
                  </div>
                );
              })}
            </Card>
          )}
        </div>
        <div>
          <h3 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground mb-3">Skickade ({sent.length})</h3>
          {sent.length === 0 ? (
            <p className="text-sm text-muted-foreground">Inga skickade rapporter än</p>
          ) : (
            <Card className="divide-y">
              {sent.map(c => (
                <div key={c.id} className="flex items-center gap-4 p-4">
                  <div className="flex-1 min-w-0">
                    <div className="font-medium truncate">{c.name}</div>
                    <div className="text-xs text-muted-foreground">{c.customer_name}</div>
                  </div>
                  <div className="text-xs text-muted-foreground">Skickad {format(new Date(c.report_sent_at!), "d MMM yyyy", { locale: sv })}</div>
                </div>
              ))}
            </Card>
          )}
        </div>
      </div>
    </>
  );
}
