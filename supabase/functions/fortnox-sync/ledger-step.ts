/**
 * The ledger step of a sync run (round two). After the invoices:
 *
 *   1. Financial years → fortnox.financial_years (the page's year selector, the ids every
 *      dated read needs).
 *   2. Suppliers: first run all of them, later the ones changed since the cursor
 *      (lastmodified, widened ten minutes).
 *   3. Supplier invoices: first run every invoice of the current and previous financial
 *      year (InvoiceDate window, clamped per year — a fromdate outside the year is a hard
 *      error), later the ones changed since the cursor. One detail GET per listed invoice
 *      (the list lacks the cost rows and the VAT); Total, VAT and Balance through
 *      requiredNum. Dev only: given numbers listed in fortnox.settings.dev_fake_supplier_payments
 *      are stored paid (balance 0, the listed date) — the test company refuses payments.
 *   4. Postings: the SIE type-4 export per financial year, parsed into one row per voucher
 *      row and replaced whole (fortnox.replace_ledger_year). First run: every financial
 *      year the current and previous one; later runs: the year(s) holding the current and
 *      the previous month (usually one file). The SIE also carries the balances brought
 *      forward and the chart of accounts.
 *   5. The recurring plan's prefill (fortnox.prefill_cashflow_plan): the last three closed
 *      months' average per row, written only where no manual plan exists.
 *
 * Reads only. Nothing here writes to Fortnox.
 */
import type { SupabaseClient } from "npm:@supabase/supabase-js@2.108.1";
import {
  clampToYear,
  type FinancialYear,
  financialYearFor,
  financialYearsCovering,
  getSupplier,
  getSupplierInvoice,
  type GuardedFortnox,
  listFinancialYears,
  listSupplierInvoices,
  listSuppliers,
  parseSupplier,
  parseSupplierInvoice,
  postingsFromSie,
  redact,
  sieForYear,
  type SupplierInvoiceRow,
} from "../_fortnox/mod.ts";

export interface LedgerStepDeps {
  db: SupabaseClient;
  fortnox: GuardedFortnox;
  now: Date;
  /** Re-read the previous financial year's SIE too (a voucher was added to a closed month, or on request). */
  fullLedger?: boolean;
}

export interface LedgerStepResult {
  financialYears: number;
  suppliersRead: number;
  supplierInvoicesRead: number;
  supplierInvoiceDetailReads: number;
  fakeSupplierPaymentsApplied: number;
  /** Financial years whose SIE was read this run, with the posting count per year. */
  yearsRead: Array<{ id: number; from: string; to: string; postings: number; vouchers: number }>;
  postingsRead: number;
  /** The last day the ledger is read up to (the end of the latest month read). */
  syncedTo: string;
  planRowsPrefilled: number;
  mode: "backfill" | "incremental";
  window: string;
}

const CURSOR_KEY = "ledger_cursor";
const SYNCED_AT_KEY = "ledger_synced_at";
const YEARS_READ_KEY = "ledger_years_read";
const FAKE_KEY = "dev_fake_supplier_payments";
const CHUNK = 200;

function must<T>(res: { data: T | null; error: { message: string } | null }, what: string): T {
  if (res.error) throw new Error(`${what}: ${res.error.message}`);
  return res.data as T;
}

async function readSetting(db: SupabaseClient, key: string): Promise<string | null> {
  const res = await db.schema("fortnox").from("settings").select("value").eq("key", key).maybeSingle();
  if (res.error) throw new Error(`read settings.${key}: ${res.error.message}`);
  return (res.data as { value: string } | null)?.value ?? null;
}

async function writeSetting(db: SupabaseClient, key: string, value: string): Promise<void> {
  must(await db.schema("fortnox").from("settings").upsert({ key, value }, { onConflict: "key" }), `write settings.${key}`);
}

const isoDay = (d: Date) => d.toISOString().slice(0, 10);
const monthStart = (day: string) => `${day.slice(0, 7)}-01`;
const previousMonthStart = (day: string): string => {
  const d = new Date(`${monthStart(day)}T00:00:00Z`);
  d.setUTCMonth(d.getUTCMonth() - 1);
  return isoDay(d);
};
const monthEnd = (day: string): string => {
  const d = new Date(`${monthStart(day)}T00:00:00Z`);
  d.setUTCMonth(d.getUTCMonth() + 1);
  d.setUTCDate(0);
  return isoDay(d);
};

/** Fake supplier payments: `[{"given_number":"1","paid_at":"2026-08-29"}]` (dev only). */
export function parseFakeSupplierPayments(raw: string | null): Map<string, string> {
  const out = new Map<string, string>();
  if (!raw) return out;
  const parsed = JSON.parse(raw) as Array<{ given_number?: string; paid_at?: string } | string>;
  for (const p of parsed) {
    if (typeof p === "string") out.set(p, "");
    else if (p.given_number) out.set(String(p.given_number), String(p.paid_at ?? ""));
  }
  return out;
}

