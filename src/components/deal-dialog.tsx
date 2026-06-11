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
import { Trash2 } from "lucide-react";

const STAGES = ["ny", "kontaktad", "offert", "forhandling", "vunnen", "forlorad"] as const;
const STAGE_LABEL: Record<string, string> = {
  ny: "Ny", kontaktad: "Kontaktad", offert: "Offert", forhandling: "Förhandling", vunnen: "Vunnen", forlorad: "Förlorad",
};

export function DealDialog({ open, onOpenChange, deal }: { open: boolean; onOpenChange: (v: boolean) => void; deal: any | null }) {
  const qc = useQueryClient();
  const [form, setForm] = useState({ title: "", customer_id: "", value: "", stage: "ny", probability: "25", expected_close_date: "", source: "", notes: "", product_id: "", commission_pct_override: "" });
  const [loading, setLoading] = useState(false);

  const { data: customers } = useQuery({
    queryKey: ["customers-list"],
    queryFn: async () => (await supabase.from("customers").select("id, company_name").order("company_name")).data ?? [],
  });
  const { data: products } = useQuery({
    queryKey: ["products-list"],
    queryFn: async () => (await supabase.from("products").select("id, name, default_commission_pct").eq("active", true).order("name")).data ?? [],
  });

  useEffect(() => {
    if (deal) setForm({
      title: deal.title ?? "", customer_id: deal.customer_id ?? "", value: String(deal.value ?? ""),
      stage: deal.stage ?? "ny", probability: String(deal.probability ?? 25),
      expected_close_date: deal.expected_close_date ?? "", source: deal.source ?? "", notes: deal.notes ?? "",
      product_id: deal.product_id ?? "", commission_pct_override: deal.commission_pct_override != null ? String(deal.commission_pct_override) : "",
    });
    else setForm({ title: "", customer_id: "", value: "", stage: "ny", probability: "25", expected_close_date: "", source: "", notes: "", product_id: "", commission_pct_override: "" });
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

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
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
          <div><Label>Källa</Label><Input value={form.source} onChange={e => setForm({ ...form, source: e.target.value })} placeholder="Mejl, rekommendation, kampanj..." /></div>
          <div><Label>Anteckningar</Label><Textarea value={form.notes} onChange={e => setForm({ ...form, notes: e.target.value })} /></div>
          <DialogFooter className="gap-2">
            {deal && <Button type="button" variant="ghost" size="sm" onClick={remove} className="text-destructive mr-auto"><Trash2 className="size-4 mr-1" /> Ta bort</Button>}
            <Button type="submit" disabled={loading}>Spara</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
