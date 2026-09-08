/**
 * Erik's frontend helpers for the Fortnox ledger (round one). Reads the `fortnox` schema's
 * views through the CRM's own Supabase client with the user's session: the views are
 * security_invoker and every row comes from fortnox.invoices, whose policy is admin-only,
 * so a non-admin gets zero rows (never an error). The generated Database types do not
 * know the `fortnox` schema — the client is widened once, here, and nowhere else.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { supabase } from "@/integrations/supabase/client";

/** fortnox.v_ledger — Filip's eleven columns plus what the page and the report need. */
export interface LedgerRow {
  document_number: string;
  saljare: string | null;
  projekt: string | null;
  kundnamn: string | null;
  fakturadatum: string;
  forfallodatum: string | null;
  belopp_ex_moms: number;
  moms: number;
  totalt: number;
  betald: boolean;
  sald: boolean;
  inlagd_i_rapport: boolean;
  kvar_att_betala: number;
  forfallen: boolean;
  cancelled: boolean;
  credit: boolean;
  credit_invoice_reference: string | null;
  invoice_type: string | null;
  booked: boolean;
  sent: boolean;
  final_pay_date: string | null;
  currency: string;
  customer_number: string;
  fortnox_customer_name: string | null;
  project_number: string | null;
  our_reference: string | null;
  external_reference: string | null;
  order_id: string | null;
  candidate_order_id: string | null;
  match_status: "unmatched" | "proposed" | "linked" | "ignored";
  match_confidence: string;
  match_method: string;
  match_reason: string | null;
  matched_by: string | null;
  matched_at: string | null;
  installment_no: number | null;
  installments_planned: number | null;
  installments_invoiced: number | null;
  planned_installment_amount: number | null;
  billing_frequency: string | null;
  seller_id: string | null;
  product_id: string | null;
  customer_id: string | null;
  synced_at: string;
  lastmodified_seen_at: string | null;
}

/** fortnox.v_order_invoice_state — one row per order with at least one matched invoice. */
export interface OrderInvoiceState {
  order_id: string;
  invoices_matched: number;
  invoices_paid: number;
  invoices_overdue: number;
  invoices_open: number;
  credit_notes: number;
  next_due_date: string | null;
  last_invoice_date: string | null;
  amount_invoiced: number;
  amount_paid: number;
  balance_open: number;
  installments_planned: number;
  planned_installment_amount: number;
  billing_frequency: string | null;
  synced_at: string | null;
}

/** fortnox.health — the round-one columns the ledger page shows. */
export interface LedgerHealth {
  invoices_synced_at: string | null;
  last_run_claude_used: boolean | null;
  last_run_at: string | null;
  last_run_status: string | null;
  invoices_total: number;
  invoices_linked: number;
  invoices_proposed: number;
  invoices_unmatched: number;
  invoices_ignored: number;
  invoices_paid: number;
  invoices_overdue: number;
  dev_fake_payments: boolean;
  feed_rotated_at: string | null;
}

/** The CRM's client, widened to reach the fortnox schema (the generated types stop at public). */
export const fortnoxSchema = () => (supabase as unknown as SupabaseClient).schema("fortnox");

const numeric = (v: unknown): number => (v === null || v === undefined ? 0 : Number(v));

function toLedgerRow(r: Record<string, unknown>): LedgerRow {
  return {
    ...(r as unknown as LedgerRow),
    belopp_ex_moms: numeric(r.belopp_ex_moms),
    moms: numeric(r.moms),
    totalt: numeric(r.totalt),
    kvar_att_betala: numeric(r.kvar_att_betala),
    planned_installment_amount:
      r.planned_installment_amount === null ? null : numeric(r.planned_installment_amount),
  };
}

/** Every ledger row with an invoice date in the year (PostgREST returns numerics as strings; fixed here). */
export async function fetchLedgerYear(year: number): Promise<LedgerRow[]> {
  const { data, error } = await fortnoxSchema()
    .from("v_ledger")
    .select("*")
    .gte("fakturadatum", `${year}-01-01`)
    .lte("fakturadatum", `${year}-12-31`)
    .order("fakturadatum", { ascending: false })
    .order("document_number", { ascending: false });
  if (error) throw new Error(error.message);
  return ((data ?? []) as Record<string, unknown>[]).map(toLedgerRow);
}

