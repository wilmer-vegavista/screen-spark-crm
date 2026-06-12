import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { PageHeader } from "@/components/page-header";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Clock, ShoppingCart, FileText } from "lucide-react";
import { addMonths, parseISO, setISOWeek, setISOWeekYear, startOfISOWeek, endOfISOWeek, min as dmin, max as dmax, format, differenceInDays } from "date-fns";
import { sv } from "date-fns/locale";

export const Route = createFileRoute("/_authenticated/avslutas-snart")({
  component: AvslutasSnartPage,
});

function AvslutasSnartPage() {
  const now = new Date();
  const thirtyDaysFromNow = new Date();
  thirtyDaysFromNow.setDate(now.getDate() + 30);
  const currentYear = now.getFullYear();

  const { data: orders } = useQuery({
    queryKey: ["orders-expiring"],
    queryFn: async () => {
      const { data } = await supabase
        .from("orders")
        .select("id, company_name, status, order_type, selected_weeks, exact_dates, invoice_start_date, billing_duration_months, total_excl_vat")
        .order("invoice_start_date", { ascending: true, nullsFirst: false });
      return data ?? [];
    },
  });

  const expiring = (orders ?? [])
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
        end =oreal(weekDates.map((x: any) => x.e));
      }
      return { ...o, _start: start, _end: end };
    })
    .filter((o: any) => {
      if (!o._end) return false;
      return o._end >= now && o._end <= thirtyDaysFromNow;
    })
    .sort((a: any, b: any) => a._end.getTime() - b._end.getTime());

  return (
    <>
      <PageHeader
        title="Avslutas snart"
        description="Ordrar och kampanjer som avslutas inom 30 dagar"
      />
      <div className="p-6 space-y-3">
        {expiring.length === 0 && (
          <Card className="p-8 text-center text-sm text-muted-foreground">
            Inga ordrar avslutas inom 30 dagar
          </Card>
        )}
        {expiring.map((o: any) => {
          const daysLeft = differenceInDays(o._end, now);
          return (
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
                  <Clock className="size-4 text-muted-foreground" />
                  <div>
                    <div className="text-sm font-semibold">{daysLeft} dag{daysLeft === 1 ? "" : "ar"} kvar</div>
                    <div className="text-xs text-muted-foreground">Avslutas {format(o._end, "d MMM", { locale: sv })}</div>
                  </div>
                </div>
              </div>
            </Card>
          );
        })}
      </div>
    </>
  );
}
