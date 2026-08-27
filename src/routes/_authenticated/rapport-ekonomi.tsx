import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useCurrentUser } from "@/lib/hooks/use-current-user";
import { PageHeader } from "@/components/page-header";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { toast } from "sonner";
import { Pencil, FileDown } from "lucide-react";
import { generateScreenReportPdf, generateOwnerReportPdf } from "@/lib/screen-report-pdf";
import { format, parseISO, addMonths, addWeeks, addQuarters, startOfWeek, endOfWeek, startOfMonth, endOfMonth, startOfQuarter, endOfQuarter, startOfISOWeek, endOfISOWeek, setISOWeek, setISOWeekYear, min as dmin, max as dmax } from "date-fns";
import { sv } from "date-fns/locale";
import { buildInvoiceSchedule, type BillingFrequency } from "@/lib/billing";

export const Route = createFileRoute("/_authenticated/rapport-ekonomi")({
  head: () => ({
    meta: [
      { title: "Rapport ekonomi — Vega Vista CRM" },
      { name: "description", content: "Intäkter per skärm, ägare, fördelning och live-datum." },
      { property: "og:title", content: "Rapport ekonomi — Vega Vista CRM" },
      { property: "og:description", content: "Intäkter per skärm, ägare, fördelning och live-datum." },
    ],
  }),
  component: RapportEkonomiPage,
});

type Granularity = "manad" | "kvartal" | "halvar" | "ar";

type DetailRow = {
  orderId: string;
  company: string;
  date: string;
  weeks: number;
  unitPrice: number;
  amount: number;
  live?: string | null;
  metric?: string;
  period?: string;
};

/** Live-perioden för en order: valda exakta datum, annars valda veckor, annars fakturastart */
function orderLiveRange(o: any): { start: Date; end: Date } | null {
  if (Array.isArray(o?.exact_dates) && o.exact_dates.length) {
    const ds = o.exact_dates.map((d: string) => parseISO(d)).filter((d: Date) => !isNaN(d.getTime()));
    if (ds.length) return { start: dmin(ds), end: dmax(ds) };
  }
  const base = o?.invoice_start_date ? parseISO(o.invoice_start_date) : o?.created_at ? parseISO(o.created_at) : null;
  if (Array.isArray(o?.selected_weeks) && o.selected_weeks.length) {
    const year = base && !isNaN(base.getTime()) ? base.getFullYear() : new Date().getFullYear();
    const ranges = o.selected_weeks.map((w: number) => {
      const d = setISOWeek(setISOWeekYear(new Date(year, 5, 1), year), w);
      return { s: startOfISOWeek(d), e: endOfISOWeek(d) };
    });
    return { start: dmin(ranges.map((r: any) => r.s)), end: dmax(ranges.map((r: any) => r.e)) };
  }
  if (base && !isNaN(base.getTime())) {
    return { start: base, end: addMonths(base, Number(o?.billing_duration_months || 1)) };
  }
  return null;
}

const liveLabel = (start?: Date | null, end?: Date | null) => {
  if (!start) return null;
  const s = format(start, "d MMM yyyy", { locale: sv });
  if (!end || format(end, "yyyy-MM-dd") === format(start, "yyyy-MM-dd")) return s;
  return `${s} – ${format(end, "d MMM yyyy", { locale: sv })}`;
};

type ProductRow = {
  id: string;
  name: string;
  city: string | null;
  owner_name: string | null;
  revenue_share_pct: number | null;
  live_date: string | null;
};

const SEK = (n: number) =>
  new Intl.NumberFormat("sv-SE", { style: "currency", currency: "SEK", maximumFractionDigits: 0 }).format(n || 0);

function periodOptions(g: Granularity) {
  if (g === "manad")
    return Array.from({ length: 12 }, (_, i) => ({
      value: String(i),
      label: format(new Date(2000, i, 1), "MMMM", { locale: sv }),
    }));
  if (g === "kvartal") return [0, 1, 2, 3].map(i => ({ value: String(i), label: `Q${i + 1}` }));
  if (g === "halvar") return [0, 1].map(i => ({ value: String(i), label: i === 0 ? "H1 (jan–jun)" : "H2 (jul–dec)" }));
  return [{ value: "0", label: "Hela året" }];
}

