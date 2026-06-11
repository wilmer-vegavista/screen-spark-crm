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
import { toast } from "sonner";
import { Target, Calculator } from "lucide-react";

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
        <SellersList year={year} />
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
