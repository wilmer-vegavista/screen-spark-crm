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
import { Trash2, Plus } from "lucide-react";
import { format } from "date-fns";
import { sv } from "date-fns/locale";

const STATUSES = [
  { key: "planerad", label: "Planerad" },
  { key: "material_produktion", label: "Material i produktion" },
  { key: "redo_for_live", label: "Redo att gå live" },
  { key: "live", label: "Live" },
  { key: "avslutad", label: "Avslutad" },
  { key: "rapport_skickad", label: "Rapport skickad" },
];

export function CampaignDialog({ open, onOpenChange, campaign }: { open: boolean; onOpenChange: (v: boolean) => void; campaign: any | null }) {
  const qc = useQueryClient();
  const [form, setForm] = useState({
    name: "", customer_id: "", start_date: "", end_date: "", status: "planerad",
    budget: "", impressions_target: "", report_due_date: "",
    cities: "", screens: "", notes: "",
  });
  const [loading, setLoading] = useState(false);
  const [newMaterial, setNewMaterial] = useState("");

  const { data: customers } = useQuery({
    queryKey: ["customers-list"],
    queryFn: async () => (await supabase.from("customers").select("id, company_name").order("company_name")).data ?? [],
  });

  const { data: materials } = useQuery({
    queryKey: ["campaign-materials", campaign?.id],
    queryFn: async () => {
      if (!campaign) return [];
      return (await supabase.from("materials").select("*").eq("campaign_id", campaign.id).order("created_at")).data ?? [];
    },
    enabled: !!campaign,
  });

  useEffect(() => {
    if (campaign) setForm({
      name: campaign.name ?? "", customer_id: campaign.customer_id ?? "",
      start_date: campaign.start_date ?? "", end_date: campaign.end_date ?? "",
      status: campaign.status ?? "planerad",
      budget: campaign.budget ? String(campaign.budget) : "",
      impressions_target: campaign.impressions_target ? String(campaign.impressions_target) : "",
      report_due_date: campaign.report_due_date ?? "",
      cities: (campaign.cities ?? []).join(", "),
      screens: (campaign.screens ?? []).join(", "),
      notes: campaign.notes ?? "",
    });
    else setForm({ name: "", customer_id: "", start_date: "", end_date: "", status: "planerad", budget: "", impressions_target: "", report_due_date: "", cities: "", screens: "", notes: "" });
  }, [campaign, open]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    const { data: u } = await supabase.auth.getUser();
    const payload: any = {
      name: form.name,
      customer_id: form.customer_id || null,
      start_date: form.start_date,
      end_date: form.end_date,
      status: form.status,
      budget: form.budget ? Number(form.budget) : null,
      impressions_target: form.impressions_target ? Number(form.impressions_target) : null,
      report_due_date: form.report_due_date || null,
      cities: form.cities ? form.cities.split(",").map(s => s.trim()).filter(Boolean) : [],
      screens: form.screens ? form.screens.split(",").map(s => s.trim()).filter(Boolean) : [],
      notes: form.notes || null,
      owner_id: campaign?.owner_id ?? u.user?.id,
      created_by: campaign?.created_by ?? u.user?.id,
    };
    const { error } = campaign
      ? await supabase.from("campaigns").update(payload).eq("id", campaign.id)
      : await supabase.from("campaigns").insert(payload);
    setLoading(false);
    if (error) return toast.error(error.message);
    toast.success(campaign ? "Kampanj uppdaterad" : "Kampanj skapad");
    qc.invalidateQueries({ queryKey: ["campaigns-with-customers"] });
    qc.invalidateQueries({ queryKey: ["reports-schedule"] });
    onOpenChange(false);
  };

  const remove = async () => {
    if (!campaign || !confirm("Ta bort kampanj?")) return;
    const { error } = await supabase.from("campaigns").delete().eq("id", campaign.id);
    if (error) return toast.error(error.message);
    toast.success("Borttagen");
    qc.invalidateQueries({ queryKey: ["campaigns-with-customers"] });
    onOpenChange(false);
  };

  const addMaterial = async () => {
    if (!campaign || !newMaterial.trim()) return;
    const { data: u } = await supabase.auth.getUser();
    const { error } = await supabase.from("materials").insert({
      campaign_id: campaign.id, title: newMaterial.trim(), created_by: u.user?.id,
    });
    if (error) return toast.error(error.message);
    setNewMaterial("");
    qc.invalidateQueries({ queryKey: ["campaign-materials", campaign.id] });
    qc.invalidateQueries({ queryKey: ["materials-with-campaigns"] });
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader><DialogTitle>{campaign ? "Redigera kampanj" : "Ny kampanj"}</DialogTitle></DialogHeader>
        <form onSubmit={submit} className="space-y-3">
          <div><Label>Namn *</Label><Input value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} required /></div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label>Kund</Label>
              <Select value={form.customer_id} onValueChange={(v) => setForm({ ...form, customer_id: v })}>
                <SelectTrigger><SelectValue placeholder="Välj kund" /></SelectTrigger>
                <SelectContent>{(customers ?? []).map(c => <SelectItem key={c.id} value={c.id}>{c.company_name}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div>
              <Label>Status</Label>
              <Select value={form.status} onValueChange={(v) => setForm({ ...form, status: v })}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>{STATUSES.map(s => <SelectItem key={s.key} value={s.key}>{s.label}</SelectItem>)}</SelectContent>
              </Select>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div><Label>Startdatum *</Label><Input type="date" value={form.start_date} onChange={e => setForm({ ...form, start_date: e.target.value })} required /></div>
            <div><Label>Slutdatum *</Label><Input type="date" value={form.end_date} onChange={e => setForm({ ...form, end_date: e.target.value })} required /></div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div><Label>Budget (kr)</Label><Input type="number" value={form.budget} onChange={e => setForm({ ...form, budget: e.target.value })} /></div>
            <div><Label>Impressions-mål</Label><Input type="number" value={form.impressions_target} onChange={e => setForm({ ...form, impressions_target: e.target.value })} /></div>
          </div>
          <div><Label>Städer (kommaseparerade)</Label><Input value={form.cities} onChange={e => setForm({ ...form, cities: e.target.value })} placeholder="Stockholm, Göteborg" /></div>
          <div><Label>Skärmar / placeringar</Label><Input value={form.screens} onChange={e => setForm({ ...form, screens: e.target.value })} placeholder="T-Centralen, Hötorget" /></div>
          <div><Label>Rapportdatum</Label><Input type="date" value={form.report_due_date} onChange={e => setForm({ ...form, report_due_date: e.target.value })} /></div>
          <div><Label>Anteckningar</Label><Textarea value={form.notes} onChange={e => setForm({ ...form, notes: e.target.value })} /></div>

          {campaign && (
            <div className="border-t pt-3">
              <Label>Material</Label>
              <div className="space-y-1.5 mt-2">
                {(materials ?? []).map(m => (
                  <div key={m.id} className="flex items-center justify-between text-sm py-1.5 px-2 rounded bg-accent/40">
                    <span>{m.title}</span>
                    <span className="text-xs text-muted-foreground">{m.status} {m.deadline && `· ${format(new Date(m.deadline), "d MMM", { locale: sv })}`}</span>
                  </div>
                ))}
                <div className="flex gap-2">
                  <Input placeholder="Nytt material..." value={newMaterial} onChange={e => setNewMaterial(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); addMaterial(); } }} />
                  <Button type="button" variant="outline" size="icon" onClick={addMaterial}><Plus className="size-4" /></Button>
                </div>
              </div>
            </div>
          )}

          <DialogFooter className="gap-2">
            {campaign && <Button type="button" variant="ghost" size="sm" onClick={remove} className="text-destructive mr-auto"><Trash2 className="size-4 mr-1" /> Ta bort</Button>}
            <Button type="submit" disabled={loading}>Spara</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
