import { useEffect, useMemo, useRef, useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { supabase } from "@/integrations/supabase/client";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Trash2, Upload, FileIcon, Download, Loader2, Mail, Phone, Building2 } from "lucide-react";

type Props = {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  customer: any | null;
};

export function CustomerDetailDialog({ open, onOpenChange, customer }: Props) {
  const qc = useQueryClient();
  const isNew = !customer;
  const empty = {
    company_name: "", contact_name: "", email: "", phone: "", org_number: "", vat_number: "",
    billing_address: "", postal_code: "", city: "", industry: "", notes: "",
    invoice_reference: "", invoice_peppol_id: "", invoice_email: "",
  };
  const [form, setForm] = useState(empty);
  const [loading, setLoading] = useState(false);
  const [tab, setTab] = useState("info");

  useEffect(() => {
    if (customer) setForm({
      company_name: customer.company_name ?? "", contact_name: customer.contact_name ?? "",
      email: customer.email ?? "", phone: customer.phone ?? "", org_number: customer.org_number ?? "",
      vat_number: customer.vat_number ?? "", billing_address: customer.billing_address ?? "",
      postal_code: customer.postal_code ?? "", city: customer.city ?? "",
      industry: customer.industry ?? "", notes: customer.notes ?? "",
      invoice_reference: customer.invoice_reference ?? "",
      invoice_peppol_id: customer.invoice_peppol_id ?? "",
      invoice_email: customer.invoice_email ?? "",
    });
    else setForm(empty);
    setTab("info");
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
      <DialogContent className="max-w-4xl max-h-[90vh] overflow-hidden flex flex-col">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Building2 className="size-5" />
            {customer ? customer.company_name : "Ny kund"}
          </DialogTitle>
        </DialogHeader>

        <Tabs value={tab} onValueChange={setTab} className="flex-1 overflow-hidden flex flex-col">
          <TabsList className={isNew ? "grid grid-cols-1" : "grid grid-cols-5"}>
            <TabsTrigger value="info">Info</TabsTrigger>
            {!isNew && <TabsTrigger value="ordrar">Ordrar</TabsTrigger>}
            {!isNew && <TabsTrigger value="skarmar">Skärmar</TabsTrigger>}
            {!isNew && <TabsTrigger value="material">Material</TabsTrigger>}
            {!isNew && <TabsTrigger value="faktura">Faktura</TabsTrigger>}
          </TabsList>

          <ScrollArea className="flex-1 mt-3 pr-3">
            <TabsContent value="info" className="mt-0">
              <form onSubmit={submit} className="space-y-3" id="customer-info-form">
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
                  <div><Label>Org.nr</Label><Input value={form.org_number} onChange={e => setForm({ ...form, org_number: e.target.value })} /></div>
                  <div><Label>Momsregistreringsnr</Label><Input value={form.vat_number} onChange={e => setForm({ ...form, vat_number: e.target.value })} placeholder="SE..." /></div>
                </div>
                <div><Label>Fakturaadress</Label><Input value={form.billing_address} onChange={e => setForm({ ...form, billing_address: e.target.value })} /></div>
                <div className="grid grid-cols-2 gap-3">
                  <div><Label>Postnummer</Label><Input value={form.postal_code} onChange={e => setForm({ ...form, postal_code: e.target.value })} /></div>
                  <div><Label>Ort</Label><Input value={form.city} onChange={e => setForm({ ...form, city: e.target.value })} /></div>
                </div>
                <div><Label>Anteckningar</Label><Textarea value={form.notes} onChange={e => setForm({ ...form, notes: e.target.value })} /></div>
              </form>
            </TabsContent>

            {!isNew && (
              <TabsContent value="ordrar" className="mt-0">
                <OrdersTab customerId={customer.id} />
              </TabsContent>
            )}
            {!isNew && (
              <TabsContent value="skarmar" className="mt-0">
                <ScreensTab customerId={customer.id} />
              </TabsContent>
            )}
            {!isNew && (
              <TabsContent value="material" className="mt-0">
                <MaterialTab customerId={customer.id} />
              </TabsContent>
            )}
            {!isNew && (
              <TabsContent value="faktura" className="mt-0">
                <InvoiceTab form={form} setForm={setForm} customer={customer} />
              </TabsContent>
            )}
          </ScrollArea>
        </Tabs>

        <DialogFooter className="gap-2 border-t pt-3">
          {customer && <Button type="button" variant="ghost" size="sm" onClick={remove} className="text-destructive mr-auto"><Trash2 className="size-4 mr-1" /> Ta bort</Button>}
          <Button type="submit" form="customer-info-form" disabled={loading} onClick={submit}>Spara</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function fmt(n: number) {
  return new Intl.NumberFormat("sv-SE", { style: "currency", currency: "SEK", maximumFractionDigits: 0 }).format(n || 0);
}

function OrdersTab({ customerId }: { customerId: string }) {
  const { data, isLoading } = useQuery({
    queryKey: ["customer-orders", customerId],
    queryFn: async () => {
      const { data } = await supabase
        .from("orders")
        .select("id, company_name, order_type, status, total_excl_vat, created_at, contact_name, contact_email, contact_phone, invoice_status, order_items(product_name, weeks, unit_price, period_unit)")
        .eq("customer_id", customerId)
        .order("created_at", { ascending: false });
      return data ?? [];
    },
  });

  if (isLoading) return <div className="flex justify-center py-6"><Loader2 className="animate-spin size-5" /></div>;
  if (!data?.length) return <p className="text-sm text-muted-foreground text-center py-6">Inga ordrar ännu</p>;

  const contacts = new Map<string, { name?: string; email?: string; phone?: string }>();
  data.forEach((o: any) => {
    const key = (o.contact_email || o.contact_phone || o.contact_name || "").toLowerCase();
    if (key && !contacts.has(key)) contacts.set(key, { name: o.contact_name, email: o.contact_email, phone: o.contact_phone });
  });

  return (
    <div className="space-y-4">
      {contacts.size > 0 && (
        <div>
          <h3 className="text-sm font-semibold mb-2">Kontaktpersoner</h3>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
            {[...contacts.values()].map((c, i) => (
              <Card key={i} className="p-2 text-sm">
                <div className="font-medium">{c.name || "—"}</div>
                {c.email && <div className="flex items-center gap-1 text-xs text-muted-foreground"><Mail className="size-3" />{c.email}</div>}
                {c.phone && <div className="flex items-center gap-1 text-xs text-muted-foreground"><Phone className="size-3" />{c.phone}</div>}
              </Card>
            ))}
          </div>
        </div>
      )}

      <div>
        <h3 className="text-sm font-semibold mb-2">Order- & bokningshistorik ({data.length})</h3>
        <div className="space-y-2">
          {data.map((o: any) => (
            <Card key={o.id} className="p-3">
              <div className="flex items-center justify-between gap-2 flex-wrap">
                <div>
                  <div className="font-medium text-sm">{o.order_type === "offert" ? "Offert" : "Bokning"} • {new Date(o.created_at).toLocaleDateString("sv-SE")}</div>
                  <div className="text-xs text-muted-foreground">{(o.order_items?.length ?? 0)} rader</div>
                </div>
                <div className="flex items-center gap-2">
                  <Badge variant="outline">{o.status}</Badge>
                  {o.invoice_status && <Badge>{o.invoice_status}</Badge>}
                  <div className="font-medium text-sm">{fmt(Number(o.total_excl_vat))}</div>
                </div>
              </div>
              {o.order_items?.length > 0 && (
                <div className="mt-2 border-t pt-2 space-y-1">
                  {o.order_items.map((it: any, i: number) => (
                    <div key={i} className="flex items-center justify-between text-xs">
                      <span className="truncate">{it.product_name} <span className="text-muted-foreground">({it.weeks} {it.period_unit})</span></span>
                      <span className="text-muted-foreground">{fmt(Number(it.unit_price) * Number(it.weeks))}</span>
                    </div>
                  ))}
                </div>
              )}
            </Card>
          ))}
        </div>
      </div>
    </div>
  );
}

function ScreensTab({ customerId }: { customerId: string }) {
  const { data, isLoading } = useQuery({
    queryKey: ["customer-screens", customerId],
    queryFn: async () => {
      const { data } = await supabase
        .from("orders")
        .select("id, order_items(product_name, weeks, unit_price)")
        .eq("customer_id", customerId);
      return data ?? [];
    },
  });

  const rows = useMemo(() => {
    const map = new Map<string, { product: string; qty: number; total: number; orders: number }>();
    (data ?? []).forEach((o: any) => {
      (o.order_items ?? []).forEach((it: any) => {
        const k = it.product_name;
        const cur = map.get(k) ?? { product: k, qty: 0, total: 0, orders: 0 };
        cur.qty += Number(it.weeks || 0);
        cur.total += Number(it.unit_price || 0) * Number(it.weeks || 0);
        cur.orders += 1;
        map.set(k, cur);
      });
    });
    return [...map.values()].sort((a, b) => b.total - a.total);
  }, [data]);

  if (isLoading) return <div className="flex justify-center py-6"><Loader2 className="animate-spin size-5" /></div>;
  if (!rows.length) return <p className="text-sm text-muted-foreground text-center py-6">Inga skärmar köpta ännu</p>;

  const grand = rows.reduce((s, r) => s + r.total, 0);

  return (
    <div>
      <div className="text-sm text-muted-foreground mb-2">Totalt köp: <span className="font-semibold text-foreground">{fmt(grand)}</span></div>
      <div className="border rounded-md">
        <table className="w-full text-sm">
          <thead className="bg-muted/50">
            <tr className="text-left">
              <th className="p-2">Skärm / Produkt</th>
              <th className="p-2 text-right">Antal perioder</th>
              <th className="p-2 text-right">Ordrar</th>
              <th className="p-2 text-right">Totalt</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.product} className="border-t">
                <td className="p-2">{r.product}</td>
                <td className="p-2 text-right">{r.qty}</td>
                <td className="p-2 text-right">{r.orders}</td>
                <td className="p-2 text-right font-medium">{fmt(r.total)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function MaterialTab({ customerId }: { customerId: string }) {
  const qc = useQueryClient();
  const fileInput = useRef<HTMLInputElement>(null);
  const [uploadingFor, setUploadingFor] = useState<string | null>(null);

  const { data: orders } = useQuery({
    queryKey: ["customer-orders-min", customerId],
    queryFn: async () => {
      const { data } = await supabase.from("orders").select("id, order_type, created_at, total_excl_vat").eq("customer_id", customerId).order("created_at", { ascending: false });
      return data ?? [];
    },
  });

  const orderIds = (orders ?? []).map(o => o.id);
  const { data: materials } = useQuery({
    enabled: orderIds.length > 0,
    queryKey: ["customer-materials", customerId, orderIds.join(",")],
    queryFn: async () => {
      const { data } = await supabase.from("order_materials").select("*").in("order_id", orderIds).order("created_at", { ascending: false });
      return data ?? [];
    },
  });

  const upload = async (orderId: string, file: File) => {
    setUploadingFor(orderId);
    const { data: u } = await supabase.auth.getUser();
    const path = `${customerId}/${orderId}/${Date.now()}-${file.name.replace(/[^\w.\-]/g, "_")}`;
    const up = await supabase.storage.from("order-media").upload(path, file, { upsert: false });
    if (up.error) { setUploadingFor(null); return toast.error(up.error.message); }
    const { error } = await supabase.from("order_materials").insert({
      order_id: orderId, customer_id: customerId, file_path: path, file_name: file.name,
      mime_type: file.type, size_bytes: file.size, uploaded_by: u.user?.id,
    });
    setUploadingFor(null);
    if (error) return toast.error(error.message);
    toast.success("Material uppladdat");
    qc.invalidateQueries({ queryKey: ["customer-materials", customerId] });
  };

  const download = async (path: string, name: string) => {
    const { data, error } = await supabase.storage.from("order-media").createSignedUrl(path, 60);
    if (error || !data) return toast.error(error?.message ?? "Kunde inte hämta fil");
    const a = document.createElement("a");
    a.href = data.signedUrl; a.download = name; a.target = "_blank"; a.click();
  };

  const remove = async (m: any) => {
    if (!confirm(`Ta bort ${m.file_name}?`)) return;
    await supabase.storage.from("order-media").remove([m.file_path]);
    const { error } = await supabase.from("order_materials").delete().eq("id", m.id);
    if (error) return toast.error(error.message);
    toast.success("Borttagen");
    qc.invalidateQueries({ queryKey: ["customer-materials", customerId] });
  };

  if (!orders?.length) return <p className="text-sm text-muted-foreground text-center py-6">Inga ordrar att koppla material till</p>;

  return (
    <div className="space-y-3">
      {orders.map((o: any) => {
        const files = (materials ?? []).filter((m: any) => m.order_id === o.id);
        return (
          <Card key={o.id} className="p-3">
            <div className="flex items-center justify-between gap-2 flex-wrap mb-2">
              <div>
                <div className="font-medium text-sm">{o.order_type === "offert" ? "Offert" : "Bokning"} • {new Date(o.created_at).toLocaleDateString("sv-SE")}</div>
                <div className="text-xs text-muted-foreground">{files.length} fil(er) • {fmt(Number(o.total_excl_vat))}</div>
              </div>
              <div>
                <input
                  type="file"
                  className="hidden"
                  ref={(el) => { if (el) (el as any).dataset.orderId = o.id; }}
                  id={`file-${o.id}`}
                  onChange={(e) => { const f = e.target.files?.[0]; if (f) upload(o.id, f); e.target.value = ""; }}
                />
                <Button size="sm" variant="outline" disabled={uploadingFor === o.id} onClick={() => document.getElementById(`file-${o.id}`)?.click()}>
                  {uploadingFor === o.id ? <Loader2 className="size-4 animate-spin" /> : <Upload className="size-4 mr-1" />}
                  Ladda upp
                </Button>
              </div>
            </div>
            {files.length > 0 && (
              <div className="space-y-1 border-t pt-2">
                {files.map((m: any) => (
                  <div key={m.id} className="flex items-center justify-between gap-2 text-sm">
                    <div className="flex items-center gap-2 min-w-0">
                      <FileIcon className="size-4 shrink-0 text-muted-foreground" />
                      <span className="truncate">{m.file_name}</span>
                      <span className="text-xs text-muted-foreground shrink-0">{m.size_bytes ? `${Math.round(m.size_bytes / 1024)} KB` : ""}</span>
                    </div>
                    <div className="flex items-center gap-1 shrink-0">
                      <Button size="icon" variant="ghost" onClick={() => download(m.file_path, m.file_name)}><Download className="size-4" /></Button>
                      <Button size="icon" variant="ghost" onClick={() => remove(m)} className="text-destructive"><Trash2 className="size-4" /></Button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </Card>
        );
      })}
      <input ref={fileInput} type="file" className="hidden" />
    </div>
  );
}

function InvoiceTab({ form, setForm, customer }: { form: any; setForm: (v: any) => void; customer: any }) {
  const { data: orders } = useQuery({
    queryKey: ["customer-invoice-orders", customer.id],
    queryFn: async () => {
      const { data } = await supabase
        .from("orders")
        .select("id, created_at, total_excl_vat, invoice_status, invoice_reference, invoice_email, invoice_peppol_id, invoiced_at")
        .eq("customer_id", customer.id)
        .order("created_at", { ascending: false });
      return data ?? [];
    },
  });

  return (
    <div className="space-y-4">
      <div>
        <h3 className="text-sm font-semibold mb-2">Standard fakturauppgifter</h3>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <div><Label>Referensnummer</Label><Input value={form.invoice_reference} onChange={e => setForm({ ...form, invoice_reference: e.target.value })} /></div>
          <div><Label>Peppol ID</Label><Input value={form.invoice_peppol_id} onChange={e => setForm({ ...form, invoice_peppol_id: e.target.value })} /></div>
          <div className="md:col-span-2"><Label>Faktura e-post</Label><Input type="email" value={form.invoice_email} onChange={e => setForm({ ...form, invoice_email: e.target.value })} /></div>
        </div>
        <p className="text-xs text-muted-foreground mt-2">Sparas på kundkortet och fylls i automatiskt på nya ordrar.</p>
      </div>

      <div>
        <h3 className="text-sm font-semibold mb-2">Fakturastatus per order</h3>
        {!orders?.length && <p className="text-sm text-muted-foreground">Inga ordrar.</p>}
        <div className="space-y-1">
          {orders?.map((o: any) => (
            <Card key={o.id} className="p-2 flex items-center justify-between gap-2 text-sm flex-wrap">
              <div>
                <div>{new Date(o.created_at).toLocaleDateString("sv-SE")} • {fmt(Number(o.total_excl_vat))}</div>
                <div className="text-xs text-muted-foreground">Ref: {o.invoice_reference || "—"} • {o.invoice_email || o.invoice_peppol_id || "—"}</div>
              </div>
              <Badge variant={o.invoice_status === "fakturerad" ? "default" : "outline"}>
                {o.invoice_status || "ej klar"}
              </Badge>
            </Card>
          ))}
        </div>
      </div>
    </div>
  );
}
