import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useCurrentUser } from "@/lib/hooks/use-current-user";
import { PageHeader } from "@/components/page-header";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { toast } from "sonner";
import { Target } from "lucide-react";

export const Route = createFileRoute("/_authenticated/budget")({
  component: BudgetPage,
});

const fmt = (n: number) =>
  new Intl.NumberFormat("sv-SE", { style: "currency", currency: "SEK", maximumFractionDigits: 0 }).format(n || 0);

type Row = {
  id: string;
  name: string;
  monthly_budget: number;
  quarterly_budget: number;
  half_year_budget: number;
  yearly_budget: number;
};

function BudgetPage() {
  const { isAdmin } = useCurrentUser();
  const qc = useQueryClient();
  const [edits, setEdits] = useState<Record<string, Partial<Row>>>({});

  const { data } = useQuery({
    queryKey: ["budget-page"],
    queryFn: async () => {
      const [{ data: profiles }, { data: roles }, { data: comps }] = await Promise.all([
        supabase.from("profiles").select("id, full_name, email"),
        supabase.from("user_roles").select("user_id, role"),
        supabase.from("seller_compensation").select("*"),
      ]);
      const sellerIds = new Set((roles ?? []).filter(r => r.role === "saljare").map(r => r.user_id));
      const compMap = new Map((comps ?? []).map(c => [c.user_id, c]));
      return (profiles ?? [])
        .filter(p => sellerIds.has(p.id))
        .map<Row>(p => {
          const c: any = compMap.get(p.id);
          return {
            id: p.id,
            name: p.full_name || p.email || "Okänd",
            monthly_budget: Number(c?.monthly_budget ?? 0),
            quarterly_budget: Number(c?.quarterly_budget ?? 0),
            half_year_budget: Number(c?.half_year_budget ?? 0),
            yearly_budget: Number(c?.yearly_budget ?? 0),
          };
        });
    },
  });

  const getVal = (row: Row, key: keyof Row) => {
    const e = edits[row.id];
    if (e && e[key] !== undefined) return String(e[key]);
    return String(row[key]);
  };

  const setVal = (id: string, key: keyof Row, value: string) => {
    setEdits(prev => ({ ...prev, [id]: { ...prev[id], [key]: Number(value) } }));
  };

  const saveRow = async (row: Row) => {
    const e = edits[row.id];
    if (!e) return;
    const payload: any = {
      user_id: row.id,
      monthly_budget: e.monthly_budget ?? row.monthly_budget,
      quarterly_budget: e.quarterly_budget ?? row.quarterly_budget,
      half_year_budget: e.half_year_budget ?? row.half_year_budget,
      yearly_budget: e.yearly_budget ?? row.yearly_budget,
    };
    const { error } = await supabase.from("seller_compensation").upsert(payload);
    if (error) return toast.error(error.message);
    toast.success("Budget sparad");
    setEdits(prev => { const n = { ...prev }; delete n[row.id]; return n; });
    qc.invalidateQueries({ queryKey: ["budget-page"] });
    qc.invalidateQueries({ queryKey: ["dashboard-stats"] });
  };

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
      <PageHeader title="Budget" description="Sätt månads-, kvartals-, halvårs- och årsbudget per säljare" />
      <div className="p-6 space-y-4">
        <Card>
          <div className="p-4 border-b flex items-center gap-2">
            <Target className="size-4 text-muted-foreground" />
            <h3 className="text-sm font-semibold">Säljarbudget</h3>
          </div>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Säljare</TableHead>
                <TableHead className="text-right">Månad</TableHead>
                <TableHead className="text-right">Kvartal</TableHead>
                <TableHead className="text-right">Halvår</TableHead>
                <TableHead className="text-right">År</TableHead>
                <TableHead className="w-24"></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {(data ?? []).map(row => {
                const dirty = !!edits[row.id];
                return (
                  <TableRow key={row.id}>
                    <TableCell className="font-medium">{row.name}</TableCell>
                    <BudgetCell value={getVal(row, "monthly_budget")} onChange={v => setVal(row.id, "monthly_budget", v)} />
                    <BudgetCell value={getVal(row, "quarterly_budget")} onChange={v => setVal(row.id, "quarterly_budget", v)} />
                    <BudgetCell value={getVal(row, "half_year_budget")} onChange={v => setVal(row.id, "half_year_budget", v)} />
                    <BudgetCell value={getVal(row, "yearly_budget")} onChange={v => setVal(row.id, "yearly_budget", v)} />
                    <TableCell className="text-right">
                      <Button size="sm" disabled={!dirty} onClick={() => saveRow(row)}>Spara</Button>
                    </TableCell>
                  </TableRow>
                );
              })}
              {(data ?? []).length === 0 && (
                <TableRow><TableCell colSpan={6} className="text-center text-muted-foreground py-6">Inga säljare ännu</TableCell></TableRow>
              )}
            </TableBody>
          </Table>
        </Card>
        <p className="text-xs text-muted-foreground">
          Tips: vill du t.ex. att kvartalsbudgeten = månad × 3, eller års = månad × 12, kan du fylla i dem manuellt. Värdena är oberoende.
        </p>
      </div>
    </>
  );
}

function BudgetCell({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const [local, setLocal] = useState(value);
  useEffect(() => { setLocal(value); }, [value]);
  return (
    <TableCell className="text-right">
      <Input
        type="number"
        className="text-right h-8 w-32 ml-auto"
        value={local}
        onChange={e => { setLocal(e.target.value); onChange(e.target.value); }}
      />
      <div className="text-[10px] text-muted-foreground mt-0.5">{fmt(Number(value))}</div>
    </TableCell>
  );
}
