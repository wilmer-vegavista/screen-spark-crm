import { createFileRoute, redirect } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";
import { format } from "date-fns";
import { supabase } from "@/integrations/supabase/client";
import { PageHeader } from "@/components/page-header";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { FileDown } from "lucide-react";
import { CashflowGrid } from "@/components/fortnox/cashflow-grid";
import { CashflowPlan } from "@/components/fortnox/cashflow-plan";
import { CashflowRules } from "@/components/fortnox/cashflow-rules";
import {
  buildGrid,
  fetchAccountMap,
  fetchAccounts,
  fetchCashPosition,
  fetchCashflow,
  fetchCashflowHealth,
  fetchCashflowItems,
  fetchCashflowRows,
  fetchFinancialYears,
  fetchPlan,
  fetchRevenueRules,
  fetchUnmappedAccounts,
  fiscalYearLabel,
  KR0,
} from "@/lib/fortnox/cashflow";
import { generateCashflowPdf } from "@/lib/fortnox/cashflow-pdf";

// Kassaflöde (round two): Filip's liquidity tab as a page in the CRM — his rows, the fiscal
// year's twelve months and Summa. Closed months are actuals from the general ledger; months
// ahead are forecasts from the customer invoices' due dates, the order book, the open
// supplier invoices, the VAT and payroll postings and the recurring plan Filip edits here.
// Admin-only, gated like kundreskontra.tsx; every figure comes from fortnox.v_cashflow and
// fortnox.v_cash_position with the admin's session, every edit goes through fortnox-sync.
// Erik's file.

export const Route = createFileRoute("/_authenticated/kassaflode")({
  beforeLoad: async () => {
    const { data: u } = await supabase.auth.getUser();
    if (!u.user) throw redirect({ to: "/auth" });
    const { data: roles } = await supabase
      .from("user_roles")
      .select("role")
      .eq("user_id", u.user.id);
    if (!(roles ?? []).some((r) => r.role === "admin")) {
      throw redirect({ to: "/dashboard" });
    }
  },
  component: KassaflodePage,
});

const when = (iso: string | null | undefined) => (iso ? format(new Date(iso), "yyyy-MM-dd HH:mm") : "–");