function periodRange(g: Granularity, year: number, idx: number) {
  const startMonth = g === "manad" ? idx : g === "kvartal" ? idx * 3 : g === "halvar" ? idx * 6 : 0;
  const months = g === "manad" ? 1 : g === "kvartal" ? 3 : g === "halvar" ? 6 : 12;
  const from = new Date(year, startMonth, 1);
  const to = new Date(year, startMonth + months, 0, 23, 59, 59);
  return { from, to };
}

const periodUnitLabel: Record<string, [string, string]> = {
  veckor: ["vecka", "veckor"],
  manader: ["månad", "månader"],
  ar: ["år", "år"],
};

function metricLabel(it: any) {
  if (it.sov_pct != null && Number(it.sov_pct) > 0) return `${Number(it.sov_pct)}% SOV`;
  if (it.impressions != null && Number(it.impressions) > 0)
    return `${new Intl.NumberFormat("sv-SE").format(Number(it.impressions))} visningar/dag`;
  return "—";
}

function periodTextOf(it: any) {
  const n = Number(it.weeks || 1);
  const pair = periodUnitLabel[it.period_unit as string] ?? periodUnitLabel.veckor;
  return `${n} ${n === 1 ? pair[0] : pair[1]}`;
}

function computeRows(data: any, from: Date, to: Date) {
  if (!data) return [] as any[];
  const orderById = new Map<string, any>();
  for (const o of data.orders) orderById.set((o as any).id, o);

  type Agg = { name: string; revenue: number; count: number; detail: DetailRow[]; liveStart: Date | null; liveEnd: Date | null };
  const byProduct = new Map<string, Agg>();
  for (const it of data.items as any[]) {
    const o = orderById.get(it.order_id);
    if (!o) continue;
    const total = Number(it.unit_price || 0) * Number(it.weeks || 1);
    // Månads-/kvartals-/halvårsfakturerade ordrar räknas per faktureringstillfälle
    const schedule = buildInvoiceSchedule(
      o.invoice_start_date || o.created_at,
      (o.billing_frequency ?? "engang") as BillingFrequency,
      Number(o.billing_duration_months ?? 0),
      total,
    );
    const recurring = (o.billing_frequency ?? "engang") !== "engang";
    const hits = schedule.filter(e => e.date >= from && e.date <= to);
    if (hits.length === 0) continue;
    const key = it.product_id || `name:${it.product_name}`;
    const cur: Agg = byProduct.get(key) ?? { name: it.product_name || "Okänd", revenue: 0, count: 0, detail: [], liveStart: null, liveEnd: null };
    const live = orderLiveRange(o);
    if (live) {
      cur.liveStart = cur.liveStart && cur.liveStart < live.start ? cur.liveStart : live.start;
      cur.liveEnd = cur.liveEnd && cur.liveEnd > live.end ? cur.liveEnd : live.end;
    }
    for (const h of hits) {
      cur.revenue += h.amount;
      cur.count += 1;
      cur.detail.push({
        orderId: it.order_id,
        company:
          (o.company_name || "Okänd kund") +
          (recurring ? ` (delfaktura ${schedule.indexOf(h) + 1}/${schedule.length})` : ""),
        date: h.date.toISOString(),
        weeks: Number(it.weeks || 1),
        unitPrice: recurring ? h.amount : Number(it.unit_price || 0),
        amount: h.amount,
        live: live ? liveLabel(live.start, live.end) : null,
        metric: metricLabel(it),
        period: periodTextOf(it),
      });
    }
    byProduct.set(key, cur);
  }

  const list = data.products.map((p: ProductRow) => {
    const agg = byProduct.get(p.id);
    const revenue = agg?.revenue ?? 0;
    const pct = Number(p.revenue_share_pct ?? 0);
    return {
      product: p,
      name: p.name,
      revenue,
      orders: agg?.count ?? 0,
      share: (revenue * pct) / 100,
      net: revenue - (revenue * pct) / 100,
      detail: agg?.detail ?? [],
      live: liveLabel(agg?.liveStart ?? null, agg?.liveEnd ?? null)
        ?? (p.live_date ? format(parseISO(p.live_date), "d MMM yyyy", { locale: sv }) : null),
    };
  });
  for (const [key, agg] of byProduct) {
    if (data.products.some((p: ProductRow) => p.id === key)) continue;
    list.push({
      product: null as any,
      name: agg.name,
      revenue: agg.revenue,
      orders: agg.count,
      share: 0,
      net: agg.revenue,
      detail: agg.detail,
      live: liveLabel(agg.liveStart, agg.liveEnd),
    });
  }

  return list.sort((a: any, b: any) => b.revenue - a.revenue);
}


