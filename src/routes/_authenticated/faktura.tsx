import { createFileRoute, redirect } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { PageHeader } from "@/components/page-header";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { AlertCircle, CheckCircle2, Receipt, Users, Undo2 } from "lucide-react";
import { OrderDialog } from "@/components/order-dialog";
import { format } from "date-fns";
import { toast } from "sonner";

export const Route = createFileRoute("/_authenticated/faktura")({
  beforeLoad: async () => {
    const { data: u } = await supabase.auth.getUser();
    if (!u.user) throw redirect({ to: "/auth" });
    const { data: roles } = await supabase.from("user_roles").select("role").eq("user_id", u.user.id);
    if (!(roles ?? []).some((r: any) => r.role === "admin")) {
      throw redirect({ to: "/dashboard" });
    }
  },
  component: FakturaPage,
});

const SEK = (n: number) =>
  new Intl.NumberFormat("sv-SE", { style: "decimal", minimumFractionDigits: 0, maximumFractionDigits: 0 }).format(n || 0);

type Bucket = "saknar" | "klar" | "fakturerad";

function isInvoiceComplete(o: any) {
  const required = [o.company_name, o.org_number, o.billing_address, o.postal_code, o.city];
  if (required.some((v: any) => !v?.toString().trim())) return false;
  if (!o.invoice_email?.toString().trim() && !o.invoice_peppol_id?.toString().trim()) return false;
  return true;
}

function bucketOf(o: any): Bucket {
  if (o.invoice_status === "fakturerad") return "fakturerad";
  if (o.invoice_status === "klar") return "klar";
  return isInvoiceComplete(o) ? "klar" : "saknar";
}