/**
 * Which financial years to read the SIE for: on the first run every year among the current
 * and the previous; later the year(s) holding the current and the previous month.
 */
export function yearsToRead(years: FinancialYear[], today: Date, firstRun: boolean): FinancialYear[] {
  const t = isoDay(today);
  const current = financialYearFor(years, t);
  if (!current) return [];
  if (firstRun) {
    const idx = years.findIndex((y) => y.id === current.id);
    return idx > 0 ? [years[idx - 1], current] : [current];
  }
  const prev = financialYearFor(years, previousMonthStart(t));
  return prev && prev.id !== current.id ? [prev, current] : [current];
}

export async function syncLedger(
  deps: LedgerStepDeps,
  dryRun: boolean,
  log: (s: string) => void,
): Promise<LedgerStepResult> {
  const { db, fortnox, now } = deps;
  const fx = db.schema("fortnox");
  const today = isoDay(now);
  const result: LedgerStepResult = {
    financialYears: 0,
    suppliersRead: 0,
    supplierInvoicesRead: 0,
    supplierInvoiceDetailReads: 0,
    fakeSupplierPaymentsApplied: 0,
    yearsRead: [],
    postingsRead: 0,
    syncedTo: monthEnd(today),
    planRowsPrefilled: 0,
    mode: "incremental",
    window: "",
  };

  // ---- 1. financial years
  const years = await listFinancialYears(fortnox);
  if (years.length === 0) throw new Error("Fortnox reports no financial years — the ledger cannot be read.");
  result.financialYears = years.length;
  if (!dryRun) {
    must(
      await fx.from("financial_years").upsert(
        years.map((y) => ({ id: y.id, from_date: y.from, to_date: y.to, accounting_method: y.accountingMethod ?? null, synced_at: now.toISOString() })),
        { onConflict: "id" },
      ),
      "write financial_years",
    );
  }
  log(`Ledger: financial years ${years.map((y) => `${y.id} (${y.from}…${y.to})`).join(", ")}`);

  // ---- 2 + 3. the window
  const cursorRaw = await readSetting(db, CURSOR_KEY);
  const cursor = cursorRaw ? new Date(cursorRaw) : null;
  const firstRun = !cursor || Number.isNaN(cursor.getTime());
  result.mode = firstRun ? "backfill" : "incremental";
  const seenAt = now.toISOString();

  // suppliers
  const suppliers = await listSuppliers(fortnox, firstRun ? undefined : cursor!);
  result.suppliersRead = suppliers.rows.length;
  log(`Suppliers listed: ${suppliers.rows.length} (${suppliers.read.pages} page(s), Fortnox reported ${suppliers.read.reportedTotal})${firstRun ? "" : ` changed since ${cursor!.toISOString()}`}`);
  const supplierRows = [];
  for (const s of suppliers.rows) {
    const detail = await getSupplier(fortnox, String(s.SupplierNumber));
    supplierRows.push({ ...parseSupplier(detail), lastmodified_seen_at: seenAt, synced_at: seenAt });
  }
  if (!dryRun && supplierRows.length) {
    for (let i = 0; i < supplierRows.length; i += CHUNK) {
      must(await fx.from("suppliers").upsert(supplierRows.slice(i, i + CHUNK), { onConflict: "supplier_number" }), "write suppliers");
    }
  }

  // supplier invoices
  let listed: SupplierInvoiceRow[] = [];
  const listedSummaries = [];
  if (firstRun) {
    const idx = years.findIndex((y) => y.from <= today && today <= y.to);
    const current = idx >= 0 ? years[idx] : years[years.length - 1];
    const previous = idx > 0 ? years[idx - 1] : null;
    const from = previous ? previous.from : current.from;
    result.window = `${from}…${current.to}`;
    log(`Supplier invoices: first read — ${result.window}`);
    for (const y of financialYearsCovering(years, from, current.to)) {
      const w = clampToYear(y, from, current.to);
      if (!w) continue;
      const part = await listSupplierInvoices(fortnox, { fromDate: w.from, toDate: w.to });
      listedSummaries.push(...part.rows);
      log(`  ${y.from}…${y.to}: ${part.rows.length} supplier invoice(s) listed (${part.read.pages} page(s), reported ${part.read.reportedTotal})`);
    }
  } else {
    result.window = `changed since ${cursor!.toISOString()}`;
    const part = await listSupplierInvoices(fortnox, { since: cursor! });
    listedSummaries.push(...part.rows);
    log(`Supplier invoices: ${part.rows.length} changed since ${cursor!.toISOString()} (${part.read.pages} page(s))`);
  }
  result.supplierInvoicesRead = listedSummaries.length;
  const fake = parseFakeSupplierPayments(await readSetting(db, FAKE_KEY));
  if (fake.size) log(`DEV ONLY: ${fake.size} fake supplier payment(s) configured in fortnox.settings.${FAKE_KEY}`);
  for (const s of listedSummaries) {
    const detail = await getSupplierInvoice(fortnox, String(s.GivenNumber));
    result.supplierInvoiceDetailReads++;
    const row = parseSupplierInvoice(detail);
    const paidAt = fake.get(row.given_number);
    if (paidAt !== undefined && !row.cancelled && row.balance !== 0) {
      row.balance = 0;
      row.final_pay_date = paidAt || row.due_date || row.invoice_date;
      result.fakeSupplierPaymentsApplied++;
    }
    listed.push(row);
    if (result.supplierInvoiceDetailReads % 50 === 0) log(`  …${result.supplierInvoiceDetailReads} supplier invoices read in full`);
  }
  listed = listed.sort((a, b) => a.invoice_date.localeCompare(b.invoice_date));
  if (!dryRun && listed.length) {
    const payload = listed.map((r) => ({ ...r, lastmodified_seen_at: seenAt, synced_at: seenAt }));
    for (let i = 0; i < payload.length; i += CHUNK) {
      must(await fx.from("supplier_invoices").upsert(payload.slice(i, i + CHUNK), { onConflict: "given_number" }), "write supplier_invoices");
    }
  }
  // DEV ONLY: the fake list is the truth for every row it names, listed this run or not.
  if (!dryRun && fake.size) {
    for (const [given, paidAt] of fake) {
      must(
        await fx
          .from("supplier_invoices")
          .update({ balance: 0, ...(paidAt ? { final_pay_date: paidAt } : {}) })
          .eq("given_number", given)
          .eq("cancelled", false),
        `apply fake supplier payment ${given}`,
      );
    }
  }
  const open = listed.filter((r) => !r.cancelled && r.balance !== 0).length;
  log(`Supplier invoices done: ${listed.length} read in full, ${listed.length - open} paid, ${open} open${result.fakeSupplierPaymentsApplied ? `, ${result.fakeSupplierPaymentsApplied} DEV fake payment(s) applied` : ""}`);

  // ---- 4. postings (SIE per financial year)
  const yearsReadBefore = new Set<number>(JSON.parse((await readSetting(db, YEARS_READ_KEY)) ?? "[]") as number[]);
  const toRead = yearsToRead(years, now, firstRun || yearsReadBefore.size === 0 || deps.fullLedger === true);
  // A year never read before is read now even on an incremental run (a company that opens
  // a new financial year mid-way).
  for (const y of yearsToRead(years, now, true)) if (!yearsReadBefore.has(y.id) && !toRead.some((t) => t.id === y.id)) toRead.push(y);
  toRead.sort((a, b) => a.from.localeCompare(b.from));
  log(`Postings: reading the SIE export for ${toRead.map((y) => `${y.id} (${y.from}…${y.to})`).join(", ")}`);
  for (const y of toRead) {
    const doc = await sieForYear(fortnox, y.id);
    const { postings, balances, accounts } = postingsFromSie(doc, y.id);
    result.yearsRead.push({ id: y.id, from: y.from, to: y.to, postings: postings.length, vouchers: doc.vouchers.length });
    result.postingsRead += postings.length;
    log(`  ${y.from}…${y.to}: ${doc.vouchers.length} vouchers, ${postings.length} postings, ${balances.length} balances, ${accounts.length} accounts in the chart`);
    if (!dryRun) {
      const { data, error } = await fx.rpc("replace_ledger_year", {
        p_financial_year_id: y.id,
        p_postings: postings,
        p_balances: balances,
        p_accounts: accounts,
      });
      if (error) throw new Error(`replace_ledger_year ${y.id}: ${error.message}`);
      if (Number(data) !== postings.length) {
        throw new Error(`replace_ledger_year ${y.id} stored ${data} rows, expected ${postings.length}.`);
      }
      yearsReadBefore.add(y.id);
    }
  }
  const latest = toRead.reduce((m, y) => (y.to > m ? y.to : m), "");
  result.syncedTo = latest && latest < monthEnd(today) ? latest : monthEnd(today);

  // ---- 5. the plan's prefill and the cursor
  if (!dryRun) {
    const { data: prefilled, error: prefillErr } = await fx.rpc("prefill_cashflow_plan", { p_months: 3 });
    if (prefillErr) throw new Error(`prefill_cashflow_plan: ${prefillErr.message}`);
    result.planRowsPrefilled = Number(prefilled ?? 0);
    await writeSetting(db, CURSOR_KEY, seenAt);
    await writeSetting(db, SYNCED_AT_KEY, seenAt);
    await writeSetting(db, YEARS_READ_KEY, JSON.stringify([...yearsReadBefore].sort()));
  }
  log(
    `Ledger done: ${result.suppliersRead} suppliers, ${result.supplierInvoicesRead} supplier invoices, ${result.postingsRead} postings over ${result.yearsRead.length} financial year(s), plan prefilled for ${result.planRowsPrefilled} row(s)${dryRun ? " (dry run — nothing written)" : ""}`,
  );
  return result;
}

/** For the run log and the error path: never let a Fortnox message carry a secret. */
export const ledgerError = (e: unknown): string => redact((e as Error).message ?? String(e));
