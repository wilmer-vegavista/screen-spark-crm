import { useEffect, useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { supabase } from "@/integrations/supabase/client";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Trash2 } from "lucide-react";

export function CustomerDialog({ open, onOpenChange, customer }: { open: boolean; onOpenChange: (v: boolean) => void; customer: any | null }) {
  const qc = useQueryClient();
  const [form, setForm] = useState({ company_name: "", contact_name: "", email: "", phone: "", org_number: "", industry: "", notes: "" });
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (customer) setForm({
      company_name: customer.company_name ?? "", contact_name: customer.contact_name ?? "",
      email: customer.email ?? "", phone: customer.phone ?? "", org_number: customer.org_number ?? "",
      industry: customer.industry ?? "", notes: customer.notes ?? "",
    });
    else setForm({ company_name: "", contact_name: "", email: "", phone: "", org_number: "", industry: "", notes: "" });
  }, [customer, open]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    const { data: u } = await supabase.auth.getUser();
    const payload = { ...form, owner_id: customer?.owner_id ?? u.user?.id, created_by: customer?.created_by ?? u.user?.id };
    const { error } = customer
      ? await supabase.from("customers").update(payload).eq("id", customer.id)
      : await supabase.from("customers").insert(payload);
    setLoading(false);
    if (error) return toast.error(error.message);
    toast.success(customer ? "Kund uppdaterad" : "Kund skapad");
    qc.invalidateQueries({ queryKey: ["customers"] });
    onOpenChange(false);
  };

  const remove = async () => {
    if (!customer || !confirm("Ta bort kund?")) return;
    const { error } = await supabase.from("customers").delete().eq("id", customer.id);
    if (error) return toast.error(error.message);
    toast.success("Kund borttagen");
    qc.invalidateQueries({ queryKey: ["customers"] });
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader><DialogTitle>{customer ? "Redigera kund" : "Ny kund"}</DialogTitle></DialogHeader>
        <form onSubmit={submit} className="space-y-3">
          <div><Label>Företag *</Label><Input value={form.company_name} onChange={e => setForm({ ...form, company_name: e.target.value })} required /></div>
          <div className="grid grid-cols-2 gap-3">
            <div><Label>Kontaktperson</Label><Input value={form.contact_name} onChange={e => setForm({ ...form, contact_name: e.target.value })} /></div>
            <div><Label>Bransch</Label><Input value={form.industry} onChange={e => setForm({ ...form, industry: e.target.value })} /></div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div><Label>E-post</Label><Input type="email" value={form.email} onChange={e => setForm({ ...form, email: e.target.value })} /></div>
            <div><Label>Telefon</Label><Input value={form.phone} onChange={e => setForm({ ...form, phone: e.target.value })} /></div>
          </div>
          <div><Label>Org.nr</Label><Input value={form.org_number} onChange={e => setForm({ ...form, org_number: e.target.value })} /></div>
          <div><Label>Anteckningar</Label><Textarea value={form.notes} onChange={e => setForm({ ...form, notes: e.target.value })} /></div>
          <DialogFooter className="gap-2">
            {customer && <Button type="button" variant="ghost" size="sm" onClick={remove} className="text-destructive mr-auto"><Trash2 className="size-4 mr-1" /> Ta bort</Button>}
            <Button type="submit" disabled={loading}>Spara</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
