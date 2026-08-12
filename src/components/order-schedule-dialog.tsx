import { useEffect, useMemo, useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { CalendarPlus, Trash2 } from "lucide-react";
import { format, parseISO, eachWeekOfInterval, getISOWeek, isBefore } from "date-fns";
import { sv } from "date-fns/locale";
import type { DateRange } from "react-day-picker";
import { supabase } from "@/integrations/supabase/client";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";

type Period = { start: Date; end: Date };

const iso = (d: Date) => format(d, "yyyy-MM-dd");

function weeksOf(p: Period): number[] {
  return eachWeekOfInterval({ start: p.start, end: p.end }, { weekStartsOn: 1 }).map((d) => getISOWeek(d));
}

function fromExactDates(dates: string[] | null | undefined): Period[] {
  const list = [...(dates ?? [])].sort();
  const out: Period[] = [];
  for (let i = 0; i < list.length; i += 2) {
    const s = parseISO(list[i]);
    const e = list[i + 1] ? parseISO(list[i + 1]) : s;
    out.push({ start: s, end: e });
  }
  return out;
}

export function OrderScheduleDialog({
  open,
  onOpenChange,
  order,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  order: any | null;
}) {
  const qc = useQueryClient();
  const [periods, setPeriods] = useState<Period[]>([]);
  const [range, setRange] = useState<DateRange | undefined>();
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (open) {
      setPeriods(fromExactDates(order?.exact_dates));
      setRange(undefined);
    }
  }, [open, order?.id]);

  const allWeeks = useMemo(() => {
    const s = new Set<number>();
    periods.forEach((p) => weeksOf(p).forEach((w) => s.add(w)));
    return [...s].sort((a, b) => a - b);
  }, [periods]);

  const addPeriod = () => {
    if (!range?.from) return;
    let start = range.from;
    let end = range.to ?? range.from;
    if (isBefore(end, start)) [start, end] = [end, start];
    setPeriods((prev) => [...prev, { start, end }].sort((a, b) => a.start.getTime() - b.start.getTime()));
    setRange(undefined);
  };

  const save = async () => {
    if (!order) return;
    setSaving(true);
    const exact_dates = periods.flatMap((p) => [iso(p.start), iso(p.end)]);
    const { error } = await supabase
      .from("orders")
      .update({
        exact_dates,
        selected_weeks: allWeeks,
        production_status: periods.length ? "datum_bestamt" : order.production_status,
      })
      .eq("id", order.id);
    setSaving(false);
    if (error) return toast.error(error.message);
    toast.success("Perioder sparade");
    qc.invalidateQueries({ queryKey: ["produktion-orders"] });
    qc.invalidateQueries({ queryKey: ["orders"] });
    qc.invalidateQueries({ queryKey: ["orders-scheduled"] });
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl">
        <DialogHeader>
          <DialogTitle>Kampanjperioder – {order?.company_name}</DialogTitle>
        </DialogHeader>

        <div className="grid gap-6 md:grid-cols-[auto_1fr]">
          <div className="space-y-2">
            <div className="flex gap-2">
              <Select
                value={String(month.getMonth())}
                onValueChange={(v) => setMonth(new Date(month.getFullYear(), Number(v), 1))}
              >
                <SelectTrigger className="w-[140px]"><SelectValue /></SelectTrigger>
                <SelectContent className="bg-popover z-50">
                  {MONTHS.map((m, i) => (
                    <SelectItem key={m} value={String(i)}>{m}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Select
                value={String(month.getFullYear())}
                onValueChange={(v) => setMonth(new Date(Number(v), month.getMonth(), 1))}
              >
                <SelectTrigger className="w-[110px]"><SelectValue /></SelectTrigger>
                <SelectContent className="bg-popover z-50">
                  {YEARS.map((y) => (
                    <SelectItem key={y} value={String(y)}>{y}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <Calendar
              mode="range"
              numberOfMonths={2}
              locale={sv}
              weekStartsOn={1}
              month={month}
              onMonthChange={setMonth}
              selected={range}
              onSelect={setRange}
              className="pointer-events-auto"
            />
            <Button size="sm" className="w-full" disabled={!range?.from} onClick={addPeriod}>
              <CalendarPlus className="size-4 mr-1" /> Lägg till period
            </Button>
            <p className="text-xs text-muted-foreground">
              Välj startdatum och sedan slutdatum, lägg till perioden. Du kan lägga till flera perioder.
            </p>
          </div>

          <div className="space-y-3">
            <div className="text-sm font-medium">Valda perioder ({periods.length})</div>
            {periods.length === 0 ? (
              <p className="text-sm text-muted-foreground">Inga perioder valda ännu.</p>
            ) : (
              <div className="space-y-2">
                {periods.map((p, i) => (
                  <div key={i} className="flex items-center justify-between gap-2 rounded-md border p-2">
                    <div className="min-w-0">
                      <div className="text-sm font-medium">
                        {format(p.start, "d MMM yyyy", { locale: sv })} – {format(p.end, "d MMM yyyy", { locale: sv })}
                      </div>
                    </div>
                    <Button
                      size="icon"
                      variant="ghost"
                      onClick={() => setPeriods((prev) => prev.filter((_, idx) => idx !== i))}
                    >
                      <Trash2 className="size-4" />
                    </Button>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>


        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Avbryt</Button>
          <Button onClick={save} disabled={saving}>Spara</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
