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
import { generateScreenReportPdf } from "@/lib/screen-report-pdf";
import { format, parseISO, addMonths, startOfISOWeek, endOfISOWeek, setISOWeek, setISOWeekYear, min as dmin, max as dmax } from "date-fns";
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

  const { data, isLoading } = useQuery({
    queryKey: ["rapport-ekonomi"],
    queryFn: async () => {
      const [{ data: products }, { data: orders }, { data: items }] = await Promise.all([
        supabase.from("products").select("id, name, city, owner_name, revenue_share_pct, live_date").order("name"),
        supabase.from("orders").select("id, company_name, invoice_start_date, created_at, status, billing_frequency, billing_duration_months"),
        supabase.from("order_items").select("order_id, product_id, product_name, unit_price, weeks"),
      ]);
      return {
        products: (products ?? []) as ProductRow[],
        orders: orders ?? [],
        items: items ?? [],
      };
    },
  });

  const { from, to } = periodRange(granularity, year, granularity === "ar" ? 0 : periodIdx);

  const rows = useMemo(() => {
    if (!data) return [];
    const orderById = new Map<string, any>();
    for (const o of data.orders) orderById.set((o as any).id, o);

    const byProduct = new Map<string, { name: string; revenue: number; count: number; detail: DetailRow[] }>();
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
      const cur = byProduct.get(key) ?? { name: it.product_name || "Okänd", revenue: 0, count: 0, detail: [] as DetailRow[] };
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
        });
      }
      byProduct.set(key, cur);

    }
    const list = data.products.map(p => {
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
      };
    });
    // products no longer in list but present in items
    for (const [key, agg] of byProduct) {
      if (data.products.some(p => p.id === key)) continue;
      list.push({
        product: null as any,
        name: agg.name,
        revenue: agg.revenue,
        orders: agg.count,
        share: 0,
        net: agg.revenue,
        detail: agg.detail,
      });
    }

    return list.sort((a, b) => b.revenue - a.revenue);
  }, [data, from.getTime(), to.getTime()]);

  const totals = rows.reduce(
    (s, r) => ({ revenue: s.revenue + r.revenue, share: s.share + r.share, net: s.net + r.net }),
    { revenue: 0, share: 0, net: 0 },
  );

  const years = Array.from({ length: 7 }, (_, i) => now.getFullYear() - 3 + i);
  const opts = periodOptions(granularity);

  return (
    <>
      <PageHeader
        title="Rapport ekonomi"
        description="Intäkt per skärm, ägare, fördelning och live-datum"
      />
      <div className="p-6 space-y-5">
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
          <Stat label="Fördelning" value={SEK(totals.share)} />
          <Stat label="Netto efter fördelning" value={SEK(totals.net)} />
        </div>

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
                <TableHead className="text-right">Fördelning</TableHead>
                <TableHead className="text-right">Netto</TableHead>
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
              {rows.map((r, i) => (
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
                  <TableCell className="text-sm">
                    {r.product?.live_date
                      ? format(parseISO(r.product.live_date), "d MMM yyyy", { locale: sv })
                      : <span className="text-muted-foreground">—</span>}
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
          {periodLabel} · Ägare: {row?.product?.owner_name || "—"} · Fördelning: {pct}%
        </div>
        <div className="max-h-[50vh] overflow-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Kund</TableHead>
                <TableHead>Datum</TableHead>
                <TableHead className="text-right">Perioder</TableHead>
                <TableHead className="text-right">Pris</TableHead>
                <TableHead className="text-right">Belopp</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {(row?.detail ?? []).length === 0 && (
                <TableRow><TableCell colSpan={5} className="text-sm text-muted-foreground">Inga ordrar i perioden</TableCell></TableRow>
              )}
              {(row?.detail ?? []).map((d: DetailRow, i: number) => (
                <TableRow key={`${d.orderId}-${i}`}>
                  <TableCell className="font-medium">{d.company}</TableCell>
                  <TableCell className="text-sm">{format(parseISO(d.date), "d MMM yyyy", { locale: sv })}</TableCell>
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
          <div><span className="text-muted-foreground">Fördelning:</span> <b>{SEK(share)}</b></div>
          <div><span className="text-muted-foreground">Netto:</span> <b>{SEK(total - share)}</b></div>
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
