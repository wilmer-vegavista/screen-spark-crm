/**
 * The revenue report's data-source switch (round one): planerat / fakturerat / betalt.
 *
 * "Planerat" is the report exactly as Wilmer built it — his CRM data, his schedule
 * expansion, untouched. "Fakturerat" and "betalt" feed the very same computeRows() with
 * data shaped like his: one synthetic one-off order + item per matched Fortnox invoice,
 * dated on the invoice date (fakturadatum — Filip's rule), amount = the invoice's amount
 * ex VAT, screen = the linked project's screen. So the tables, the per-owner split and
 * the detail dialogs all follow the switch without a line of his logic changing.
 *
 *   fakturerat = matched, not cancelled (credit notes included, negative)
 *   betalt     = matched, not cancelled, balance zero (Filip's rule: paid, by invoice date)
 *
 * Invoices nobody has matched to an order are not counted; the switch says how many and
 * how much sit outside, and where to fix it. The "delfaktura X/Y" in a row's name is
 * counted from Fortnox (X = this invoice's rank among the order's invoices, Y = the CRM's
 * planned count).
 */
import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  fetchLedgerHealth,
  fetchLedgerLeftovers,
  fortnoxSchema,
  installmentLabel,
  type LedgerRow,
} from "./ledger";

export type RevenueSource = "planerat" | "fakturerat" | "betalt";

export const REVENUE_SOURCE_LABEL: Record<RevenueSource, string> = {
  planerat: "Planerat (CRM:ets plan)",
  fakturerat: "Fakturerat (Fortnox)",
  betalt: "Betalt (Fortnox)",
};

/** The shape rapport-ekonomi.tsx's query returns and computeRows() consumes. */
export interface CrmReportData {
  products: unknown[];
  orders: Record<string, unknown>[];
  items: Record<string, unknown>[];
}

const PERIOD_UNIT: Record<string, string> = {
  manad: "manader",
  kvartal: "manader",
  halvar: "manader",
};
const PERIOD_WEEKS: Record<string, number> = { manad: 1, kvartal: 3, halvar: 6 };

/** computeRows()-shaped data built from the ledger: one one-off order and one item per invoice. */
export function ledgerAsReportData(
  crm: CrmReportData,
  rows: LedgerRow[],
  source: RevenueSource,
): CrmReportData {
  const orderById = new Map(crm.orders.map((o) => [String(o.id), o]));
  const itemsByOrder = new Map<string, Record<string, unknown>[]>();
  for (const it of crm.items) {
    const k = String(it.order_id);
    itemsByOrder.set(k, [...(itemsByOrder.get(k) ?? []), it]);
  }
  const orders: Record<string, unknown>[] = [];
  const items: Record<string, unknown>[] = [];
  for (const r of rows) {
    if (r.cancelled || r.match_status !== "linked" || !r.order_id) continue;
    if (source === "betalt" && !r.betald) continue;
    const real = orderById.get(r.order_id);
    const id = `fortnox:${r.document_number}`;
    const label = installmentLabel(r);
    orders.push({
      id,
      company_name: `${r.kundnamn ?? r.fortnox_customer_name ?? "Okänd kund"}${label ? ` (${label})` : ""}`,
      invoice_start_date: r.fakturadatum.slice(0, 10),
      created_at: r.fakturadatum.slice(0, 10),
      status: "fakturerad",
      billing_frequency: "engang",
      billing_duration_months: Number(real?.billing_duration_months ?? 1) || 1,
      selected_weeks: (real?.selected_weeks as number[] | undefined) ?? [],
      exact_dates: (real?.exact_dates as string[] | undefined) ?? [],
    });
    const orderItems = itemsByOrder.get(r.order_id) ?? [];
    const crmItem =
      orderItems.find((it) => it.product_id && it.product_id === r.product_id) ?? orderItems[0];
    const recurring = Boolean(r.billing_frequency && r.billing_frequency !== "engang");
    const weeks = recurring
      ? (PERIOD_WEEKS[r.billing_frequency!] ?? 1)
      : Math.max(1, Number(crmItem?.weeks ?? 1) || 1);
    items.push({
      order_id: id,
      product_id: r.product_id,
      product_name:
        r.projekt ?? (r.project_number ? `Fortnox-projekt ${r.project_number}` : "Utan projekt"),
      // total = unit_price × weeks must equal the invoice's amount ex VAT.
      unit_price: r.belopp_ex_moms / weeks,
      weeks,
      sov_pct: crmItem?.sov_pct ?? null,
      impressions: crmItem?.impressions ?? null,
      period_unit: recurring
        ? PERIOD_UNIT[r.billing_frequency!]
        : (crmItem?.period_unit ?? "veckor"),
    });
  }
  return { products: crm.products, orders, items };
}

async function fetchAllLedgerRows(): Promise<LedgerRow[]> {
  const { data, error } = await fortnoxSchema().from("v_ledger").select("*").order("fakturadatum");
  if (error) throw new Error(error.message);
  return ((data ?? []) as Record<string, unknown>[]).map((r) => ({
    ...(r as unknown as LedgerRow),
    belopp_ex_moms: Number(r.belopp_ex_moms ?? 0),
    moms: Number(r.moms ?? 0),
    totalt: Number(r.totalt ?? 0),
    kvar_att_betala: Number(r.kvar_att_betala ?? 0),
  }));
}

export interface RevenueSourceState {
  source: RevenueSource;
  setSource: (s: RevenueSource) => void;
  /** The data to hand computeRows(): the CRM's own for planerat, the ledger-shaped one otherwise. */
  data: CrmReportData | undefined;
  isLoading: boolean;
  error: string | null;
  leftovers: LedgerRow[];
  syncedAt: string | null;
  claudeUsed: boolean | null;
  devFakePayments: boolean;
}

/** The hook rapport-ekonomi.tsx calls once; `data` replaces its own `data` downstream. */
export function useRevenueSource(crm: CrmReportData | undefined): RevenueSourceState {
  const [source, setSource] = useState<RevenueSource>("planerat");
  const active = source !== "planerat";
  const ledger = useQuery({
    queryKey: ["fortnox-ledger-all"],
    queryFn: fetchAllLedgerRows,
    enabled: active,
    retry: false,
  });
  const leftovers = useQuery({
    queryKey: ["fortnox-ledger-leftovers"],
    queryFn: fetchLedgerLeftovers,
    enabled: active,
    retry: false,
  });
  const health = useQuery({
    queryKey: ["fortnox-ledger-health"],
    queryFn: fetchLedgerHealth,
    enabled: active,
    retry: false,
  });
  const data = useMemo(() => {
    if (!active) return crm;
    if (!crm || !ledger.data) return undefined;
    return ledgerAsReportData(crm, ledger.data, source);
  }, [active, crm, ledger.data, source]);
  return {
    source,
    setSource,
    data,
    isLoading: active && ledger.isLoading,
    error: active && ledger.error ? (ledger.error as Error).message : null,
    leftovers: leftovers.data ?? [],
    syncedAt: health.data?.invoices_synced_at ?? null,
    claudeUsed: health.data?.last_run_claude_used ?? null,
    devFakePayments: health.data?.dev_fake_payments ?? false,
  };
}
