import { createFileRoute, Link } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { format } from "date-fns";
import { sv } from "date-fns/locale";
import { supabase } from "@/integrations/supabase/client";
import { buildInvoiceSchedule, type BillingFrequency } from "@/lib/billing";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card } from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { toast } from "sonner";
import { ChevronDown, ChevronRight, Loader2, LogOut, Monitor } from "lucide-react";

export const Route = createFileRoute("/skarmportal")({
  ssr: false,
  component: SkarmportalPage,
});

const SEK = (n: number) =>
  new Intl.NumberFormat("sv-SE", {
    style: "currency",
    currency: "SEK",
    maximumFractionDigits: 0,
  }).format(n || 0);

type PortalProduct = {
  id: string;
  name: string;
  city: string | null;
  address: string | null;
  image_url: string | null;
  revenue_share_pct: number | null;
  live_date: string | null;
  active: boolean;
};

type PortalItem = {
  order_id: string;
  product_id: string | null;
  product_name: string;
  unit_price: number | null;
  weeks: number | null;
  sov_pct: number | null;
  impressions: number | null;
  period_unit: string | null;
};

type PortalOrder = {
  id: string;
  company_name: string | null;
  invoice_start_date: string | null;
  created_at: string;
  status: string;
  billing_frequency: string | null;
  billing_duration_months: number | null;
  selected_weeks: number[] | null;
  exact_dates: string[] | null;
};

type PortalReport = {
  owner_name: string;
  products: PortalProduct[];
  items: PortalItem[];
  orders: PortalOrder[];
};

type DetailRow = { company: string; date: Date; period: string; amount: number };

type ScreenRow = {
  product: PortalProduct;
  yearRevenue: number;
  yearShare: number;
  totalOrderValue: number;
  detail: DetailRow[];
};

const periodUnitLabel: Record<string, [string, string]> = {
  veckor: ["vecka", "veckor"],
  manader: ["månad", "månader"],
  ar: ["år", "år"],
};

function periodTextOf(it: PortalItem) {
  const n = Number(it.weeks || 1);
  const pair = periodUnitLabel[it.period_unit as string] ?? periodUnitLabel.veckor;
  return `${n} ${n === 1 ? pair[0] : pair[1]}`;
}

/** Samma intäktslogik som CRM:ets ekonomirapport: pris × perioder, utslaget per faktureringstillfälle */
function computeScreens(report: PortalReport, year: number): ScreenRow[] {
  const orderById = new Map<string, PortalOrder>();
  for (const o of report.orders) orderById.set(o.id, o);

  type Agg = { yearRevenue: number; totalOrderValue: number; detail: DetailRow[] };
  const byProduct = new Map<string, Agg>();

  const from = new Date(year, 0, 1);
  const to = new Date(year, 11, 31, 23, 59, 59);

  for (const it of report.items) {
    const o = orderById.get(it.order_id);
    if (!o || !it.product_id) continue;
    const total = Number(it.unit_price || 0) * Number(it.weeks || 1);
    const cur = byProduct.get(it.product_id) ?? { yearRevenue: 0, totalOrderValue: 0, detail: [] };
    cur.totalOrderValue += total;

    const schedule = buildInvoiceSchedule(
      o.invoice_start_date || o.created_at,
      (o.billing_frequency ?? "engang") as BillingFrequency,
      Number(o.billing_duration_months ?? 0),
      total,
    );
    const recurring = (o.billing_frequency ?? "engang") !== "engang";
    for (const h of schedule) {
      if (h.date < from || h.date > to) continue;
      cur.yearRevenue += h.amount;
      cur.detail.push({
        company:
          (o.company_name || "Okänd kund") +
          (recurring ? ` (delfaktura ${schedule.indexOf(h) + 1}/${schedule.length})` : ""),
        date: h.date,
        period: periodTextOf(it),
        amount: h.amount,
      });
    }
    byProduct.set(it.product_id, cur);
  }

  return report.products
    .map((p) => {
      const agg = byProduct.get(p.id);
      const yearRevenue = agg?.yearRevenue ?? 0;
      const pct = Number(p.revenue_share_pct ?? 0);
      return {
        product: p,
        yearRevenue,
        yearShare: (yearRevenue * pct) / 100,
        totalOrderValue: agg?.totalOrderValue ?? 0,
        detail: (agg?.detail ?? []).sort((a, b) => a.date.getTime() - b.date.getTime()),
      };
    })
    .sort((a, b) => b.yearRevenue - a.yearRevenue || b.totalOrderValue - a.totalOrderValue);
}

