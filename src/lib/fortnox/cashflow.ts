/**
 * Erik's frontend helpers for the cash-flow page (round two). Reads the `fortnox` schema's
 * views with the user's session (security_invoker, admin-only policies → a non-admin gets
 * zero rows); every edit goes through the fortnox-sync function with the admin's session.
 *
 * The grid is built here exactly as Filip's workbook computes it (rows 6–55): the source
 * rows and the two VAT rows come from fortnox.v_cashflow (value per month), the opening
 * cash from fortnox.v_cash_position, and the sum rows and the three running cash rows are
 * the workbook's own formulas applied column by column — including the "Inför start"
 * column that carries Kassa årets ingång into the first month.
 */
import { supabase } from "@/integrations/supabase/client";
import { fortnoxSchema } from "@/lib/fortnox/ledger";

// ---------------------------------------------------------------- shapes of the views

export type MonthKind = "closed" | "current" | "ahead";

export interface CashflowRowDef {
  key: string;
  label: string;
  section: "cash" | "in" | "out" | "out2";
  kind: "balance" | "header" | "source" | "vat_out" | "vat_in" | "opening" | "sum";
  position: number;
  income: boolean;
  vat_bearing: boolean;
  plan_enabled: boolean;
}

/** fortnox.v_cashflow — one row per fed row × month. */
export interface CashflowCell {
  financial_year_id: number;
  fy_from: string;
  fy_to: string;
  month: string;
  row_key: string;
  label: string;
  position: number;
  section: CashflowRowDef["section"];
  kind: CashflowRowDef["kind"];
  income: boolean;
  vat_bearing: boolean;
  plan_enabled: boolean;
  month_kind: MonthKind;
  actual: number;
  forecast_invoiced: number;
  forecast_planned: number;
  liability: number;
  plan: number | null;
  plan_overridden: boolean;
  plan_source: string | null;
  value: number;
}

/** fortnox.v_cash_position — one row per month of a fiscal year. */
export interface CashPosition {
  financial_year_id: number;
  fy_from: string;
  fy_to: string;
  month: string;
  month_end: string;
  month_kind: MonthKind | null;
  opening_cash: number;
  opening_overridden: boolean;
  opening_ledger: number;
  opening_ledger_source: "ib" | "previous_ub" | "none";
  income_total: number;
  outflow_total: number;
  income_actual: number;
  outflow_actual: number;
  computed_end: number;
  ledger_bank_in: number;
  ledger_bank_out: number;
  ledger_bank_end: number;
  has_postings: boolean;
}

/** fortnox.v_cashflow_items — a cell's makeup. */
export interface CashflowItem {
  bucket: "actual" | "forecast_invoiced" | "forecast_planned" | "liability";
  source: "invoice" | "supplier_invoice" | "posting" | "order";
  ref: string;
  month: string;
  date: string;
  row_key: string;
  amount: number;
  label: string;
}

export interface FinancialYearRow {
  id: number;
  from_date: string;
  to_date: string;
  accounting_method: string | null;
}

export interface PlanMonth {
  month: string;
  amount: number;
  note: string | null;
  updated_at: string;
  updated_by_name: string | null;
}

/** fortnox.v_cashflow_plan */
export interface PlanRow {
  row_key: string;
  label: string;
  position: number;
  section: string;
  plan_enabled: boolean;
  amount: number | null;
  source: "ledger" | "manual" | null;
  basis: string | null;
  updated_at: string | null;
  updated_by_name: string | null;
  months: PlanMonth[];
}

export interface AccountMapRow {
  id: number;
  account: number | null;
  account_to: number | null;
  supplier_match: string | null;
  row_key: string;
  source: "default" | "manual";
  note: string | null;
  updated_by: string | null;
  updated_at: string;
}

export interface RevenueRule {
  id: number;
  priority: number;
  kind: "seller" | "project" | "screen_type" | "billing" | "default";
  match_value: string | null;
  row_key: string;
  source: "default" | "manual";
  note: string | null;
  updated_at: string;
}

export interface UnmappedAccount {
  account: number;
  description: string | null;
  amount: number;
  postings: number;
  first_date: string;
  last_date: string;
  sources: string[];
}

export interface AccountRow {
  account: number;
  description: string;
}

export interface CashflowHealth {
  last_run_at: string | null;
  last_run_status: string | null;
  invoices_synced_at: string | null;
  ledger_synced_at: string | null;
  ledger_synced_to: string | null;
  dev_fake_payments: boolean;
  dev_fake_supplier_payments: boolean;
  vat_period: "monthly" | "quarterly" | "yearly";
  vat_lag_months: number;
  cash_accounts: string;
  suppliers_total: number;
  supplier_invoices_total: number;
  supplier_invoices_open: number;
  supplier_invoices_overdue: number;
  postings_total: number;
  postings_first_date: string | null;
  postings_last_date: string | null;
  financial_years_total: number;
  cashflow_plan_edited_at: string | null;
}

