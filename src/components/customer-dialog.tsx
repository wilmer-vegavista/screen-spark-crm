import { useEffect, useRef, useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { supabase } from "@/integrations/supabase/client";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Loader2, Search, Trash2 } from "lucide-react";
import { lookupCompanyAddress } from "@/lib/company-lookup.functions";
import { normalizeOrgNumber, isValidOrgNumber } from "@/lib/orgnr";

export function CustomerDialog({ open, onOpenChange, customer }: { open: boolean; onOpenChange: (v: boolean) => void; customer: any | null }) {
  const qc = useQueryClient();
  const empty = { company_name: "", contact_name: "", email: "", phone: "", org_number: "", vat_number: "", billing_address: "", postal_code: "", city: "", industry: "", notes: "" };
  const [form, setForm] = useState(empty);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (customer) setForm({
      company_name: customer.company_name ?? "", contact_name: customer.contact_name ?? "",
      email: customer.email ?? "", phone: customer.phone ?? "", org_number: customer.org_number ?? "",
      vat_number: customer.vat_number ?? "", billing_address: customer.billing_address ?? "",
      postal_code: customer.postal_code ?? "", city: customer.city ?? "",
      industry: customer.industry ?? "", notes: customer.notes ?? "",
    });
    else setForm(empty);
  }, [customer, open]);

  const [orgLookupLoading, setOrgLookupLoading] = useState(false);
  const lastOrgLookup = useRef("");

  const runOrgLookup = async (raw: string, force = false) => {
    const digits = normalizeOrgNumber(raw);
    if (digits.length !== 10) {
      if (force) toast.error("Ange ett organisationsnummer med 10 siffror");
      return;
    }
    if (!force && (!isValidOrgNumber(digits) || lastOrgLookup.current === digits)) return;
    lastOrgLookup.current = digits;
    setOrgLookupLoading(true);
    try {
      const r = await lookupCompanyAddress({ data: { orgNumber: digits } });
      if (r.ok) {
        setForm(f => ({
          ...f,
          company_name: f.company_name.trim() ? f.company_name : (r.name ?? f.company_name),
          billing_address: r.street ?? f.billing_address,
          postal_code: r.postalCode ?? f.postal_code,
          city: r.city ?? f.city,
        }));
        toast.success("Adressuppgifter hämtade från allabolag.se");
      } else {
        toast.error(r.error);
      }
    } catch (err: any) {
      toast.error("Kunde inte hämta adress: " + (err?.message ?? "okänt fel"));
    } finally {
      setOrgLookupLoading(false);
    }
  };

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
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label>Org.nr</Label>
              <div className="flex gap-1">
                <Input
                  value={form.org_number}
                  onChange={e => {
                    const v = e.target.value;
                    setForm(f => ({ ...f, org_number: v }));
                    runOrgLookup(v);
                  }}
                  onBlur={e => runOrgLookup(e.target.value)}
                  placeholder="XXXXXX-XXXX"
                />
                <Button
                  type="button"
                  size="icon"
                  variant="outline"
                  onClick={() => runOrgLookup(form.org_number, true)}
                  disabled={orgLookupLoading}
                  title="Hämta adress från allabolag.se"
                >
                  {orgLookupLoading ? <Loader2 className="size-4 animate-spin" /> : <Search className="size-4" />}
                </Button>
              </div>
              <p className="text-[10px] text-muted-foreground mt-1">Adress hämtas automatiskt från allabolag.se.</p>
            </div>
            <div><Label>Momsregistreringsnr</Label><Input value={form.vat_number} onChange={e => setForm({ ...form, vat_number: e.target.value })} placeholder="SE..." /></div>
          </div>
          <div><Label>Fakturaadress</Label><Input value={form.billing_address} onChange={e => setForm({ ...form, billing_address: e.target.value })} /></div>
          <div className="grid grid-cols-2 gap-3">
            <div><Label>Postnummer</Label><Input value={form.postal_code} onChange={e => setForm({ ...form, postal_code: e.target.value })} /></div>
            <div><Label>Ort</Label><Input value={form.city} onChange={e => setForm({ ...form, city: e.target.value })} /></div>
          </div>
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