/** Every ledger row that still needs a person (proposed / unmatched / ignored), any year. */
export async function fetchLedgerLeftovers(): Promise<LedgerRow[]> {
  const { data, error } = await fortnoxSchema()
    .from("v_ledger")
    .select("*")
    .neq("match_status", "linked")
    .eq("cancelled", false)
    .order("fakturadatum", { ascending: false });
  if (error) throw new Error(error.message);
  return ((data ?? []) as Record<string, unknown>[]).map(toLedgerRow);
}

export async function fetchOrderInvoiceStates(): Promise<OrderInvoiceState[]> {
  const { data, error } = await fortnoxSchema().from("v_order_invoice_state").select("*");
  if (error) throw new Error(error.message);
  return ((data ?? []) as Record<string, unknown>[]).map((r) => ({
    ...(r as unknown as OrderInvoiceState),
    amount_invoiced: numeric(r.amount_invoiced),
    amount_paid: numeric(r.amount_paid),
    balance_open: numeric(r.balance_open),
    planned_installment_amount: numeric(r.planned_installment_amount),
  }));
}

export async function fetchLedgerHealth(): Promise<LedgerHealth | null> {
  const { data, error } = await fortnoxSchema()
    .from("health")
    .select(
      "invoices_synced_at, last_run_claude_used, last_run_at, last_run_status, invoices_total, invoices_linked, invoices_proposed, invoices_unmatched, invoices_ignored, invoices_paid, invoices_overdue, dev_fake_payments, feed_rotated_at",
    )
    .maybeSingle();
  if (error) throw new Error(error.message);
  return (data as LedgerHealth | null) ?? null;
}

// ---------------------------------------------------------------- labels

export const SEK0 = (n: number) =>
  new Intl.NumberFormat("sv-SE", {
    style: "currency",
    currency: "SEK",
    maximumFractionDigits: 0,
  }).format(n || 0);

export const SEK2 = (n: number) =>
  new Intl.NumberFormat("sv-SE", {
    style: "decimal",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(n || 0);

/** "delfaktura 3/12" for an instalment row, "engångsfaktura" for a one-off, "" when unmatched. */
export function installmentLabel(
  r: Pick<LedgerRow, "installment_no" | "installments_planned" | "billing_frequency" | "credit">,
): string {
  if (r.credit) return "kreditfaktura";
  if (r.installment_no == null || r.installments_planned == null) return "";
  if (r.billing_frequency === "engang" || r.installments_planned <= 1) return "engångsfaktura";
  return `delfaktura ${r.installment_no}/${r.installments_planned}`;
}

/** "Fortnox: 8 av 12 fakturerade · 7 betalda · 1 förfallen (förfaller 2026-10-15)" */
export function orderStateLine(s: OrderInvoiceState): string {
  const parts = [
    `${s.invoices_matched} av ${s.installments_planned} fakturerade`,
    `${s.invoices_paid} betalda`,
  ];
  if (s.invoices_overdue > 0) {
    parts.push(`${s.invoices_overdue} ${s.invoices_overdue === 1 ? "förfallen" : "förfallna"}`);
  }
  if (s.invoices_open > 0 && s.next_due_date)
    parts.push(`förfaller ${s.next_due_date.slice(0, 10)}`);
  if (s.credit_notes > 0)
    parts.push(`${s.credit_notes} kreditfaktur${s.credit_notes === 1 ? "a" : "or"}`);
  return `Fortnox: ${parts.join(" · ")}`;
}

/** The planned figure, for the tooltip beside the Fortnox counter. */
export function plannedLine(
  s: Pick<
    OrderInvoiceState,
    "installments_planned" | "planned_installment_amount" | "billing_frequency"
  >,
): string {
  if (s.billing_frequency === "engang" || s.installments_planned <= 1)
    return `Planerat: en faktura à ${SEK0(s.planned_installment_amount)}`;
  return `Planerat: ${s.installments_planned} × ${SEK0(s.planned_installment_amount)}`;
}