function FakturaPage() {
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<any | null>(null);
  const [sellerFilter, setSellerFilter] = useState<string>("all");
  const [tab, setTab] = useState<Bucket>("saknar");

  const { data: orders = [] } = useQuery({
    queryKey: ["faktura-orders"],
    queryFn: async () => {
      const { data } = await supabase
        .from("orders")
        .select("*")
        .eq("order_type", "bokning")
        .order("created_at", { ascending: false });
      return data ?? [];
    },
  });

  const { data: sellers = [] } = useQuery({
    queryKey: ["all-profiles-min"],
    queryFn: async () => {
      const { data } = await supabase.from("profiles").select("id, full_name, email").order("full_name");
      return data ?? [];
    },
  });

  const sellerName = (id: string | null) => {
    if (!id) return "—";
    const s = sellers.find((x: any) => x.id === id);
    return s?.full_name || s?.email || "—";
  };

  const filtered = useMemo(() => {
    const base = sellerFilter === "all" ? orders : orders.filter((o: any) => o.owner_id === sellerFilter);
    return {
      saknar: base.filter((o: any) => bucketOf(o) === "saknar"),
      klar: base.filter((o: any) => bucketOf(o) === "klar"),
      fakturerad: base.filter((o: any) => bucketOf(o) === "fakturerad"),
    };
  }, [orders, sellerFilter]);

  const markFakturerad = async (id: string) => {
    const { error } = await supabase
      .from("orders")
      .update({ invoice_status: "fakturerad", invoiced_at: new Date().toISOString() })
      .eq("id", id);
    if (error) return toast.error(error.message);
    toast.success("Markerad som fakturerad");
    qc.invalidateQueries({ queryKey: ["faktura-orders"] });
    qc.invalidateQueries({ queryKey: ["orders"] });
  };

  const undoFakturerad = async (id: string) => {
    const { error } = await supabase
      .from("orders")
      .update({ invoice_status: "klar", invoiced_at: null })
      .eq("id", id);
    if (error) return toast.error(error.message);
    toast.success("Återställd till klar att fakturera");
    qc.invalidateQueries({ queryKey: ["faktura-orders"] });
    qc.invalidateQueries({ queryKey: ["orders"] });
  };

  const forceKlar = async (id: string) => {
    const { error } = await supabase
      .from("orders")
      .update({ invoice_status: "klar", invoiced_at: null })
      .eq("id", id);
    if (error) return toast.error(error.message);
    toast.success("Flyttad till klar att fakturera");
    qc.invalidateQueries({ queryKey: ["faktura-orders"] });
    qc.invalidateQueries({ queryKey: ["orders"] });
  };

  const resetSaknar = async (id: string) => {
    const { error } = await supabase
      .from("orders")
      .update({ invoice_status: null, invoiced_at: null })
      .eq("id", id);
    if (error) return toast.error(error.message);
    toast.success("Återställd");
    qc.invalidateQueries({ queryKey: ["faktura-orders"] });
    qc.invalidateQueries({ queryKey: ["orders"] });
  };

  const renderList = (list: any[], bucket: Bucket) => {
    if (list.length === 0) {
      return <Card className="p-8 text-center text-sm text-muted-foreground">Inga ordrar i denna kategori</Card>;
    }
    return list.map((o: any) => {
      const missingFields: string[] = [];
      if (!o.company_name?.trim()) missingFields.push("Företag");
      if (!o.org_number?.trim()) missingFields.push("Org.nr");
      if (!o.billing_address?.trim()) missingFields.push("Adress");
      if (!o.postal_code?.trim()) missingFields.push("Postnr");
      if (!o.city?.trim()) missingFields.push("Ort");
      if (!o.invoice_email?.trim() && !o.invoice_peppol_id?.trim()) missingFields.push("Peppol-ID / faktura-mejl");

      return (
        <Card
          key={o.id}
          className="p-4 hover:border-primary/50 cursor-pointer transition-colors"
          onClick={() => { setEditing(o); setOpen(true); }}
        >
          <div className="flex items-center gap-4">
            <div className="size-10 rounded-md bg-accent flex items-center justify-center shrink-0">
              {bucket === "fakturerad" ? <Receipt className="size-5" /> :
                bucket === "klar" ? <CheckCircle2 className="size-5 text-primary" /> :
                <AlertCircle className="size-5 text-destructive" />}
            </div>
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <span className="font-medium truncate">{o.company_name || "(saknar företagsnamn)"}</span>
                <Badge variant="secondary">{sellerName(o.owner_id)}</Badge>
                {o.invoice_reference && <Badge variant="outline">Ref: {o.invoice_reference}</Badge>}
              </div>
              <div className="text-xs text-muted-foreground mt-1">
                {format(new Date(o.created_at), "yyyy-MM-dd")} · {o.invoice_email || o.invoice_peppol_id || "ingen fakturakontakt"}
              </div>
              {bucket === "saknar" && missingFields.length > 0 && (
                <div className="text-xs text-destructive mt-1">Saknas: {missingFields.join(", ")}</div>
              )}
              {bucket === "fakturerad" && o.invoiced_at && (
                <div className="text-xs text-muted-foreground mt-1">Fakturerad: {format(new Date(o.invoiced_at), "yyyy-MM-dd")}</div>
              )}
            </div>
            <div className="text-right">
              <div className="text-sm font-semibold">{SEK(Number(o.total_excl_vat))} SEK</div>
            </div>
            <div onClick={(e) => e.stopPropagation()} className="shrink-0 flex gap-2">
              {bucket === "saknar" && (
                <>
                  <Button size="sm" variant="outline" onClick={() => forceKlar(o.id)}>
                    <CheckCircle2 className="size-4 mr-1" /> Flytta till klar
                  </Button>
                  <Button size="sm" onClick={() => markFakturerad(o.id)}>
                    <Receipt className="size-4 mr-1" /> Markera fakturerad
                  </Button>
                </>
              )}
              {bucket === "klar" && (
                <Button size="sm" onClick={() => markFakturerad(o.id)}>
                  <Receipt className="size-4 mr-1" /> Markera fakturerad
                </Button>
              )}
              {bucket === "fakturerad" && (
                <Button size="sm" variant="outline" onClick={() => undoFakturerad(o.id)}>
                  <Undo2 className="size-4 mr-1" /> Ångra
                </Button>
              )}
            </div>
          </div>
        </Card>
      );
    });
  };

  return (
    <>
      <PageHeader
        title="Faktura"
        description="Hantera fakturaunderlag för bokningar"
      />
      <div className="p-6 space-y-4">
        <Card className="p-3 flex items-center gap-2 flex-wrap">
          <Users className="size-4 text-muted-foreground" />
          <span className="text-xs text-muted-foreground">Säljare:</span>
          <Select value={sellerFilter} onValueChange={setSellerFilter}>
            <SelectTrigger className="w-64 h-8"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Alla säljare</SelectItem>
              {sellers.map((s: any) => (
                <SelectItem key={s.id} value={s.id}>{s.full_name || s.email}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <span className="text-xs text-muted-foreground ml-auto">
            Saknar info: {filtered.saknar.length} · Klar: {filtered.klar.length} · Fakturerad: {filtered.fakturerad.length}
          </span>
        </Card>

        <Tabs value={tab} onValueChange={(v) => setTab(v as Bucket)}>
          <TabsList className="grid w-full grid-cols-3">
            <TabsTrigger value="saknar" className="gap-2">
              <AlertCircle className="size-4" /> Faktura info saknas
              <Badge variant="secondary" className="ml-1">{filtered.saknar.length}</Badge>
            </TabsTrigger>
            <TabsTrigger value="klar" className="gap-2">
              <CheckCircle2 className="size-4" /> Klar att fakturera
              <Badge variant="secondary" className="ml-1">{filtered.klar.length}</Badge>
            </TabsTrigger>
            <TabsTrigger value="fakturerad" className="gap-2">
              <Receipt className="size-4" /> Fakturerad
              <Badge variant="secondary" className="ml-1">{filtered.fakturerad.length}</Badge>
            </TabsTrigger>
          </TabsList>

          <TabsContent value="saknar" className="space-y-3 pt-4">{renderList(filtered.saknar, "saknar")}</TabsContent>
          <TabsContent value="klar" className="space-y-3 pt-4">{renderList(filtered.klar, "klar")}</TabsContent>
          <TabsContent value="fakturerad" className="space-y-3 pt-4">{renderList(filtered.fakturerad, "fakturerad")}</TabsContent>
        </Tabs>
      </div>
      <OrderDialog open={open} onOpenChange={setOpen} order={editing} />
    </>
  );
}
