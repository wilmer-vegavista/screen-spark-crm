/**
 * The invoice step of a sync run (round one). After customers and projects:
 *
 *   1. Which invoices to read. No cursor yet (fortnox.settings.invoices_cursor absent) →
 *      the backfill: every invoice of the current and the previous financial year, by
 *      InvoiceDate. Cursor present → every invoice Fortnox changed since it (lastmodified,
 *      widened ten minutes). The cursor is this run's start, written only on success, so
 *      a failed run re-reads the same window.
 *   2. One detail GET per listed invoice (the list lacks Net and TotalVAT), parsed with
 *      requiredNum on Balance/Total/Net/TotalVAT — a malformed balance fails the run.
 *   3. Match every invoice to an order (invoice-matcher.ts). An admin's earlier choice
 *      and a standing sync link are kept; the rest take the fresh verdict.
 *   4. Upsert by document number. Dev-only: document numbers listed in
 *      fortnox.settings.dev_fake_payments are stored with balance 0 (the seed writes that
 *      key when the test company refuses to bookkeep payments; the health row says so).
 *   5. Refresh the ledger snapshot the Google Sheet feed serves.
 *
 * Reads only. Nothing here writes to Fortnox.
 */
import type { SupabaseClient } from "npm:@supabase/supabase-js@2.108.1";
import {
  backfillWindow,
  type ExistingMatch,
  getInvoice,
  type GuardedFortnox,
  type InvoiceRow,
  listFinancialYears,
  listInvoices,
  type MatchIndex,
  type MatchOrder,
  matchInvoice,
  mergeMatch,
  parseInvoice,
  redact,
  refreshLedgerSnapshot,
  snapshotYears,
} from "../_fortnox/mod.ts";

export interface InvoiceStepDeps {
  db: SupabaseClient;
  fortnox: GuardedFortnox;
  now: Date;
}

export interface InvoiceStepResult {
  /** Invoices listed this run (the window or the changed set). */
  read: number;
  detailReads: number;
  /** Status after the run, over the invoices read this run. */
  matched: number;
  proposed: number;
  unmatched: number;
  ignored: number;
  /** Rows whose match an admin had decided; left as they were. */
  adminKept: number;
  fakePaymentsApplied: number;
  window: string;
  mode: "backfill" | "incremental";
}

const CURSOR_KEY = "invoices_cursor";
const FAKE_KEY = "dev_fake_payments";
const CHUNK = 200;

function must<T>(res: { data: T | null; error: { message: string } | null }, what: string): T {
  if (res.error) throw new Error(`${what}: ${res.error.message}`);
  return res.data as T;
}

interface ExistingRow extends ExistingMatch {
  document_number: string;
}

interface OrderRow {
  id: string;
  customer_id: string | null;
  company_name: string;
  billing_frequency: string | null;
  billing_duration_months: number | null;
  total_excl_vat: number | string;
  invoice_start_date: string | null;
  created_at: string;
  order_type: string;
}

/** The link tables and the bookings, shaped for the matcher. */
export async function loadMatchIndex(db: SupabaseClient): Promise<MatchIndex & { orders: MatchOrder[] }> {
  const fx = db.schema("fortnox");
  const [customerLinks, projectLinks, orders, items] = await Promise.all([
    fx.from("customer_links").select("customer_id, fortnox_customer_number").eq("status", "linked"),
    fx.from("project_links").select("product_id, fortnox_project_number").eq("status", "linked"),
    db
      .from("orders")
      .select(
        "id, customer_id, company_name, billing_frequency, billing_duration_months, total_excl_vat, invoice_start_date, created_at, order_type",
      )
      .eq("order_type", "bokning"),
    db.from("order_items").select("order_id, product_id"),
  ]);
  const cl = must(customerLinks, "read customer_links") as { customer_id: string; fortnox_customer_number: string }[];
  const pl = must(projectLinks, "read project_links") as { product_id: string; fortnox_project_number: string }[];
  const os = must(orders, "read orders") as OrderRow[];
  const its = must(items, "read order_items") as { order_id: string; product_id: string | null }[];

  const productsByOrder = new Map<string, string[]>();
  for (const it of its) {
    if (!it.product_id) continue;
    const list = productsByOrder.get(it.order_id) ?? [];
    list.push(it.product_id);
    productsByOrder.set(it.order_id, list);
  }
  const matchOrders: MatchOrder[] = os.map((o) => ({
    id: o.id,
    customer_id: o.customer_id,
    company_name: o.company_name,
    billing_frequency: o.billing_frequency,
    billing_duration_months: o.billing_duration_months,
    total_excl_vat: Number(o.total_excl_vat) || 0,
    invoice_start_date: o.invoice_start_date,
    created_at: o.created_at,
    product_ids: productsByOrder.get(o.id) ?? [],
  }));
  const ordersByCustomer = new Map<string, MatchOrder[]>();
  for (const o of matchOrders) {
    if (!o.customer_id) continue;
    const list = ordersByCustomer.get(o.customer_id) ?? [];
    list.push(o);
    ordersByCustomer.set(o.customer_id, list);
  }
  return {
    customerIdByNumber: new Map(cl.map((l) => [l.fortnox_customer_number, l.customer_id])),
    productIdByProject: new Map(pl.map((l) => [l.fortnox_project_number, l.product_id])),
    ordersByCustomer,
    orders: matchOrders,
  };
}

