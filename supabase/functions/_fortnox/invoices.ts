/**
 * Customer invoices (kundreskontran), round one. Reads only.
 *
 * Fortnox's `GET /3/invoices` list carries DocumentNumber, CustomerNumber, CustomerName,
 * InvoiceDate, DueDate, Total, Balance, Currency, Booked, Cancelled, Sent, FinalPayDate,
 * Project, TermsOfPayment, InvoiceType, ExternalInvoiceReference1/2 — but NOT the amount
 * ex VAT (Net) or the VAT (TotalVAT); those are on the full record only, so every new or
 * changed invoice costs one detail GET. The list walk is paging.ts's: a truncated list
 * is a thrown error, never a shorter ledger.
 *
 * Balance, Total, Net and TotalVAT are read with `requiredNum`: a missing or malformed
 * Balance throws and fails the run visibly. Reading it as 0 would mark a live invoice
 * "betald" — the one mistake this ledger must never make (fortnox-agent, Codex review #16).
 *
 * Financial years: the first run reads the current and the previous financial year
 * (Fortnox's `fromdate`/`todate` filter on InvoiceDate); later runs read `lastmodified`
 * since the cursor, widened by ten minutes like the customer/project reads.
 */
import type { GuardedFortnox } from "./guard.ts";
import { getAllWithMeta } from "./paging.ts";
import { formatLastmodified, type ListResult } from "./reads.ts";
import { num, requiredNum, str } from "./numbers.ts";
import { FortnoxReadError } from "./errors.ts";

export interface InvoiceSummary {
  /** Fortnox sends numbers here; the list/get functions stringify them. */
  DocumentNumber: string | number;
  CustomerNumber: string | number;
  CustomerName?: string;
  InvoiceDate?: string;
  DueDate?: string;
  Total?: number | string;
  Balance?: number | string;
  Currency?: string;
  Booked?: boolean | string;
  Sent?: boolean | string;
  Cancelled?: boolean | string;
  /** `/supplierinvoices` spells it `Cancel`; read both, like the fortnox-agent does. */
  Cancel?: boolean | string;
  FinalPayDate?: string;
  Project?: string;
  TermsOfPayment?: string;
  InvoiceType?: string;
  ExternalInvoiceReference1?: string;
  ExternalInvoiceReference2?: string;
  OCR?: string;
}

export interface InvoiceDetail extends InvoiceSummary {
  Net?: number | string;
  TotalVAT?: number | string;
  Gross?: number | string;
  /** The string "true"/"false" on the full record. */
  Credit?: boolean | string;
  /**
   * On the ORIGINAL invoice: the DocumentNumber of the credit note that credits it (verified
   * live 2026-09-08: #12 carries "13", the credit note #13 carries "0"). Not on the note.
   */
  CreditInvoiceReference?: string | number;
  OurReference?: string;
  YourReference?: string;
  OrderReference?: string | number;
  YourOrderNumber?: string;
  Remarks?: string;
  ContractReference?: string | number;
  VATIncluded?: boolean;
  InvoiceRows?: Array<{
    ArticleNumber?: string;
    Description?: string;
    DeliveredQuantity?: number | string;
    Price?: number | string;
    VAT?: number | string;
    AccountNumber?: number | string;
    Project?: string;
  }>;
}

export interface FinancialYear {
  id: number;
  from: string;
  to: string;
  accountingMethod?: string;
}

/** The row fortnox.invoices stores for one Fortnox invoice (match columns aside). */
export interface InvoiceRow {
  document_number: string;
  customer_number: string;
  customer_name: string | null;
  project_number: string | null;
  invoice_date: string;
  due_date: string | null;
  amount_excl_vat: number;
  vat: number;
  total: number;
  balance: number;
  currency: string;
  booked: boolean;
  sent: boolean;
  cancelled: boolean;
  credit: boolean;
  credit_invoice_reference: string | null;
  invoice_type: string | null;
  final_pay_date: string | null;
  terms_of_payment: string | null;
  our_reference: string | null;
  your_reference: string | null;
  order_reference: string | null;
  external_reference: string | null;
}

