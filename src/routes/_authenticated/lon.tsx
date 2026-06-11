import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useCurrentUser } from "@/lib/hooks/use-current-user";
import { PageHeader } from "@/components/page-header";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { toast } from "sonner";
import { Wallet, Plus, Pencil, Trash2 } from "lucide-react";
import { format, startOfMonth, endOfMonth, addMonths } from "date-fns";
import { sv } from "date-fns/locale";

export const Route = createFileRoute("/_authenticated/lon")({
  component: LonPage,
});

const fmt = (n: number) =>
  new Intl.NumberFormat("sv-SE", { style: "currency", currency: "SEK", maximumFractionDigits: 0 }).format(n || 0);

function LonPage() {
  const { user, isAdmin } = useCurrentUser();
  const [monthOffset, setMonthOffset] = useState(0);
  const month = useMemo(() => addMonths(new Date(), monthOffset), [monthOffset]);
  const monthStart = startOfMonth(month);
  const monthEnd = endOfMonth(month);

  return (
    <>
      <PageHeader
        title="Lön"
        description={isAdmin ? "Översikt och administration av provision" : "Din lön och provision denna månad"}
      />
      <div className="p-6 space-y-6">
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={() => setMonthOffset(o => o - 1)}>← Föregående</Button>
          <div className="text-sm font-medium px-3 capitalize">{format(month, "LLLL yyyy", { locale: sv })}</div>
          <Button variant="outline" size="sm" onClick={() => setMonthOffset(o => o + 1)} disabled={monthOffset >= 0}>Nästa →</Button>
        </div>

        {isAdmin ? (
          <Tabs defaultValue="min">
            <TabsList>
              <TabsTrigger value="min">Min lön</TabsTrigger>
              <TabsTrigger value="alla">Alla säljare</TabsTrigger>
              <TabsTrigger value="produkter">Produkter & provision</TabsTrigger>
              <TabsTrigger value="saljare">Säljarinställningar</TabsTrigger>
            </TabsList>
            <TabsContent value="min" className="mt-4">
              {user && <SalaryCard userId={user.id} from={monthStart} to={monthEnd} />}
            </TabsContent>
            <TabsContent value="alla" className="mt-4">
              <AllSellers from={monthStart} to={monthEnd} />
            </TabsContent>
            <TabsContent value="produkter" className="mt-4">
              <ProductsAdmin />
            </TabsContent>
            <TabsContent value="saljare" className="mt-4">
              <CompensationAdmin />
            </TabsContent>
          </Tabs>
        ) : (
          user && <SalaryCard userId={user.id} from={monthStart} to={monthEnd} />
        )}
      </div>
    </>
  );
}

// ---------- Salary calc ----------
// Pick the right commission % for a deal given the seller's compensation type
function pickPct(deal: any, product: any, compType: string, defaultPct: number) {
  if (deal.commission_pct_override != null) return Number(deal.commission_pct_override);
  if (product) {
    const col = compType === "endast_provision" ? product.commission_pct_provision_only : product.commission_pct_with_base;
    if (col != null) return Number(col);
    if (product.default_commission_pct != null) return Number(product.default_commission_pct);
  }
  return defaultPct;
}

function useSalary(userId: string, from: Date, to: Date) {
  return useQuery({
    queryKey: ["salary", userId, from.toISOString(), to.toISOString()],
    queryFn: async () => {
      const [{ data: comp }, { data: deals }, { data: products }] = await Promise.all([
        supabase.from("seller_compensation").select("*").eq("user_id", userId).maybeSingle(),
        supabase
          .from("deals")
          .select("*")
          .eq("owner_id", userId)
          .eq("stage", "vunnen")
          .gte("won_at", from.toISOString())
          .lte("won_at", to.toISOString()),
        supabase.from("products").select("*"),
      ]);
      const prodMap = new Map((products ?? []).map(p => [p.id, p]));
      const compType = comp?.compensation_type ?? "med_grundlon";
      const baseSalary = compType === "endast_provision" ? 0 : Number(comp?.base_salary ?? 0);
      const defaultPct = Number(comp?.default_commission_pct ?? 0);
      const rows = (deals ?? []).map(d => {
        const product = d.product_id ? prodMap.get(d.product_id) : null;
        const pct = pickPct(d, product, compType, defaultPct);
        const value = Number(d.value ?? 0);
        const commission = (value * pct) / 100;
        return { id: d.id, title: d.title, product: product?.name ?? "—", value, pct, commission, won_at: d.won_at };
      });
      const totalCommission = rows.reduce((s, r) => s + r.commission, 0);
      const totalValue = rows.reduce((s, r) => s + r.value, 0);
      return { comp, compType, rows, baseSalary, defaultPct, totalCommission, totalValue, total: baseSalary + totalCommission };
    },
  });
}