async function readSetting(db: SupabaseClient, key: string): Promise<string | null> {
  const res = await db.schema("fortnox").from("settings").select("value").eq("key", key).maybeSingle();
  if (res.error) throw new Error(`read settings.${key}: ${res.error.message}`);
  return (res.data as { value: string } | null)?.value ?? null;
}

export async function syncInvoices(
  deps: InvoiceStepDeps,
  dryRun: boolean,
  runId: number | null,
  log: (s: string) => void,
): Promise<InvoiceStepResult> {
  const { db, fortnox, now } = deps;
  const fx = db.schema("fortnox");
  const result: InvoiceStepResult = {
    read: 0,
    detailReads: 0,
    matched: 0,
    proposed: 0,
    unmatched: 0,
    ignored: 0,
    adminKept: 0,
    fakePaymentsApplied: 0,
    window: "",
    mode: "incremental",
  };

  // ---- 1. the window
  const cursorRaw = await readSetting(db, CURSOR_KEY);
  const cursor = cursorRaw ? new Date(cursorRaw) : null;
  let listed;
  if (!cursor || Number.isNaN(cursor.getTime())) {
    result.mode = "backfill";
    let years: Awaited<ReturnType<typeof listFinancialYears>> = [];
    try {
      years = await listFinancialYears(fortnox);
    } catch (e) {
      log(`Invoices: financial years not readable (${redact((e as Error).message)}) — calendar years instead`);
    }
    const w = backfillWindow(years, now);
    result.window = `${w.fromDate}…${w.toDate} (${w.note})`;
    log(`Invoices: first read — ${result.window}`);
    listed = await listInvoices(fortnox, { fromDate: w.fromDate, toDate: w.toDate });
  } else {
    result.window = `changed since ${cursor.toISOString()}`;
    log(`Invoices: reading changes since ${cursor.toISOString()}`);
    listed = await listInvoices(fortnox, { since: cursor });
  }
  result.read = listed.rows.length;
  log(`Invoices listed: ${listed.rows.length} (${listed.read.pages} page(s), Fortnox reported ${listed.read.reportedTotal})`);

  // ---- 2. detail reads
  const rows: InvoiceRow[] = [];
  for (const s of listed.rows) {
    const detail = await getInvoice(fortnox, String(s.DocumentNumber));
    result.detailReads++;
    rows.push(parseInvoice(detail));
    if (result.detailReads % 50 === 0) log(`  …${result.detailReads} invoices read in full`);
  }

  // ---- 3. match, keeping what a person (or an earlier run) decided
  const existingRows = rows.length
    ? (must(
        await fx
          .from("invoices")
          .select("document_number, match_status, matched_by, order_id")
          .in("document_number", rows.map((r) => r.document_number)),
        "read invoices",
      ) as ExistingRow[])
    : [];
  const existing = new Map(existingRows.map((e) => [e.document_number, e]));
  const index = await loadMatchIndex(db);
  // Credit notes follow the invoice they credit: every linked invoice, by document number,
  // and the reverse map note → original (Fortnox keeps CreditInvoiceReference on the original).
  const linkedRows = must(
    await fx.from("invoices").select("document_number, order_id").not("order_id", "is", null),
    "read linked invoices",
  ) as { document_number: string; order_id: string }[];
  index.orderIdByDocument = new Map(linkedRows.map((l) => [l.document_number, l.order_id]));
  const creditedRows = must(
    await fx.from("invoices").select("document_number, credit_invoice_reference").not("credit_invoice_reference", "is", null),
    "read credited invoices",
  ) as { document_number: string; credit_invoice_reference: string }[];
  index.originalOfCreditNote = new Map(creditedRows.map((r) => [r.credit_invoice_reference, r.document_number]));
  for (const r of rows) if (r.credit_invoice_reference) index.originalOfCreditNote.set(r.credit_invoice_reference, r.document_number);
  log(
    `Match index: ${index.customerIdByNumber.size} linked customers, ${index.productIdByProject.size} linked screens, ${index.orders.length} bookings, ${linkedRows.length} invoices already linked, ${index.originalOfCreditNote.size} credit note(s) known`,
  );

  // Round one wrote a list of document numbers; round two's seed writes objects with the pay
  // date of the bank voucher it booked, so the ledger and the fake-payment table agree.
  const fakeRaw = await readSetting(db, FAKE_KEY);
  const fake = new Map<string, string | null>();
  for (const f of fakeRaw ? (JSON.parse(fakeRaw) as Array<string | { document_number?: string; paid_at?: string }>) : []) {
    if (typeof f === "string") fake.set(f, null);
    else if (f.document_number) fake.set(String(f.document_number), f.paid_at ? String(f.paid_at).slice(0, 10) : null);
  }
  if (fake.size) log(`DEV ONLY: ${fake.size} fake payment(s) configured in fortnox.settings.${FAKE_KEY}`);

  const seenAt = now.toISOString();
  const withMatch: Record<string, unknown>[] = [];
  const withoutMatch: Record<string, unknown>[] = [];
  // Ordinary invoices first, credit notes last, so a credit note created in the same window
  // as its invoice finds that invoice already linked.
  rows.sort((a, b) => Number(a.credit) - Number(b.credit) || a.invoice_date.localeCompare(b.invoice_date));
  for (const r of rows) {
    if (fake.has(r.document_number) && !r.cancelled) {
      r.balance = 0;
      r.final_pay_date = fake.get(r.document_number) ?? r.final_pay_date ?? r.due_date ?? r.invoice_date;
      result.fakePaymentsApplied++;
    }
    const prev = existing.get(r.document_number);
    const fresh = matchInvoice(
      {
        document_number: r.document_number,
        customer_number: r.customer_number,
        project_number: r.project_number,
        amount_excl_vat: r.amount_excl_vat,
        invoice_date: r.invoice_date,
        credit: r.credit,
      },
      index,
    );
    const merged = mergeMatch(prev, fresh, now);
    const base = { ...r, lastmodified_seen_at: seenAt, synced_at: seenAt };
    const finalStatus = merged ? merged.match_status : prev!.match_status;
    const finalOrder = merged ? merged.order_id : prev!.order_id;
    if (finalStatus === "linked" && finalOrder) index.orderIdByDocument!.set(r.document_number, finalOrder);
    if (finalStatus === "linked") result.matched++;
    else if (finalStatus === "proposed") result.proposed++;
    else if (finalStatus === "ignored") result.ignored++;
    else result.unmatched++;
    if (merged) {
      withMatch.push({ ...base, ...merged });
      log(
        `  ${r.document_number} ${r.invoice_date} ${r.customer_name ?? r.customer_number} ${r.amount_excl_vat} kr → ${merged.match_status}${merged.match_status !== "unmatched" ? ` [${merged.match_confidence}]` : ""}: ${merged.match_reason}`,
      );
    } else {
      if (prev?.matched_by?.startsWith("admin:")) result.adminKept++;
      withoutMatch.push(base);
    }
  }

  // ---- 4. upsert (columns not in the payload stay as they are — that is how a kept match survives)
  if (!dryRun) {
    for (const batch of [withMatch, withoutMatch]) {
      for (let i = 0; i < batch.length; i += CHUNK) {
        must(
          await fx.from("invoices").upsert(batch.slice(i, i + CHUNK), { onConflict: "document_number" }),
          "write invoices",
        );
      }
    }
    must(
      await fx.from("settings").upsert({ key: CURSOR_KEY, value: seenAt }, { onConflict: "key" }),
      "write invoices_cursor",
    );
    // DEV ONLY: the fake-payment table is the truth for every row it names, not only the rows
    // this run listed — round two's seed re-dates the payments to the bank vouchers it booked,
    // and an incremental run must carry that onto rows Fortnox did not change.
    for (const [doc, paidAt] of fake) {
      must(
        await fx
          .from("invoices")
          .update({ balance: 0, ...(paidAt ? { final_pay_date: paidAt } : {}) })
          .eq("document_number", doc)
          .eq("cancelled", false),
        `apply fake payment ${doc}`,
      );
    }
    // ---- 5. the feed's snapshot
    for (const year of snapshotYears(now)) {
      const snap = await refreshLedgerSnapshot(db, year, runId, now);
      log(`Ledger snapshot ${year}: ${snap.row_count} row(s)`);
    }
  }
  log(
    `Invoices done: ${result.read} read, ${result.matched} matched, ${result.proposed} proposed, ${result.unmatched} unmatched${result.ignored ? `, ${result.ignored} left unlinked by an admin` : ""}${result.adminKept ? `, ${result.adminKept} admin decision(s) kept` : ""}${result.fakePaymentsApplied ? `, ${result.fakePaymentsApplied} DEV fake payment(s) applied` : ""}${dryRun ? " (dry run — nothing written)" : ""}`,
  );
  return result;
}