function SkarmportalPage() {
  const qc = useQueryClient();

  const { data: session, isLoading: sessionLoading } = useQuery({
    queryKey: ["portal-session"],
    queryFn: async () => (await supabase.auth.getSession()).data.session,
  });

  const { data: report, isLoading: reportLoading } = useQuery({
    queryKey: ["portal-report"],
    enabled: !!session,
    queryFn: async () => {
      const { data, error } = await supabase.rpc("get_screen_owner_report");
      if (error) throw error;
      return data as unknown as PortalReport | null;
    },
  });

  const onSignOut = async () => {
    await supabase.auth.signOut();
    qc.clear();
  };

  if (sessionLoading || (session && reportLoading)) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <Loader2 className="size-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (!session) {
    return <PortalLogin onSignedIn={() => qc.invalidateQueries()} />;
  }

  if (!report) {
    // Inloggad men inte skärmägare (t.ex. CRM-användare) — hänvisa rätt
    return (
      <PortalFrame>
        <Card className="p-6 max-w-md mx-auto text-center space-y-4">
          <p className="text-sm text-muted-foreground">
            Det här kontot är inte kopplat till någon skärmägare.
          </p>
          <div className="flex justify-center gap-2">
            <Button asChild variant="outline">
              <Link to="/dashboard">Till CRM</Link>
            </Button>
            <Button variant="ghost" onClick={onSignOut}>
              <LogOut className="size-4 mr-2" /> Logga ut
            </Button>
          </div>
        </Card>
      </PortalFrame>
    );
  }

  return <PortalDashboard report={report} onSignOut={onSignOut} />;
}

function PortalFrame({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-background">
      <div
        className="absolute inset-0 -z-10 opacity-40"
        style={{
          background:
            "radial-gradient(60% 50% at 50% 0%, oklch(0.56 0.19 258 / 0.18), transparent 70%)",
        }}
      />
      <div className="max-w-5xl mx-auto px-4 py-8">{children}</div>
    </div>
  );
}

function PortalLogin({ onSignedIn }: { onSignedIn: () => void }) {
  const [loading, setLoading] = useState(false);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");

  const onSignIn = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    setLoading(false);
    if (error) return toast.error("Fel e-post eller lösenord");
    toast.success("Inloggad");
    onSignedIn();
  };

  return (
    <div className="min-h-screen flex items-center justify-center px-4 relative overflow-hidden">
      <div
        className="absolute inset-0 -z-10 opacity-40"
        style={{
          background:
            "radial-gradient(60% 50% at 50% 20%, oklch(0.56 0.19 258 / 0.22), transparent 70%)",
        }}
      />
      <div className="w-full max-w-md">
        <div className="flex items-center gap-2 justify-center mb-2">
          <div
            className="size-9 rounded-lg flex items-center justify-center"
            style={{ background: "var(--gradient-primary)" }}
          >
            <Monitor className="size-5 text-primary-foreground" />
          </div>
          <span className="text-xl font-semibold tracking-tight">Skärmägarportal</span>
        </div>
        <p className="text-sm text-muted-foreground text-center mb-8">
          Logga in för att se försäljningen på dina skärmar
        </p>
        <div className="rounded-xl border bg-card p-6 shadow-[var(--shadow-card)]">
          <form onSubmit={onSignIn} className="space-y-3">
            <div>
              <Label htmlFor="email">E-post</Label>
              <Input
                id="email"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
              />
            </div>
            <div>
              <Label htmlFor="password">Lösenord</Label>
              <Input
                id="password"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
              />
            </div>
            <Button type="submit" className="w-full" disabled={loading}>
              {loading && <Loader2 className="size-4 animate-spin mr-2" />} Logga in
            </Button>
          </form>
        </div>
        <p className="text-xs text-muted-foreground text-center mt-4">
          Har du inga inloggningsuppgifter? Kontakta oss så hjälper vi dig.
        </p>
      </div>
    </div>
  );
}