// ---------------------------------------------------------------- reads

const n = (v: unknown): number => (v === null || v === undefined ? 0 : Number(v));
const nOrNull = (v: unknown): number | null => (v === null || v === undefined ? null : Number(v));
const day = (v: unknown): string => String(v ?? "").slice(0, 10);

function fail(error: { message: string } | null) {
  if (error) throw new Error(error.message);
}

export async function fetchFinancialYears(): Promise<FinancialYearRow[]> {
  const { data, error } = await fortnoxSchema().from("financial_years").select("*").order("from_date", { ascending: false });
  fail(error);
  return ((data ?? []) as Record<string, unknown>[]).map((r) => ({
    id: n(r.id),
    from_date: day(r.from_date),
    to_date: day(r.to_date),
    accounting_method: (r.accounting_method as string | null) ?? null,
  }));
}

export async function fetchCashflowRows(): Promise<CashflowRowDef[]> {
  const { data, error } = await fortnoxSchema().from("cashflow_rows").select("*").order("position");
  fail(error);
  return (data ?? []) as CashflowRowDef[];
}

export async function fetchCashflow(fyFrom: string): Promise<CashflowCell[]> {
  const { data, error } = await fortnoxSchema().from("v_cashflow").select("*").eq("fy_from", fyFrom).order("position").order("month");
  fail(error);
  return ((data ?? []) as Record<string, unknown>[]).map((r) => ({
    ...(r as unknown as CashflowCell),
    month: day(r.month),
    fy_from: day(r.fy_from),
    fy_to: day(r.fy_to),
    actual: n(r.actual),
    forecast_invoiced: n(r.forecast_invoiced),
    forecast_planned: n(r.forecast_planned),
    liability: n(r.liability),
    plan: nOrNull(r.plan),
    value: n(r.value),
  }));
}

export async function fetchCashPosition(fyFrom: string): Promise<CashPosition[]> {
  const { data, error } = await fortnoxSchema().from("v_cash_position").select("*").eq("fy_from", fyFrom).order("month");
  fail(error);
  return ((data ?? []) as Record<string, unknown>[]).map((r) => ({
    ...(r as unknown as CashPosition),
    month: day(r.month),
    month_end: day(r.month_end),
    fy_from: day(r.fy_from),
    fy_to: day(r.fy_to),
    opening_cash: n(r.opening_cash),
    opening_ledger: n(r.opening_ledger),
    income_total: n(r.income_total),
    outflow_total: n(r.outflow_total),
    income_actual: n(r.income_actual),
    outflow_actual: n(r.outflow_actual),
    computed_end: n(r.computed_end),
    ledger_bank_in: n(r.ledger_bank_in),
    ledger_bank_out: n(r.ledger_bank_out),
    ledger_bank_end: n(r.ledger_bank_end),
  }));
}

/** Every item of a fiscal year (the hover reads them by month and row). */
export async function fetchCashflowItems(fyFrom: string, fyTo: string): Promise<CashflowItem[]> {
  const { data, error } = await fortnoxSchema()
    .from("v_cashflow_items")
    .select("*")
    .gte("month", fyFrom)
    .lte("month", fyTo)
    .order("month")
    .order("date");
  fail(error);
  return ((data ?? []) as Record<string, unknown>[]).map((r) => ({
    ...(r as unknown as CashflowItem),
    month: day(r.month),
    date: day(r.date),
    amount: n(r.amount),
  }));
}

export async function fetchPlan(): Promise<PlanRow[]> {
  const { data, error } = await fortnoxSchema().from("v_cashflow_plan").select("*").order("position");
  fail(error);
  return ((data ?? []) as Record<string, unknown>[]).map((r) => ({
    ...(r as unknown as PlanRow),
    amount: nOrNull(r.amount),
    months: ((r.months as PlanMonth[] | null) ?? []).map((m) => ({ ...m, month: day(m.month), amount: n(m.amount) })),
  }));
}

export async function fetchAccountMap(): Promise<AccountMapRow[]> {
  const { data, error } = await fortnoxSchema().from("account_map").select("*").order("supplier_match", { nullsFirst: false }).order("account");
  fail(error);
  return (data ?? []) as AccountMapRow[];
}

