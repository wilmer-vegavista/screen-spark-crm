import { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from "@/components/ui/select";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { Trash2, FileDown } from "lucide-react";
import { generateOrderConfirmationPdf } from "@/lib/order-confirmation-pdf";

const STAGES = ["ny", "kontaktad", "offert", "forhandling", "vunnen", "forlorad"] as const;
const STAGE_LABEL: Record<string, string> = {
  ny: "Ny", kontaktad: "Kontaktad", offert: "Offert", forhandling: "Förhandling", vunnen: "Vunnen", forlorad: "Förlorad",
};

export function DealDialog({ open, onOpenChange, deal }: { open: boolean; onOpenChange: (v: boolean) => void; deal: any | null }) {
  const qc = useQueryClient();
  const emptyForm = {
    title: "", customer_id: "", value: "", stage: "ny", probability: "25", expected_close_date: "",
    source: "", notes: "", product_id: "", commission_pct_override: "",
    sov_pct: "", impressions: "",
    schedule_mode: "dates" as "dates" | "weeks",
    campaign_start: "", campaign_end: "", campaign_weeks: "",
    package_id: "",
  };
  const [form, setForm] = useState(emptyForm);
  const [loading, setLoading] = useState(false);

  const { data: customers } = useQuery({
    queryKey: ["customers-list"],
    queryFn: async () => (await supabase.from("customers").select("id, company_name").order("company_name")).data ?? [],
  });
  const { data: products } = useQuery({
    queryKey: ["products-list"],
    queryFn: async () => (await supabase.from("products").select("id, name, default_commission_pct").eq("active", true).order("name")).data ?? [],
  });
  const { data: packages } = useQuery({
    queryKey: ["packages-list"],
    queryFn: async () => (await supabase.from("product_packages").select("*").eq("active", true).order("name")).data ?? [],
  });

  const filteredPackages = (packages ?? []).filter(p => !form.product_id || !p.product_id || p.product_id === form.product_id);

  const applyPackage = (id: string) => {
    const pkg = (packages ?? []).find(p => p.id === id);
    if (!pkg) { setForm({ ...form, package_id: "" }); return; }
    setForm({
      ...form,
      package_id: pkg.id,
      product_id: pkg.product_id ?? form.product_id,
      value: pkg.price != null ? String(pkg.price) : form.value,
      sov_pct: pkg.sov_pct != null ? String(pkg.sov_pct) : form.sov_pct,
      impressions: pkg.impressions != null ? String(pkg.impressions) : form.impressions,
      campaign_weeks: pkg.weeks != null ? String(pkg.weeks) : form.campaign_weeks,
      schedule_mode: pkg.weeks != null && !form.campaign_start ? "weeks" : form.schedule_mode,
    });
  };

  useEffect(() => {
    if (deal) setForm({
      title: deal.title ?? "", customer_id: deal.customer_id ?? "", value: String(deal.value ?? ""),
      stage: deal.stage ?? "ny", probability: String(deal.probability ?? 25),
      expected_close_date: deal.expected_close_date ?? "", source: deal.source ?? "", notes: deal.notes ?? "",
      product_id: deal.product_id ?? "", commission_pct_override: deal.commission_pct_override != null ? String(deal.commission_pct_override) : "",
      sov_pct: deal.sov_pct != null ? String(deal.sov_pct) : "",
      impressions: deal.impressions != null ? String(deal.impressions) : "",
      schedule_mode: deal.campaign_weeks && !deal.campaign_start ? "weeks" : "dates",
      campaign_start: deal.campaign_start ?? "",
      campaign_end: deal.campaign_end ?? "",
      campaign_weeks: deal.campaign_weeks != null ? String(deal.campaign_weeks) : "",
      package_id: deal.package_id ?? "",
    });
    else setForm(emptyForm);
  }, [deal, open]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    const { data: u } = await supabase.auth.getUser();
    const payload: any = {
      title: form.title,
      customer_id: form.customer_id || null,
      value: form.value ? Number(form.value) : 0,
      stage: form.stage,
      probability: form.probability ? Number(form.probability) : 25,
      expected_close_date: form.expected_close_date || null,
      source: form.source || null,
      notes: form.notes || null,
      product_id: form.product_id || null,
      commission_pct_override: form.commission_pct_override !== "" ? Number(form.commission_pct_override) : null,
      sov_pct: form.sov_pct !== "" ? Number(form.sov_pct) : null,
      impressions: form.impressions !== "" ? Number(form.impressions) : null,
      campaign_start: form.schedule_mode === "dates" ? (form.campaign_start || null) : null,
      campaign_end: form.schedule_mode === "dates" ? (form.campaign_end || null) : null,
      campaign_weeks: form.schedule_mode === "weeks" && form.campaign_weeks !== "" ? Number(form.campaign_weeks) : null,
      package_id: form.package_id || null,
      owner_id: deal?.owner_id ?? u.user?.id,
      created_by: deal?.created_by ?? u.user?.id,
    };
    const { error } = deal
      ? await supabase.from("deals").update(payload).eq("id", deal.id)
      : await supabase.from("deals").insert(payload);
    setLoading(false);
    if (error) return toast.error(error.message);
    toast.success(deal ? "Affär uppdaterad" : "Affär skapad");
    qc.invalidateQueries({ queryKey: ["deals-with-customers"] });
    onOpenChange(false);
  };

  const remove = async () => {
    if (!deal || !confirm("Ta bort affär?")) return;
    const { error } = await supabase.from("deals").delete().eq("id", deal.id);
    if (error) return toast.error(error.message);
    toast.success("Borttagen");
    qc.invalidateQueries({ queryKey: ["deals-with-customers"] });
    onOpenChange(false);
  };

  const downloadOrder = async () => {
    if (!deal) return;
    try {
      const [{ data: customer }, { data: product }, { data: pkg }, { data: u }] = await Promise.all([
        form.customer_id ? supabase.from("customers").select("*").eq("id", form.customer_id).maybeSingle() : Promise.resolve({ data: null }),
        form.product_id ? supabase.from("products").select("*").eq("id", form.product_id).maybeSingle() : Promise.resolve({ data: null }),
        form.package_id ? supabase.from("product_packages").select("*").eq("id", form.package_id).maybeSingle() : Promise.resolve({ data: null }),
        supabase.auth.getUser(),
      ]);
      let sellerName: string | null = null;
      const ownerId = deal.owner_id ?? u.user?.id;
      if (ownerId) {
        const { data: prof } = await supabase.from("profiles").select("full_name, email").eq("id", ownerId).maybeSingle();
        sellerName = prof?.full_name ?? prof?.email ?? null;
      }
      generateOrderConfirmationPdf({
        deal: {
          ...deal,
          value: form.value ? Number(form.value) : deal.value,
          sov_pct: form.sov_pct !== "" ? Number(form.sov_pct) : deal.sov_pct,
          impressions: form.impressions !== "" ? Number(form.impressions) : deal.impressions,
          campaign_start: form.schedule_mode === "dates" ? (form.campaign_start || null) : null,
          campaign_end: form.schedule_mode === "dates" ? (form.campaign_end || null) : null,
          campaign_weeks: form.schedule_mode === "weeks" && form.campaign_weeks !== "" ? Number(form.campaign_weeks) : deal.campaign_weeks,
          notes: form.notes,
        },
        customer,
        product,
        pkg,
        sellerName,
        sellerEmail: u.user?.email ?? null,
      });
    } catch (e: any) {
      toast.error(e.message ?? "Kunde inte skapa PDF");
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogHeader><DialogTitle>{deal ? "Redigera affär" : "Ny affär"}</DialogTitle></DialogHeader>
        <form onSubmit={submit} className="space-y-3">
          <div><Label>Titel *</Label><Input value={form.title} onChange={e => setForm({ ...form, title: e.target.value })} required /></div>
          <div>
            <Label>Kund</Label>
            <Select value={form.customer_id} onValueChange={(v) => setForm({ ...form, customer_id: v })}>
              <SelectTrigger><SelectValue placeholder="Välj kund" /></SelectTrigger>
              <SelectContent>
                {(customers ?? []).map(c => <SelectItem key={c.id} value={c.id}>{c.company_name}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div><Label>Värde (kr)</Label><Input type="number" value={form.value} onChange={e => setForm({ ...form, value: e.target.value })} /></div>
            <div><Label>Sannolikhet (%)</Label><Input type="number" min="0" max="100" value={form.probability} onChange={e => setForm({ ...form, probability: e.target.value })} /></div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label>Steg</Label>
              <Select value={form.stage} onValueChange={(v) => setForm({ ...form, stage: v })}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>{STAGES.map(s => <SelectItem key={s} value={s}>{STAGE_LABEL[s]}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div><Label>Förväntat avslut</Label><Input type="date" value={form.expected_close_date} onChange={e => setForm({ ...form, expected_close_date: e.target.value })} /></div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label>Produkt</Label>
              <Select value={form.product_id || "_none"} onValueChange={(v) => setForm({ ...form, product_id: v === "_none" ? "" : v })}>
                <SelectTrigger><SelectValue placeholder="Ingen" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="_none">Ingen</SelectItem>
                  {(products ?? []).map(p => <SelectItem key={p.id} value={p.id}>{p.name} ({p.default_commission_pct}%)</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>Provision % (override)</Label>
              <Input type="number" step="0.1" value={form.commission_pct_override} onChange={e => setForm({ ...form, commission_pct_override: e.target.value })} placeholder="Auto från produkt" />
            </div>
          </div>
          {filteredPackages.length > 0 && (
            <div className="space-y-2 rounded-md border p-3 bg-muted/20">
              <Label className="text-xs uppercase tracking-wide text-muted-foreground">Välj paket (valfritt)</Label>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                {filteredPackages.map(p => (
                  <button
                    key={p.id}
                    type="button"
                    onClick={() => applyPackage(p.id)}
                    className={`text-left p-2 rounded-md border text-xs ${form.package_id === p.id ? "border-primary bg-primary/10" : "border-border bg-background"}`}
                  >
                    <div className="font-semibold">{p.name}</div>
                    <div className="text-muted-foreground mt-0.5">
                      {p.sov_pct != null && <span>SOV {p.sov_pct}% · </span>}
                      {p.weeks != null && <span>{p.weeks}v · </span>}
                      {Number(p.price).toLocaleString("sv-SE")} kr
                    </div>
                  </button>
                ))}
              </div>
              {form.package_id && (
                <button type="button" onClick={() => setForm({ ...form, package_id: "" })} className="text-[10px] text-muted-foreground underline">
                  Rensa paketval
                </button>
              )}
            </div>
          )}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label>SOV (%)</Label>
              <Input type="number" step="0.1" min="0" max="100" value={form.sov_pct} onChange={e => setForm({ ...form, sov_pct: e.target.value })} placeholder="Share of voice" />
            </div>
            <div>
              <Label>Antal visningar</Label>
              <Input type="number" min="0" value={form.impressions} onChange={e => setForm({ ...form, impressions: e.target.value })} placeholder="t.ex. 250000" />
            </div>
          </div>
          <div className="space-y-2 rounded-md border p-3">
            <Label className="text-xs uppercase tracking-wide text-muted-foreground">Kampanjperiod</Label>
            <div className="flex gap-2">
              <button type="button" onClick={() => setForm({ ...form, schedule_mode: "dates" })}
                className={`flex-1 text-xs p-2 rounded border ${form.schedule_mode === "dates" ? "border-primary bg-primary/10" : "border-border"}`}>
                Bestämda datum
              </button>
              <button type="button" onClick={() => setForm({ ...form, schedule_mode: "weeks" })}
                className={`flex-1 text-xs p-2 rounded border ${form.schedule_mode === "weeks" ? "border-primary bg-primary/10" : "border-border"}`}>
                Antal veckor (datum ej satta)
              </button>
            </div>
            {form.schedule_mode === "dates" ? (
              <div className="grid grid-cols-2 gap-3">
                <div><Label>Start</Label><Input type="date" value={form.campaign_start} onChange={e => setForm({ ...form, campaign_start: e.target.value })} /></div>
                <div><Label>Slut</Label><Input type="date" value={form.campaign_end} onChange={e => setForm({ ...form, campaign_end: e.target.value })} /></div>
              </div>
            ) : (
              <div><Label>Antal veckor</Label><Input type="number" min="1" value={form.campaign_weeks} onChange={e => setForm({ ...form, campaign_weeks: e.target.value })} placeholder="t.ex. 4" /></div>
            )}
          </div>
          <div><Label>Källa</Label><Input value={form.source} onChange={e => setForm({ ...form, source: e.target.value })} placeholder="Mejl, rekommendation, kampanj..." /></div>
          <div><Label>Anteckningar</Label><Textarea value={form.notes} onChange={e => setForm({ ...form, notes: e.target.value })} /></div>
          <DialogFooter className="gap-2 flex-wrap">
            {deal && <Button type="button" variant="ghost" size="sm" onClick={remove} className="text-destructive mr-auto"><Trash2 className="size-4 mr-1" /> Ta bort</Button>}
            {deal && <Button type="button" variant="outline" size="sm" onClick={downloadOrder}><FileDown className="size-4 mr-1" /> Orderbekräftelse (PDF)</Button>}
            <Button type="submit" disabled={loading}>Spara</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
