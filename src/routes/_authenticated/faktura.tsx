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
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { AlertCircle, CheckCircle2, Receipt, Users, Undo2, BarChart3 } from "lucide-react";
import { OrderDialog } from "@/components/order-dialog";
import { format, addMonths, startOfMonth, endOfMonth } from "date-fns";
import { sv } from "date-fns/locale";
import { toast } from "sonner";
import { ORDER_SELECT } from "@/lib/order-columns";
import { buildInvoiceSchedule, frequencyLabels, type BillingFrequency } from "@/lib/billing";

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
  const [reportOpen, setReportOpen] = useState(false);

  const { data: orders = [] } = useQuery({
    queryKey: ["faktura-orders"],
    queryFn: async () => {
      const { data } = await supabase
        .from("orders")
        .select(ORDER_SELECT)
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

  const totalOf = (list: any[]) => list.reduce((s: number, o: any) => s + Number(o.total_excl_vat || 0), 0);

  const renderTotal = (list: any[]) => (
    <div className="flex justify-end pt-2">
      <div className="text-right">
        <div className="text-xs text-muted-foreground">Totalt ({list.length} ordrar)</div>
        <div className="text-lg font-semibold">{SEK(totalOf(list))} SEK</div>
      </div>
    </div>
  );

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
              {o.invoice_info && (
                <div className="text-xs text-foreground mt-1 whitespace-pre-wrap">Faktura info: {o.invoice_info}</div>
              )}
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
          <Button size="sm" variant="outline" onClick={() => setReportOpen(true)}>
            <BarChart3 className="size-4 mr-1" /> Rapport ekonomi månadsvis
          </Button>
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

          <TabsContent value="saknar" className="space-y-3 pt-4">{renderList(filtered.saknar, "saknar")}{renderTotal(filtered.saknar)}</TabsContent>
          <TabsContent value="klar" className="space-y-3 pt-4">{renderList(filtered.klar, "klar")}{renderTotal(filtered.klar)}</TabsContent>
          <TabsContent value="fakturerad" className="space-y-3 pt-4">{renderList(filtered.fakturerad, "fakturerad")}{renderTotal(filtered.fakturerad)}</TabsContent>
        </Tabs>
      </div>
      <OrderDialog open={open} onOpenChange={setOpen} order={editing} />
      <MonthlyEconomyReportDialog
        open={reportOpen}
        onOpenChange={setReportOpen}
        orders={orders}
        sellerName={sellerName}
      />
    </>
  );
}

/**
 * Rapport ekonomi månadsvis — visar för admin vad som faktiskt ska faktureras
 * en viss månad. Ordrar med "provision direkt" (commission_upfront) faktureras
 * i sin helhet direkt även om de visas som månadsvisa mot skärmägaren.
 */
function MonthlyEconomyReportDialog({
  open,
  onOpenChange,
  orders,
  sellerName,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  orders: any[];
  sellerName: (id: string | null) => string;
}) {
  const [monthOffset, setMonthOffset] = useState(0);
  const month = addMonths(new Date(), monthOffset);
  const from = startOfMonth(month);
  const to = endOfMonth(month);

  const { rows, total, oneOff, recurring } = useMemo(() => {
    type Row = {
      id: string;
      company: string;
      seller: string;
      billingLabel: string;
      installment: string;
      amount: number;
      upfront: boolean;
    };
    const list: Row[] = [];
    for (const o of orders) {
      const freq = (o.billing_frequency ?? "engang") as BillingFrequency;
      const totalAmount = Number(o.total_excl_vat ?? 0);
      if (!totalAmount) continue;
      const start = o.invoice_start_date || o.created_at;
      const upfront = !!o.commission_upfront && freq !== "engang";
      // Vid "fakturerar direkt" är den verkliga faktureringen hela beloppet på en gång
      const schedule = upfront
        ? buildInvoiceSchedule(start, "engang", 1, totalAmount)
        : buildInvoiceSchedule(start, freq, Number(o.billing_duration_months ?? 0), totalAmount);
      const hits = schedule.filter(e => e.date >= from && e.date <= to);
      for (const h of hits) {
        list.push({
          id: o.id,
          company: o.company_name || "Okänd kund",
          seller: sellerName(o.owner_id),
          billingLabel: upfront
            ? `Faktureras direkt (${frequencyLabels[freq].toLowerCase()} mot skärmägare)`
            : frequencyLabels[freq],
          installment: schedule.length > 1 ? `${schedule.indexOf(h) + 1}/${schedule.length}` : "—",
          amount: h.amount,
          upfront,
        });
      }
    }
    list.sort((a, b) => b.amount - a.amount);
    const total = list.reduce((s, r) => s + r.amount, 0);
    const oneOff = list.filter(r => r.installment === "—").reduce((s, r) => s + r.amount, 0);
    return { rows: list, total, oneOff, recurring: total - oneOff };
  }, [orders, from.getTime(), to.getTime(), sellerName]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-4xl">
        <DialogHeader><DialogTitle>Rapport ekonomi månadsvis</DialogTitle></DialogHeader>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={() => setMonthOffset(o => o - 1)}>← Föregående</Button>
          <div className="text-sm font-medium px-3 capitalize">{format(month, "LLLL yyyy", { locale: sv })}</div>
          <Button variant="outline" size="sm" onClick={() => setMonthOffset(o => o + 1)}>Nästa →</Button>
          {monthOffset !== 0 && (
            <Button variant="ghost" size="sm" onClick={() => setMonthOffset(0)}>Nu</Button>
          )}
        </div>
        <div className="grid grid-cols-3 gap-3">
          <Card className="p-3">
            <div className="text-xs text-muted-foreground uppercase tracking-wider">Att fakturera</div>
            <div className="mt-1 text-xl font-semibold">{SEK(total)} SEK</div>
          </Card>
          <Card className="p-3">
            <div className="text-xs text-muted-foreground uppercase tracking-wider">Engång / direkt</div>
            <div className="mt-1 text-xl font-semibold">{SEK(oneOff)} SEK</div>
          </Card>
          <Card className="p-3">
            <div className="text-xs text-muted-foreground uppercase tracking-wider">Abonnemang</div>
            <div className="mt-1 text-xl font-semibold">{SEK(recurring)} SEK</div>
          </Card>
        </div>
        <div className="max-h-[50vh] overflow-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Kund</TableHead>
                <TableHead>Säljare</TableHead>
                <TableHead>Fakturering</TableHead>
                <TableHead className="text-right">Delfaktura</TableHead>
                <TableHead className="text-right">Belopp</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.length === 0 && (
                <TableRow><TableCell colSpan={5} className="text-sm text-muted-foreground text-center py-6">Inget att fakturera denna månad</TableCell></TableRow>
              )}
              {rows.map((r, i) => (
                <TableRow key={`${r.id}-${i}`}>
                  <TableCell className="font-medium">{r.company}</TableCell>
                  <TableCell className="text-sm">{r.seller}</TableCell>
                  <TableCell className={`text-xs ${r.upfront ? "text-primary" : "text-muted-foreground"}`}>{r.billingLabel}</TableCell>
                  <TableCell className="text-right text-sm">{r.installment}</TableCell>
                  <TableCell className="text-right font-medium">{SEK(r.amount)} SEK</TableCell>
                </TableRow>
              ))}
              {rows.length > 0 && (
                <TableRow className="bg-muted/40 font-semibold">
                  <TableCell colSpan={4}>Totalt</TableCell>
                  <TableCell className="text-right">{SEK(total)} SEK</TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Stäng</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