export async function fetchRevenueRules(): Promise<RevenueRule[]> {
  const { data, error } = await fortnoxSchema().from("revenue_rules").select("*").order("priority").order("id");
  fail(error);
  return (data ?? []) as RevenueRule[];
}

export async function fetchUnmappedAccounts(): Promise<UnmappedAccount[]> {
  const { data, error } = await fortnoxSchema().from("v_unmapped_accounts").select("*").order("account");
  fail(error);
  return ((data ?? []) as Record<string, unknown>[]).map((r) => ({
    ...(r as unknown as UnmappedAccount),
    amount: n(r.amount),
    postings: n(r.postings),
    first_date: day(r.first_date),
    last_date: day(r.last_date),
  }));
}

export async function fetchAccounts(): Promise<AccountRow[]> {
  const { data, error } = await fortnoxSchema().from("accounts").select("account, description").order("account");
  fail(error);
  return (data ?? []) as AccountRow[];
}

/**
 * The status line's figures. Not unmapped_accounts: that column re-runs v_unmapped_accounts
 * (~2.5 s on the real ledger, 8 201 postings) and made this read ~20 times slower (2.8 s vs
 * 0.15 s as the admin). Next to the page's other heavy reads it then passed the database's 8 s
 * statement timeout, the read failed, and the line said "Synkstatus okänd" (11 Sept 2026).
 * The page counts the unmapped accounts from its own v_unmapped_accounts read instead.
 */
export async function fetchCashflowHealth(): Promise<CashflowHealth | null> {
  const { data, error } = await fortnoxSchema()
    .from("health")
    .select(
      "last_run_at, last_run_status, invoices_synced_at, ledger_synced_at, ledger_synced_to, dev_fake_payments, dev_fake_supplier_payments, vat_period, vat_lag_months, cash_accounts, suppliers_total, supplier_invoices_total, supplier_invoices_open, supplier_invoices_overdue, postings_total, postings_first_date, postings_last_date, financial_years_total, cashflow_plan_edited_at",
    )
    .maybeSingle();
  fail(error);
  return (data as CashflowHealth | null) ?? null;
}

// ---------------------------------------------------------------- the function (edits)

const FUNCTIONS_BASE: string =
  import.meta.env.VITE_FORTNOX_FUNCTIONS_URL || `${import.meta.env.VITE_SUPABASE_URL}/functions/v1`;

