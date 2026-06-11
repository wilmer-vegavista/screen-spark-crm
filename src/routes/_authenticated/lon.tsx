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
              <TabsTrigger value="paket">Paket</TabsTrigger>
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
            <TabsContent value="paket" className="mt-4">
              <PackagesAdmin />
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
            <TableHead>Typ</TableHead>
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
              <TableCell className="text-xs text-muted-foreground">{r.compType === "endast_provision" ? "Endast provision" : "Med grundlön"}</TableCell>
              <TableCell className="text-right">{r.count}</TableCell>
              <TableCell className="text-right">{fmt(r.value)}</TableCell>
              <TableCell className="text-right">{fmt(r.base)}</TableCell>
              <TableCell className="text-right">{fmt(r.commission)}</TableCell>
              <TableCell className="text-right font-semibold text-primary">{fmt(r.total)}</TableCell>
            </TableRow>
          ))}
          {(data ?? []).length === 0 && (
            <TableRow>
              <TableCell colSpan={7} className="text-center text-muted-foreground py-6">Ingen data</TableCell>
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
      const rows = data ?? [];
      const paths = rows.map((r: any) => r.image_url).filter(Boolean) as string[];
      const signedMap = new Map<string, string>();
      if (paths.length) {
        const { data: signed } = await supabase.storage.from("product-images").createSignedUrls(paths, 3600);
        (signed ?? []).forEach((s: any) => { if (s.signedUrl && s.path) signedMap.set(s.path, s.signedUrl); });
      }
      return rows.map((r: any) => ({ ...r, image_signed_url: r.image_url ? signedMap.get(r.image_url) : null }));
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
            <TableHead>Typ</TableHead>
            <TableHead className="text-right">% endast prov.</TableHead>
            <TableHead className="text-right">% med grundlön</TableHead>
            <TableHead className="w-24"></TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {(products ?? []).map(p => (
            <TableRow key={p.id}>
              <TableCell className="font-medium">
                <div className="flex items-center gap-2">
                  {p.image_signed_url ? (
                    <img src={p.image_signed_url} alt={p.name} className="size-10 rounded object-cover border" />
                  ) : (
                    <div className="size-10 rounded border bg-muted/30" />
                  )}
                  <div>
                    <div>{p.name}</div>
                    {p.description && <div className="text-[10px] text-muted-foreground">{p.description}</div>}
                  </div>
                </div>
              </TableCell>
              <TableCell>
                <span className={`text-[10px] px-2 py-0.5 rounded-full ${
                  p.screen_type === "egen" ? "bg-primary/15 text-primary" :
                  p.screen_type === "digital" ? "bg-secondary/50 text-secondary-foreground" :
                  "bg-muted text-muted-foreground"
                }`}>
                  {p.screen_type === "egen" ? "Egen skärm" : p.screen_type === "digital" ? "Digital produkt" : "Extern skärm"}
                </span>
              </TableCell>
              <TableCell className="text-right">{p.commission_pct_provision_only ?? p.default_commission_pct}%</TableCell>
              <TableCell className="text-right">{p.commission_pct_with_base ?? p.default_commission_pct}%</TableCell>
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
            <TableRow><TableCell colSpan={5} className="text-center text-muted-foreground py-6">Inga produkter ännu</TableCell></TableRow>
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
  const [screenType, setScreenType] = useState<"egen" | "extern" | "digital">("egen");
  const [pctProv, setPctProv] = useState("0");
  const [pctBase, setPctBase] = useState("0");
  const [imagePath, setImagePath] = useState<string | null>(null);
  const [imagePreview, setImagePreview] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [dimensions, setDimensions] = useState("");
  const [contactsPerWeek, setContactsPerWeek] = useState("");
  const [format, setFormat] = useState("");
  const [materialSpec, setMaterialSpec] = useState("");
  const [address, setAddress] = useState("");

  useMemo(() => {
    if (open) {
      setName(product?.name ?? "");
      setDescription(product?.description ?? "");
      setScreenType((product?.screen_type as any) ?? "egen");
      setPctProv(String(product?.commission_pct_provision_only ?? product?.default_commission_pct ?? "0"));
      setPctBase(String(product?.commission_pct_with_base ?? product?.default_commission_pct ?? "0"));
      setImagePath(product?.image_url ?? null);
      setImagePreview(product?.image_signed_url ?? null);
      setDimensions(product?.dimensions ?? "");
      setContactsPerWeek(product?.contacts_per_week != null ? String(product.contacts_per_week) : "");
      setFormat(product?.format ?? "");
      setMaterialSpec(product?.material_spec ?? "");
      setAddress(product?.address ?? "");
    }
  }, [open, product]);

  const handleFile = async (file: File) => {
    if (!file) return;
    setUploading(true);
    try {
      const ext = file.name.split(".").pop()?.toLowerCase() || "png";
      const path = `products/${crypto.randomUUID()}.${ext}`;
      const { error: upErr } = await supabase.storage.from("product-images").upload(path, file, { contentType: file.type, upsert: false });
      if (upErr) throw upErr;
      const { data: signed } = await supabase.storage.from("product-images").createSignedUrl(path, 3600);
      // Try to delete previous image if it existed
      if (imagePath) await supabase.storage.from("product-images").remove([imagePath]).catch(() => {});
      setImagePath(path);
      setImagePreview(signed?.signedUrl ?? null);
    } catch (e: any) {
      toast.error(e.message ?? "Uppladdning misslyckades");
    } finally {
      setUploading(false);
    }
  };

  const removeImage = async () => {
    if (imagePath) await supabase.storage.from("product-images").remove([imagePath]).catch(() => {});
    setImagePath(null);
    setImagePreview(null);
  };

  const save = async () => {
    const payload = {
      name,
      description: description || null,
      screen_type: screenType,
      commission_pct_provision_only: Number(pctProv),
      commission_pct_with_base: Number(pctBase),
      default_commission_pct: Number(pctBase),
      image_url: imagePath,
      dimensions: dimensions || null,
      contacts_per_week: contactsPerWeek !== "" ? Number(contactsPerWeek) : null,
      format: format || null,
      material_spec: materialSpec || null,
      address: address || null,
    };
    const { error } = product
      ? await supabase.from("products").update(payload).eq("id", product.id)
      : await supabase.from("products").insert(payload);
    if (error) toast.error(error.message);
    else { toast.success("Sparat"); qc.invalidateQueries({ queryKey: ["products"] }); onOpenChange(false); }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto">
        <DialogHeader><DialogTitle>{product ? "Redigera produkt" : "Ny produkt"}</DialogTitle></DialogHeader>
        <div className="space-y-3">
          <div>
            <label className="text-xs font-medium">Bild</label>
            <div className="mt-1 flex items-center gap-3">
              {imagePreview ? (
                <img src={imagePreview} alt="" className="size-20 rounded object-cover border" />
              ) : (
                <div className="size-20 rounded border bg-muted/30 flex items-center justify-center text-[10px] text-muted-foreground">Ingen bild</div>
              )}
              <div className="flex flex-col gap-2">
                <Input
                  type="file"
                  accept="image/*"
                  disabled={uploading}
                  onChange={e => { const f = e.target.files?.[0]; if (f) handleFile(f); }}
                />
                {imagePreview && (
                  <Button type="button" variant="outline" size="sm" onClick={removeImage}>Ta bort bild</Button>
                )}
              </div>
            </div>
          </div>
          <div>
            <label className="text-xs font-medium">Namn</label>
            <Input value={name} onChange={e => setName(e.target.value)} placeholder="t.ex. Egna skärmar" />
          </div>
          <div>
            <label className="text-xs font-medium">Beskrivning</label>
            <Input value={description} onChange={e => setDescription(e.target.value)} />
          </div>
          <div>
            <label className="text-xs font-medium">Skärmtyp</label>
            <div className="grid grid-cols-3 gap-2 mt-1">
              <button
                type="button"
                onClick={() => setScreenType("egen")}
                className={`text-left p-3 rounded-md border text-xs ${screenType === "egen" ? "border-primary bg-primary/10" : "border-border"}`}
              >
                <div className="font-semibold">Egen skärm</div>
                <div className="text-muted-foreground mt-1">Vi äger skärmen själva</div>
              </button>
              <button
                type="button"
                onClick={() => setScreenType("extern")}
                className={`text-left p-3 rounded-md border text-xs ${screenType === "extern" ? "border-primary bg-primary/10" : "border-border"}`}
              >
                <div className="font-semibold">Extern skärm</div>
                <div className="text-muted-foreground mt-1">Hyrd / inköpt från partner</div>
              </button>
              <button
                type="button"
                onClick={() => setScreenType("digital")}
                className={`text-left p-3 rounded-md border text-xs ${screenType === "digital" ? "border-primary bg-primary/10" : "border-border"}`}
              >
                <div className="font-semibold">Digital produkt</div>
                <div className="text-muted-foreground mt-1">Banners, CTV, programmatic</div>
              </button>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs font-medium">% för säljare utan grundlön</label>
              <Input type="number" step="0.1" value={pctProv} onChange={e => setPctProv(e.target.value)} />
              <p className="text-[10px] text-muted-foreground mt-1">Endast provision</p>
            </div>
            <div>
              <label className="text-xs font-medium">% för säljare med grundlön</label>
              <Input type="number" step="0.1" value={pctBase} onChange={e => setPctBase(e.target.value)} />
              <p className="text-[10px] text-muted-foreground mt-1">Har fast lön</p>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs font-medium">Mått på skärmen</label>
              <Input value={dimensions} onChange={e => setDimensions(e.target.value)} placeholder="t.ex. 1920×1080 / 75 tum" />
            </div>
            <div>
              <label className="text-xs font-medium">Format</label>
              <Input value={format} onChange={e => setFormat(e.target.value)} placeholder="t.ex. Liggande 16:9, MP4" />
            </div>
          </div>
          <div>
            <label className="text-xs font-medium">Material spec</label>
            <Input value={materialSpec} onChange={e => setMaterialSpec(e.target.value)} placeholder="t.ex. MP4 H.264, max 20MB, 10 sek" />
          </div>
          <div>
            <label className="text-xs font-medium">Antal kontakter / vecka</label>
            <Input type="number" min="0" value={contactsPerWeek} onChange={e => setContactsPerWeek(e.target.value)} placeholder="t.ex. 25000" />
          </div>
          <div>
            <label className="text-xs font-medium">Adress</label>
            <Input value={address} onChange={e => setAddress(e.target.value)} placeholder="Gatuadress, ort" />
            {address && (
              <div className="mt-2 space-y-2">
                <iframe
                  title="Karta"
                  src={`https://maps.google.com/maps?q=${encodeURIComponent(address)}&output=embed`}
                  className="w-full h-48 rounded-md border"
                  loading="lazy"
                />
                <a
                  href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(address)}`}
                  target="_blank" rel="noreferrer"
                  className="text-xs text-primary underline"
                >Öppna i Google Maps</a>
              </div>
            )}
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Avbryt</Button>
          <Button onClick={save} disabled={!name || uploading}>{uploading ? "Laddar upp…" : "Spara"}</Button>
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
        .map(p => {
          const c = compMap.get(p.id);
          return {
            ...p,
            compensation_type: c?.compensation_type ?? "med_grundlon",
            base_salary: Number(c?.base_salary ?? 0),
            default_commission_pct: Number(c?.default_commission_pct ?? 0),
            monthly_budget: Number(c?.monthly_budget ?? 0),
          };
        });
    },
  });

  const [editing, setEditing] = useState<any>(null);

  return (
    <Card>
      <div className="p-4 border-b">
        <h3 className="text-sm font-semibold">Säljarinställningar</h3>
        <p className="text-xs text-muted-foreground mt-1">Välj om säljaren är på "endast provision" eller "med grundlön". Provisionsprocenten per affär hämtas från produkten utifrån säljarens typ.</p>
      </div>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Säljare</TableHead>
            <TableHead>Typ</TableHead>
            <TableHead className="text-right">Grundlön</TableHead>
            <TableHead className="text-right">Standard %</TableHead>
            <TableHead className="text-right">Månadsbudget</TableHead>
            <TableHead className="w-20"></TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {(data ?? []).map(p => (
            <TableRow key={p.id}>
              <TableCell className="font-medium">{p.full_name || p.email}</TableCell>
              <TableCell className="text-xs">{p.compensation_type === "endast_provision" ? "Endast provision" : "Med grundlön"}</TableCell>
              <TableCell className="text-right">{p.compensation_type === "endast_provision" ? "—" : fmt(p.base_salary)}</TableCell>
              <TableCell className="text-right">{p.default_commission_pct}%</TableCell>
              <TableCell className="text-right">{fmt(p.monthly_budget)}</TableCell>
              <TableCell className="text-right">
                <Button variant="ghost" size="icon" onClick={() => setEditing(p)}><Pencil className="size-3.5" /></Button>
              </TableCell>
            </TableRow>
          ))}
          {(data ?? []).length === 0 && (
            <TableRow><TableCell colSpan={6} className="text-center text-muted-foreground py-6">Inga säljare ännu</TableCell></TableRow>
          )}
        </TableBody>
      </Table>
      <CompDialog seller={editing} onClose={() => { setEditing(null); qc.invalidateQueries({ queryKey: ["compensation-admin"] }); }} />
    </Card>
  );
}

function CompDialog({ seller, onClose }: { seller: any; onClose: () => void }) {
  const [type, setType] = useState<"endast_provision" | "med_grundlon">("med_grundlon");
  const [base, setBase] = useState("0");
  const [pct, setPct] = useState("0");
  const [budget, setBudget] = useState("0");
  useMemo(() => {
    if (seller) {
      setType((seller.compensation_type as any) ?? "med_grundlon");
      setBase(String(seller.base_salary ?? 0));
      setPct(String(seller.default_commission_pct ?? 0));
      setBudget(String(seller.monthly_budget ?? 0));
    }
  }, [seller]);

  const save = async () => {
    if (!seller) return;
    const { error } = await supabase
      .from("seller_compensation")
      .upsert({
        user_id: seller.id,
        compensation_type: type,
        base_salary: type === "endast_provision" ? 0 : Number(base),
        default_commission_pct: Number(pct),
        monthly_budget: Number(budget),
      });
    if (error) toast.error(error.message);
    else { toast.success("Sparat"); onClose(); }
  };

  return (
    <Dialog open={!!seller} onOpenChange={o => !o && onClose()}>
      <DialogContent>
        <DialogHeader><DialogTitle>Lön för {seller?.full_name || seller?.email}</DialogTitle></DialogHeader>
        <div className="space-y-3">
          <div>
            <label className="text-xs font-medium">Provisionskategori</label>
            <div className="grid grid-cols-2 gap-2 mt-1">
              <button
                type="button"
                onClick={() => setType("med_grundlon")}
                className={`text-left p-3 rounded-md border text-xs ${type === "med_grundlon" ? "border-primary bg-primary/10" : "border-border"}`}
              >
                <div className="font-semibold">Med grundlön</div>
                <div className="text-muted-foreground mt-1">Fast lön + lägre provision</div>
              </button>
              <button
                type="button"
                onClick={() => setType("endast_provision")}
                className={`text-left p-3 rounded-md border text-xs ${type === "endast_provision" ? "border-primary bg-primary/10" : "border-border"}`}
              >
                <div className="font-semibold">Endast provision</div>
                <div className="text-muted-foreground mt-1">Ingen fast lön, högre provision</div>
              </button>
            </div>
          </div>
          {type === "med_grundlon" && (
            <div>
              <label className="text-xs font-medium">Grundlön (kr/mån)</label>
              <Input type="number" value={base} onChange={e => setBase(e.target.value)} />
            </div>
          )}
          <div>
            <label className="text-xs font-medium">Standard provision %</label>
            <Input type="number" step="0.1" value={pct} onChange={e => setPct(e.target.value)} />
            <p className="text-[10px] text-muted-foreground mt-1">Används endast om affären saknar produkt. Produktens % per kategori används annars.</p>
          </div>
          <div>
            <label className="text-xs font-medium">Månadsbudget (kr försäljning)</label>
            <Input type="number" value={budget} onChange={e => setBudget(e.target.value)} />
            <p className="text-[10px] text-muted-foreground mt-1">Säljarens försäljningsbudget per månad. Visas på dashboarden.</p>
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

// ---------- Admin: packages ----------
function PackagesAdmin() {
  const qc = useQueryClient();
  const { data: products } = useQuery({
    queryKey: ["products-for-packages"],
    queryFn: async () => (await supabase.from("products").select("id, name").order("name")).data ?? [],
  });
  const { data: packages } = useQuery({
    queryKey: ["packages-admin"],
    queryFn: async () => (await supabase.from("product_packages").select("*").order("name")).data ?? [],
  });
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<any>(null);

  const remove = async (id: string) => {
    if (!confirm("Ta bort paketet?")) return;
    const { error } = await supabase.from("product_packages").delete().eq("id", id);
    if (error) toast.error(error.message);
    else { toast.success("Borttagen"); qc.invalidateQueries({ queryKey: ["packages-admin"] }); }
  };

  const prodName = (id: string | null) => products?.find(p => p.id === id)?.name ?? "—";

  return (
    <Card>
      <div className="p-4 border-b flex items-center justify-between">
        <div>
          <h3 className="text-sm font-semibold">Paket</h3>
          <p className="text-xs text-muted-foreground">Färdiga bundlar med SOV och pris som säljare kan välja vid order.</p>
        </div>
        <Button size="sm" onClick={() => { setEditing(null); setOpen(true); }}>
          <Plus className="size-4 mr-1" /> Nytt paket
        </Button>
      </div>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Namn</TableHead>
            <TableHead>Produkt</TableHead>
            <TableHead className="text-right">SOV</TableHead>
            <TableHead className="text-right">Veckor</TableHead>
            <TableHead className="text-right">Visningar</TableHead>
            <TableHead className="text-right">Pris</TableHead>
            <TableHead className="w-24"></TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {(packages ?? []).map(p => (
            <TableRow key={p.id}>
              <TableCell className="font-medium">
                <div>{p.name}</div>
                {p.description && <div className="text-[10px] text-muted-foreground">{p.description}</div>}
              </TableCell>
              <TableCell className="text-xs">{prodName(p.product_id)}</TableCell>
              <TableCell className="text-right">{p.sov_pct != null ? `${p.sov_pct}%` : "—"}</TableCell>
              <TableCell className="text-right">{p.weeks ?? "—"}</TableCell>
              <TableCell className="text-right">{p.impressions ? Number(p.impressions).toLocaleString("sv-SE") : "—"}</TableCell>
              <TableCell className="text-right">{fmt(Number(p.price))}</TableCell>
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
          {(packages ?? []).length === 0 && (
            <TableRow><TableCell colSpan={7} className="text-center text-muted-foreground py-6">Inga paket ännu</TableCell></TableRow>
          )}
        </TableBody>
      </Table>
      <PackageDialog open={open} onOpenChange={setOpen} pkg={editing} products={products ?? []} />
    </Card>
  );
}

function PackageDialog({ open, onOpenChange, pkg, products }: { open: boolean; onOpenChange: (b: boolean) => void; pkg: any; products: { id: string; name: string }[] }) {
  const qc = useQueryClient();
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [productId, setProductId] = useState<string>("");
  const [sov, setSov] = useState("");
  const [weeks, setWeeks] = useState("");
  const [impressions, setImpressions] = useState("");
  const [price, setPrice] = useState("0");

  useMemo(() => {
    if (open) {
      setName(pkg?.name ?? "");
      setDescription(pkg?.description ?? "");
      setProductId(pkg?.product_id ?? "");
      setSov(pkg?.sov_pct != null ? String(pkg.sov_pct) : "");
      setWeeks(pkg?.weeks != null ? String(pkg.weeks) : "");
      setImpressions(pkg?.impressions != null ? String(pkg.impressions) : "");
      setPrice(String(pkg?.price ?? "0"));
    }
  }, [open, pkg]);

  const save = async () => {
    const payload = {
      name,
      description: description || null,
      product_id: productId || null,
      sov_pct: sov !== "" ? Number(sov) : null,
      weeks: weeks !== "" ? Number(weeks) : null,
      impressions: impressions !== "" ? Number(impressions) : null,
      price: Number(price),
    };
    const { error } = pkg
      ? await supabase.from("product_packages").update(payload).eq("id", pkg.id)
      : await supabase.from("product_packages").insert(payload);
    if (error) toast.error(error.message);
    else { toast.success("Sparat"); qc.invalidateQueries({ queryKey: ["packages-admin"] }); onOpenChange(false); }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto">
        <DialogHeader><DialogTitle>{pkg ? "Redigera paket" : "Nytt paket"}</DialogTitle></DialogHeader>
        <div className="space-y-3">
          <div>
            <label className="text-xs font-medium">Namn</label>
            <Input value={name} onChange={e => setName(e.target.value)} placeholder="t.ex. Brons 4 veckor" />
          </div>
          <div>
            <label className="text-xs font-medium">Produkt</label>
            <select
              value={productId}
              onChange={e => setProductId(e.target.value)}
              className="w-full h-9 rounded-md border bg-background px-3 text-sm"
            >
              <option value="">Alla / ej specificerad</option>
              {products.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
          </div>
          <div>
            <label className="text-xs font-medium">Beskrivning</label>
            <Input value={description} onChange={e => setDescription(e.target.value)} />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs font-medium">SOV (%)</label>
              <Input type="number" step="0.1" value={sov} onChange={e => setSov(e.target.value)} placeholder="t.ex. 20" />
            </div>
            <div>
              <label className="text-xs font-medium">Antal veckor</label>
              <Input type="number" min="1" value={weeks} onChange={e => setWeeks(e.target.value)} placeholder="t.ex. 4" />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs font-medium">Antal visningar</label>
              <Input type="number" min="0" value={impressions} onChange={e => setImpressions(e.target.value)} placeholder="t.ex. 250000" />
            </div>
            <div>
              <label className="text-xs font-medium">Pris (kr)</label>
              <Input type="number" min="0" value={price} onChange={e => setPrice(e.target.value)} />
            </div>
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