function PortalDashboard({ report, onSignOut }: { report: PortalReport; onSignOut: () => void }) {
  const now = new Date();
  const [year, setYear] = useState(now.getFullYear());
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  const rows = useMemo(() => computeScreens(report, year), [report, year]);

  const totalYear = rows.reduce((s, r) => s + r.yearRevenue, 0);
  const totalShare = rows.reduce((s, r) => s + r.yearShare, 0);
  const totalAllTime = rows.reduce((s, r) => s + r.totalOrderValue, 0);
  const hasShare = rows.some((r) => Number(r.product.revenue_share_pct ?? 0) > 0);

  const years = Array.from({ length: 4 }, (_, i) => now.getFullYear() - i);

  const toggle = (id: string) =>
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  return (
    <PortalFrame>
      <div className="flex flex-wrap items-center justify-between gap-3 mb-6">
        <div className="flex items-center gap-2">
          <div
            className="size-9 rounded-lg flex items-center justify-center"
            style={{ background: "var(--gradient-primary)" }}
          >
            <Monitor className="size-5 text-primary-foreground" />
          </div>
          <div>
            <h1 className="text-lg font-semibold leading-tight">{report.owner_name}</h1>
            <p className="text-xs text-muted-foreground">Skärmägarportal</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Select value={String(year)} onValueChange={(v) => setYear(Number(v))}>
            <SelectTrigger className="w-28">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {years.map((y) => (
                <SelectItem key={y} value={String(y)}>
                  {y}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button variant="outline" size="sm" onClick={onSignOut}>
            <LogOut className="size-4 mr-2" /> Logga ut
          </Button>
        </div>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4 mb-6">
        <Kpi label={`Omsättning ${year}`} value={SEK(totalYear)} />
        {hasShare && <Kpi label={`Er andel ${year}`} value={SEK(totalShare)} />}
        <Kpi label="Antal skärmar" value={String(rows.length)} />
        <Kpi label="Totalt ordervärde (alla år)" value={SEK(totalAllTime)} />
      </div>

      <Card className="overflow-hidden">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-8" />
              <TableHead>Skärm</TableHead>
              <TableHead>Stad</TableHead>
              <TableHead className="text-right">Omsättning {year}</TableHead>
              {hasShare && <TableHead className="text-right">Er andel</TableHead>}
              <TableHead className="text-right">Totalt ordervärde</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((r) => {
              const open = expanded.has(r.product.id);
              const pct = Number(r.product.revenue_share_pct ?? 0);
              return (
                <>
                  <TableRow
                    key={r.product.id}
                    className="cursor-pointer"
                    onClick={() => toggle(r.product.id)}
                  >
                    <TableCell className="pr-0">
                      {open ? (
                        <ChevronDown className="size-4 text-muted-foreground" />
                      ) : (
                        <ChevronRight className="size-4 text-muted-foreground" />
                      )}
                    </TableCell>
                    <TableCell className="font-medium">{r.product.name}</TableCell>
                    <TableCell className="text-muted-foreground">{r.product.city || "—"}</TableCell>
                    <TableCell className="text-right font-medium">{SEK(r.yearRevenue)}</TableCell>
                    {hasShare && (
                      <TableCell className="text-right text-muted-foreground">
                        {pct > 0 ? `${SEK(r.yearShare)} (${pct}%)` : "—"}
                      </TableCell>
                    )}
                    <TableCell className="text-right text-muted-foreground">
                      {SEK(r.totalOrderValue)}
                    </TableCell>
                  </TableRow>
                  {open && (
                    <TableRow key={`${r.product.id}-detail`} className="hover:bg-transparent">
                      <TableCell colSpan={hasShare ? 6 : 5} className="bg-muted/30 p-0">
                        {r.detail.length === 0 ? (
                          <p className="text-sm text-muted-foreground px-10 py-3">
                            Ingen fakturerad försäljning {year}.
                          </p>
                        ) : (
                          <Table>
                            <TableHeader>
                              <TableRow className="hover:bg-transparent">
                                <TableHead className="pl-10">Kund</TableHead>
                                <TableHead>Datum</TableHead>
                                <TableHead>Period</TableHead>
                                <TableHead className="text-right pr-6">Belopp</TableHead>
                              </TableRow>
                            </TableHeader>
                            <TableBody>
                              {r.detail.map((d, i) => (
                                <TableRow key={i} className="hover:bg-transparent">
                                  <TableCell className="pl-10">{d.company}</TableCell>
                                  <TableCell>
                                    {format(d.date, "d MMM yyyy", { locale: sv })}
                                  </TableCell>
                                  <TableCell>{d.period}</TableCell>
                                  <TableCell className="text-right pr-6">{SEK(d.amount)}</TableCell>
                                </TableRow>
                              ))}
                            </TableBody>
                          </Table>
                        )}
                      </TableCell>
                    </TableRow>
                  )}
                </>
              );
            })}
            {rows.length === 0 && (
              <TableRow>
                <TableCell
                  colSpan={hasShare ? 6 : 5}
                  className="text-center text-sm text-muted-foreground py-8"
                >
                  Inga skärmar kopplade till kontot ännu.
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </Card>

      <p className="text-xs text-muted-foreground mt-4">
        Alla belopp i SEK exkl. moms. Omsättningen fördelas per faktureringstillfälle, på samma sätt
        som i vår ekonomirapport.
      </p>
    </PortalFrame>
  );
}

function Kpi({ label, value }: { label: string; value: string }) {
  return (
    <Card className="p-4">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="text-xl font-semibold mt-1">{value}</p>
    </Card>
  );
}