function RapportEkonomiPage() {
  const { isAdmin } = useCurrentUser();
  if (!isAdmin) {
    return (
      <>
        <PageHeader title="Rapport ekonomi" />
        <div className="p-6">
          <Card className="p-6 text-sm text-muted-foreground">Du har inte behörighet att se denna sida.</Card>
        </div>
      </>
    );
  }
  return <ReportView />;
}

function ReportView() {
  const qc = useQueryClient();
  const now = new Date();
  const [granularity, setGranularity] = useState<Granularity>("manad");
  const [year, setYear] = useState(now.getFullYear());
  const [periodIdx, setPeriodIdx] = useState(now.getMonth());
  const [editing, setEditing] = useState<ProductRow | null>(null);
  const [detail, setDetail] = useState<any | null>(null);
  const [ownerDetail, setOwnerDetail] = useState<string | null>(null);

  const { data, isLoading } = useQuery({
    queryKey: ["rapport-ekonomi"],
    queryFn: async () => {
      const [{ data: products }, { data: orders }, { data: items }] = await Promise.all([
        supabase.from("products").select("id, name, city, owner_name, revenue_share_pct, live_date").order("name"),
        supabase.from("orders").select("id, company_name, invoice_start_date, created_at, status, billing_frequency, billing_duration_months, selected_weeks, exact_dates"),
        supabase.from("order_items").select("order_id, product_id, product_name, unit_price, weeks, sov_pct, impressions, period_unit"),
      ]);
      return {
        products: (products ?? []) as ProductRow[],
        orders: orders ?? [],
        items: items ?? [],
      };
    },
  });

  const { from, to } = periodRange(granularity, year, granularity === "ar" ? 0 : periodIdx);

  const rows = useMemo(() => computeRows(data, from, to), [data, from.getTime(), to.getTime()]);

  const totals = rows.reduce(
    (s: any, r: any) => ({ revenue: s.revenue + r.revenue, share: s.share + r.share, net: s.net + r.net }),
    { revenue: 0, share: 0, net: 0 },
  );

  const ownerRows = useMemo(() => {
    const m = new Map<string, { owner: string; screens: number; revenue: number; share: number; net: number }>();
    for (const r of rows) {
      if (!r.revenue) continue;
      const owner = r.product?.owner_name?.trim() || "Utan ägare";
      const cur = m.get(owner) ?? { owner, screens: 0, revenue: 0, share: 0, net: 0 };
      cur.screens += 1;
      cur.revenue += r.revenue;
      cur.share += r.share;
      cur.net += r.net;
      m.set(owner, cur);
    }
    return Array.from(m.values()).sort((a, b) => b.revenue - a.revenue);
  }, [rows]);

  const years = Array.from({ length: 7 }, (_, i) => now.getFullYear() - 3 + i);
  const opts = periodOptions(granularity);

  return (
    <>
      <PageHeader
        title="Rapport ekonomi"
        description="Intäkt per skärm, ägare, fördelning och live-datum"
      />
      <div className="p-6 space-y-5">
        <Tabs defaultValue="skarmar" className="space-y-5">
          <TabsList>
            <TabsTrigger value="skarmar">Skärmar</TabsTrigger>
            <TabsTrigger value="abonnemang">Abonnemang</TabsTrigger>
          </TabsList>
          <TabsContent value="abonnemang" className="space-y-5">
            <SubscriptionTab data={data} year={year} setYear={setYear} years={years} />
          </TabsContent>
          <TabsContent value="skarmar" className="space-y-5">
        <Card className="p-4 flex flex-wrap items-end gap-3">

          <div className="space-y-1">
            <Label className="text-xs">Period</Label>
            <Select
              value={granularity}
              onValueChange={v => {
                const g = v as Granularity;
                setGranularity(g);
                setPeriodIdx(g === "manad" ? now.getMonth() : 0);
              }}
            >
              <SelectTrigger className="w-40"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="manad">Månad</SelectItem>
                <SelectItem value="kvartal">Kvartal</SelectItem>
                <SelectItem value="halvar">Halvår</SelectItem>
                <SelectItem value="ar">År</SelectItem>
              </SelectContent>
            </Select>
          </div>
          {granularity !== "ar" && (
            <div className="space-y-1">
              <Label className="text-xs">Välj</Label>
              <Select value={String(periodIdx)} onValueChange={v => setPeriodIdx(Number(v))}>
                <SelectTrigger className="w-44"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {opts.map(o => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          )}
          <div className="space-y-1">
            <Label className="text-xs">År</Label>
            <Select value={String(year)} onValueChange={v => setYear(Number(v))}>
              <SelectTrigger className="w-28"><SelectValue /></SelectTrigger>
              <SelectContent>
                {years.map(y => <SelectItem key={y} value={String(y)}>{y}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div className="ml-auto text-xs text-muted-foreground">
            {format(from, "d MMM yyyy", { locale: sv })} – {format(to, "d MMM yyyy", { locale: sv })}
          </div>
        </Card>

        <div className="grid gap-3 sm:grid-cols-3">
          <Stat label="Total intäkt" value={SEK(totals.revenue)} />
          <Stat label="Fördelning till ägare" value={SEK(totals.share)} />
          <Stat label="Kvar till oss" value={SEK(totals.net)} />
        </div>

        <Card>
          <div className="px-4 pt-4 pb-2 text-sm font-semibold">Per ägare</div>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Ägare</TableHead>
                <TableHead className="text-right">Skärmar</TableHead>
                <TableHead className="text-right">Intäkt</TableHead>
                <TableHead className="text-right">Till ägare</TableHead>
                <TableHead className="text-right">Kvar till oss</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {ownerRows.length === 0 && (
                <TableRow><TableCell colSpan={5} className="text-muted-foreground">Ingen försäljning i perioden</TableCell></TableRow>
              )}
              {ownerRows.map(o => (
                <TableRow key={o.owner}>
                  <TableCell className="font-medium">
                    <button type="button" className="text-left hover:underline" onClick={() => setOwnerDetail(o.owner)}>
                      {o.owner}
                    </button>
                  </TableCell>
                  <TableCell className="text-right">{o.screens}</TableCell>
                  <TableCell className="text-right">{SEK(o.revenue)}</TableCell>
                  <TableCell className="text-right">{SEK(o.share)}</TableCell>
                  <TableCell className="text-right">{SEK(o.net)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </Card>


        <Card>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Skärm</TableHead>
                <TableHead>Ägare</TableHead>
                <TableHead>Live</TableHead>
                <TableHead className="text-right">Ordrar</TableHead>
                <TableHead className="text-right">Intäkt</TableHead>
                <TableHead className="text-right">Fördelning %</TableHead>
                <TableHead className="text-right">Till ägare</TableHead>
                <TableHead className="text-right">Kvar till oss</TableHead>
                <TableHead />
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading && (
                <TableRow><TableCell colSpan={9} className="text-sm text-muted-foreground">Laddar…</TableCell></TableRow>
              )}
              {!isLoading && rows.length === 0 && (
                <TableRow><TableCell colSpan={9} className="text-sm text-muted-foreground">Inga skärmar</TableCell></TableRow>
              )}
              {rows.map((r: any, i: number) => (
                <TableRow key={r.product?.id ?? `x-${i}`}>
                  <TableCell className="font-medium">
                    <button
                      type="button"
                      className="text-left hover:underline"
                      onClick={() => setDetail(r)}
                    >
                      {r.name}
                    </button>
                    {r.product?.city && <span className="text-xs text-muted-foreground"> · {r.product.city}</span>}
                  </TableCell>
                  <TableCell className="text-sm">{r.product?.owner_name || <span className="text-muted-foreground">—</span>}</TableCell>
                  <TableCell className="text-sm whitespace-nowrap">
                    {r.live || <span className="text-muted-foreground">—</span>}
                  </TableCell>
                  <TableCell className="text-right text-sm">{r.orders}</TableCell>
                  <TableCell className="text-right font-medium">{SEK(r.revenue)}</TableCell>
                  <TableCell className="text-right text-sm">{Number(r.product?.revenue_share_pct ?? 0)}%</TableCell>
                  <TableCell className="text-right text-sm">{SEK(r.share)}</TableCell>
                  <TableCell className="text-right text-sm">{SEK(r.net)}</TableCell>
                  <TableCell className="text-right">
                    {r.product && (
                      <Button variant="ghost" size="icon" onClick={() => setEditing(r.product)}>
                        <Pencil className="size-4" />
                      </Button>
                    )}
                  </TableCell>
                </TableRow>
              ))}
              {rows.length > 0 && (
                <TableRow className="bg-muted/40 font-semibold">
                  <TableCell colSpan={4}>Totalt</TableCell>
                  <TableCell className="text-right">{SEK(totals.revenue)}</TableCell>
                  <TableCell />
                  <TableCell className="text-right">{SEK(totals.share)}</TableCell>
                  <TableCell className="text-right">{SEK(totals.net)}</TableCell>
                  <TableCell />
                </TableRow>
              )}
            </TableBody>
          </Table>
        </Card>
      </div>

      <DetailDialog
        row={detail}
        periodLabel={`${format(from, "d MMM yyyy", { locale: sv })} – ${format(to, "d MMM yyyy", { locale: sv })}`}
        onClose={() => setDetail(null)}
      />

      <OwnerDialog owner={ownerDetail} data={data} onClose={() => setOwnerDetail(null)} />



      <EditDialog
        product={editing}
        onClose={() => setEditing(null)}
        onSaved={() => {
          setEditing(null);
          qc.invalidateQueries({ queryKey: ["rapport-ekonomi"] });
        }}
      />
    </>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <Card className="p-4">
      <div className="text-xs uppercase tracking-wider text-muted-foreground">{label}</div>
      <div className="mt-1 text-2xl font-semibold tracking-tight">{value}</div>
    </Card>
  );
}

function EditDialog({
  product,
  onClose,
  onSaved,
}: {
  product: ProductRow | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [owner, setOwner] = useState("");
  const [pct, setPct] = useState("0");
  const [live, setLive] = useState("");
  const [saving, setSaving] = useState(false);
  const [loadedFor, setLoadedFor] = useState<string | null>(null);

  if (product && loadedFor !== product.id) {
    setLoadedFor(product.id);
    setOwner(product.owner_name ?? "");
    setPct(String(product.revenue_share_pct ?? 0));
    setLive(product.live_date ?? "");
  }

  const save = async () => {
    if (!product) return;
    setSaving(true);
    const { error } = await supabase
      .from("products")
      .update({
        owner_name: owner || null,
        revenue_share_pct: Number(pct) || 0,
        live_date: live || null,
      })
      .eq("id", product.id);
    setSaving(false);
    if (error) toast.error(error.message);
    else {
      toast.success("Sparat");
      onSaved();
    }
  };

  return (
    <Dialog open={!!product} onOpenChange={o => !o && onClose()}>
      <DialogContent>
        <DialogHeader><DialogTitle>{product?.name}</DialogTitle></DialogHeader>
        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label>Ägare av skärmen</Label>
            <Input value={owner} onChange={e => setOwner(e.target.value)} placeholder="T.ex. Fastighets AB" />
          </div>
          <div className="space-y-1.5">
            <Label>Fördelning %</Label>
            <Input type="number" min={0} max={100} step="0.1" value={pct} onChange={e => setPct(e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label>Går live</Label>
            <Input type="date" value={live} onChange={e => setLive(e.target.value)} />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Avbryt</Button>
          <Button onClick={save} disabled={saving}>Spara</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function DetailDialog({
  row,
  periodLabel,
  onClose,
}: {
  row: any | null;
  periodLabel: string;
  onClose: () => void;
}) {
  const pct = Number(row?.product?.revenue_share_pct ?? 0);
  const total = (row?.detail ?? []).reduce((s: number, d: DetailRow) => s + d.amount, 0);
  const share = (total * pct) / 100;

  return (
    <Dialog open={!!row} onOpenChange={o => !o && onClose()}>
      <DialogContent className="max-w-3xl">
        <DialogHeader>
          <DialogTitle>{row?.name}</DialogTitle>
        </DialogHeader>
        <div className="text-xs text-muted-foreground">
          {periodLabel} · Ägare: {row?.product?.owner_name || "—"} · Fördelning till ägare: {pct}%
        </div>
        <div className="max-h-[50vh] overflow-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Kund</TableHead>
                <TableHead>Orderdatum</TableHead>
                <TableHead>Går live</TableHead>
                <TableHead className="text-right">Perioder</TableHead>
                <TableHead className="text-right">Pris</TableHead>
                <TableHead className="text-right">Belopp</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {(row?.detail ?? []).length === 0 && (
                <TableRow><TableCell colSpan={6} className="text-sm text-muted-foreground">Inga ordrar i perioden</TableCell></TableRow>
              )}
              {(row?.detail ?? []).map((d: DetailRow, i: number) => (
                <TableRow key={`${d.orderId}-${i}`}>
                  <TableCell className="font-medium">{d.company}</TableCell>
                  <TableCell className="text-sm">{format(parseISO(d.date), "d MMM yyyy", { locale: sv })}</TableCell>
                  <TableCell className="text-sm whitespace-nowrap">{d.live || "—"}</TableCell>
                  <TableCell className="text-right text-sm">{d.weeks}</TableCell>
                  <TableCell className="text-right text-sm">{SEK(d.unitPrice)}</TableCell>
                  <TableCell className="text-right font-medium">{SEK(d.amount)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
        <div className="grid gap-2 sm:grid-cols-3 text-sm">
          <div><span className="text-muted-foreground">Total intäkt:</span> <b>{SEK(total)}</b></div>
          <div><span className="text-muted-foreground">Till ägare ({pct}%):</span> <b>{SEK(share)}</b></div>
          <div><span className="text-muted-foreground">Kvar till oss:</span> <b>{SEK(total - share)}</b></div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Stäng</Button>
          <Button
            onClick={() =>
              generateScreenReportPdf({
                screenName: row.name,
                city: row?.product?.city ?? null,
                ownerName: row?.product?.owner_name ?? null,
                sharePct: pct,
                periodLabel,
                rows: row.detail ?? [],
              })
            }
          >
            <FileDown className="size-4" /> Exportera PDF
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

type OwnerScope = "vecka" | "manad" | "kvartal";

function ownerScopeRange(scope: OwnerScope, offset: number) {
  const base = new Date();
  if (scope === "vecka") {
    const d = addWeeks(base, offset);
    return { from: startOfWeek(d, { locale: sv }), to: endOfWeek(d, { locale: sv }) };
  }
  if (scope === "manad") {
    const d = addMonths(base, offset);
    return { from: startOfMonth(d), to: endOfMonth(d) };
  }
  const d = addQuarters(base, offset);
  return { from: startOfQuarter(d), to: endOfQuarter(d) };
}

function OwnerDialog({ owner, data, onClose }: { owner: string | null; data: any; onClose: () => void }) {
  const [scope, setScope] = useState<OwnerScope>("manad");
  const [offset, setOffset] = useState(0);

  const { from, to } = ownerScopeRange(scope, offset);
  const periodLabel = `${format(from, "d MMM yyyy", { locale: sv })} – ${format(to, "d MMM yyyy", { locale: sv })}`;

  const { rows, total, sharePct, share } = useMemo(() => {
    if (!owner || !data) return { rows: [] as any[], total: 0, sharePct: null as number | null, share: 0 };
    const all = computeRows(data, from, to);
    const mine = all.filter((r: any) => (r.product?.owner_name?.trim() || "Utan ägare") === owner);
    const list: any[] = [];
    let sum = 0;
    let shareSum = 0;
    for (const r of mine) {
      const pct = Number(r.product?.revenue_share_pct ?? 0);
      for (const d of r.detail as DetailRow[]) {
        list.push({
          company: d.company,
          screen: r.name,
          date: d.date,
          metric: d.metric ?? "—",
          period: d.period ?? `${d.weeks}`,
          amount: d.amount,
        });
        sum += d.amount;
        shareSum += (d.amount * pct) / 100;
      }
    }
    list.sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());
    const pctAvg = sum > 0 ? Math.round((shareSum / sum) * 1000) / 10 : null;
    return { rows: list, total: sum, sharePct: pctAvg, share: shareSum };
  }, [owner, data, from.getTime(), to.getTime()]);

  return (
    <Dialog open={!!owner} onOpenChange={o => !o && onClose()}>
      <DialogContent className="max-w-4xl">
        <DialogHeader><DialogTitle>Bokningar – {owner}</DialogTitle></DialogHeader>

        <div className="flex flex-wrap items-center gap-2">
          <Select value={scope} onValueChange={v => { setScope(v as OwnerScope); setOffset(0); }}>
            <SelectTrigger className="w-36"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="vecka">Veckan</SelectItem>
              <SelectItem value="manad">Månaden</SelectItem>
              <SelectItem value="kvartal">Kvartalet</SelectItem>
            </SelectContent>
          </Select>
          <Button variant="outline" size="sm" onClick={() => setOffset(o => o - 1)}>Föregående</Button>
          <Button variant="outline" size="sm" onClick={() => setOffset(0)}>Nu</Button>
          <Button variant="outline" size="sm" onClick={() => setOffset(o => o + 1)}>Nästa</Button>
          <span className="text-xs text-muted-foreground ml-auto">{periodLabel}</span>
        </div>

        <div className="max-h-[50vh] overflow-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Kund</TableHead>
                <TableHead>Skärm</TableHead>
                <TableHead>Orderdatum</TableHead>
                <TableHead>SOV / visningar</TableHead>
                <TableHead>Period</TableHead>
                <TableHead className="text-right">Pris</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.length === 0 && (
                <TableRow><TableCell colSpan={6} className="text-sm text-muted-foreground">Inga bokningar i perioden</TableCell></TableRow>
              )}
              {rows.map((r, i) => (
                <TableRow key={i}>
                  <TableCell className="font-medium">{r.company}</TableCell>
                  <TableCell className="text-sm">{r.screen}</TableCell>
                  <TableCell className="text-sm">{format(parseISO(r.date), "d MMM yyyy", { locale: sv })}</TableCell>
                  <TableCell className="text-sm">{r.metric}</TableCell>
                  <TableCell className="text-sm">{r.period}</TableCell>
                  <TableCell className="text-right font-medium">{SEK(r.amount)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>

        <div className="grid gap-2 sm:grid-cols-3 text-sm">
          <div><span className="text-muted-foreground">Total intäkt:</span> <b>{SEK(total)}</b></div>
          <div><span className="text-muted-foreground">Till ägare:</span> <b>{SEK(share)}</b></div>
          <div><span className="text-muted-foreground">Kvar till oss:</span> <b>{SEK(total - share)}</b></div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Stäng</Button>
          <Button
            onClick={() =>
              generateOwnerReportPdf({
                ownerName: owner || "",
                periodLabel,
                sharePct,
                rows,
              })
            }
          >
            <FileDown className="size-4" /> Exportera PDF
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