const LASTMODIFIED_OVERLAP_MS = 10 * 60 * 1000;

export interface ListInvoicesOptions {
  /** Incremental read: everything Fortnox changed since this moment (widened by 10 min). */
  since?: Date;
  /** InvoiceDate window, inclusive, `YYYY-MM-DD`. */
  fromDate?: string;
  toDate?: string;
}

/**
 * Fortnox's booleans arrive as `true` on list rows and as the STRING "true" on some full
 * records (Credit on GET /invoices/{n}, verified live 2026-09-08). Read both.
 */
export const fxBool = (v: unknown): boolean => v === true || String(v).toLowerCase() === "true";

/** Cancelled under either spelling; absent means not cancelled (see the fortnox-agent's isCancelled). */
export const isCancelled = (r: { Cancel?: boolean | string; Cancelled?: boolean | string }): boolean =>
  fxBool(r.Cancel) || fxBool(r.Cancelled);

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/** `YYYY-MM-DD` or null; a value that is present but not a date is an error, not a null. */
export function isoDate(v: unknown, what: string): string | null {
  const s = str(v).trim().slice(0, 10);
  if (!s) return null;
  if (!ISO_DATE.test(s)) throw new FortnoxReadError(`${what} is ${JSON.stringify(v)}, not a YYYY-MM-DD date.`);
  return s;
}

/** All invoices (in a date window, or changed since `since`). Numbers are strings, as Fortnox sends them. */
export async function listInvoices(
  g: GuardedFortnox,
  opts: ListInvoicesOptions = {},
): Promise<ListResult<InvoiceSummary>> {
  const params: string[] = [];
  if (opts.since) {
    const widened = new Date(opts.since.getTime() - LASTMODIFIED_OVERLAP_MS);
    params.push(`lastmodified=${encodeURIComponent(formatLastmodified(widened))}`);
  }
  if (opts.fromDate) params.push(`fromdate=${encodeURIComponent(opts.fromDate)}`);
  if (opts.toDate) params.push(`todate=${encodeURIComponent(opts.toDate)}`);
  const path = params.length ? `/invoices?${params.join("&")}` : "/invoices";
  // Filtered reads over-report @TotalResources (round zero saw it on lastmodified); a
  // short read is still refused by the walk itself.
  const { rows, read } = await getAllWithMeta<InvoiceSummary>(g, path, "Invoices", {
    exactTotal: params.length === 0,
  });
  return {
    rows: rows.map((r) => ({
      ...r,
      DocumentNumber: str(r.DocumentNumber),
      CustomerNumber: str(r.CustomerNumber),
    })),
    read,
  };
}

export async function getInvoice(g: GuardedFortnox, documentNumber: string): Promise<InvoiceDetail> {
  const res = await g.get<{ Invoice?: InvoiceDetail }>(`/invoices/${encodeURIComponent(documentNumber)}`);
  if (!res?.Invoice) throw new FortnoxReadError(`GET /invoices/${documentNumber} returned no Invoice object.`);
  return {
    ...res.Invoice,
    DocumentNumber: str(res.Invoice.DocumentNumber),
    CustomerNumber: str(res.Invoice.CustomerNumber),
  };
}

export async function listFinancialYears(g: GuardedFortnox): Promise<FinancialYear[]> {
  const { rows } = await getAllWithMeta<{ Id?: number | string; FromDate?: string; ToDate?: string; AccountingMethod?: string }>(
    g,
    "/financialyears",
    "FinancialYears",
    { exactTotal: true },
  );
  return rows
    .map((r) => ({
      id: Number(r.Id),
      from: str(r.FromDate).slice(0, 10),
      to: str(r.ToDate).slice(0, 10),
      accountingMethod: r.AccountingMethod,
    }))
    .filter((y) => Number.isFinite(y.id) && ISO_DATE.test(y.from) && ISO_DATE.test(y.to))
    .sort((a, b) => a.from.localeCompare(b.from));
}

