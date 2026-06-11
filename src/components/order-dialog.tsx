import { useEffect, useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Card } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Checkbox } from "@/components/ui/checkbox";
import { supabase } from "@/integrations/supabase/client";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Plus, Trash2, FileDown, Loader2, ChevronDown } from "lucide-react";
import { generateOrderPdf } from "@/lib/order-pdf";


type Item = {
  id?: string;
  product_id: string | null;
  product_name: string;
  sov_pct: string;
  impressions: string;
  weeks: string;
  unit_price: string;
  commission_pct: string;
};

const emptyItem = (): Item => ({
  product_id: null,
  product_name: "",
  sov_pct: "",
  impressions: "",
  weeks: "1",
  unit_price: "0",
  commission_pct: "0",
});


const SEK = (n: number) =>
  new Intl.NumberFormat("sv-SE", { style: "decimal", minimumFractionDigits: 0, maximumFractionDigits: 2 }).format(n || 0);

export function OrderDialog({
  open,
  onOpenChange,
  order,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  order: any | null;
}) {
  const qc = useQueryClient();
  const [saving, setSaving] = useState(false);
  const [generating, setGenerating] = useState(false);

  const { data: customers = [] } = useQuery({
    queryKey: ["customers-min"],
    queryFn: async () => {
      const { data } = await supabase.from("customers").select("*").order("company_name");
      return data ?? [];
    },
  });
  const { data: products = [] } = useQuery({
    queryKey: ["products-min"],
    queryFn: async () => {
      const { data } = await supabase.from("products").select("*").eq("active", true).order("name");
      return data ?? [];
    },
  });
  const { data: sellerComp } = useQuery({
    queryKey: ["my-compensation"],
    queryFn: async () => {
      const { data: u } = await supabase.auth.getUser();
      if (!u.user) return null;
      const { data } = await supabase.from("seller_compensation").select("*").eq("user_id", u.user.id).maybeSingle();
      return data;
    },
  });

  const commissionPctFor = (p: any): number => {
    if (!p) return 0;
    const type = sellerComp?.compensation_type;
    if (type === "endast_provision" && p.commission_pct_provision_only != null) return Number(p.commission_pct_provision_only);
    if (type === "med_grundlon" && p.commission_pct_with_base != null) return Number(p.commission_pct_with_base);
    return Number(p.default_commission_pct ?? 0);
  };

  // Keep commission % in sync with product × seller compensation
  useEffect(() => {
    if (!sellerComp || products.length === 0) return;
    setItems(arr => arr.map(it => {
      if (!it.product_id) return it;
      const p = products.find((x: any) => x.id === it.product_id);
      if (!p) return it;
      const pct = commissionPctFor(p).toString();
      if (it.commission_pct === pct) return it;
      return { ...it, commission_pct: pct };
    }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sellerComp?.compensation_type, products]);




  const [form, setForm] = useState({
    order_type: "offert" as "offert" | "bokning",
    customer_id: null as string | null,
    company_name: "",
    org_number: "",
    vat_number: "",
    billing_address: "",
    postal_code: "",
    city: "",
    contact_name: "",
    contact_email: "",
    contact_phone: "",
    notes: "",
  });
  const [items, setItems] = useState<Item[]>([emptyItem()]);
  const [totalPrice, setTotalPrice] = useState<string>("0");


  useEffect(() => {
    if (!open) return;
    if (order) {
      setForm({
        order_type: order.order_type ?? "offert",
        customer_id: order.customer_id,
        company_name: order.company_name ?? "",
        org_number: order.org_number ?? "",
        vat_number: order.vat_number ?? "",
        billing_address: order.billing_address ?? "",
        postal_code: order.postal_code ?? "",
        city: order.city ?? "",
        contact_name: order.contact_name ?? "",
        contact_email: order.contact_email ?? "",
        contact_phone: order.contact_phone ?? "",
        notes: order.notes ?? "",
      });
      // load items
      supabase.from("order_items").select("*").eq("order_id", order.id).order("position").then(({ data }) => {
        if (data && data.length) {
          setItems(data.map(d => ({
            id: d.id, product_id: d.product_id, product_name: d.product_name,
            sov_pct: d.sov_pct?.toString() ?? "",
            impressions: d.impressions?.toString() ?? "",
            weeks: d.weeks?.toString() ?? "1",
            unit_price: d.unit_price?.toString() ?? "0",
            commission_pct: d.commission_pct?.toString() ?? "0",
          })));
          const tot = data.reduce((s, d) => s + Number(d.unit_price || 0) * Number(d.weeks || 1), 0);
          setTotalPrice(tot.toString());
        } else {
          setItems([emptyItem()]);
          setTotalPrice("0");
        }
      });
    } else {
      setForm({
        order_type: "offert", customer_id: null, company_name: "", org_number: "", vat_number: "",
        billing_address: "", postal_code: "", city: "",
        contact_name: "", contact_email: "", contact_phone: "", notes: "",
      });
      setItems([emptyItem()]);
      setTotalPrice("0");
    }

  }, [order, open]);

  const pickCustomer = (id: string) => {
    const c = customers.find((x: any) => x.id === id);
    if (!c) return;
    setForm(f => ({
      ...f,
      customer_id: c.id,
      company_name: c.company_name ?? "",
      org_number: c.org_number ?? "",
      vat_number: c.vat_number ?? "",
      billing_address: c.billing_address ?? "",
      postal_code: c.postal_code ?? "",
      city: c.city ?? "",
      contact_name: c.contact_name ?? "",
      contact_email: c.email ?? "",
      contact_phone: c.phone ?? "",
    }));
  };

  const pickProduct = (idx: number, pid: string) => {
    const p = products.find((x: any) => x.id === pid);
    if (!p) return;
    setItems(arr => arr.map((it, i) => i === idx ? {
      ...it,
      product_id: p.id,
      product_name: p.name,
      commission_pct: commissionPctFor(p).toString(),

    } : it));
  };

  const updItem = (idx: number, patch: Partial<Item>) => {
    setItems(arr => arr.map((it, i) => i === idx ? { ...it, ...patch } : it));
  };

  // Calculations — total price is split equally across screens
  const total = Number(totalPrice) || 0;
  const activeItems = items.filter(it => it.product_name.trim());
  const perScreen = activeItems.length > 0 ? total / activeItems.length : 0;
  const calc = items.map(it => {
    const lineTotal = it.product_name.trim() ? perScreen : 0;
    const commission = lineTotal * (Number(it.commission_pct) || 0) / 100;
    return { lineTotal, commission };
  });
  const subtotal = calc.reduce((s, c) => s + c.lineTotal, 0);
  const totalCommission = calc.reduce((s, c) => s + c.commission, 0);


  const handleSave = async (e?: React.FormEvent) => {
    e?.preventDefault();
    if (!form.company_name.trim()) { toast.error("Företagsnamn krävs"); return; }
    if (items.length === 0 || items.every(it => !it.product_name.trim())) { toast.error("Lägg till minst en skärm"); return; }
    setSaving(true);
    const { data: u } = await supabase.auth.getUser();
    const uid = u.user?.id;

    const orderPayload: any = {
      ...form,
      total_excl_vat: subtotal,
      total_commission: totalCommission,
      owner_id: order?.owner_id ?? uid,
      created_by: order?.created_by ?? uid,
    };

    let orderId = order?.id;
    if (order) {
      const { error } = await supabase.from("orders").update(orderPayload).eq("id", order.id);
      if (error) { setSaving(false); return toast.error(error.message); }
    } else {
      const { data, error } = await supabase.from("orders").insert(orderPayload).select("id").single();
      if (error || !data) { setSaving(false); return toast.error(error?.message ?? "Kunde inte spara"); }
      orderId = data.id;
    }

    // Replace items
    if (order) await supabase.from("order_items").delete().eq("order_id", orderId);
    const itemRows = items.filter(it => it.product_name.trim()).map((it, i) => {
      const weeks = Number(it.weeks) || 1;
      const lineAmount = perScreen;
      const unitPrice = weeks > 0 ? lineAmount / weeks : lineAmount;
      const pct = Number(it.commission_pct) || 0;
      return {
        order_id: orderId,
        product_id: it.product_id,
        product_name: it.product_name,
        sov_pct: it.sov_pct ? Number(it.sov_pct) : null,
        impressions: it.impressions ? Number(it.impressions) : null,
        weeks,
        unit_price: unitPrice,
        commission_pct: pct,
        commission_amount: lineAmount * pct / 100,
        position: i,
      };
    });

    if (itemRows.length) {
      const { error } = await supabase.from("order_items").insert(itemRows);
      if (error) { setSaving(false); return toast.error(error.message); }
    }

    // Auto-link / create deal
    const dealPayload: any = {
      title: `${form.order_type === "offert" ? "Offert" : "Bokning"} – ${form.company_name}`,
      customer_id: form.customer_id,
      value: subtotal,
      stage: form.order_type === "offert" ? "offert" : "vunnen",
      owner_id: order?.owner_id ?? uid,
      created_by: order?.created_by ?? uid,
    };
    let dealId = order?.deal_id;
    if (dealId) {
      await supabase.from("deals").update(dealPayload).eq("id", dealId);
    } else {
      const { data: d } = await supabase.from("deals").insert(dealPayload).select("id").single();
      if (d) {
        dealId = d.id;
        await supabase.from("orders").update({ deal_id: dealId }).eq("id", orderId);
      }
    }

    setSaving(false);
    toast.success(order ? "Order uppdaterad" : `${form.order_type === "offert" ? "Offert" : "Bokning"} skapad`);
    qc.invalidateQueries({ queryKey: ["orders"] });
    qc.invalidateQueries({ queryKey: ["deals"] });
    onOpenChange(false);
  };

  const handleRemove = async () => {
    if (!order || !confirm("Ta bort ordern?")) return;
    const { error } = await supabase.from("orders").delete().eq("id", order.id);
    if (error) return toast.error(error.message);
    toast.success("Order borttagen");
    qc.invalidateQueries({ queryKey: ["orders"] });
    onOpenChange(false);
  };

  const handlePdf = async () => {
    setGenerating(true);
    try {
      const { data: u } = await supabase.auth.getUser();
      const { data: prof } = await supabase.from("profiles").select("*").eq("id", u.user!.id).maybeSingle();
      const productsMap: Record<string, any> = {};
      products.forEach((p: any) => { productsMap[p.id] = p; });
      await generateOrderPdf({
        order: {
          id: order?.id ?? crypto.randomUUID(),
          ...form,
        },
        items: items.filter(it => it.product_name.trim()).map(it => {
          const weeks = Number(it.weeks) || 1;
          return {
            product_id: it.product_id,
            product_name: it.product_name,
            sov_pct: it.sov_pct ? Number(it.sov_pct) : null,
            impressions: it.impressions ? Number(it.impressions) : null,
            weeks,
            unit_price: weeks > 0 ? perScreen / weeks : perScreen,
          };
        }),

        products: productsMap,
        sellerName: prof?.full_name ?? u.user?.email,
        sellerEmail: prof?.email ?? u.user?.email,
        sellerTitle: "Account Manager",
      });
    } catch (err: any) {
      toast.error(err.message ?? "PDF kunde inte skapas");
    } finally {
      setGenerating(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{order ? "Redigera order" : "Ny order / offert"}</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSave} className="space-y-5">
          {/* Typ */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label>Typ</Label>
              <Select value={form.order_type} onValueChange={(v: "offert" | "bokning") => setForm(f => ({ ...f, order_type: v }))}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="offert">Offert</SelectItem>
                  <SelectItem value="bokning">Bokning</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>Välj befintlig kund (valfritt)</Label>
              <Select value={form.customer_id ?? "__none"} onValueChange={(v) => v === "__none" ? setForm(f => ({ ...f, customer_id: null })) : pickCustomer(v)}>
                <SelectTrigger><SelectValue placeholder="Eller fyll i nedan" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="__none">— Ingen / manuell —</SelectItem>
                  {customers.map((c: any) => (
                    <SelectItem key={c.id} value={c.id}>{c.company_name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          {/* Fakturauppgifter */}
          <div>
            <div className="text-sm font-semibold mb-2">Fakturauppgifter</div>
            <div className="space-y-3">
              <div><Label>Företag *</Label><Input value={form.company_name} onChange={e => setForm({ ...form, company_name: e.target.value })} required /></div>
              <div className="grid grid-cols-2 gap-3">
                <div><Label>Org.nr</Label><Input value={form.org_number} onChange={e => setForm({ ...form, org_number: e.target.value })} /></div>
                <div><Label>Momsregistreringsnr</Label><Input value={form.vat_number} onChange={e => setForm({ ...form, vat_number: e.target.value })} placeholder="SE..." /></div>
              </div>
              <div><Label>Fakturaadress</Label><Input value={form.billing_address} onChange={e => setForm({ ...form, billing_address: e.target.value })} /></div>
              <div className="grid grid-cols-2 gap-3">
                <div><Label>Postnummer</Label><Input value={form.postal_code} onChange={e => setForm({ ...form, postal_code: e.target.value })} /></div>
                <div><Label>Ort</Label><Input value={form.city} onChange={e => setForm({ ...form, city: e.target.value })} /></div>
              </div>
            </div>
          </div>

          {/* Kontakt */}
          <div>
            <div className="text-sm font-semibold mb-2">Kontaktperson</div>
            <div className="grid grid-cols-3 gap-3">
              <div><Label>Namn</Label><Input value={form.contact_name} onChange={e => setForm({ ...form, contact_name: e.target.value })} /></div>
              <div><Label>E-post</Label><Input type="email" value={form.contact_email} onChange={e => setForm({ ...form, contact_email: e.target.value })} /></div>
              <div><Label>Telefon</Label><Input value={form.contact_phone} onChange={e => setForm({ ...form, contact_phone: e.target.value })} /></div>
            </div>
          </div>

          {/* Skärmar */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <div className="text-sm font-semibold">Skärmar</div>
              <Popover>
                <PopoverTrigger asChild>
                  <Button type="button" size="sm" variant="outline">
                    <Plus className="size-4 mr-1" /> Välj skärmar <ChevronDown className="size-4 ml-1" />
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-80 p-2 max-h-96 overflow-y-auto" align="end">
                  <div className="text-xs text-muted-foreground px-2 py-1">Bocka i de skärmar du vill lägga till</div>
                  {products.length === 0 && (
                    <div className="px-2 py-3 text-sm text-muted-foreground">Inga produkter att välja</div>
                  )}
                  {products.map((p: any) => {
                    const checked = items.some(it => it.product_id === p.id);
                    return (
                      <label
                        key={p.id}
                        className="flex items-center gap-2 px-2 py-1.5 rounded hover:bg-accent cursor-pointer"
                      >
                        <Checkbox
                          checked={checked}
                          onCheckedChange={(v) => {
                            if (v) {
                              setItems(arr => {
                                const cleaned = arr.filter(it => it.product_id || it.product_name.trim());
                                return [...cleaned, {
                                  product_id: p.id,
                                  product_name: p.name,
                                  sov_pct: "",
                                  impressions: "",
                                  weeks: "1",
                                  unit_price: "0",
                                  commission_pct: commissionPctFor(p).toString(),
                                }];
                              });
                            } else {
                              setItems(arr => arr.filter(it => it.product_id !== p.id));
                            }
                          }}
                        />
                        <span className="text-sm flex-1">{p.name}</span>
                      </label>
                    );
                  })}
                </PopoverContent>
              </Popover>
            </div>

            <div className="space-y-3">
              {items.map((it, idx) => {
                const { lineTotal, commission } = calc[idx];
                return (
                  <Card key={idx} className="p-3 space-y-3">
                    <div className="grid grid-cols-12 gap-2 items-end">
                      <div className="col-span-5">
                        <Label className="text-xs">Skärm / produkt</Label>
                        <Select value={it.product_id ?? "__none"} onValueChange={(v) => v !== "__none" && pickProduct(idx, v)}>
                          <SelectTrigger><SelectValue placeholder={it.product_name || "Välj skärm"} /></SelectTrigger>
                          <SelectContent>
                            {products.map((p: any) => (
                              <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>
                      <div className="col-span-2">
                        <Label className="text-xs">SOV %</Label>
                        <Input type="number" step="0.01" value={it.sov_pct} onChange={e => updItem(idx, { sov_pct: e.target.value })} />
                      </div>
                      <div className="col-span-3">
                        <Label className="text-xs">Antal visningar</Label>
                        <Input type="number" value={it.impressions} onChange={e => updItem(idx, { impressions: e.target.value })} />
                      </div>
                      <div className="col-span-1">
                        <Label className="text-xs">Veckor</Label>
                        <Input type="number" min="1" value={it.weeks} onChange={e => updItem(idx, { weeks: e.target.value })} />
                      </div>
                      <div className="col-span-1 flex justify-end">
                        <Button type="button" size="icon" variant="ghost" onClick={() => setItems(a => a.filter((_, i) => i !== idx))}>
                          <Trash2 className="size-4 text-destructive" />
                        </Button>
                      </div>
                    </div>
                    <div className="grid grid-cols-12 gap-2 items-end">
                      <div className="col-span-3">
                        <Label className="text-xs">Provision %</Label>
                        <Input type="number" step="0.01" value={it.commission_pct} onChange={e => updItem(idx, { commission_pct: e.target.value })} />
                      </div>
                      <div className="col-span-4 text-sm">
                        <div className="text-xs text-muted-foreground">Andel av total</div>
                        <div className="font-semibold">{SEK(lineTotal)} SEK</div>
                      </div>
                      <div className="col-span-5 text-sm">
                        <div className="text-xs text-muted-foreground">Provision (rad)</div>
                        <div className="font-semibold text-primary">{SEK(commission)} SEK</div>
                      </div>
                    </div>

                  </Card>
                );
              })}
            </div>
          </div>

          {/* Totalpris + SOV */}
          <Card className="p-4 border-primary/40">
            <div className="grid grid-cols-2 gap-4">
              <div>
                <Label className="text-sm font-semibold">Totalt pris för hela ordern (ex moms)</Label>
                <div className="flex items-center gap-3 mt-2">
                  <Input
                    type="number"
                    step="0.01"
                    min="0"
                    value={totalPrice}
                    onChange={e => setTotalPrice(e.target.value)}
                    placeholder="t.ex. 30000"
                    className="text-lg font-semibold"
                  />
                  <span className="text-sm text-muted-foreground whitespace-nowrap">SEK</span>
                </div>
              </div>
              <div>
                <Label className="text-sm font-semibold">SOV (sätter alla skärmar)</Label>
                <div className="flex items-center gap-3 mt-2">
                  <Input
                    type="number"
                    step="0.01"
                    min="0"
                    max="100"
                    placeholder="t.ex. 25"
                    className="text-lg font-semibold"
                    onChange={e => {
                      const v = e.target.value;
                      setItems(arr => arr.map(it => ({ ...it, sov_pct: v })));
                    }}
                  />
                  <span className="text-sm text-muted-foreground whitespace-nowrap">%</span>
                </div>
              </div>
            </div>
            <p className="text-xs text-muted-foreground mt-2">
              Beloppet fördelas automatiskt jämnt över {activeItems.length || 0} skärm{activeItems.length === 1 ? "" : "ar"}
              {activeItems.length > 0 && ` (${SEK(perScreen)} SEK per skärm)`}. SOV kan justeras per skärm ovan.
            </p>
          </Card>


          <div><Label>Anteckningar</Label><Textarea value={form.notes} onChange={e => setForm({ ...form, notes: e.target.value })} /></div>

          <Separator />

          {/* Sammanfattning */}
          <Card className="p-4 bg-accent/30">
            <div className="grid grid-cols-4 gap-4">
              <div>
                <div className="text-xs text-muted-foreground">Summa ex moms</div>
                <div className="text-lg font-bold">{SEK(subtotal)} SEK</div>
              </div>
              <div>
                <div className="text-xs text-muted-foreground">Moms 25%</div>
                <div className="text-lg font-bold">{SEK(subtotal * 0.25)} SEK</div>
              </div>
              <div>
                <div className="text-xs text-muted-foreground">Totalt inkl moms</div>
                <div className="text-lg font-bold">{SEK(subtotal * 1.25)} SEK</div>
              </div>
              <div>
                <div className="text-xs text-muted-foreground">Provision</div>
                <div className="text-lg font-bold text-primary">{SEK(totalCommission)} SEK</div>
              </div>
            </div>
          </Card>


          <DialogFooter className="gap-2">
            {order && (
              <Button type="button" variant="ghost" size="sm" onClick={handleRemove} className="text-destructive mr-auto">
                <Trash2 className="size-4 mr-1" /> Ta bort
              </Button>
            )}
            <Button type="button" variant="outline" onClick={handlePdf} disabled={generating}>
              {generating ? <Loader2 className="size-4 mr-1 animate-spin" /> : <FileDown className="size-4 mr-1" />}
              Ladda ner PDF
            </Button>
            <Button type="submit" disabled={saving}>
              {saving && <Loader2 className="size-4 mr-1 animate-spin" />}
              Spara {form.order_type === "offert" ? "offert" : "bokning"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
