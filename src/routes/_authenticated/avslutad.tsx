import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { PageHeader } from "@/components/page-header";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { CheckCircle, ShoppingCart, FileText } from "lucide-react";
import { addMonths, parseISO, setISOWeek, setISOWeekYear, startOfISOWeek, endOfISOWeek, min as dmin, max as dmax, format } from "date-fns";
import { sv } from "date-fns/locale";

export const Route = createFileRoute("/_authenticated/avslutad")({
  component: AvslutadPage,
});

function AvslutadPage() {
  const now = new Date();
  const currentYear = now.getFullYear();

  const { data: orders } = useQuery({
    queryKey: ["orders-ended"],
    queryFn: async () => {
      const { data } = await supabase
        .from("orders")
        .select("id, company_name, status, order_type, selected_weeks, exact_dates, invoice_start_date, billing_duration_months, total_excl_vat")
        .order("invoice_start_date", { ascending: false, nullsFirst: false });
      return data ?? [];
    },
  });

  const ended = (orders ?? [])
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
    .filter((o: any) => {
      if (!o._end) return false;
      return o._end < now;
    })
    .sort((a: any, b: any) => b._end.getTime() - a._end.getTime());

  return (
    <>
      <PageHeader
        title="Avslutad"
        description="Ordrar och kampanjer som har avslutats"
      />
      <div className="p-6 space-y-3">
        {ended.length === 0 && (
          <Card className="p-8 text-center text-sm text-muted-foreground">
            Inga avslutade ordrar
          </Card>
        )}
        {ended.map((o: any) => (
          <Card key={o.id} className="p-4">
            <div className="flex items-center gap-4">
              <div className="size-10 rounded-md bg-accent flex items-center justify-center shrink-0">
                {o.order_type === "offert" ? <FileText className="size-5" /> : <ShoppingCart className="size-5" />}
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <span className="font-medium truncate">{o.company_name}</span>
                  <Badge variant={o.order_type === "offert" ? "secondary" : "default"}>
                    {o.order_type === "offert" ? "Offert" : "Bokning"}
                  </Badge>
                </div>
                <div className="text-xs text-muted-foreground">
                  {o._start && format(o._start, "d MMM yyyy", { locale: sv })} – {format(o._end, "d MMM yyyy", { locale: sv })}
                </div>
              </div>
              <div className="text-right flex items-center gap-2">
                <CheckCircle className="size-4 text-muted-foreground" />
                <div>
                  <div className="text-sm font-semibold">Avslutad</div>
                  <div className="text-xs text-muted-foreground">{format(o._end, "d MMM yyyy", { locale: sv })}</div>
                </div>
              </div>
            </div>
          </Card>
        ))}
      </div>
    </>
  );
}
