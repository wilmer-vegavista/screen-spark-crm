import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { CustomerDetailDialog } from "@/components/customer-detail-dialog";
import { toast } from "sonner";
import { format, isPast, isToday } from "date-fns";
import { sv } from "date-fns/locale";
import { cn } from "@/lib/utils";
import {
  ArrowLeft, Building2, Mail, Phone, MapPin, Pencil, Plus, Loader2,
  FileText, Receipt, MonitorPlay, CalendarClock, Briefcase, Hash,
} from "lucide-react";

export const Route = createFileRoute("/_authenticated/kunder_/$customerId")({
  component: KundSida,
});

function fmt(n: number) {
  return new Intl.NumberFormat("sv-SE", { style: "currency", currency: "SEK", maximumFractionDigits: 0 }).format(n || 0);
}

function KundSida() {
  const { customerId } = Route.useParams();
  const [editOpen, setEditOpen] = useState(false);
  const [activityOpen, setActivityOpen] = useState(false);

  const { data: customer, isLoading } = useQuery({
    queryKey: ["customer", customerId],
    queryFn: async () => {
      const { data } = await supabase.from("customers").select("*").eq("id", customerId).maybeSingle();
      return data;
    },
  });

  const { data: orders } = useQuery({
    queryKey: ["customer-orders", customerId],
    queryFn: async () => {
      const { data } = await supabase
        .from("orders")
        .select("id, company_name, order_type, status, total_excl_vat, created_at, contact_name, contact_email, contact_phone, invoice_status, invoice_reference, invoice_email, invoice_peppol_id, invoiced_at, order_items(product_name, weeks, unit_price, period_unit)")
        .eq("customer_id", customerId)
        .order("created_at", { ascending: false });
      return data ?? [];
    },
  });

  const { data: activities } = useQuery({
    queryKey: ["customer-activities", customerId],
    queryFn: async () => {
      const { data } = await supabase
        .from("activities")
        .select("*")
        .eq("customer_id", customerId)
        .order("completed")
        .order("due_at", { ascending: true, nullsFirst: false });
      return data ?? [];
    },
  });

  const stats = useMemo(() => {
    const all = orders ?? [];
    const confirmed = all.filter((o: any) => o.order_type === "order");
    const quotes = all.filter((o: any) => o.order_type !== "order");
    return {
      orderCount: confirmed.length,
      quoteCount: quotes.length,
      orderTotal: confirmed.reduce((s: number, o: any) => s + Number(o.total_excl_vat || 0), 0),
      quoteTotal: quotes.reduce((s: number, o: any) => s + Number(o.total_excl_vat || 0), 0),
      openActivities: (activities ?? []).filter((a: any) => !a.completed).length,
    };
  }, [orders, activities]);

  const contacts = useMemo(() => {
    const map = new Map<string, { name?: string | null; email?: string | null; phone?: string | null }>();
    if (customer?.contact_name || customer?.email || customer?.phone) {
      map.set((customer.email || customer.phone || customer.contact_name || "").toLowerCase(), {
        name: customer.contact_name, email: customer.email, phone: customer.phone,
      });
    }
    (orders ?? []).forEach((o: any) => {
      const key = (o.contact_email || o.contact_phone || o.contact_name || "").toLowerCase();
      if (key && !map.has(key)) map.set(key, { name: o.contact_name, email: o.contact_email, phone: o.contact_phone });
    });
    return [...map.values()];
  }, [customer, orders]);

  const screens = useMemo(() => {
    const map = new Map<string, { product: string; qty: number; total: number; orders: number }>();
    (orders ?? []).forEach((o: any) => {
      (o.order_items ?? []).forEach((it: any) => {
        const cur = map.get(it.product_name) ?? { product: it.product_name, qty: 0, total: 0, orders: 0 };
        cur.qty += Number(it.weeks || 0);
        cur.total += Number(it.unit_price || 0) * Number(it.weeks || 0);
        cur.orders += 1;
        map.set(it.product_name, cur);
      });
    });
    return [...map.values()].sort((a, b) => b.total - a.total);
  }, [orders]);

  if (isLoading) return <div className="flex justify-center py-16"><Loader2 className="animate-spin size-6" /></div>;
  if (!customer) {
    return (
      <div className="p-6 space-y-3">
        <p className="text-sm text-muted-foreground">Kunden hittades inte.</p>
        <Button asChild variant="outline" size="sm"><Link to="/kunder" search={{ customer: undefined }}><ArrowLeft className="size-4 mr-1" /> Till kundlistan</Link></Button>
      </div>
    );
  }

  return (
    <>
      <div className="flex items-start justify-between gap-4 px-6 py-6 border-b border-border/70">
        <div className="flex items-start gap-3 min-w-0">
          <Button asChild variant="ghost" size="icon" className="shrink-0 mt-0.5">
            <Link to="/kunder" search={{ customer: undefined }}><ArrowLeft className="size-4" /></Link>
          </Button>
          <div className="size-11 rounded-md bg-accent flex items-center justify-center shrink-0">
            <Building2 className="size-5" />
          </div>
          <div className="min-w-0">
            <h1 className="text-2xl font-semibold tracking-tight truncate" style={{ fontFamily: "var(--font-display)" }}>
              {customer.company_name}
            </h1>
            <p className="text-sm text-muted-foreground mt-0.5 flex items-center gap-2 flex-wrap">
              {customer.city && <span className="flex items-center gap-1"><MapPin className="size-3.5" />{customer.city}</span>}
              {customer.industry && <span className="flex items-center gap-1"><Briefcase className="size-3.5" />{customer.industry}</span>}
              {customer.org_number && <span className="flex items-center gap-1"><Hash className="size-3.5" />{customer.org_number}</span>}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <Button size="sm" variant="outline" onClick={() => setActivityOpen(true)}><Plus className="size-4 mr-1" /> Aktivitet</Button>
          <Button size="sm" onClick={() => setEditOpen(true)}><Pencil className="size-4 mr-1" /> Redigera</Button>
        </div>
      </div>

      <div className="p-6 space-y-6">
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          <StatCard icon={<Receipt className="size-4" />} label="Totalt köpt (ordrar)" value={fmt(stats.orderTotal)} sub={`${stats.orderCount} ordrar`} />
          <StatCard icon={<FileText className="size-4" />} label="Offererat" value={fmt(stats.quoteTotal)} sub={`${stats.quoteCount} offerter`} />
          <StatCard icon={<MonitorPlay className="size-4" />} label="Skärmar köpta" value={String(screens.length)} sub={screens[0] ? `Mest: ${screens[0].product}` : "—"} />
          <StatCard icon={<CalendarClock className="size-4" />} label="Öppna aktiviteter" value={String(stats.openActivities)} sub={`${(activities ?? []).length} totalt`} />
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          <div className="space-y-4">
            <Card className="p-4 space-y-3">
              <h3 className="text-sm font-semibold">Kontaktpersoner</h3>
              {contacts.length === 0 && <p className="text-sm text-muted-foreground">Inga kontaktuppgifter ännu</p>}
              {contacts.map((c, i) => (
                <div key={i} className="text-sm border rounded-md p-2">
                  <div className="font-medium">{c.name || "—"}</div>
                  {c.email && <a href={`mailto:${c.email}`} className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground mt-1"><Mail className="size-3" />{c.email}</a>}
                  {c.phone && <a href={`tel:${c.phone}`} className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground mt-1"><Phone className="size-3" />{c.phone}</a>}
                </div>
              ))}
            </Card>

            <Card className="p-4 space-y-2">
              <h3 className="text-sm font-semibold">Fakturauppgifter</h3>
              <InfoRow label="Referens" value={customer.invoice_reference} />
              <InfoRow label="Faktura e-post" value={customer.invoice_email} />
              <InfoRow label="Peppol ID" value={customer.invoice_peppol_id} />
              <InfoRow label="Momsreg.nr" value={customer.vat_number} />
              <InfoRow label="Fakturaadress" value={[customer.billing_address, [customer.postal_code, customer.city].filter(Boolean).join(" ")].filter(Boolean).join(", ")} />
            </Card>

            {customer.notes && (
              <Card className="p-4">
                <h3 className="text-sm font-semibold mb-1">Anteckningar</h3>
                <p className="text-sm text-muted-foreground whitespace-pre-wrap">{customer.notes}</p>
              </Card>
            )}
          </div>

          <div className="lg:col-span-2">
            <Tabs defaultValue="ordrar">
              <TabsList>
                <TabsTrigger value="ordrar">Ordrar ({stats.orderCount})</TabsTrigger>
                <TabsTrigger value="offerter">Offerter ({stats.quoteCount})</TabsTrigger>
                <TabsTrigger value="aktiviteter">Aktiviteter ({(activities ?? []).length})</TabsTrigger>
                <TabsTrigger value="skarmar">Skärmar</TabsTrigger>
              </TabsList>

              <TabsContent value="ordrar" className="mt-3">
                <OrderList orders={(orders ?? []).filter((o: any) => o.order_type === "order")} empty="Inga ordrar ännu" />
              </TabsContent>
              <TabsContent value="offerter" className="mt-3">
                <OrderList orders={(orders ?? []).filter((o: any) => o.order_type !== "order")} empty="Inga offerter ännu" />
              </TabsContent>
              <TabsContent value="aktiviteter" className="mt-3">
                <ActivityList activities={activities ?? []} customerId={customerId} onAdd={() => setActivityOpen(true)} />
              </TabsContent>
              <TabsContent value="skarmar" className="mt-3">
                <ScreenTable screens={screens} />
              </TabsContent>
            </Tabs>
          </div>
        </div>
      </div>

      <CustomerDetailDialog open={editOpen} onOpenChange={setEditOpen} customer={customer} />
      <NewActivityDialog open={activityOpen} onOpenChange={setActivityOpen} customerId={customerId} />
    </>
  );
}

function StatCard({ icon, label, value, sub }: { icon: React.ReactNode; label: string; value: string; sub?: string }) {
  return (
    <Card className="p-4">
      <div className="flex items-center gap-1.5 text-xs text-muted-foreground">{icon}{label}</div>
      <div className="text-xl font-semibold mt-1 truncate">{value}</div>
      {sub && <div className="text-xs text-muted-foreground mt-0.5 truncate">{sub}</div>}
    </Card>
  );
}

function InfoRow({ label, value }: { label: string; value?: string | null }) {
  return (
    <div className="flex items-start justify-between gap-3 text-sm">
      <span className="text-muted-foreground shrink-0">{label}</span>
      <span className="text-right break-words min-w-0">{value || "—"}</span>
    </div>
  );
}

function OrderList({ orders, empty }: { orders: any[]; empty: string }) {
  if (!orders.length) return <p className="text-sm text-muted-foreground text-center py-6">{empty}</p>;
  return (
    <div className="space-y-2">
      {orders.map((o) => (
        <Card key={o.id} className="p-3">
          <div className="flex items-center justify-between gap-2 flex-wrap">
            <div>
              <div className="font-medium text-sm">{o.order_type === "order" ? "Order" : "Offert"} • {new Date(o.created_at).toLocaleDateString("sv-SE")}</div>
              <div className="text-xs text-muted-foreground">
                {(o.order_items?.length ?? 0)} rader
                {o.invoice_reference ? ` • Ref: ${o.invoice_reference}` : ""}
              </div>
            </div>
            <div className="flex items-center gap-2">
              <Badge variant="outline">{o.status}</Badge>
              {o.invoice_status && <Badge variant={o.invoice_status === "fakturerad" ? "default" : "secondary"}>{o.invoice_status}</Badge>}
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
  );
}

function ActivityList({ activities, customerId, onAdd }: { activities: any[]; customerId: string; onAdd: () => void }) {
  const qc = useQueryClient();
  const toggle = async (id: string, completed: boolean) => {
    const { error } = await supabase.from("activities").update({
      completed: !completed,
      completed_at: !completed ? new Date().toISOString() : null,
    }).eq("id", id);
    if (error) toast.error(error.message);
    else qc.invalidateQueries({ queryKey: ["customer-activities", customerId] });
  };

  if (!activities.length) {
    return (
      <div className="text-center py-6 space-y-2">
        <p className="text-sm text-muted-foreground">Inga aktiviteter ännu</p>
        <Button size="sm" variant="outline" onClick={onAdd}><Plus className="size-4 mr-1" /> Ny aktivitet</Button>
      </div>
    );
  }

  return (
    <Card className="divide-y">
      {activities.map((a) => {
        const overdue = a.due_at && !a.completed && isPast(new Date(a.due_at)) && !isToday(new Date(a.due_at));
        return (
          <div key={a.id} className="flex items-center gap-3 p-3">
            <Checkbox checked={a.completed} onCheckedChange={() => toggle(a.id, a.completed)} />
            <div className="flex-1 min-w-0">
              <div className={cn("text-sm font-medium", a.completed && "line-through text-muted-foreground")}>{a.title}</div>
              <div className="text-xs text-muted-foreground flex items-center gap-2">
                <span className="capitalize">{a.type}</span>
                {a.description && <><span>·</span><span className="truncate">{a.description}</span></>}
              </div>
            </div>
            {a.due_at && (
              <div className={cn("text-xs", overdue ? "text-destructive font-medium" : "text-muted-foreground")}>
                {format(new Date(a.due_at), "d MMM HH:mm", { locale: sv })}
              </div>
            )}
          </div>
        );
      })}
    </Card>
  );
}

function ScreenTable({ screens }: { screens: { product: string; qty: number; total: number; orders: number }[] }) {
  if (!screens.length) return <p className="text-sm text-muted-foreground text-center py-6">Inga skärmar köpta ännu</p>;
  const grand = screens.reduce((s, r) => s + r.total, 0);
  return (
    <div>
      <div className="text-sm text-muted-foreground mb-2">Totalt köp: <span className="font-semibold text-foreground">{fmt(grand)}</span></div>
      <div className="border rounded-md overflow-x-auto">
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
            {screens.map((r) => (
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

function NewActivityDialog({ open, onOpenChange, customerId }: { open: boolean; onOpenChange: (v: boolean) => void; customerId: string }) {
  const qc = useQueryClient();
  const [title, setTitle] = useState("");
  const [type, setType] = useState("uppgift");
  const [description, setDescription] = useState("");
  const [dueAt, setDueAt] = useState("");
  const [loading, setLoading] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    const { data: u } = await supabase.auth.getUser();
    const { error } = await supabase.from("activities").insert({
      title, type: type as any, description: description || null,
      due_at: dueAt || null, customer_id: customerId,
      assigned_to: u.user?.id, created_by: u.user?.id,
    });
    setLoading(false);
    if (error) return toast.error(error.message);
    toast.success("Aktivitet skapad");
    setTitle(""); setDescription(""); setDueAt("");
    qc.invalidateQueries({ queryKey: ["customer-activities", customerId] });
    qc.invalidateQueries({ queryKey: ["activities"] });
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader><DialogTitle>Ny aktivitet</DialogTitle></DialogHeader>
        <form onSubmit={submit} className="space-y-3">
          <div><Label>Titel</Label><Input value={title} onChange={e => setTitle(e.target.value)} required /></div>
          <div>
            <Label>Typ</Label>
            <Select value={type} onValueChange={setType}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="samtal">Samtal</SelectItem>
                <SelectItem value="mote">Möte</SelectItem>
                <SelectItem value="mejl">Mejl</SelectItem>
                <SelectItem value="uppgift">Uppgift</SelectItem>
                <SelectItem value="paminnelse">Påminnelse</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div><Label>Beskrivning</Label><Textarea value={description} onChange={e => setDescription(e.target.value)} /></div>
          <div><Label>Deadline</Label><Input type="datetime-local" value={dueAt} onChange={e => setDueAt(e.target.value)} /></div>
          <DialogFooter><Button type="submit" disabled={loading}>Spara</Button></DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
