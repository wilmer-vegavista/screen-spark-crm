import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useCurrentUser } from "@/lib/hooks/use-current-user";
import { PageHeader } from "@/components/page-header";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Progress } from "@/components/ui/progress";
import { toast } from "sonner";
import { Target, Calculator, TrendingDown, TrendingUp } from "lucide-react";
import { buildInvoiceSchedule, type BillingFrequency } from "@/lib/billing";
import { startOfYear, endOfYear, startOfMonth, endOfMonth } from "date-fns";

export const Route = createFileRoute("/_authenticated/budget")({
  component: BudgetPage,
});

const fmt = (n: number) =>
  new Intl.NumberFormat("sv-SE", { style: "currency", currency: "SEK", maximumFractionDigits: 0 }).format(n || 0);

const monthLabels = ["Jan", "Feb", "Mar", "Apr", "Maj", "Jun", "Jul", "Aug", "Sep", "Okt", "Nov", "Dec"];

type Seller = { id: string; name: string };

function BudgetPage() {
  const { isAdmin } = useCurrentUser();
  const currentYear = new Date().getFullYear();
  const [year, setYear] = useState(currentYear);
  const years = [currentYear - 1, currentYear, currentYear + 1, currentYear + 2];

  if (!isAdmin) {
    return (
      <>
        <PageHeader title="Budget" description="Endast admin har åtkomst" />
        <div className="p-6">
          <Card className="p-6 text-sm text-muted-foreground">Du behöver admin-rättigheter för att se denna sida.</Card>
        </div>
      </>
    );
  }

  return (
    <>
      <PageHeader title="Budget" description="Sätt månads-, kvartals-, halvårs- och årsbudget per säljare och kalenderår" />
      <div className="p-6 space-y-4">
        <div className="flex items-center gap-3">
          <label className="text-sm font-medium">Kalenderår</label>
          <Select value={String(year)} onValueChange={v => setYear(Number(v))}>
            <SelectTrigger className="w-32"><SelectValue /></SelectTrigger>
            <SelectContent>
              {years.map(y => <SelectItem key={y} value={String(y)}>{y}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
        <Tabs defaultValue="satt">
          <TabsList>
            <TabsTrigger value="satt">Sätt budget</TabsTrigger>
            <TabsTrigger value="kvar">Kvar till budget</TabsTrigger>
          </TabsList>
          <TabsContent value="satt">
            <SellersList year={year} />
          </TabsContent>
          <TabsContent value="kvar">
            <BudgetRemaining year={year} />
          </TabsContent>
        </Tabs>
      </div>
    </>
  );
}

function SellersList({ year }: { year: number }) {
  const { data } = useQuery({
    queryKey: ["budget-sellers", year],
    queryFn: async () => {
      const [{ data: profiles }, { data: roles }, { data: budgets }] = await Promise.all([
        supabase.from("profiles").select("id, full_name, email"),
        supabase.from("user_roles").select("user_id, role"),
        supabase.from("seller_monthly_budgets").select("*").eq("year", year),
      ]);
      const sellerIds = new Set((roles ?? []).filter(r => r.role === "saljare").map(r => r.user_id));
      const sellers: Seller[] = (profiles ?? [])
        .filter(p => sellerIds.has(p.id))
        .map(p => ({ id: p.id, name: p.full_name || p.email || "Okänd" }));
      const byUser = new Map<string, number[]>();
      for (const s of sellers) byUser.set(s.id, Array(12).fill(0));
      for (const b of budgets ?? []) {
        const arr = byUser.get(b.user_id) ?? Array(12).fill(0);
        arr[b.month - 1] = Number(b.amount);
        byUser.set(b.user_id, arr);
      }
      return { sellers, byUser };
    },
  });

  if (!data) return <Card className="p-6 text-sm text-muted-foreground">Laddar…</Card>;
  if (data.sellers.length === 0) return <Card className="p-6 text-sm text-muted-foreground">Inga säljare ännu</Card>;

  return (
    <div className="space-y-4">
      {data.sellers.map(s => (
        <SellerBudgetCard key={s.id} seller={s} year={year} initial={data.byUser.get(s.id) ?? Array(12).fill(0)} />
      ))}
    </div>
  );
}

function SellerBudgetCard({ seller, year, initial }: { seller: Seller; year: number; initial: number[] }) {
  const qc = useQueryClient();
  const [months, setMonths] = useState<number[]>(initial);
  const [yearInput, setYearInput] = useState<string>("");
  const [saving, setSaving] = useState(false);

  useEffect(() => { setMonths(initial); }, [initial]);

  const yearTotal = useMemo(() => months.reduce((s, n) => s + n, 0), [months]);
  const q1 = months.slice(0, 3).reduce((s, n) => s + n, 0);
  const q2 = months.slice(3, 6).reduce((s, n) => s + n, 0);
  const q3 = months.slice(6, 9).reduce((s, n) => s + n, 0);
  const q4 = months.slice(9, 12).reduce((s, n) => s + n, 0);
  const h1 = q1 + q2;
  const h2 = q3 + q4;

  const distributeYear = () => {
    const v = Number(yearInput);
    if (!v || v < 0) return toast.error("Ange ett giltigt årsbelopp");
    const per = Math.round(v / 12);
    setMonths(Array(12).fill(per));
    toast.success(`Fördelade ${fmt(v)} jämnt på 12 månader (${fmt(per)}/mån)`);
  };

  const setMonth = (idx: number, val: string) => {
    const n = Math.max(0, Number(val) || 0);
    setMonths(prev => prev.map((m, i) => i === idx ? n : m));
  };

  const save = async () => {
    setSaving(true);
    const rows = months.map((amount, i) => ({
      user_id: seller.id,
      year,
      month: i + 1,
      amount,
    }));
    const { error } = await supabase
      .from("seller_monthly_budgets")
      .upsert(rows, { onConflict: "user_id,year,month" });
    setSaving(false);
    if (error) return toast.error(error.message);
    toast.success(`Budget sparad för ${seller.name}`);
    qc.invalidateQueries({ queryKey: ["budget-sellers", year] });
    qc.invalidateQueries({ queryKey: ["dashboard-stats"] });
  };

  return (
    <Card className="p-5 space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div className="flex items-center gap-2">
          <Target className="size-4 text-muted-foreground" />
          <h3 className="text-sm font-semibold">{seller.name}</h3>
          <span className="text-xs text-muted-foreground">· {year}</span>
        </div>
        <div className="flex items-end gap-2">
          <div>
            <label className="text-[10px] text-muted-foreground uppercase tracking-wider">Årsbudget (auto-fördela)</label>
            <Input
              type="number"
              placeholder="t.ex. 1200000"
              value={yearInput}
              onChange={e => setYearInput(e.target.value)}
              className="w-44 h-9"
            />
          </div>
          <Button type="button" variant="outline" size="sm" onClick={distributeYear}>
            <Calculator className="size-3.5 mr-1" /> Fördela på 12 mån
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-2">
        {monthLabels.map((label, i) => (
          <div key={label} className="space-y-1">
            <label className="text-[10px] text-muted-foreground uppercase tracking-wider">{label}</label>
            <Input
              type="number"
              value={months[i] || 0}
              onChange={e => setMonth(i, e.target.value)}
              className="h-9"
            />
          </div>
        ))}
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-7 gap-3 pt-3 border-t">
        <Stat label="Q1" value={fmt(q1)} />
        <Stat label="Q2" value={fmt(q2)} />
        <Stat label="Q3" value={fmt(q3)} />
        <Stat label="Q4" value={fmt(q4)} />
        <Stat label="H1" value={fmt(h1)} />
        <Stat label="H2" value={fmt(h2)} />
        <Stat label={`År ${year}`} value={fmt(yearTotal)} highlight />
      </div>

      <div className="flex justify-end">
        <Button size="sm" onClick={save} disabled={saving}>{saving ? "Sparar…" : "Spara"}</Button>
      </div>
    </Card>
  );
}

function Stat({ label, value, highlight }: { label: string; value: string; highlight?: boolean }) {
  return (
    <div>
      <div className="text-[10px] text-muted-foreground uppercase tracking-wider">{label}</div>
      <div className={`text-sm font-semibold ${highlight ? "text-primary" : ""}`}>{value}</div>
    </div>
  );
}

function BudgetRemaining({ year }: { year: number }) {
  const now = new Date();
  const isCurrentYear = year === now.getFullYear();
  const yearStart = startOfYear(new Date(year, 0, 1));
  const yearEnd = endOfYear(new Date(year, 0, 1));
  const monthStart = startOfMonth(now);
  const monthEnd = endOfMonth(now);

  const { data } = useQuery({
    queryKey: ["budget-remaining", year],
    queryFn: async () => {
      const [
        { data: profiles },
        { data: roles },
        { data: budgets },
        { data: orders },
      ] = await Promise.all([
        supabase.from("profiles").select("id, full_name, email"),
        supabase.from("user_roles").select("user_id, role"),
        supabase.from("seller_monthly_budgets").select("*").eq("year", year),
        supabase
          .from("orders")
          .select("id, owner_id, total_excl_vat, invoice_start_date, billing_frequency, billing_duration_months, order_type")
          .eq("order_type", "bokning")
          .gte("invoice_start_date", `${year - 1}-01-01`)
          .lte("invoice_start_date", `${year + 1}-12-31`),
      ]);
      const sellerIds = new Set((roles ?? []).filter(r => r.role === "saljare").map(r => r.user_id));
      const sellers: Seller[] = (profiles ?? [])
        .filter(p => sellerIds.has(p.id))
        .map(p => ({ id: p.id, name: p.full_name || p.email || "Okänd" }));

      // Build invoice schedule entries per order
      type Entry = { date: Date; amount: number; owner_id: string | null };
      const entries: Entry[] = [];
      for (const o of orders ?? []) {
        const total = Number(o.total_excl_vat ?? 0);
        if (!total || !o.invoice_start_date) continue;
        const sched = buildInvoiceSchedule(
          o.invoice_start_date,
          (o.billing_frequency as BillingFrequency) ?? "engang",
          o.billing_duration_months ?? 1,
          total,
        );
        for (const e of sched) {
          entries.push({ date: e.date, amount: e.amount, owner_id: o.owner_id });
        }
      }

      // Budgets per seller per month
      const budgetMap = new Map<string, number[]>();
      for (const s of sellers) budgetMap.set(s.id, Array(12).fill(0));
      for (const b of budgets ?? []) {
        const arr = budgetMap.get(b.user_id) ?? Array(12).fill(0);
        arr[b.month - 1] = Number(b.amount);
        budgetMap.set(b.user_id, arr);
      }

      // Actuals per seller per month (from invoice schedule)
      const actualMap = new Map<string, number[]>();
      for (const s of sellers) actualMap.set(s.id, Array(12).fill(0));
      for (const e of entries) {
        if (e.date < yearStart || e.date > yearEnd) continue;
        if (!e.owner_id) continue;
        const arr = actualMap.get(e.owner_id) ?? Array(12).fill(0);
        arr[e.date.getMonth()] += e.amount;
        actualMap.set(e.owner_id, arr);
      }

      // Yearly totals
      const yearBudget = new Map<string, number>();
      const yearActual = new Map<string, number>();
      const monthBudget = new Map<string, number>();
      const monthActual = new Map<string, number>();
      for (const s of sellers) {
        const bArr = budgetMap.get(s.id) ?? Array(12).fill(0);
        const aArr = actualMap.get(s.id) ?? Array(12).fill(0);
        yearBudget.set(s.id, bArr.reduce((sum, n) => sum + n, 0));
        yearActual.set(s.id, aArr.reduce((sum, n) => sum + n, 0));
        if (isCurrentYear) {
          monthBudget.set(s.id, bArr[now.getMonth()]);
          monthActual.set(s.id, aArr[now.getMonth()]);
        }
      }

      return { sellers, yearBudget, yearActual, monthBudget, monthActual };
    },
  });

  if (!data) return <Card className="p-6 text-sm text-muted-foreground">Laddar…</Card>;
  if (data.sellers.length === 0) return <Card className="p-6 text-sm text-muted-foreground">Inga säljare ännu</Card>;

  return (
    <div className="space-y-4">
      {data.sellers.map(s => {
        const budget = data.yearBudget.get(s.id) ?? 0;
        const actual = data.yearActual.get(s.id) ?? 0;
        const remaining = Math.max(budget - actual, 0);
        const pct = budget > 0 ? Math.min(100, (actual / budget) * 100) : 0;
        const mBudget = isCurrentYear ? (data.monthBudget.get(s.id) ?? 0) : 0;
        const mActual = isCurrentYear ? (data.monthActual.get(s.id) ?? 0) : 0;
        const mRemaining = Math.max(mBudget - mActual, 0);
        const mPct = mBudget > 0 ? Math.min(100, (mActual / mBudget) * 100) : 0;

        return (
          <Card key={s.id} className="p-5 space-y-4">
            <div className="flex items-center justify-between flex-wrap gap-3">
              <div className="flex items-center gap-2">
                <Target className="size-4 text-muted-foreground" />
                <h3 className="text-sm font-semibold">{s.name}</h3>
                <span className="text-xs text-muted-foreground">· {year}</span>
              </div>
              <div className="text-xs text-muted-foreground">
                {pct.toFixed(0)}% uppnått
              </div>
            </div>

            <div className="space-y-3">
              <div className="flex items-baseline justify-between">
                <div className="text-sm text-muted-foreground">Årsbudget</div>
                <div className="text-sm font-semibold">{fmt(budget)}</div>
              </div>
              <div className="flex items-baseline justify-between">
                <div className="text-sm text-muted-foreground">Sålt hittills</div>
                <div className="text-sm font-semibold">{fmt(actual)}</div>
              </div>
              <div className="flex items-baseline justify-between">
                <div className="text-sm text-muted-foreground">Kvar till budget</div>
                <div className="text-sm font-semibold flex items-center gap-1">
                  {remaining > 0 ? <TrendingDown className="size-3.5 text-orange-500" /> : <TrendingUp className="size-3.5 text-emerald-500" />}
                  {fmt(remaining)}
                </div>
              </div>
              <Progress value={pct} />
            </div>

            {isCurrentYear && mBudget > 0 && (
              <div className="pt-3 border-t space-y-2">
                <div className="text-[10px] text-muted-foreground uppercase tracking-wider">Denna månad</div>
                <div className="grid grid-cols-3 gap-4">
                  <div>
                    <div className="text-[10px] text-muted-foreground">Budget</div>
                    <div className="text-sm font-semibold">{fmt(mBudget)}</div>
                  </div>
                  <div>
                    <div className="text-[10px] text-muted-foreground">Sålt</div>
                    <div className="text-sm font-semibold">{fmt(mActual)}</div>
                  </div>
                  <div>
                    <div className="text-[10px] text-muted-foreground">Kvar</div>
                    <div className="text-sm font-semibold">{fmt(mRemaining)}</div>
                  </div>
                </div>
                <Progress value={mPct} />
              </div>
            )}
          </Card>
        );
      })}
    </div>
  );
}