/** POST an action to fortnox-sync with the admin's session; the function checks the role again. */
export async function callFortnoxAction<T = { ok: boolean }>(body: Record<string, unknown>): Promise<T> {
  const { data } = await supabase.auth.getSession();
  if (!data.session) throw new Error("Inte inloggad");
  const res = await fetch(`${FUNCTIONS_BASE}/fortnox-sync`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${data.session.access_token}`,
      apikey: import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY ?? "",
    },
    body: JSON.stringify(body),
  });
  const json = (await res.json().catch(() => ({}))) as { error?: string; message?: string };
  if (!res.ok) throw new Error(json.error ?? json.message ?? `Fortnox-funktionen svarade ${res.status}`);
  return json as T;
}

// ---------------------------------------------------------------- formatting

/** "12 500" — the workbook's #,##0 (a plain space, Intl's non-breaking one looks like a box in a PDF). */
export const KR0 = (v: number | null | undefined): string => {
  if (v === null || v === undefined) return "";
  const r = Math.round(v);
  if (r === 0) return "–";
  return new Intl.NumberFormat("sv-SE", { maximumFractionDigits: 0 }).format(r).replace(/\u00a0/g, " ").replace(/−/g, "-");
};

const MONTH_SHORT = ["JAN.", "FEB.", "MARS", "APR.", "MAJ", "JUNI", "JULI", "AUG.", "SEP.", "OKT.", "NOV.", "DEC."];

/** The workbook's month header: UPPER(TEXT(date, "MMM")) in Swedish. */
export const monthHeader = (isoMonth: string): string => MONTH_SHORT[Number(isoMonth.slice(5, 7)) - 1] ?? isoMonth;

export const monthLong = (isoMonth: string): string =>
  new Date(`${isoMonth.slice(0, 7)}-01T00:00:00`).toLocaleDateString("sv-SE", { month: "long", year: "numeric" });

export const fiscalYearLabel = (fy: { from_date: string; to_date: string }): string =>
  fy.from_date.slice(5, 7) === "01" && fy.to_date.slice(5, 7) === "12"
    ? fy.from_date.slice(0, 4)
    : `${fy.from_date.slice(0, 7)} – ${fy.to_date.slice(0, 7)}`;

// ---------------------------------------------------------------- the grid, as the workbook computes it

export interface GridColumn {
  /** "start" for the workbook's D column, else the month's first day. */
  key: string;
  label: string;
  monthKind: MonthKind | "start";
}

export interface GridCell {
  value: number | null;
  actual: number;
  forecastInvoiced: number;
  forecastPlanned: number;
  liability: number;
  plan: number | null;
  planOverridden: boolean;
  monthKind: MonthKind | "start";
  /** How the cell should read: actual · forecast (invoiced / plan) · planned share present · computed · empty. */
  tone: "actual" | "forecast" | "planned" | "computed" | "empty";
  /** The ledger's own bank balance, on the month-end cash row of a closed or current month. */
  ledgerBalance?: number;
}

export interface GridLine {
  def: CashflowRowDef;
  cells: Record<string, GridCell>;
  total: GridCell;
}

export interface Grid {
  columns: GridColumn[];
  lines: GridLine[];
}

const START = "start";
const empty = (monthKind: GridCell["monthKind"]): GridCell => ({
  value: null,
  actual: 0,
  forecastInvoiced: 0,
  forecastPlanned: 0,
  liability: 0,
  plan: null,
  planOverridden: false,
  monthKind,
  tone: "empty",
});
const computed = (value: number, monthKind: GridCell["monthKind"]): GridCell => ({ ...empty(monthKind), value, tone: "computed" });

function toneOf(c: CashflowCell): GridCell["tone"] {
  if (c.month_kind === "closed") return c.value === 0 ? "empty" : "actual";
  if (c.forecast_planned > 0) return "planned";
  return c.value === 0 && c.actual === 0 ? "empty" : "forecast";
}

/**
 * Filip's grid. Column D ("Inför start") carries Kassa årets ingång; row 6 of month one is
 * D55; each Summa row is the workbook's SUBTOTAL; the Summa column repeats the workbook's
 * R formulas (R6 = P6, the rest sums of the row's D:P, R19 = R6 + SUM(R10:R17), R55 = R19 − R53).
 */
export function buildGrid(defs: CashflowRowDef[], cells: CashflowCell[], positions: CashPosition[]): Grid {
  const months = positions.map((p) => p.month);
  const columns: GridColumn[] = [
    { key: START, label: "(Inför) start", monthKind: START },
    ...positions.map((p) => ({ key: p.month, label: monthHeader(p.month), monthKind: p.month_kind ?? "ahead" })),
  ];
  const kindOf = new Map(positions.map((p) => [p.month, (p.month_kind ?? "ahead") as MonthKind]));
  const opening = positions[0]?.opening_cash ?? 0;
  const byRowMonth = new Map<string, CashflowCell>();
  for (const c of cells) byRowMonth.set(`${c.row_key}|${c.month}`, c);
  const def = (key: string) => defs.find((d) => d.key === key)!;
  const lines = new Map<string, GridLine>();

  const fed = defs.filter((d) => d.kind === "source" || d.kind === "vat_out" || d.kind === "vat_in");
  for (const d of fed) {
    const line: GridLine = { def: d, cells: {}, total: empty("ahead") };
    line.cells[START] = empty(START);
    let sum = 0;
    for (const m of months) {
      const c = byRowMonth.get(`${d.key}|${m}`);
      const mk = kindOf.get(m) ?? "ahead";
      if (!c) {
        line.cells[m] = empty(mk);
        continue;
      }
      line.cells[m] = {
        value: c.value,
        actual: c.actual,
        forecastInvoiced: c.forecast_invoiced,
        forecastPlanned: c.forecast_planned,
        liability: c.liability,
        plan: c.plan,
        planOverridden: c.plan_overridden,
        monthKind: mk,
        tone: toneOf(c),
      };
      sum += c.value;
    }
    line.total = computed(sum, "ahead");
    lines.set(d.key, line);
  }

  // Kassa årets ingång: the D column only.
  {
    const d = def("kassa_arets_ingang");
    const line: GridLine = { def: d, cells: { [START]: { ...computed(opening, START), tone: positions[0]?.opening_overridden ? "forecast" : "actual" } }, total: computed(opening, "ahead") };
    for (const m of months) line.cells[m] = empty(kindOf.get(m) ?? "ahead");
    lines.set(d.key, line);
  }

  const colKeys = [START, ...months];
  const sumOf = (col: string, from: number, to: number): number =>
    defs
      .filter((d) => d.position >= from && d.position <= to && lines.has(d.key) && (d.kind === "source" || d.kind === "vat_out" || d.kind === "vat_in" || d.kind === "opening"))
      .reduce((s, d) => s + (lines.get(d.key)!.cells[col]?.value ?? 0), 0);
  const mk = (col: string): GridCell["monthKind"] => (col === START ? START : (kindOf.get(col) ?? "ahead"));

  const summaIn: GridLine = { def: def("summa_in"), cells: {}, total: empty("ahead") };
  const summaUt: GridLine = { def: def("summa_ut"), cells: {}, total: empty("ahead") };
  const summaEj: GridLine = { def: def("summa_ej_resultat"), cells: {}, total: empty("ahead") };
  const summaUtbet: GridLine = { def: def("summa_utbetalningar"), cells: {}, total: empty("ahead") };
  const kontanta: GridLine = { def: def("kontanta_medel"), cells: {}, total: empty("ahead") };
  const summaKontanta: GridLine = { def: def("summa_kontanta"), cells: {}, total: empty("ahead") };
  const kassaSlut: GridLine = { def: def("kassa_manadsslut"), cells: {}, total: empty("ahead") };

  let previousEnd: number | null = null;
  for (const col of colKeys) {
    const inSum = sumOf(col, 10, 17);
    const outSum = sumOf(col, 23, 42);
    const ejSum = sumOf(col, 47, 51);
    const open: number | null = col === START ? null : (previousEnd ?? 0);
    const before: number = (open ?? 0) + inSum;
    const end: number = before - (outSum + ejSum);
    summaIn.cells[col] = computed(inSum, mk(col));
    summaUt.cells[col] = computed(outSum, mk(col));
    summaEj.cells[col] = computed(ejSum, mk(col));
    summaUtbet.cells[col] = computed(outSum + ejSum, mk(col));
    kontanta.cells[col] = open === null ? empty(START) : computed(open, mk(col));
    summaKontanta.cells[col] = computed(before, mk(col));
    const pos = positions.find((p) => p.month === col);
    kassaSlut.cells[col] = {
      ...computed(end, mk(col)),
      ...(pos && pos.month_kind !== "ahead" && pos.has_postings ? { ledgerBalance: pos.ledger_bank_end } : {}),
    };
    previousEnd = end;
  }
  // The Summa column, the workbook's R formulas.
  const rowTotal = (line: GridLine) => colKeys.reduce((s, c) => s + (line.cells[c].value ?? 0), 0);
  summaIn.total = computed(defs.filter((d) => d.position >= 10 && d.position <= 17 && lines.has(d.key)).reduce((s, d) => s + (lines.get(d.key)!.total.value ?? 0), 0), "ahead");
  summaUt.total = computed(defs.filter((d) => d.position >= 23 && d.position <= 42 && lines.has(d.key)).reduce((s, d) => s + (lines.get(d.key)!.total.value ?? 0), 0), "ahead");
  summaEj.total = computed(defs.filter((d) => d.position >= 47 && d.position <= 51 && lines.has(d.key)).reduce((s, d) => s + (lines.get(d.key)!.total.value ?? 0), 0), "ahead");
  summaUtbet.total = computed((summaUt.total.value ?? 0) + (summaEj.total.value ?? 0), "ahead");
  kontanta.total = computed(kontanta.cells[months[months.length - 1] ?? START]?.value ?? 0, "ahead");
  summaKontanta.total = computed((kontanta.total.value ?? 0) + (summaIn.total.value ?? 0), "ahead");
  kassaSlut.total = computed((summaKontanta.total.value ?? 0) - (summaUtbet.total.value ?? 0), "ahead");
  void rowTotal;

  for (const l of [summaIn, summaUt, summaEj, summaUtbet, kontanta, summaKontanta, kassaSlut]) lines.set(l.def.key, l);
  for (const d of defs.filter((x) => x.kind === "header")) {
    const line: GridLine = { def: d, cells: {}, total: empty("ahead") };
    for (const col of colKeys) line.cells[col] = empty(mk(col));
    lines.set(d.key, line);
  }
  return {
    columns,
    lines: defs.map((d) => lines.get(d.key)).filter((l): l is GridLine => Boolean(l)),
  };
}

/** The items behind one cell, for the hover. */
export function itemsFor(items: CashflowItem[], rowKey: string, month: string): CashflowItem[] {
  return items.filter((i) => i.row_key === rowKey && i.month === month);
}

export const BUCKET_LABEL: Record<CashflowItem["bucket"], string> = {
  actual: "utfall",
  forecast_invoiced: "fakturerat, ej betalt",
  forecast_planned: "planerat (orderboken, ej fakturerat)",
  liability: "bokad skuld, betalas",
};

export const RULE_KIND_LABEL: Record<RevenueRule["kind"], string> = {
  seller: "Säljare börjar med",
  project: "Projekt / skärmkod",
  screen_type: "Skärmtyp",
  billing: "Fakturering",
  default: "Allt annat",
};