function KassaflodePage() {
  const qc = useQueryClient();
  const [fyFrom, setFyFrom] = useState<string>("");
  const [tab, setTab] = useState("kassaflode");

  const years = useQuery({ queryKey: ["fortnox-cashflow-years"], queryFn: fetchFinancialYears });
  const rows = useQuery({ queryKey: ["fortnox-cashflow-rows"], queryFn: fetchCashflowRows });
  const health = useQuery({ queryKey: ["fortnox-cashflow-health"], queryFn: fetchCashflowHealth });

  // Default to the fiscal year containing today, else the latest one.
  useEffect(() => {
    if (fyFrom || !years.data?.length) return;
    const today = new Date().toISOString().slice(0, 10);
    const current = years.data.find((y) => y.from_date <= today && today <= y.to_date) ?? years.data[0];
    setFyFrom(current.from_date);
  }, [years.data, fyFrom]);

  const fy = years.data?.find((y) => y.from_date === fyFrom);
  // The four heavy views (v_cashflow, v_cash_position, v_cashflow_items, v_unmapped_accounts:
  // 1.4–2.5 s each on the real ledger) are read two at a time, never all at once. Side by side
  // they passed the database's 8 s statement timeout on 11 Sept and came back 500 until a retry;
  // a tab switch refetched them all together again, so they do not refetch on focus.
  const heavy = { refetchOnWindowFocus: false } as const;
  const cells = useQuery({ queryKey: ["fortnox-cashflow", fyFrom], queryFn: () => fetchCashflow(fyFrom), enabled: Boolean(fyFrom), ...heavy });
  const position = useQuery({ queryKey: ["fortnox-cash-position", fyFrom], queryFn: () => fetchCashPosition(fyFrom), enabled: Boolean(fyFrom), ...heavy });
  const gridRead = cells.isFetched && position.isFetched;
  const items = useQuery({
    queryKey: ["fortnox-cashflow-items", fyFrom],
    queryFn: () => fetchCashflowItems(fyFrom, fy?.to_date ?? fyFrom),
    enabled: Boolean(fyFrom && fy) && gridRead,
    ...heavy,
  });
  const plan = useQuery({ queryKey: ["fortnox-cashflow-plan"], queryFn: fetchPlan });
  const accountMap = useQuery({ queryKey: ["fortnox-account-map"], queryFn: fetchAccountMap });
  const rules = useQuery({ queryKey: ["fortnox-revenue-rules"], queryFn: fetchRevenueRules });
  const unmapped = useQuery({
    queryKey: ["fortnox-unmapped-accounts"],
    queryFn: fetchUnmappedAccounts,
    enabled: gridRead && items.isFetched,
    ...heavy,
  });
  const accounts = useQuery({ queryKey: ["fortnox-accounts"], queryFn: fetchAccounts });

  const grid = useMemo(
    () => (rows.data && cells.data && position.data?.length ? buildGrid(rows.data, cells.data, position.data) : null),
    [rows.data, cells.data, position.data],
  );

  // After an edit: the light reads together, then the heavy ones in the same pairs as on load.
  const invalidateAll = async () => {
    const refresh = (...keys: string[]) => Promise.all(keys.map((key) => qc.invalidateQueries({ queryKey: [key] })));
    await refresh("fortnox-cashflow-plan", "fortnox-account-map", "fortnox-revenue-rules", "fortnox-cashflow-health");
    await refresh("fortnox-cashflow", "fortnox-cash-position");
    await refresh("fortnox-cashflow-items", "fortnox-unmapped-accounts");
  };

  const h = health.data;
  const unmappedCount = unmapped.data?.length ?? 0;
  const syncedLabel = h
    ? `Huvudboken synkad ${when(h.ledger_synced_at)} (t.o.m. ${h.ledger_synced_to ?? "–"}) · kundfakturor ${when(h.invoices_synced_at)} · ${h.postings_total} verifikationsrader, ${h.supplier_invoices_total} leverantörsfakturor (${h.supplier_invoices_open} öppna, ${h.supplier_invoices_overdue} förfallna)`
    : health.error
      ? `Synkstatus kunde inte läsas: ${(health.error as Error).message}`
      : "Hämtar synkstatus…";
  const loading = years.isLoading || rows.isLoading || cells.isLoading || position.isLoading;
  const error = years.error ?? rows.error ?? cells.error ?? position.error;
  const months = position.data?.map((p) => p.month) ?? [];
  const current = position.data?.find((p) => p.month_kind === "current");

  return (
    <>
      <PageHeader
        title="Kassaflöde"
        description="Filips likviditetsflik i CRM:et: rader per kategori, tolv månader, pengar in / pengar ut / kassa. Passerade månader från huvudboken, månader framåt som prognos."
        actions={
          <>
            <div className="space-y-1">
              <Label className="text-xs">Räkenskapsår</Label>
              <Select value={fyFrom} onValueChange={setFyFrom}>
                <SelectTrigger className="w-56">
                  <SelectValue placeholder="Räkenskapsår" />
                </SelectTrigger>
                <SelectContent>
                  {(years.data ?? []).map((y) => (
                    <SelectItem key={y.from_date} value={y.from_date}>
                      {fiscalYearLabel(y)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <Button
              variant="outline"
              disabled={!grid || !fy}
              onClick={() => grid && fy && generateCashflowPdf({ title: "Kassaflöde", fiscalYearLabel: fiscalYearLabel(fy), syncedLabel, grid })}
            >
              <FileDown className="size-4 mr-1" /> Ladda ner PDF
            </Button>
          </>
        }
      />
      <div className="p-6 space-y-4">
        {(h?.dev_fake_payments || h?.dev_fake_supplier_payments) && (
          <Card className="p-3 text-xs text-destructive" data-banner="dev">
            DEV: betalningarna är fejkade i dev-projektets tabeller (testbolagets integration saknar rättigheten payment) – kundfakturor
            {h.dev_fake_supplier_payments ? " och leverantörsfakturor" : ""} står som betalda här och som bankverifikationer i testbolaget, men inte
            som betalningar i Fortnox. Er integration registrerar riktiga betalningar.
          </Card>
        )}
        <Card className="p-3 text-xs text-muted-foreground flex flex-wrap gap-x-4 gap-y-1 items-center" data-banner="sync">
          <span>{syncedLabel}</span>
          {unmappedCount > 0 && (
            <Badge variant="outline" className="cursor-pointer" onClick={() => setTab("regler")}>
              {unmappedCount} okopplade konton
            </Badge>
          )}
          {h && (
            <span>
              Momsperiod: {h.vat_period === "monthly" ? "månad" : h.vat_period === "quarterly" ? "kvartal" : "helår"}, betalas {h.vat_lag_months} mån efter · kassakonton {h.cash_accounts}
            </span>
          )}
          {current && (
            <span>
              Innevarande månad {current.month.slice(0, 7)}: utfall hittills in {KR0(current.income_actual)} / ut {KR0(current.outflow_actual)} kr
            </span>
          )}
        </Card>

        {error && <Card className="p-4 text-sm text-destructive">Kunde inte läsa kassaflödet: {(error as Error).message}</Card>}
        {!error && loading && <Card className="p-8 text-center text-sm text-muted-foreground">Hämtar…</Card>}
        {!error && !loading && years.data?.length === 0 && (
          <Card className="p-8 text-center text-sm text-muted-foreground">Inga räkenskapsår lästa ännu – kör Synka nu på Fortnox-koppling först</Card>
        )}

        {grid && fy && (
          <Tabs value={tab} onValueChange={setTab}>
            <TabsList>
              <TabsTrigger value="kassaflode">Kassaflöde</TabsTrigger>
              <TabsTrigger value="plan">Plan</TabsTrigger>
              <TabsTrigger value="regler">
                Regler &amp; konton{unmappedCount > 0 ? <Badge variant="secondary" className="ml-1">{unmappedCount}</Badge> : null}
              </TabsTrigger>
            </TabsList>
            <TabsContent value="kassaflode" className="pt-4 space-y-3">
              <Card className="overflow-hidden">
                <CashflowGrid grid={grid} items={items.data ?? []} />
              </Card>
              <div className="text-xs text-muted-foreground space-y-1">
                <div>
                  <b>Så läses rutnätet.</b> Stängda månader visar bara utfall från huvudboken (pengar in = kundfakturor betalda den månaden per kategori,
                  pengar ut = leverantörsfakturor betalda den månaden per konto och övriga bankrörelser per motkonto; lönekörningens bankrad är Löner,
                  skattebetalningen Arbetsgivaravgifter &amp; skatt, momsavstämningen Moms att betala). Månader framåt är <i>kursiva</i>: kända fakturor
                  på förfallodatum, orderbokens planerade delfakturor (<span className="text-muted-foreground/60 italic">ljusare</span>, ej fakturerade)
                  och planen som golv. Innevarande månad = utfall hittills + prognos för resten. Momsraderna: verklig moms i stängda månader, 25 % av
                  raderna i prognosen, som i arbetsboken. Håll muspekaren över en siffra för underlaget. Under Kassa (månadsslutet) står huvudbokens
                  banksaldo för stängda månader.
                </div>
              </div>
            </TabsContent>
            <TabsContent value="plan" className="pt-4">
              <CashflowPlan plan={plan.data ?? []} months={months} position={position.data?.[0]} onChanged={invalidateAll} />
            </TabsContent>
            <TabsContent value="regler" className="pt-4">
              <CashflowRules
                rules={rules.data ?? []}
                accountMap={accountMap.data ?? []}
                unmapped={unmapped.data ?? []}
                accounts={accounts.data ?? []}
                rows={rows.data ?? []}
                health={h ?? null}
                onChanged={invalidateAll}
              />
            </TabsContent>
          </Tabs>
        )}
      </div>
    </>
  );
}
