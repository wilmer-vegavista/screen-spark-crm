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
import { format, parseISO } from "date-fns";
import { sv } from "date-fns/locale";

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

  const { data, isLoading } = useQuery({
    queryKey: ["rapport-ekonomi"],
    queryFn: async () => {
      const [{ data: products }, { data: orders }, { data: items }] = await Promise.all([
        supabase.from("products").select("id, name, city, owner_name, revenue_share_pct, live_date").order("name"),
        supabase.from("orders").select("id, company_name, invoice_start_date, created_at, status"),
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
    const orderDate = new Map<string, Date>();
    for (const o of data.orders) {
      const raw = (o as any).invoice_start_date || (o as any).created_at;
      if (raw) orderDate.set((o as any).id, typeof raw === "string" ? parseISO(raw) : raw);
    }
    const byProduct = new Map<string, { name: string; revenue: number; count: number }>();
    for (const it of data.items as any[]) {
      const d = orderDate.get(it.order_id);
      if (!d || d < from || d > to) continue;
      const key = it.product_id || `name:${it.product_name}`;
      const cur = byProduct.get(key) ?? { name: it.product_name || "Okänd", revenue: 0, count: 0 };
      cur.revenue += Number(it.unit_price || 0) * Number(it.weeks || 1);
      cur.count += 1;
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
                    {r.name}
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