function SalaryCard({ userId, from, to }: { userId: string; from: Date; to: Date }) {
  const { data, isLoading } = useSalary(userId, from, to);
  if (isLoading || !data) return <Card className="p-6 text-sm text-muted-foreground">Laddar…</Card>;
  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <StatCard label="Grundlön" value={fmt(data.baseSalary)} />
        <StatCard label="Provision" value={fmt(data.totalCommission)} sub={`${data.rows.length} vunna affärer · ${fmt(data.totalValue)}`} />
        <StatCard label="Totalt denna månad" value={fmt(data.total)} highlight />
      </div>
      <Card>
        <div className="p-4 border-b flex items-center gap-2">
          <Wallet className="size-4 text-muted-foreground" />
          <h3 className="text-sm font-semibold">Vunna affärer</h3>
        </div>
        {data.rows.length === 0 ? (
          <div className="p-6 text-sm text-muted-foreground text-center">Inga vunna affärer i denna månad</div>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Affär</TableHead>
                <TableHead>Produkt</TableHead>
                <TableHead>Stängd</TableHead>
                <TableHead className="text-right">Värde</TableHead>
                <TableHead className="text-right">%</TableHead>
                <TableHead className="text-right">Provision</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {data.rows.map(r => (
                <TableRow key={r.id}>
                  <TableCell className="font-medium">{r.title}</TableCell>
                  <TableCell>{r.product}</TableCell>
                  <TableCell className="text-muted-foreground text-xs">{r.won_at ? format(new Date(r.won_at), "d MMM", { locale: sv }) : "—"}</TableCell>
                  <TableCell className="text-right">{fmt(r.value)}</TableCell>
                  <TableCell className="text-right">{r.pct}%</TableCell>
                  <TableCell className="text-right font-medium">{fmt(r.commission)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </Card>
      {!data.comp && (
        <Card className="p-4 text-xs text-warning border-warning/40">
          Ingen kompensation är satt för dig än. Be admin sätta grundlön och provision under fliken "Säljarinställningar".
        </Card>
      )}
    </div>
  );
}

function StatCard({ label, value, sub, highlight }: { label: string; value: string; sub?: string; highlight?: boolean }) {
  return (
    <Card className={`p-4 ${highlight ? "border-primary/40" : ""}`}>
      <div className="text-xs text-muted-foreground uppercase tracking-wider">{label}</div>
      <div className={`mt-1 text-2xl font-semibold ${highlight ? "text-primary" : ""}`}>{value}</div>
      {sub && <div className="mt-1 text-xs text-muted-foreground">{sub}</div>}
    </Card>
  );
}

// ---------- Admin: all sellers overview ----------
function AllSellers({ from, to }: { from: Date; to: Date }) {
  const { data } = useQuery({
    queryKey: ["all-sellers-salary", from.toISOString(), to.toISOString()],
    queryFn: async () => {
      const [{ data: comps }, { data: profiles }, { data: deals }, { data: products }] = await Promise.all([
        supabase.from("seller_compensation").select("*"),
        supabase.from("profiles").select("id, full_name, email"),
        supabase
          .from("deals")
          .select("*")
          .eq("stage", "vunnen")
          .gte("won_at", from.toISOString())
          .lte("won_at", to.toISOString()),
        supabase.from("products").select("*"),
      ]);
      const prodMap = new Map((products ?? []).map(p => [p.id, p]));
      const compMap = new Map((comps ?? []).map(c => [c.user_id, c]));
      const profileMap = new Map((profiles ?? []).map(p => [p.id, p]));
      const grouped = new Map<string, { value: number; commission: number; count: number }>();
      for (const d of deals ?? []) {
        if (!d.owner_id) continue;
        const c = compMap.get(d.owner_id);
        const compType = c?.compensation_type ?? "med_grundlon";
        const product = d.product_id ? prodMap.get(d.product_id) : null;
        const pct = pickPct(d, product, compType, Number(c?.default_commission_pct ?? 0));
        const value = Number(d.value ?? 0);
        const cur = grouped.get(d.owner_id) ?? { value: 0, commission: 0, count: 0 };
        cur.value += value;
        cur.commission += (value * pct) / 100;
        cur.count += 1;
        grouped.set(d.owner_id, cur);
      }
      for (const c of comps ?? []) {
        if (!grouped.has(c.user_id)) grouped.set(c.user_id, { value: 0, commission: 0, count: 0 });
      }
      return Array.from(grouped.entries()).map(([userId, g]) => {
        const c = compMap.get(userId);
        const p = profileMap.get(userId);
        const compType = c?.compensation_type ?? "med_grundlon";
        const base = compType === "endast_provision" ? 0 : Number(c?.base_salary ?? 0);
        return {
          userId,
          name: p?.full_name || p?.email || "Okänd",
          compType,
          base,
          commission: g.commission,
          total: base + g.commission,
          count: g.count,
          value: g.value,
        };
      });
    },
  });
  return (
    <Card>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Säljare</TableHead>
            <TableHead className="text-right">Vunna</TableHead>
            <TableHead className="text-right">Försäljning</TableHead>
            <TableHead className="text-right">Grundlön</TableHead>
            <TableHead className="text-right">Provision</TableHead>
            <TableHead className="text-right">Totalt</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {(data ?? []).map(r => (
            <TableRow key={r.userId}>
              <TableCell className="font-medium">{r.name}</TableCell>
              <TableCell className="text-right">{r.count}</TableCell>
              <TableCell className="text-right">{fmt(r.value)}</TableCell>
              <TableCell className="text-right">{fmt(r.base)}</TableCell>
              <TableCell className="text-right">{fmt(r.commission)}</TableCell>
              <TableCell className="text-right font-semibold text-primary">{fmt(r.total)}</TableCell>
            </TableRow>
          ))}
          {(data ?? []).length === 0 && (
            <TableRow>
              <TableCell colSpan={6} className="text-center text-muted-foreground py-6">Ingen data</TableCell>
            </TableRow>
          )}
        </TableBody>
      </Table>
    </Card>
  );
}

// ---------- Admin: products ----------
function ProductsAdmin() {
  const qc = useQueryClient();
  const { data: products } = useQuery({
    queryKey: ["products"],
    queryFn: async () => {
      const { data, error } = await supabase.from("products").select("*").order("name");
      if (error) throw error;
      return data ?? [];
    },
  });
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<any>(null);

  const remove = async (id: string) => {
    if (!confirm("Ta bort produkten?")) return;
    const { error } = await supabase.from("products").delete().eq("id", id);
    if (error) toast.error(error.message);
    else { toast.success("Borttagen"); qc.invalidateQueries({ queryKey: ["products"] }); }
  };

  return (
    <Card>
      <div className="p-4 border-b flex items-center justify-between">
        <h3 className="text-sm font-semibold">Produkter</h3>
        <Button size="sm" onClick={() => { setEditing(null); setOpen(true); }}>
          <Plus className="size-4 mr-1" /> Ny produkt
        </Button>
      </div>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Namn</TableHead>
            <TableHead>Beskrivning</TableHead>
            <TableHead className="text-right">Provision %</TableHead>
            <TableHead className="w-24"></TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {(products ?? []).map(p => (
            <TableRow key={p.id}>
              <TableCell className="font-medium">{p.name}</TableCell>
              <TableCell className="text-muted-foreground text-xs">{p.description || "—"}</TableCell>
              <TableCell className="text-right">{p.default_commission_pct}%</TableCell>
              <TableCell className="text-right">
                <Button variant="ghost" size="icon" onClick={() => { setEditing(p); setOpen(true); }}>
                  <Pencil className="size-3.5" />
                </Button>
                <Button variant="ghost" size="icon" onClick={() => remove(p.id)}>
                  <Trash2 className="size-3.5" />
                </Button>
              </TableCell>
            </TableRow>
          ))}
          {(products ?? []).length === 0 && (
            <TableRow><TableCell colSpan={4} className="text-center text-muted-foreground py-6">Inga produkter ännu</TableCell></TableRow>
          )}
        </TableBody>
      </Table>
      <ProductDialog open={open} onOpenChange={setOpen} product={editing} />
    </Card>
  );
}

function ProductDialog({ open, onOpenChange, product }: { open: boolean; onOpenChange: (b: boolean) => void; product: any }) {
  const qc = useQueryClient();
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [pct, setPct] = useState("0");

  useMemo(() => {
    if (open) {
      setName(product?.name ?? "");
      setDescription(product?.description ?? "");
      setPct(String(product?.default_commission_pct ?? "0"));
    }
  }, [open, product]);

  const save = async () => {
    const payload = { name, description: description || null, default_commission_pct: Number(pct) };
    const { error } = product
      ? await supabase.from("products").update(payload).eq("id", product.id)
      : await supabase.from("products").insert(payload);
    if (error) toast.error(error.message);
    else { toast.success("Sparat"); qc.invalidateQueries({ queryKey: ["products"] }); onOpenChange(false); }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader><DialogTitle>{product ? "Redigera produkt" : "Ny produkt"}</DialogTitle></DialogHeader>
        <div className="space-y-3">
          <div>
            <label className="text-xs font-medium">Namn</label>
            <Input value={name} onChange={e => setName(e.target.value)} placeholder="t.ex. Premium DOOH-skärm" />
          </div>
          <div>
            <label className="text-xs font-medium">Beskrivning</label>
            <Input value={description} onChange={e => setDescription(e.target.value)} />
          </div>
          <div>
            <label className="text-xs font-medium">Provision %</label>
            <Input type="number" step="0.1" value={pct} onChange={e => setPct(e.target.value)} />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Avbryt</Button>
          <Button onClick={save} disabled={!name}>Spara</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ---------- Admin: per-seller compensation ----------
function CompensationAdmin() {
  const qc = useQueryClient();
  const { data } = useQuery({
    queryKey: ["compensation-admin"],
    queryFn: async () => {
      const [{ data: profiles }, { data: roles }, { data: comps }] = await Promise.all([
        supabase.from("profiles").select("id, full_name, email"),
        supabase.from("user_roles").select("user_id, role"),
        supabase.from("seller_compensation").select("*"),
      ]);
      const sellerIds = new Set((roles ?? []).filter(r => r.role === "saljare").map(r => r.user_id));
      const compMap = new Map((comps ?? []).map(c => [c.user_id, c]));
      return (profiles ?? [])
        .filter(p => sellerIds.has(p.id))
        .map(p => ({
          ...p,
          base_salary: Number(compMap.get(p.id)?.base_salary ?? 0),
          default_commission_pct: Number(compMap.get(p.id)?.default_commission_pct ?? 0),
        }));
    },
  });

  const [editing, setEditing] = useState<any>(null);

  return (
    <Card>
      <div className="p-4 border-b">
        <h3 className="text-sm font-semibold">Säljarinställningar</h3>
        <p className="text-xs text-muted-foreground mt-1">Sätt grundlön och standardprovision per säljare. Produktspecifik provision från fliken "Produkter" tar över när en produkt är vald på affären.</p>
      </div>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Säljare</TableHead>
            <TableHead className="text-right">Grundlön</TableHead>
            <TableHead className="text-right">Standard provision %</TableHead>
            <TableHead className="w-20"></TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {(data ?? []).map(p => (
            <TableRow key={p.id}>
              <TableCell className="font-medium">{p.full_name || p.email}</TableCell>
              <TableCell className="text-right">{fmt(p.base_salary)}</TableCell>
              <TableCell className="text-right">{p.default_commission_pct}%</TableCell>
              <TableCell className="text-right">
                <Button variant="ghost" size="icon" onClick={() => setEditing(p)}><Pencil className="size-3.5" /></Button>
              </TableCell>
            </TableRow>
          ))}
          {(data ?? []).length === 0 && (
            <TableRow><TableCell colSpan={4} className="text-center text-muted-foreground py-6">Inga säljare ännu</TableCell></TableRow>
          )}
        </TableBody>
      </Table>
      <CompDialog seller={editing} onClose={() => { setEditing(null); qc.invalidateQueries({ queryKey: ["compensation-admin"] }); }} />
    </Card>
  );
}

function CompDialog({ seller, onClose }: { seller: any; onClose: () => void }) {
  const [base, setBase] = useState("0");
  const [pct, setPct] = useState("0");
  useMemo(() => {
    if (seller) {
      setBase(String(seller.base_salary ?? 0));
      setPct(String(seller.default_commission_pct ?? 0));
    }
  }, [seller]);

  const save = async () => {
    if (!seller) return;
    const { error } = await supabase
      .from("seller_compensation")
      .upsert({ user_id: seller.id, base_salary: Number(base), default_commission_pct: Number(pct) });
    if (error) toast.error(error.message);
    else { toast.success("Sparat"); onClose(); }
  };

  return (
    <Dialog open={!!seller} onOpenChange={o => !o && onClose()}>
      <DialogContent>
        <DialogHeader><DialogTitle>Lön för {seller?.full_name || seller?.email}</DialogTitle></DialogHeader>
        <div className="space-y-3">
          <div>
            <label className="text-xs font-medium">Grundlön (kr/mån)</label>
            <Input type="number" value={base} onChange={e => setBase(e.target.value)} />
          </div>
          <div>
            <label className="text-xs font-medium">Standard provision %</label>
            <Input type="number" step="0.1" value={pct} onChange={e => setPct(e.target.value)} />
            <p className="text-[10px] text-muted-foreground mt-1">Används när affären saknar produkt och inte har egen %.</p>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Avbryt</Button>
          <Button onClick={save}>Spara</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
