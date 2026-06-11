import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useCurrentUser } from "@/lib/hooks/use-current-user";
import { PageHeader } from "@/components/page-header";
import { Card } from "@/components/ui/card";
import { Wallet, TrendingUp, FileText, Package } from "lucide-react";
import { startOfMonth, endOfMonth, startOfQuarter, startOfYear, endOfYear } from "date-fns";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  CartesianGrid,
} from "recharts";

export const Route = createFileRoute("/_authenticated/dashboard")({
  component: Dashboard,
});

const fmt = (n: number) =>
  new Intl.NumberFormat("sv-SE", { style: "currency", currency: "SEK", maximumFractionDigits: 0 }).format(n || 0);

function pickPct(deal: any, product: any, compType: string, defaultPct: number) {
  if (deal.commission_pct_override != null) return Number(deal.commission_pct_override);
  if (product) {
    const col = compType === "endast_provision" ? product.commission_pct_provision_only : product.commission_pct_with_base;
    if (col != null) return Number(col);
    if (product.default_commission_pct != null) return Number(product.default_commission_pct);
  }
  return defaultPct;
}

function Dashboard() {
  const { user } = useCurrentUser();
  const now = new Date();
  const yearStart = startOfYear(now);
  const yearEnd = endOfYear(now);
  const monthStart = startOfMonth(now);
  const monthEnd = endOfMonth(now);
  const quarterStart = startOfQuarter(now);

  const { data } = useQuery({
    queryKey: ["dashboard-stats", yearStart.toISOString()],
    queryFn: async () => {
      const [{ data: deals }, { data: products }, { data: profiles }, { data: comps }] = await Promise.all([
        supabase.from("deals").select("*").gte("won_at", yearStart.toISOString()).lte("won_at", yearEnd.toISOString()).eq("stage", "vunnen"),
        supabase.from("products").select("*"),
        supabase.from("profiles").select("id, full_name, email"),
        supabase.from("seller_compensation").select("*"),
      ]);
      const { data: openDeals } = await supabase.from("deals").select("*").not("stage", "in", "(vunnen,forlorad)");
      return {
        wonDeals: deals ?? [],
        openDeals: openDeals ?? [],
        products: products ?? [],
        profiles: profiles ?? [],
        comps: comps ?? [],
      };
    },
  });

  const prodMap = new Map((data?.products ?? []).map(p => [p.id, p]));
  const profileMap = new Map((data?.profiles ?? []).map(p => [p.id, p]));
  const compMap = new Map((data?.comps ?? []).map(c => [c.user_id, c]));

  // Per-seller yearly sales
  const sellerSales = new Map<string, number>();
  for (const d of data?.wonDeals ?? []) {
    if (!d.owner_id) continue;
    sellerSales.set(d.owner_id, (sellerSales.get(d.owner_id) ?? 0) + Number(d.value ?? 0));
  }
  const sellerChart = Array.from(sellerSales.entries())
    .map(([uid, value]) => {
      const p = profileMap.get(uid);
      const name = p?.full_name || p?.email || "Okänd";
      return { name: name.split(" ")[0], value };
    })
    .sort((a, b) => b.value - a.value);

  // Company sales
  let monthTotal = 0, quarterTotal = 0, yearTotal = 0;
  for (const d of data?.wonDeals ?? []) {
    const v = Number(d.value ?? 0);
    const w = d.won_at ? new Date(d.won_at) : null;
    if (!w) continue;
    yearTotal += v;
    if (w >= quarterStart) quarterTotal += v;
    if (w >= monthStart && w <= monthEnd) monthTotal += v;
  }

  // Per product yearly revenue
  const productSales = new Map<string, number>();
  for (const d of data?.wonDeals ?? []) {
    const key = d.product_id || "ingen";
    productSales.set(key, (productSales.get(key) ?? 0) + Number(d.value ?? 0));
  }
  const productChart = Array.from(productSales.entries())
    .map(([pid, value]) => ({
      name: pid === "ingen" ? "Övrigt" : (prodMap.get(pid)?.name ?? "Okänd"),
      value,
    }))
    .sort((a, b) => b.value - a.value);

  // Open offers - own
  const myOpen = (data?.openDeals ?? []).filter(d => d.owner_id === user?.id);
  const myOpenValue = myOpen.reduce((s, d) => s + Number(d.value ?? 0), 0);

  // My salary (this month)
  const myComp = user ? compMap.get(user.id) : null;
  const compType = myComp?.compensation_type ?? "med_grundlon";
  const defaultPct = Number(myComp?.default_commission_pct ?? 0);
  const baseSalary = compType === "endast_provision" ? 0 : Number(myComp?.base_salary ?? 0);
  const myWonThisMonth = (data?.wonDeals ?? []).filter(d => {
    if (d.owner_id !== user?.id || !d.won_at) return false;
    const w = new Date(d.won_at);
    return w >= monthStart && w <= monthEnd;
  });
  const myCommission = myWonThisMonth.reduce((s, d) => {
    const product = d.product_id ? prodMap.get(d.product_id) : null;
    const pct = pickPct(d, product, compType, defaultPct);
    return s + (Number(d.value ?? 0) * pct) / 100;
  }, 0);
  const mySalaryTotal = baseSalary + myCommission;

  return (
    <>
      <PageHeader title="Dashboard" description="Översikt över sälj, produkter och lön" />
      <div className="p-6 space-y-6">
        {/* My salary + my offers */}
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
          <Stat label="Min lön (denna månad)" value={fmt(mySalaryTotal)} sub={`Grundlön ${fmt(baseSalary)} + Provision ${fmt(myCommission)}`} icon={Wallet} accent />
          <Stat label="Mina offerter ute" value={String(myOpen.length)} sub={`Värde ${fmt(myOpenValue)}`} icon={FileText} />
          <Stat label="Bolaget – månad" value={fmt(monthTotal)} icon={TrendingUp} />
          <Stat label="Bolaget – år" value={fmt(yearTotal)} sub={`Kvartal ${fmt(quarterTotal)}`} icon={TrendingUp} />
        </div>

        {/* Seller bar chart */}
        <Card className="p-5">
          <h3 className="text-sm font-semibold mb-4">Försäljning per säljare i år</h3>
          {sellerChart.length === 0 ? (
            <div className="text-sm text-muted-foreground py-12 text-center">Ingen försäljning i år ännu</div>
          ) : (
            <ResponsiveContainer width="100%" height={300}>
              <BarChart data={sellerChart}>
                <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
                <XAxis dataKey="name" className="text-xs" />
                <YAxis className="text-xs" tickFormatter={(v) => `${(v / 1000).toFixed(0)}k`} />
                <Tooltip formatter={(v: number) => fmt(v)} contentStyle={{ background: "hsl(var(--card))", border: "1px solid hsl(var(--border))" }} />
                <Bar dataKey="value" fill="hsl(var(--primary))" radius={[6, 6, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          )}
        </Card>

        {/* Per product yearly */}
        <Card className="p-5">
          <div className="flex items-center gap-2 mb-4">
            <Package className="size-4 text-muted-foreground" />
            <h3 className="text-sm font-semibold">Omsättning per produkt i år</h3>
          </div>
          {productChart.length === 0 ? (
            <div className="text-sm text-muted-foreground py-12 text-center">Ingen data</div>
          ) : (
            <ResponsiveContainer width="100%" height={Math.max(200, productChart.length * 40)}>
              <BarChart data={productChart} layout="vertical">
                <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
                <XAxis type="number" className="text-xs" tickFormatter={(v) => `${(v / 1000).toFixed(0)}k`} />
                <YAxis type="category" dataKey="name" width={140} className="text-xs" />
                <Tooltip formatter={(v: number) => fmt(v)} contentStyle={{ background: "hsl(var(--card))", border: "1px solid hsl(var(--border))" }} />
                <Bar dataKey="value" fill="hsl(var(--primary))" radius={[0, 6, 6, 0]} />
              </BarChart>
            </ResponsiveContainer>
          )}
        </Card>
      </div>
    </>
  );
}

function Stat({
  label,
  value,
  sub,
  icon: Icon,
  accent,
}: {
  label: string;
  value: string;
  sub?: string;
  icon: any;
  accent?: boolean;
}) {
  return (
    <Card className={`p-4 ${accent ? "border-primary/40" : ""}`}>
      <div className="flex items-center justify-between">
        <div className="text-xs text-muted-foreground uppercase tracking-wider">{label}</div>
        <Icon className="size-4 text-muted-foreground" />
      </div>
      <div className={`mt-2 text-2xl font-semibold ${accent ? "text-primary" : ""}`}>{value}</div>
      {sub && <div className="mt-1 text-xs text-muted-foreground">{sub}</div>}
    </Card>
  );
}
