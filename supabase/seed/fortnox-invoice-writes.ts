/**
 * The seed's Fortnox invoice writes — the ONLY code in this repository that creates,
 * bookkeeps, pays or cancels an invoice, and it lives in the seed folder on purpose: the
 * functions folder (the sync, the page actions, the feed) has no invoice-writing code at
 * all. Every call goes through GuardedFortnox.write, so the DatabaseNumber 1848969 check
 * runs before the first one.
 *
 * Rows are free text (Description + DeliveredQuantity + Price + VAT + AccountNumber): the
 * fortnox-agent's integration lacks the `article` scope, and Filip's ledger has no
 * articles either. AccountNumber 3001 is BAS's "Försäljning inom Sverige, 25 % moms",
 * present in every Swedish Fortnox company's default chart.
 *
 * The idempotency marker `{VV inv <n>}` goes into ExternalInvoiceReference1, which the
 * invoice LIST returns (Remarks and YourReference need a detail GET each), so a re-run
 * finds every earlier invoice in one call. It does not print on the invoice.
 */
import type { GuardedFortnox } from "../functions/_fortnox/mod.ts";
import { str } from "../functions/_fortnox/mod.ts";

const MARKER_RE = /\{VV inv ([A-Za-z0-9-]+)\}/;

export const invoiceMarkerFor = (key: string): string => `{VV inv ${key}}`;
export function invoiceMarkerIn(text: string | null | undefined): string | null {
  const m = MARKER_RE.exec(text ?? "");
  return m ? m[1] : null;
}

export interface NewInvoice {
  markerKey: string;
  customerNumber: string;
  projectNumber: string | null;
  invoiceDate: string;
  dueDate: string;
  /** Amount ex VAT for the single free-text row. Negative for a credit note. */
  amount: number;
  description: string;
  ourReference: string | null;
  yourReference?: string | null;
  remarks?: string;
}

export function invoicePayload(i: NewInvoice) {
  return {
    Invoice: {
      CustomerNumber: i.customerNumber,
      InvoiceDate: i.invoiceDate,
      DueDate: i.dueDate,
      ...(i.projectNumber ? { Project: i.projectNumber } : {}),
      ...(i.ourReference ? { OurReference: i.ourReference.slice(0, 50) } : {}),
      ...(i.yourReference ? { YourReference: i.yourReference.slice(0, 50) } : {}),
      ExternalInvoiceReference1: invoiceMarkerFor(i.markerKey),
      Remarks: (i.remarks ?? "Syntetisk faktura (seed, Vega Vista runda 1)").slice(0, 1024),
      InvoiceRows: [
        {
          Description: i.description.slice(0, 50),
          DeliveredQuantity: "1",
          Price: Math.round(i.amount * 100) / 100,
          VAT: 25,
          AccountNumber: 3001,
          ...(i.projectNumber ? { Project: i.projectNumber } : {}),
        },
      ],
    },
  };
}

export interface CreatedInvoice {
  documentNumber: string;
  total: number;
}

export async function createInvoice(g: GuardedFortnox, i: NewInvoice): Promise<CreatedInvoice> {
  const res = await g.write<{ Invoice?: { DocumentNumber?: string | number; Total?: number | string } }>(
    "POST",
    "/invoices",
    invoicePayload(i),
  );
  const no = str(res?.Invoice?.DocumentNumber);
  if (!no) throw new Error(`Fortnox created an invoice but returned no DocumentNumber: ${JSON.stringify(res)}`);
  return { documentNumber: no, total: Number(String(res?.Invoice?.Total ?? "0").replace(/[\s ]/g, "").replace(",", ".")) };
}

/** Bookkeep the invoice (Fortnox requires it before a payment can be registered). */
export async function bookkeepInvoice(g: GuardedFortnox, documentNumber: string): Promise<void> {
  await g.write("PUT", `/invoices/${encodeURIComponent(documentNumber)}/bookkeep`, {});
}

/** Cancel — only an unbooked invoice can be cancelled; a booked one is credited instead. */
export async function cancelInvoice(g: GuardedFortnox, documentNumber: string): Promise<void> {
  await g.write("PUT", `/invoices/${encodeURIComponent(documentNumber)}/cancel`, {});
}

/**
 * Create the credit note for a booked invoice. Returns the credit note's DocumentNumber.
 * Fortnox books the credit note immediately and refuses further edits to it, so it carries
 * no seed marker: the seed recognises it by its CreditInvoiceReference on the next run.
 */
export async function creditInvoice(g: GuardedFortnox, documentNumber: string): Promise<string> {
  const res = await g.write<{ Invoice?: { DocumentNumber?: string | number } }>(
    "PUT",
    `/invoices/${encodeURIComponent(documentNumber)}/credit`,
    {},
  );
  const no = str(res?.Invoice?.DocumentNumber);
  if (!no) throw new Error(`Fortnox credited invoice ${documentNumber} but returned no DocumentNumber: ${JSON.stringify(res)}`);
  return no;
}

/**
 * Open a project's accounting period from `startDate`: Fortnox refuses to bookkeep an
 * invoice on a project whose period does not cover the invoice date (the hand-made seed
 * projects had no start date at all).
 */
export async function setProjectStartDate(g: GuardedFortnox, projectNumber: string, startDate: string): Promise<void> {
  await g.write("PUT", `/projects/${encodeURIComponent(projectNumber)}`, { Project: { StartDate: startDate } });
}

export interface NewPayment {
  documentNumber: string;
  amount: number;
  paymentDate: string;
}

/** Register a payment and bookkeep it, so Fortnox's Balance drops to zero. Returns the payment number. */
export async function payInvoice(g: GuardedFortnox, p: NewPayment): Promise<string> {
  const res = await g.write<{ InvoicePayment?: { Number?: string | number } }>("POST", "/invoicepayments", {
    InvoicePayment: {
      InvoiceNumber: Number(p.documentNumber),
      Amount: Math.round(p.amount * 100) / 100,
      PaymentDate: p.paymentDate,
    },
  });
  const no = str(res?.InvoicePayment?.Number);
  if (!no) throw new Error(`Fortnox registered a payment but returned no Number: ${JSON.stringify(res)}`);
  await g.write("PUT", `/invoicepayments/${encodeURIComponent(no)}/bookkeep`, {});
  return no;
}
