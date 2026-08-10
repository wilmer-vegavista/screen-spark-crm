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
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Calendar } from "@/components/ui/calendar";
import { Badge } from "@/components/ui/badge";
import { supabase } from "@/integrations/supabase/client";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Plus, Trash2, FileDown, Loader2, ChevronDown, CalendarIcon, X, Eye, CheckCircle2, ArrowUp, ArrowDown, Package as PackageIcon } from "lucide-react";
import { generateOrderPdf, type OrderPdfInput } from "@/lib/order-pdf";
import { format } from "date-fns";
import { sv } from "date-fns/locale";
import { buildInvoiceSchedule, frequencyLabels, type BillingFrequency } from "@/lib/billing";
import { cn } from "@/lib/utils";
import { ORDER_ITEM_SELECT } from "@/lib/order-columns";



type PeriodUnit = "veckor" | "manader" | "ar";

type Item = {
  id?: string;
  product_id: string | null;
  product_name: string;
  sov_pct: string;
  impressions: string;
  weeks: string;
  period_unit: PeriodUnit;
  unit_price: string;
  line_price: string;
  commission_pct: string;
};

const emptyItem = (): Item => ({
  product_id: null,
  product_name: "",
  sov_pct: "",
  impressions: "",
  weeks: "1",
  period_unit: "veckor",
  unit_price: "0",
  line_price: "0",
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
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);

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
  const { data: packages = [] } = useQuery({
    queryKey: ["packages-with-products"],
    queryFn: async () => {
      const { data: pkgs } = await supabase
        .from("product_packages")
        .select("id, name")
        .eq("active", true)
        .order("name");
      if (!pkgs || pkgs.length === 0) return [];
      const ids = pkgs.map((p: any) => p.id);
      const { data: links } = await supabase
        .from("package_products")
        .select("package_id, product_id, position")
        .in("package_id", ids);
      return pkgs.map((p: any) => ({
        ...p,
        product_ids: (links ?? [])
          .filter((l: any) => l.package_id === p.id)
          .sort((a: any, b: any) => (a.position ?? 0) - (b.position ?? 0))
          .map((l: any) => l.product_id),
      }));
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
  const { data: currentUserId } = useQuery({
    queryKey: ["current-user-id"],
    queryFn: async () => {
      const { data } = await supabase.auth.getUser();
      return data.user?.id ?? null;
    },
  });
  const { data: sellers = [] } = useQuery({
    queryKey: ["sellers-list"],
    queryFn: async () => {
      const { data: roles } = await supabase.from("user_roles").select("user_id").eq("role", "saljare");
      const ids = (roles ?? []).map((r: any) => r.user_id);
      if (ids.length === 0) return [];
      const { data } = await supabase.from("profiles").select("id, full_name, email").in("id", ids).order("full_name");
      return data ?? [];
    },
  });

  const commissionPctFor = (p: any): number => {
    if (!p) return 0;
    const type = sellerComp?.compensation_type;
    if (type === "endast_provision" && p.commission_pct_provision_only != null) return Number(p.commission_pct_provision_only);
    if (type === "med_grundlon" && p.commission_pct_with_base != null) return Number(p.commission_pct_with_base);
    return Number(p.default_commission_pct ?? 0);
  };

  const commissionPctForItem = (it: Item): number => {
    const product = it.product_id ? products.find((p: any) => p.id === it.product_id) : null;
    return product ? commissionPctFor(product) : Number(it.commission_pct || 0);
  };

  // Keep commission % in sync with product × seller compensation
  useEffect(() => {
    if (products.length === 0) return;
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
    invoice_start_date: new Date() as Date,
    billing_frequency: "engang" as BillingFrequency,
    billing_duration_months: 1,
    invoice_reference: "",
    invoice_peppol_id: "",
    invoice_email: "",
    invoice_status: null as string | null,
  });
  const [items, setItems] = useState<Item[]>([emptyItem()]);
  const [totalPrice, setTotalPrice] = useState<string>("0");
  const [selectedWeeks, setSelectedWeeks] = useState<number[]>([]);
  const [exactDates, setExactDates] = useState<Date[]>([]);
  const [ownerId, setOwnerId] = useState<string | null>(null);
  const [splits, setSplits] = useState<Array<{ user_id: string; share_pct: string }>>([]);



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
        invoice_start_date: order.invoice_start_date ? new Date(order.invoice_start_date) : new Date(),
        billing_frequency: (order.billing_frequency as BillingFrequency) ?? "engang",
        billing_duration_months: order.billing_duration_months ?? 1,
        invoice_reference: order.invoice_reference ?? "",
        invoice_peppol_id: order.invoice_peppol_id ?? "",
        invoice_email: order.invoice_email ?? "",
        invoice_status: order.invoice_status ?? null,
      });
      setSelectedWeeks(Array.isArray(order.selected_weeks) ? order.selected_weeks : []);
      setExactDates(Array.isArray(order.exact_dates) ? order.exact_dates.map((d: string) => new Date(d)) : []);
      setOwnerId(order.owner_id ?? null);

      // load items (commission is protected in the DB and fetched separately)
      (async () => {
        const [{ data }, { data: comm }] = await Promise.all([
          supabase.from("order_items").select(ORDER_ITEM_SELECT).eq("order_id", order.id).order("position"),
          supabase.rpc("get_order_commission", { _order_id: order.id }),
        ]);
        const pctByItem = new Map<string, number>(
          ((comm ?? []) as any[])
            .filter(r => r.item_id)
            .map(r => [r.item_id as string, Number(r.item_commission_pct ?? 0)]),
        );
        if (data && data.length) {
          setItems(data.map(d => ({
            id: d.id, product_id: d.product_id, product_name: d.product_name,
            sov_pct: d.sov_pct?.toString() ?? "",
            impressions: d.impressions?.toString() ?? "",
            weeks: d.weeks?.toString() ?? "1",
            period_unit: ((d as any).period_unit ?? "veckor") as PeriodUnit,
            unit_price: d.unit_price?.toString() ?? "0",
            line_price: (Number(d.unit_price || 0) * Number(d.weeks || 1)).toString(),
            commission_pct: String(pctByItem.get(d.id) ?? 0),
          })));
          const tot = data.reduce((s, d) => s + Number(d.unit_price || 0) * Number(d.weeks || 1), 0);
          setTotalPrice(tot.toString());
        } else {
          setItems([emptyItem()]);
          setTotalPrice("0");
        }
      })();


      // load splits
      supabase.from("order_splits").select("user_id, share_pct").eq("order_id", order.id).then(({ data }) => {
        setSplits((data ?? []).map((s: any) => ({ user_id: s.user_id, share_pct: String(s.share_pct) })));
      });
    } else {
      setForm({
        order_type: "offert", customer_id: null, company_name: "", org_number: "", vat_number: "",
        billing_address: "", postal_code: "", city: "",
        contact_name: "", contact_email: "", contact_phone: "", notes: "",
        invoice_start_date: new Date(), billing_frequency: "engang", billing_duration_months: 1,
        invoice_reference: "", invoice_peppol_id: "", invoice_email: "", invoice_status: null,
      });
      setItems([emptyItem()]);
      setTotalPrice("0");
      setSelectedWeeks([]);
      setExactDates([]);
      setOwnerId(currentUserId ?? null);
      setSplits([]);
    }


  }, [order, open, currentUserId]);

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
      invoice_reference: f.invoice_reference || c.invoice_reference || "",
      invoice_peppol_id: f.invoice_peppol_id || c.invoice_peppol_id || "",
      invoice_email: f.invoice_email || c.invoice_email || "",
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

  const moveItem = (idx: number, dir: -1 | 1) => {
    setItems(arr => {
      const next = [...arr];
      const target = idx + dir;
      if (target < 0 || target >= next.length) return arr;
      [next[idx], next[target]] = [next[target], next[idx]];
      return next;
    });
  };

  const addPackage = (pkg: { product_ids: string[] }) => {
    if (!pkg.product_ids?.length) return;
    setItems(arr => {
      const cleaned = arr.filter(it => it.product_id || it.product_name.trim());
      const existing = new Set(cleaned.map(it => it.product_id).filter(Boolean));
      const additions: Item[] = pkg.product_ids
        .filter(pid => !existing.has(pid))
        .map(pid => {
          const p = products.find((x: any) => x.id === pid);
          if (!p) return null;
          return {
            product_id: p.id,
            product_name: p.name,
            sov_pct: "",
            impressions: "",
            weeks: "1",
            period_unit: "veckor" as PeriodUnit,
            unit_price: "0",
            line_price: "0",
            commission_pct: commissionPctFor(p).toString(),
          } as Item;
        })
        .filter(Boolean) as Item[];
      return [...cleaned, ...additions];
    });
  };

  const cityFor = (pid: string | null) => {
    if (!pid) return "Övrigt";
    const p = products.find((x: any) => x.id === pid);
    return (p?.city || "Övrigt") as string;
  };

  // Calculations — use per-screen price if any are set, otherwise split total equally
  const total = Number(totalPrice) || 0;
  const activeItems = items.filter(it => it.product_name.trim());
  const manualSum = activeItems.reduce((s, it) => s + (Number(it.line_price) || 0), 0);
  const useManual = manualSum > 0;
  const perScreen = activeItems.length > 0 ? total / activeItems.length : 0;
  const calc = items.map(it => {
    const hasName = !!it.product_name.trim();
    const lineTotal = hasName ? (useManual ? (Number(it.line_price) || 0) : perScreen) : 0;
    const commissionPct = commissionPctForItem(it);
    const commission = lineTotal * commissionPct / 100;
    return { lineTotal, commission, commissionPct };
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

    const effectiveOwner = ownerId ?? uid;

    // Validate splits
    const cleanSplits = splits
      .filter(s => s.user_id && s.user_id !== effectiveOwner && Number(s.share_pct) > 0)
      .map(s => ({ user_id: s.user_id, share_pct: Number(s.share_pct) }));
    const totalSplit = cleanSplits.reduce((sum, s) => sum + s.share_pct, 0);
    if (totalSplit > 100) {
      setSaving(false);
      toast.error("Total delningsprocent kan inte överstiga 100%");
      return;
    }

    // Auto-create / link customer card from invoice details
    let customerId = form.customer_id;
    if (form.company_name.trim()) {
      const customerPayload = {
        company_name: form.company_name.trim(),
        org_number: form.org_number || null,
        vat_number: form.vat_number || null,
        billing_address: form.billing_address || null,
        postal_code: form.postal_code || null,
        city: form.city || null,
        contact_name: form.contact_name || null,
        email: form.contact_email || null,
        phone: form.contact_phone || null,
        invoice_reference: form.invoice_reference || null,
        invoice_peppol_id: form.invoice_peppol_id || null,
        invoice_email: form.invoice_email || null,
      };
      if (customerId) {
        await supabase.from("customers").update(customerPayload).eq("id", customerId);
      } else {
        // Try to find existing customer for this owner with same company name
        const { data: existing } = await supabase
          .from("customers")
          .select("id")
          .ilike("company_name", form.company_name.trim())
          .eq("owner_id", effectiveOwner!)
          .maybeSingle();
        if (existing?.id) {
          customerId = existing.id;
          await supabase.from("customers").update(customerPayload).eq("id", customerId);
        } else {
          const { data: newCust, error: custErr } = await supabase
            .from("customers")
            .insert({ ...customerPayload, owner_id: effectiveOwner, created_by: uid })
            .select("id")
            .single();
          if (custErr) { setSaving(false); return toast.error("Kunde inte skapa kundkort: " + custErr.message); }
          customerId = newCust!.id;
        }
      }
      qc.invalidateQueries({ queryKey: ["customers"] });
      qc.invalidateQueries({ queryKey: ["customers-min"] });
    }

    const orderPayload: any = {
      ...form,
      customer_id: customerId,
      invoice_start_date: format(form.invoice_start_date, "yyyy-MM-dd"),
      total_excl_vat: subtotal,
      total_commission: totalCommission,
      selected_weeks: selectedWeeks,
      exact_dates: exactDates.map(d => format(d, "yyyy-MM-dd")),
      owner_id: effectiveOwner,
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
      const lineAmount = useManual ? (Number(it.line_price) || 0) : perScreen;
      const unitPrice = weeks > 0 ? lineAmount / weeks : lineAmount;
      const pct = commissionPctForItem(it);
      return {
        order_id: orderId,
        product_id: it.product_id,
        product_name: it.product_name,
        sov_pct: it.sov_pct ? Number(it.sov_pct) : null,
        impressions: it.impressions ? Number(it.impressions) : null,
        weeks,
        period_unit: it.period_unit,
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
      commission_pct_override: subtotal > 0 ? (totalCommission / subtotal) * 100 : null,
      stage: form.order_type === "offert" ? "offert" : "vunnen",
      owner_id: effectiveOwner,
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

    // Replace splits
    await supabase.from("order_splits").delete().eq("order_id", orderId);
    if (cleanSplits.length > 0) {
      const { error } = await supabase
        .from("order_splits")
        .insert(cleanSplits.map(s => ({ ...s, order_id: orderId })));
      if (error) { setSaving(false); return toast.error(error.message); }
    }

    // Sync invoice details back to customer card
    if (form.customer_id && (form.invoice_reference || form.invoice_peppol_id || form.invoice_email)) {
      await supabase.from("customers").update({
        invoice_reference: form.invoice_reference || null,
        invoice_peppol_id: form.invoice_peppol_id || null,
        invoice_email: form.invoice_email || null,
      }).eq("id", form.customer_id);
    }

    setSaving(false);
    toast.success(order ? "Order uppdaterad" : `${form.order_type === "offert" ? "Offert" : "Bokning"} skapad`);
    qc.invalidateQueries({ queryKey: ["orders"] });
    qc.invalidateQueries({ queryKey: ["deals"] });
    qc.invalidateQueries({ queryKey: ["customers-min"] });
    onOpenChange(false);
    return orderId;
  };

  const invoiceMissing = (() => {
    const required = [form.company_name, form.org_number, form.billing_address, form.postal_code, form.city];
    if (required.some(v => !v?.trim())) return true;
    if (!form.invoice_email?.trim() && !form.invoice_peppol_id?.trim()) return true;
    return false;
  })();

  const handleMarkReady = async () => {
    if (invoiceMissing) {
      toast.error("Fyll i alla fakturauppgifter (företag, org.nr, adress, postnr, ort + peppol-id eller faktura-mejl)");
      return;
    }
    setSaving(true);
    try {
      const oid = await handleSave();
      const targetId = oid ?? order?.id;
      if (targetId) {
        await supabase.from("orders").update({
          invoice_status: "klar",
          marked_ready_at: new Date().toISOString(),
        }).eq("id", targetId);
        toast.success("Markerad som klar att fakturera");
        qc.invalidateQueries({ queryKey: ["orders"] });
      }
    } catch (err: any) {
      toast.error(err?.message ?? "Kunde inte markera som klar");
    } finally {
      setSaving(false);
    }
  };

  const handleRemove = async () => {
    if (!order || !confirm("Ta bort ordern?")) return;
    const { error } = await supabase.from("orders").delete().eq("id", order.id);
    if (error) return toast.error(error.message);
    toast.success("Order borttagen");
    qc.invalidateQueries({ queryKey: ["orders"] });
    onOpenChange(false);
  };

  const buildPdfInput = async (): Promise<Omit<OrderPdfInput, "mode">> => {
    const { data: u } = await supabase.auth.getUser();
    const sellerId = (order as any)?.owner_id ?? ownerId ?? (order as any)?.created_by ?? u.user?.id;
    const { data: prof } = await supabase.from("profiles").select("*").eq("id", sellerId).maybeSingle();
    const productsMap: Record<string, any> = {};
    products.forEach((p: any) => { productsMap[p.id] = p; });
    return {
      order: {
        id: order?.id ?? crypto.randomUUID(),
        created_at: (order as any)?.created_at ?? new Date().toISOString(),
        ...form,
        selected_weeks: selectedWeeks,
        exact_dates: exactDates.map(d => format(d, "yyyy-MM-dd")),
      },
      items: items.filter(it => it.product_name.trim()).map(it => {
        const weeks = Number(it.weeks) || 1;
        const lineAmount = useManual ? (Number(it.line_price) || 0) : perScreen;
        return {
          product_id: it.product_id,
          product_name: it.product_name,
          sov_pct: it.sov_pct ? Number(it.sov_pct) : null,
          impressions: it.impressions ? Number(it.impressions) : null,
          weeks,
          unit_price: weeks > 0 ? lineAmount / weeks : lineAmount,
        };
      }),
      products: productsMap,
      sellerName: prof?.full_name ?? prof?.email ?? u.user?.email,
      sellerEmail: prof?.email ?? u.user?.email,
      sellerTitle: "Account Manager",
    };
  };

  const handlePdf = async () => {
    setGenerating(true);
    try {
      const input = await buildPdfInput();
      await generateOrderPdf({ ...input, mode: "download" });
    } catch (err: any) {
      toast.error(err.message ?? "PDF kunde inte skapas");
    } finally {
      setGenerating(false);
    }
  };

  const handlePreview = async () => {
    setPreviewLoading(true);
    try {
      const input = await buildPdfInput();
      const url = (await generateOrderPdf({ ...input, mode: "blob" })) as string;
      if (previewUrl) URL.revokeObjectURL(previewUrl);
      setPreviewUrl(url);
    } catch (err: any) {
      toast.error(err.message ?? "Förhandsvisning kunde inte skapas");
    } finally {
      setPreviewLoading(false);
    }
  };

  // Städa upp object-URL när komponenten unmountar
  useEffect(() => {
    return () => {
      if (previewUrl) URL.revokeObjectURL(previewUrl);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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

          {/* Säljare + Dela affär */}
          <Card className="p-4 space-y-4">
            <div>
              <Label className="text-sm font-semibold">Säljare (ägare av ordern)</Label>
              <Select value={ownerId ?? ""} onValueChange={(v) => setOwnerId(v)}>
                <SelectTrigger className="mt-1">
                  <SelectValue placeholder="Välj säljare" />
                </SelectTrigger>
                <SelectContent>
                  {sellers.map((s: any) => (
                    <SelectItem key={s.id} value={s.id}>
                      {s.full_name || s.email}{s.id === currentUserId ? " (du)" : ""}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-[10px] text-muted-foreground mt-1">Förval är personen som är inloggad.</p>
            </div>

            <Separator />

            <div>
              <div className="flex items-center justify-between mb-2">
                <div>
                  <div className="text-sm font-semibold">Dela affär</div>
                  <div className="text-[11px] text-muted-foreground">
                    Lägg till kollegor som ska dela på affären och välj procent. Resten tillfaller ägaren.
                  </div>
                </div>
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  onClick={() => setSplits(arr => [...arr, { user_id: "", share_pct: "" }])}
                >
                  <Plus className="size-4 mr-1" /> Lägg till kollega
                </Button>
              </div>

              {splits.length === 0 ? (
                <div className="text-xs text-muted-foreground italic">Affären delas inte.</div>
              ) : (
                <div className="space-y-2">
                  {splits.map((s, i) => {
                    const total = splits.reduce((sum, x) => sum + (Number(x.share_pct) || 0), 0);
                    return (
                      <div key={i} className="grid grid-cols-12 gap-2 items-end">
                        <div className="col-span-7">
                          <Label className="text-xs">Kollega</Label>
                          <Select
                            value={s.user_id}
                            onValueChange={(v) => setSplits(arr => arr.map((x, j) => j === i ? { ...x, user_id: v } : x))}
                          >
                            <SelectTrigger><SelectValue placeholder="Välj säljare" /></SelectTrigger>
                            <SelectContent>
                              {sellers
                                .filter((sel: any) => sel.id !== ownerId && !splits.some((sp, j) => j !== i && sp.user_id === sel.id))
                                .map((sel: any) => (
                                  <SelectItem key={sel.id} value={sel.id}>{sel.full_name || sel.email}</SelectItem>
                                ))}
                            </SelectContent>
                          </Select>
                        </div>
                        <div className="col-span-3">
                          <Label className="text-xs">Andel %</Label>
                          <Input
                            type="number"
                            min="0"
                            max="100"
                            step="0.01"
                            value={s.share_pct}
                            onChange={(e) => setSplits(arr => arr.map((x, j) => j === i ? { ...x, share_pct: e.target.value } : x))}
                          />
                        </div>
                        <div className="col-span-2 flex justify-end">
                          <Button
                            type="button"
                            size="icon"
                            variant="ghost"
                            onClick={() => setSplits(arr => arr.filter((_, j) => j !== i))}
                          >
                            <Trash2 className="size-4 text-destructive" />
                          </Button>
                        </div>
                        {i === splits.length - 1 && (
                          <div className="col-span-12 text-xs">
                            Delat totalt: <span className={total > 100 ? "text-destructive font-semibold" : "font-semibold"}>{total}%</span>
                            {" · "}Ägarens andel: <span className="font-semibold">{Math.max(0, 100 - total)}%</span>
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </Card>


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
              <div className="grid grid-cols-3 gap-3 pt-2 border-t mt-2">
                <div>
                  <Label>Referensnummer</Label>
                  <Input value={form.invoice_reference} onChange={e => setForm({ ...form, invoice_reference: e.target.value })} placeholder="Kundens referens" />
                </div>
                <div>
                  <Label>Peppol-ID</Label>
                  <Input value={form.invoice_peppol_id} onChange={e => setForm({ ...form, invoice_peppol_id: e.target.value })} placeholder="0007:..." />
                </div>
                <div>
                  <Label>Faktura-mejl</Label>
                  <Input type="email" value={form.invoice_email} onChange={e => setForm({ ...form, invoice_email: e.target.value })} placeholder="faktura@..." />
                </div>
              </div>
              <p className="text-[11px] text-muted-foreground">Sparas även på kundkortet så de följer med nästa order.</p>
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
            <div className="flex items-center justify-between mb-2 gap-2 flex-wrap">
              <div className="text-sm font-semibold">Skärmar</div>
              <div className="flex items-center gap-2">
                {packages.length > 0 && (
                  <Popover>
                    <PopoverTrigger asChild>
                      <Button type="button" size="sm" variant="outline">
                        <PackageIcon className="size-4 mr-1" /> Lägg till paket <ChevronDown className="size-4 ml-1" />
                      </Button>
                    </PopoverTrigger>
                    <PopoverContent className="w-72 p-1 max-h-80 overflow-y-auto" align="end">
                      <div className="text-xs text-muted-foreground px-2 py-1">
                        Lägger till alla skärmar i paketet
                      </div>
                      {packages.map((pkg: any) => (
                        <button
                          key={pkg.id}
                          type="button"
                          onClick={() => addPackage(pkg)}
                          className="w-full text-left px-2 py-2 rounded hover:bg-accent flex items-center justify-between gap-2"
                        >
                          <span className="text-sm">{pkg.name}</span>
                          <span className="text-xs text-muted-foreground">
                            {pkg.product_ids.length} st
                          </span>
                        </button>
                      ))}
                    </PopoverContent>
                  </Popover>
                )}
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
                                    period_unit: "veckor" as PeriodUnit,
                                    unit_price: "0",
                                    line_price: "0",
                                    commission_pct: commissionPctFor(p).toString(),
                                  }];
                                });
                              } else {
                                setItems(arr => arr.filter(it => it.product_id !== p.id));
                              }
                            }}
                          />
                          <span className="text-sm flex-1">
                            {p.name}
                            {p.city ? <span className="text-xs text-muted-foreground ml-1">· {p.city}</span> : null}
                          </span>
                        </label>
                      );
                    })}
                  </PopoverContent>
                </Popover>
              </div>
            </div>

            <div className="space-y-4">
              {(() => {
                const groups: { city: string; entries: { it: Item; idx: number }[] }[] = [];
                items.forEach((it, idx) => {
                  const c = cityFor(it.product_id);
                  const g = groups.find(x => x.city === c);
                  if (g) g.entries.push({ it, idx });
                  else groups.push({ city: c, entries: [{ it, idx }] });
                });
                return groups.map(g => (
                  <div key={g.city} className="space-y-2">
                    {groups.length > 1 && (
                      <div className="text-xs font-semibold uppercase tracking-wider text-muted-foreground px-1">
                        {g.city} <span className="text-muted-foreground/60">· {g.entries.length} st</span>
                      </div>
                    )}
                    <div className="space-y-3">
                      {g.entries.map(({ it, idx }) => {
                        const { lineTotal, commission, commissionPct } = calc[idx];
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
                      <div className="col-span-2">
                        <Label className="text-xs">Antal visningar</Label>
                        <Input type="number" value={it.impressions} onChange={e => updItem(idx, { impressions: e.target.value })} />
                      </div>
                      <div className="col-span-2">
                        <Label className="text-xs">Period</Label>
                        <div className="flex gap-1">
                          <Input
                            type="number"
                            min="1"
                            value={it.weeks}
                            onChange={e => updItem(idx, { weeks: e.target.value })}
                            className="w-14"
                          />
                          <Select
                            value={it.period_unit}
                            onValueChange={(v: PeriodUnit) => updItem(idx, { period_unit: v })}
                          >
                            <SelectTrigger className="flex-1"><SelectValue /></SelectTrigger>
                            <SelectContent>
                              <SelectItem value="veckor">veckor</SelectItem>
                              <SelectItem value="manader">månader</SelectItem>
                              <SelectItem value="ar">år</SelectItem>
                            </SelectContent>
                          </Select>
                        </div>
                      </div>
                      <div className="col-span-1 flex flex-col items-end gap-1">
                        <div className="flex">
                          <Button type="button" size="icon" variant="ghost" className="size-7" onClick={() => moveItem(idx, -1)} disabled={idx === 0}>
                            <ArrowUp className="size-3.5" />
                          </Button>
                          <Button type="button" size="icon" variant="ghost" className="size-7" onClick={() => moveItem(idx, 1)} disabled={idx === items.length - 1}>
                            <ArrowDown className="size-3.5" />
                          </Button>
                        </div>
                        <Button type="button" size="icon" variant="ghost" className="size-7" onClick={() => setItems(a => a.filter((_, i) => i !== idx))}>
                          <Trash2 className="size-3.5 text-destructive" />
                        </Button>
                      </div>
                    </div>
                    <div className="grid grid-cols-12 gap-2 items-end">
                      <div className="col-span-3">
                        <Label className="text-xs">Pris (ex moms)</Label>
                        <Input
                          type="number"
                          step="0.01"
                          min="0"
                          value={it.line_price}
                          onChange={e => updItem(idx, { line_price: e.target.value })}
                          placeholder="0"
                        />
                      </div>
                      <div className="col-span-2">
                        <Label className="text-xs">Provision %</Label>
                        <Input type="number" step="0.01" value={commissionPct} readOnly />
                      </div>
                      <div className="col-span-3 text-sm">
                        <div className="text-xs text-muted-foreground">Radens belopp</div>
                        <div className="font-semibold">{SEK(lineTotal)} SEK</div>
                      </div>
                      <div className="col-span-4 text-sm">
                        <div className="text-xs text-muted-foreground">Provision (rad)</div>
                        <div className="font-semibold text-primary">{SEK(commission)} SEK</div>
                      </div>
                    </div>

                          </Card>
                        );
                      })}
                    </div>
                  </div>
                ));
              })()}
            </div>
          </div>

          {/* Totalpris + SOV */}
          <Card className="p-4 border-primary/40">
            <div className="grid grid-cols-2 gap-4">
              <div>
                <Label className="text-sm font-semibold">Totalt pris (fördelas jämnt om inget pris satts per skärm)</Label>
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
              {useManual
                ? `Pris per skärm används. Totalt: ${SEK(subtotal)} SEK`
                : `Totalbeloppet fördelas jämnt över ${activeItems.length || 0} skärm${activeItems.length === 1 ? "" : "ar"}${activeItems.length > 0 ? ` (${SEK(perScreen)} SEK per skärm)` : ""}.`}
            </p>
          </Card>


          {/* Kampanjperiod – veckor eller exakta datum */}
          <Card className="p-4">
            <div className="text-sm font-semibold mb-3">Kampanjperiod</div>
            <Tabs defaultValue="count">
              <TabsList className="grid w-full grid-cols-3">
                <TabsTrigger value="count">Antal veckor</TabsTrigger>
                <TabsTrigger value="weeks">Välj veckor</TabsTrigger>
                <TabsTrigger value="dates">Exakta datum</TabsTrigger>
              </TabsList>

              <TabsContent value="count" className="space-y-3 pt-3">
                <div className="text-xs text-muted-foreground">
                  Ange bara hur många veckor kampanjen ska köras – inga specifika veckor eller datum behövs.
                </div>
                <div className="flex items-center gap-3 max-w-xs">
                  <Input
                    type="number"
                    min="1"
                    placeholder="t.ex. 4"
                    onChange={e => {
                      const v = e.target.value;
                      setItems(arr => arr.map(it => ({ ...it, weeks: v || "1" })));
                    }}
                  />
                  <span className="text-sm text-muted-foreground whitespace-nowrap">veckor</span>
                </div>
                <p className="text-xs text-muted-foreground">
                  Detta uppdaterar fältet "Veckor" på alla skärmar ovan.
                </p>
              </TabsContent>


              <TabsContent value="weeks" className="space-y-3 pt-3">
                <div className="text-xs text-muted-foreground">
                  Klicka för att välja de veckor kunden vill köra. {selectedWeeks.length} vecka{selectedWeeks.length === 1 ? "" : "or"} valda.
                </div>
                <div className="grid grid-cols-10 gap-1.5">
                  {Array.from({ length: 52 }, (_, i) => i + 1).map(w => {
                    const active = selectedWeeks.includes(w);
                    return (
                      <button
                        key={w}
                        type="button"
                        onClick={() => setSelectedWeeks(prev =>
                          prev.includes(w) ? prev.filter(x => x !== w) : [...prev, w].sort((a, b) => a - b)
                        )}
                        className={`text-xs rounded-md py-1.5 border transition ${
                          active
                            ? "bg-primary text-primary-foreground border-primary"
                            : "bg-background hover:bg-accent border-input"
                        }`}
                      >
                        v{w}
                      </button>
                    );
                  })}
                </div>
                {selectedWeeks.length > 0 && (
                  <Button type="button" size="sm" variant="ghost" onClick={() => setSelectedWeeks([])}>
                    Rensa veckor
                  </Button>
                )}
              </TabsContent>

              <TabsContent value="dates" className="space-y-3 pt-3">
                <div className="text-xs text-muted-foreground">
                  Välj specifika datum kunden vill köra på. {exactDates.length} datum valda.
                </div>
                <div className="flex flex-wrap gap-3 items-start">
                  <Popover>
                    <PopoverTrigger asChild>
                      <Button type="button" variant="outline" size="sm">
                        <CalendarIcon className="size-4 mr-1" /> Lägg till datum
                      </Button>
                    </PopoverTrigger>
                    <PopoverContent className="w-auto p-0" align="start">
                      <Calendar
                        mode="multiple"
                        selected={exactDates}
                        onSelect={(d) => setExactDates(d ?? [])}
                        locale={sv}
                        weekStartsOn={1}
                        className="p-3 pointer-events-auto"
                      />
                    </PopoverContent>
                  </Popover>
                  {exactDates.length > 0 && (
                    <Button type="button" size="sm" variant="ghost" onClick={() => setExactDates([])}>
                      Rensa datum
                    </Button>
                  )}
                </div>
                {exactDates.length > 0 && (
                  <div className="flex flex-wrap gap-1.5">
                    {[...exactDates].sort((a, b) => a.getTime() - b.getTime()).map((d, i) => (
                      <Badge key={i} variant="secondary" className="gap-1">
                        {format(d, "d MMM yyyy", { locale: sv })}
                        <button
                          type="button"
                          onClick={() => setExactDates(prev => prev.filter(x => x.getTime() !== d.getTime()))}
                          className="hover:text-destructive"
                        >
                          <X className="size-3" />
                        </button>
                      </Badge>
                    ))}
                  </div>
                )}
              </TabsContent>
            </Tabs>
          </Card>

          <div className="space-y-1">
            <Label htmlFor="order-notes">Order anteckningar</Label>
            <Textarea
              id="order-notes"
              value={form.notes}
              onChange={e => setForm({ ...form, notes: e.target.value })}
              placeholder="Skriv valfria anteckningar här – de visas på PDF:en under produktöversikten."
              rows={4}
            />
            <p className="text-[11px] text-muted-foreground">Det du skriver här hamnar på orderbekräftelsen/offerten under rubriken "Order Anteckningar".</p>
          </div>

          {/* Fakturering */}
          <Card className="p-4">
            <div className="text-sm font-semibold mb-3">Fakturering</div>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
              <div>
                <Label className="text-xs">Faktureringsdatum (start)</Label>
                <Popover>
                  <PopoverTrigger asChild>
                    <Button
                      type="button"
                      variant="outline"
                      className={cn("w-full justify-start text-left font-normal mt-1", !form.invoice_start_date && "text-muted-foreground")}
                    >
                      <CalendarIcon className="size-4 mr-2" />
                      {form.invoice_start_date ? format(form.invoice_start_date, "d MMM yyyy", { locale: sv }) : "Välj datum"}
                    </Button>
                  </PopoverTrigger>
                  <PopoverContent className="w-auto p-0" align="start">
                    <Calendar
                      mode="single"
                      selected={form.invoice_start_date}
                      onSelect={d => d && setForm(f => ({ ...f, invoice_start_date: d }))}
                      initialFocus
                      className={cn("p-3 pointer-events-auto")}
                    />
                  </PopoverContent>
                </Popover>
                <p className="text-[10px] text-muted-foreground mt-1">Standard: idag. Sätt fram i tiden om kunden ska faktureras senare.</p>
              </div>
              <div>
                <Label className="text-xs">Faktureringsfrekvens</Label>
                <Select
                  value={form.billing_frequency}
                  onValueChange={(v: BillingFrequency) => setForm(f => ({
                    ...f,
                    billing_frequency: v,
                    billing_duration_months: v === "engang" ? 1 : (f.billing_duration_months > 1 ? f.billing_duration_months : 12),
                  }))}
                >
                  <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="engang">Engångsfaktura</SelectItem>
                    <SelectItem value="manad">Månadsvis</SelectItem>
                    <SelectItem value="kvartal">Kvartalsvis</SelectItem>
                    <SelectItem value="halvar">Halvårsvis</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              {form.billing_frequency !== "engang" && (
                <div>
                  <Label className="text-xs">Total längd (månader)</Label>
                  <Input
                    type="number"
                    min="1"
                    className="mt-1"
                    value={form.billing_duration_months}
                    onChange={e => setForm(f => ({ ...f, billing_duration_months: Math.max(1, Number(e.target.value) || 1) }))}
                  />
                  <p className="text-[10px] text-muted-foreground mt-1">T.ex. 12 = ett år. Beloppet fördelas jämnt.</p>
                </div>
              )}
            </div>
            {/* Schedule preview */}
            {(() => {
              const sched = buildInvoiceSchedule(form.invoice_start_date, form.billing_frequency, form.billing_duration_months, subtotal);
              if (sched.length === 0) return null;
              return (
                <div className="mt-3 p-3 rounded-md bg-accent/30 text-xs">
                  <div className="font-medium mb-1">
                    {frequencyLabels[form.billing_frequency]} – {sched.length} faktura{sched.length === 1 ? "" : "or"} à {SEK(sched[0].amount)} SEK
                  </div>
                  <div className="text-muted-foreground">
                    Försäljning bokförs per månad: {format(sched[0].date, "MMM yyyy", { locale: sv })}
                    {sched.length > 1 && ` – ${format(sched[sched.length - 1].date, "MMM yyyy", { locale: sv })}`}.
                  </div>
                </div>
              );
            })()}
          </Card>

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
            <Button type="button" variant="outline" onClick={handlePreview} disabled={previewLoading}>
              {previewLoading ? <Loader2 className="size-4 mr-1 animate-spin" /> : <Eye className="size-4 mr-1" />}
              Förhandsgranska
            </Button>
            <Button type="button" variant="outline" onClick={handlePdf} disabled={generating}>
              {generating ? <Loader2 className="size-4 mr-1 animate-spin" /> : <FileDown className="size-4 mr-1" />}
              Ladda ner PDF
            </Button>
            <Button
              type="button"
              variant="secondary"
              onClick={handleMarkReady}
              disabled={saving || invoiceMissing || form.invoice_status === "fakturerad"}
              title={invoiceMissing ? "Fyll i alla fakturauppgifter först" : ""}
            >
              <CheckCircle2 className="size-4 mr-1" />
              {form.invoice_status === "klar" ? "Klar (uppdatera)" : "Klar att fakturera"}
            </Button>
            <Button type="submit" disabled={saving}>
              {saving && <Loader2 className="size-4 mr-1 animate-spin" />}
              Spara {form.order_type === "offert" ? "offert" : "bokning"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>

      {/* PDF-förhandsvisning */}
      <Dialog
        open={!!previewUrl}
        onOpenChange={(o) => {
          if (!o) {
            if (previewUrl) URL.revokeObjectURL(previewUrl);
            setPreviewUrl(null);
          }
        }}
      >
        <DialogContent className="max-w-5xl w-[95vw] h-[90vh] flex flex-col p-0 gap-0">
          <DialogHeader className="px-6 py-4 border-b">
            <DialogTitle>Förhandsvisning av PDF</DialogTitle>
          </DialogHeader>
          <div className="flex-1 min-h-0 bg-muted">
            {previewUrl && (
              <iframe
                src={previewUrl}
                title="PDF-förhandsvisning"
                className="w-full h-full border-0"
              />
            )}
          </div>
          <DialogFooter className="px-6 py-3 border-t gap-2">
            <Button
              type="button"
              variant="outline"
              onClick={() => {
                if (previewUrl) URL.revokeObjectURL(previewUrl);
                setPreviewUrl(null);
              }}
            >
              Stäng
            </Button>
            <Button type="button" onClick={handlePdf} disabled={generating}>
              {generating ? <Loader2 className="size-4 mr-1 animate-spin" /> : <FileDown className="size-4 mr-1" />}
              Ladda ner PDF
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Dialog>
  );
}
