import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useCurrentUser } from "@/lib/hooks/use-current-user";
import { PageHeader } from "@/components/page-header";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "sonner";
import { Wallet, TrendingUp, FileText, Package, Target, CalendarDays } from "lucide-react";
import { startOfMonth, endOfMonth, startOfQuarter, startOfYear, endOfYear, subYears } from "date-fns";
import { buildInvoiceSchedule, type BillingFrequency } from "@/lib/billing";
import { businessDaysBetween } from "@/lib/swedish-holidays";
import { Trophy, Medal, Award } from "lucide-react";
import {
  BarChart,
  Bar,
  Cell,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  CartesianGrid,
  LabelList,
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
  const { user, isAdmin } = useCurrentUser();
  const [leaderboardSeller, setLeaderboardSeller] = useState<string>("all");
  const now = new Date();
  const yearStart = startOfYear(now);
  const yearEnd = endOfYear(now);
  const monthStart = startOfMonth(now);
  const monthEnd = endOfMonth(now);
  const quarterStart = startOfQuarter(now);

  const { data } = useQuery({
    queryKey: ["dashboard-stats", yearStart.toISOString()],
    queryFn: async () => {
      const lookbackStart = subYears(yearStart, 2).toISOString().slice(0, 10);
      const [
        { data: deals },
        { data: products },
        { data: profiles },
        { data: comps },
        { data: company },
        { data: orders },
        { data: monthlyBudgets },
      ] = await Promise.all([
        supabase.from("deals").select("*").gte("won_at", yearStart.toISOString()).lte("won_at", yearEnd.toISOString()).eq("stage", "vunnen"),
        supabase.from("products").select("*"),
        supabase.from("profiles").select("id, full_name, email"),
        supabase.from("seller_compensation").select("*"),
        supabase.from("company_settings").select("*").maybeSingle(),
        supabase
          .from("orders")
          .select("id, owner_id, total_excl_vat, invoice_start_date, billing_frequency, billing_duration_months, order_type")
          .eq("order_type", "bokning")
          .gte("invoice_start_date", lookbackStart),
        supabase.from("seller_monthly_budgets").select("*").eq("year", now.getFullYear()),
      ]);
      const orderIds = (orders ?? []).map(o => o.id);
      const { data: items } = orderIds.length
        ? await supabase.from("order_items").select("order_id, product_id, unit_price, weeks").in("order_id", orderIds)
        : { data: [] };
      const { data: openDeals } = await supabase.from("deals").select("*").not("stage", "in", "(vunnen,forlorad)");
      return {
        wonDeals: deals ?? [],
        openDeals: openDeals ?? [],
        products: products ?? [],
        profiles: profiles ?? [],
        comps: comps ?? [],
        company: company ?? { monthly_budget: 0 },
        orders: orders ?? [],
        items: items ?? [],
        monthlyBudgets: monthlyBudgets ?? [],
      };
    },
  });

  const prodMap = new Map((data?.products ?? []).map(p => [p.id, p]));
  const profileMap = new Map((data?.profiles ?? []).map(p => [p.id, p]));
  const compMap = new Map((data?.comps ?? []).map(c => [c.user_id, c]));

  // Build invoice schedule entries from orders. Each entry contributes to sales
  // on its month: { date, amount, owner_id, productSplit: Map<productId, amount> }
  type ScheduleEntry = { date: Date; amount: number; owner_id: string | null; productSplit: Map<string, number> };
  const itemsByOrder = new Map<string, any[]>();
  for (const it of data?.items ?? []) {
    const arr = itemsByOrder.get(it.order_id) ?? [];
    arr.push(it);
    itemsByOrder.set(it.order_id, arr);
  }
  const scheduleEntries: ScheduleEntry[] = [];
  for (const o of data?.orders ?? []) {
    const total = Number(o.total_excl_vat ?? 0);
    if (!total) continue;
    const sched = buildInvoiceSchedule(
      o.invoice_start_date,
      (o.billing_frequency as BillingFrequency) ?? "engang",
      o.billing_duration_months ?? 1,
      total,
    );
    // product split ratios for this order
    const ois = itemsByOrder.get(o.id) ?? [];
    const itemTotals = ois.map(it => ({
      product_id: it.product_id || "ingen",
      value: Number(it.unit_price ?? 0) * Number(it.weeks ?? 1),
    }));
    const itemsSum = itemTotals.reduce((s, x) => s + x.value, 0) || 1;
    for (const entry of sched) {
      const split = new Map<string, number>();
      for (const it of itemTotals) {
        split.set(it.product_id, (split.get(it.product_id) ?? 0) + (entry.amount * it.value) / itemsSum);
      }
      scheduleEntries.push({ date: entry.date, amount: entry.amount, owner_id: o.owner_id, productSplit: split });
    }
  }

  // Per-seller yearly sales (from invoice schedule, current year)
  const sellerSales = new Map<string, number>();
  // Company sales totals
  let monthTotal = 0, quarterTotal = 0, yearTotal = 0;
  // Per product yearly revenue
  const productSales = new Map<string, number>();
  for (const e of scheduleEntries) {
    if (e.date < yearStart || e.date > yearEnd) continue;
    yearTotal += e.amount;
    if (e.date >= quarterStart) quarterTotal += e.amount;
    if (e.date >= monthStart && e.date <= monthEnd) monthTotal += e.amount;
    if (e.owner_id) sellerSales.set(e.owner_id, (sellerSales.get(e.owner_id) ?? 0) + e.amount);
    for (const [pid, amt] of e.productSplit) {
      productSales.set(pid, (productSales.get(pid) ?? 0) + amt);
    }
  }
  const sellerChartAll = Array.from(sellerSales.entries())
    .map(([uid, value]) => {
      const p = profileMap.get(uid);
      const fullName = (p?.full_name && p.full_name.trim()) || p?.email || "Okänd";
      const first = fullName.split(" ")[0] || fullName;
      return { id: uid, name: first, fullName, value };
    })
    .sort((a, b) => b.value - a.value)
    .map((row, i) => ({ ...row, rank: i + 1, label: `#${i + 1} ${row.name}` }));
  const sellerChart = leaderboardSeller === "all"
    ? sellerChartAll
    : sellerChartAll.filter(s => s.id === leaderboardSeller);
  const productChart = Array.from(productSales.entries())
    .map(([pid, value]) => ({
      name: pid === "ingen" ? "Övrigt" : (prodMap.get(pid)?.name ?? "Okänd"),
      value,
    }))
    .sort((a, b) => b.value - a.value);

  // Per-month sales for current year (company-wide)
  const monthNames = ["Jan", "Feb", "Mar", "Apr", "Maj", "Jun", "Jul", "Aug", "Sep", "Okt", "Nov", "Dec"];
  const monthlyTotals = Array.from({ length: 12 }, (_, i) => ({ name: monthNames[i], value: 0 }));
  for (const e of scheduleEntries) {
    if (e.date < yearStart || e.date > yearEnd) continue;
    monthlyTotals[e.date.getMonth()].value += e.amount;
  }
  const currentMonthIdx = now.getMonth();

  // Open offers - own
  const myOpen = (data?.openDeals ?? []).filter(d => d.owner_id === user?.id);
  const myOpenValue = myOpen.reduce((s, d) => s + Number(d.value ?? 0), 0);

  // My salary + budget (this month)
  const myComp: any = user ? compMap.get(user.id) : null;
  const compType = myComp?.compensation_type ?? "med_grundlon";
  const defaultPct = Number(myComp?.default_commission_pct ?? 0);
  const baseSalary = compType === "endast_provision" ? 0 : Number(myComp?.base_salary ?? 0);
  const currentMonth = now.getMonth() + 1;
  const myMonthlyBudgetRow = (data?.monthlyBudgets ?? []).find(b => b.user_id === user?.id && b.month === currentMonth);
  const myBudget = Number(myMonthlyBudgetRow?.amount ?? myComp?.monthly_budget ?? 0);
  const mySoldThisMonth = scheduleEntries
    .filter(e => e.owner_id === user?.id && e.date >= monthStart && e.date <= monthEnd)
    .reduce((s, e) => s + e.amount, 0);
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

  // Daily pace toward my monthly budget (business days remaining)
  const daysLeft = Math.max(businessDaysBetween(now, monthEnd), 1);
  const myRemaining = Math.max(myBudget - mySoldThisMonth, 0);
  const myPerDay = myBudget > 0 ? myRemaining / daysLeft : 0;
  const myBudgetPct = myBudget > 0 ? Math.min(100, (mySoldThisMonth / myBudget) * 100) : 0;

  // Company budget = sum of all sellers' monthly budgets for current month
  const companyBudget = (data?.monthlyBudgets ?? [])
    .filter(b => b.month === currentMonth)
    .reduce((s, b) => s + Number(b.amount ?? 0), 0);
  const companyRemaining = Math.max(companyBudget - monthTotal, 0);
  const companyBudgetPct = companyBudget > 0 ? Math.min(100, (monthTotal / companyBudget) * 100) : 0;

  return (
    <>
      <PageHeader title="Dashboard" description="Översikt över sälj, budget och lön" />
      <div className="p-6 space-y-6">
        {/* Top KPIs */}
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
          <Stat label="Min lön (denna månad)" value={fmt(mySalaryTotal)} sub={`Grundlön ${fmt(baseSalary)} + Provision ${fmt(myCommission)}`} icon={Wallet} accent />
          <Stat label="Mina offerter ute" value={String(myOpen.length)} sub={`Värde ${fmt(myOpenValue)}`} icon={FileText} />
          <Stat label="Bolaget – månad" value={fmt(monthTotal)} icon={TrendingUp} />
          <Stat label="Bolaget – år" value={fmt(yearTotal)} sub={`Kvartal ${fmt(quarterTotal)}`} icon={TrendingUp} />
        </div>

        {/* Budget progress */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          <Card className="p-5">
            <div className="flex items-center justify-between mb-3">
              <div className="flex items-center gap-2">
                <Target className="size-4 text-muted-foreground" />
                <h3 className="text-sm font-semibold">Min månadsbudget</h3>
              </div>
              <div className="text-xs text-muted-foreground">{myBudgetPct.toFixed(0)}%</div>
            </div>
            {myBudget === 0 ? (
              <p className="text-sm text-muted-foreground">Ingen budget satt. Be admin sätta din månadsbudget under Lön → Säljarinställningar.</p>
            ) : (
              <>
                <div className="flex items-baseline justify-between mb-2">
                  <div className="text-2xl font-semibold">{fmt(mySoldThisMonth)}</div>
                  <div className="text-xs text-muted-foreground">av {fmt(myBudget)}</div>
                </div>
                <Progress value={myBudgetPct} />
                <div className="grid grid-cols-2 gap-3 mt-4 pt-3 border-t">
                  <div>
                    <div className="text-[10px] text-muted-foreground uppercase tracking-wider">Kvar till budget</div>
                    <div className="text-lg font-semibold">{fmt(myRemaining)}</div>
                  </div>
                  <div>
                    <div className="text-[10px] text-muted-foreground uppercase tracking-wider flex items-center gap-1">
                      <CalendarDays className="size-3" /> Behöver/dag ({daysLeft} arbetsdagar kvar)
                    </div>
                    <div className="text-lg font-semibold text-primary">{fmt(myPerDay)}</div>
                  </div>
                </div>
              </>
            )}
          </Card>

          <Card className="p-5">
            <div className="flex items-center justify-between mb-3">
              <div className="flex items-center gap-2">
                <Target className="size-4 text-muted-foreground" />
                <h3 className="text-sm font-semibold">Bolagets månadsbudget</h3>
              </div>
              <div className="text-xs text-muted-foreground">{companyBudgetPct.toFixed(0)}%</div>
            </div>
            {companyBudget === 0 ? (
              <p className="text-sm text-muted-foreground">Ingen bolagsbudget satt. Lägg in säljarnas budgetar under Budget-fliken.</p>
            ) : (
              <>
                <div className="flex items-baseline justify-between mb-2">
                  <div className="text-2xl font-semibold">{fmt(monthTotal)}</div>
                  <div className="text-xs text-muted-foreground">av {fmt(companyBudget)}</div>
                </div>
                <Progress value={companyBudgetPct} />
                <div className="grid grid-cols-2 gap-3 mt-4 pt-3 border-t">
                  <div>
                    <div className="text-[10px] text-muted-foreground uppercase tracking-wider">Kvar till budget</div>
                    <div className="text-lg font-semibold">{fmt(companyRemaining)}</div>
                  </div>
                  <div>
                    <div className="text-[10px] text-muted-foreground uppercase tracking-wider flex items-center gap-1">
                      <CalendarDays className="size-3" /> Behöver/dag
                    </div>
                    <div className="text-lg font-semibold text-primary">{fmt(companyRemaining / daysLeft)}</div>
                  </div>
                </div>
              </>
            )}
          </Card>
        </div>

        {/* Monthly company sales for current year */}
        <Card className="p-5">
          <div className="flex items-center gap-2 mb-4">
            <CalendarDays className="size-4 text-muted-foreground" />
            <h3 className="text-sm font-semibold">Försäljning per månad ({now.getFullYear()})</h3>
          </div>
          <ResponsiveContainer width="100%" height={280}>
            <BarChart data={monthlyTotals}>
              <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
              <XAxis dataKey="name" className="text-xs" />
              <YAxis className="text-xs" tickFormatter={(v) => `${(v / 1000).toFixed(0)}k`} />
              <Tooltip formatter={(v: number) => fmt(v)} contentStyle={{ background: "hsl(var(--card))", border: "1px solid hsl(var(--border))" }} />
              <Bar dataKey="value" fill="hsl(var(--chart-blue))" radius={[6, 6, 0, 0]}>
                <LabelList dataKey="value" position="top" formatter={(v: number) => `${(v / 1000).toFixed(0)}k`} className="text-[10px]" />
              </Bar>
            </BarChart>
          </ResponsiveContainer>
          <div className="mt-3 text-xs text-muted-foreground">
            Totalt i år: <span className="font-semibold text-foreground">{fmt(yearTotal)}</span> · Snitt/månad hittills:{" "}
            <span className="font-semibold text-foreground">{fmt(yearTotal / (currentMonthIdx + 1))}</span>
          </div>
        </Card>

        {/* Seller leaderboard */}
        <Card className="p-5">
          <div className="flex items-center gap-2 mb-4">
            <Trophy className="size-4 text-amber-500" />
            <h3 className="text-sm font-semibold">Säljartoppen i år</h3>
          </div>
          {sellerChart.length === 0 ? (
            <div className="text-sm text-muted-foreground py-12 text-center">Ingen försäljning i år ännu</div>
          ) : (
            <>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mb-5">
                {sellerChart.slice(0, 3).map((s) => {
                  const styles = [
                    { ring: "ring-amber-400/60 bg-amber-500/10", text: "text-amber-500", Icon: Trophy, label: "1:a" },
                    { ring: "ring-zinc-300/60 bg-zinc-400/10", text: "text-zinc-300", Icon: Medal, label: "2:a" },
                    { ring: "ring-orange-400/60 bg-orange-500/10", text: "text-orange-400", Icon: Award, label: "3:a" },
                  ][s.rank - 1];
                  const Icon = styles.Icon;
                  return (
                    <div key={s.id} className={`rounded-lg p-4 ring-1 ${styles.ring}`}>
                      <div className="flex items-center justify-between">
                        <div className={`flex items-center gap-2 ${styles.text}`}>
                          <Icon className="size-4" />
                          <span className="text-xs font-semibold uppercase tracking-wider">{styles.label} plats</span>
                        </div>
                        <span className={`text-xl font-bold ${styles.text}`}>#{s.rank}</span>
                      </div>
                      <div className="mt-2 text-base font-semibold truncate" title={s.fullName}>{s.fullName}</div>
                      <div className="text-sm text-muted-foreground">{fmt(s.value)}</div>
                    </div>
                  );
                })}
              </div>
              <ResponsiveContainer width="100%" height={Math.max(260, sellerChart.length * 44)}>
                <BarChart data={sellerChart} layout="vertical" margin={{ left: 8, right: 32 }}>
                  <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
                  <XAxis type="number" className="text-xs" tickFormatter={(v) => `${(v / 1000).toFixed(0)}k`} />
                  <YAxis type="category" dataKey="label" width={160} className="text-xs" />
                  <Tooltip formatter={(v: number) => fmt(v)} contentStyle={{ background: "hsl(var(--card))", border: "1px solid hsl(var(--border))" }} />
                  <Bar dataKey="value" radius={[0, 6, 6, 0]}>
                    {sellerChart.map((s) => {
                      const color =
                        s.rank === 1 ? "hsl(45 95% 55%)" :
                        s.rank === 2 ? "hsl(220 10% 75%)" :
                        s.rank === 3 ? "hsl(25 90% 55%)" :
                        "hsl(var(--primary))";
                      return <Cell key={s.id} fill={color} />;
                    })}
                    <LabelList dataKey="value" position="right" formatter={(v: number) => fmt(v)} className="text-[10px]" />
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </>
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