export interface BackfillWindow {
  fromDate: string;
  toDate: string;
  /** Human line for the run log: which years were chosen and why. */
  note: string;
}

const isoDay = (d: Date) => d.toISOString().slice(0, 10);

/**
 * The first run's window: the financial year containing `today` and the one before it.
 * With no previous year (a fresh test company) the current year alone; with no readable
 * financial years at all, the previous and current calendar years. The end is the current
 * year's end, so invoices dated ahead are read too.
 */
export function backfillWindow(years: FinancialYear[], today: Date): BackfillWindow {
  const t = isoDay(today);
  const idx = years.findIndex((y) => y.from <= t && t <= y.to);
  if (idx === -1) {
    const y = today.getUTCFullYear();
    return {
      fromDate: `${y - 1}-01-01`,
      toDate: `${y}-12-31`,
      note: years.length
        ? `no financial year contains ${t}; reading calendar years ${y - 1}–${y}`
        : `no financial years readable; reading calendar years ${y - 1}–${y}`,
    };
  }
  const current = years[idx];
  const previous = idx > 0 ? years[idx - 1] : null;
  return {
    fromDate: previous ? previous.from : current.from,
    toDate: current.to,
    note: previous
      ? `financial years ${previous.from}…${previous.to} and ${current.from}…${current.to}`
      : `financial year ${current.from}…${current.to} (no previous financial year in this company)`,
  };
}

/**
 * The stored row from the full record. Total and Balance are decisions (paid, overdue),
 * Net and TotalVAT are the ledger's figures: all four through requiredNum. A credit note
 * carries negative amounts as Fortnox sends them.
 */
export function parseInvoice(d: InvoiceDetail): InvoiceRow {
  const no = str(d.DocumentNumber);
  if (!no) throw new FortnoxReadError("An invoice without DocumentNumber cannot be stored.");
  const what = `Invoice ${no}`;
  const invoiceDate = isoDate(d.InvoiceDate, `${what} InvoiceDate`);
  if (!invoiceDate) throw new FortnoxReadError(`${what} has no InvoiceDate.`);
  const cancelled = isCancelled(d);
  return {
    document_number: no,
    customer_number: str(d.CustomerNumber),
    customer_name: str(d.CustomerName) || null,
    project_number: str(d.Project).trim() || null,
    invoice_date: invoiceDate,
    due_date: isoDate(d.DueDate, `${what} DueDate`),
    amount_excl_vat: requiredNum(d.Net, `${what} Net`),
    vat: requiredNum(d.TotalVAT, `${what} TotalVAT`),
    total: requiredNum(d.Total, `${what} Total`),
    // A cancelled invoice has no claim: Fortnox may still echo the old balance.
    balance: cancelled ? 0 : requiredNum(d.Balance, `${what} Balance`),
    currency: str(d.Currency) || "SEK",
    booked: fxBool(d.Booked),
    sent: fxBool(d.Sent),
    cancelled,
    credit: fxBool(d.Credit) || num(d.Total) < 0,
    // "0" means none; kept only on the original (it names the credit note that credits it).
    credit_invoice_reference: (() => {
      const ref = str(d.CreditInvoiceReference).trim();
      return ref && ref !== "0" ? ref : null;
    })(),
    invoice_type: str(d.InvoiceType) || null,
    final_pay_date: isoDate(d.FinalPayDate, `${what} FinalPayDate`),
    terms_of_payment: str(d.TermsOfPayment) || null,
    our_reference: str(d.OurReference) || null,
    your_reference: str(d.YourReference) || null,
    order_reference: str(d.OrderReference) || null,
    external_reference: str(d.ExternalInvoiceReference1) || null,
  };
}
