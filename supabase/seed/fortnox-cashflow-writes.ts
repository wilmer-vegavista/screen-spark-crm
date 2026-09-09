/**
 * The seed's ledger writes for round two — the ONLY code in this repository that creates a
 * supplier, a supplier invoice or a voucher in Fortnox, and it lives in the seed folder on
 * purpose: the functions folder reads the ledger and never writes it. Every call goes
 * through GuardedFortnox.write, so the DatabaseNumber 1848969 check runs before the first.
 *
 * Idempotency markers, read back from the LIST endpoints before anything is created:
 *   supplier          `{VV cf sup <key>}` in Comments (a detail read each; a dozen rows)
 *   supplier invoice  InvoiceNumber = `VV-CF-<key>` (the list carries InvoiceNumber)
 *   voucher           Description starts with `{VV cf <key>}` (the list carries Description)
 *
 * Voucher descriptions follow the fortnox-agent's allowlist: Fortnox rejects `[ ] < > ~ |`
 * and typographic punctuation (em dash, ellipsis, curly quotes) with 400, and rejects an
 * over-long description (200) rather than truncating it. Curly braces are accepted, which
 * is why the marker uses them.
 */
import type { GuardedFortnox } from "../functions/_fortnox/mod.ts";
import { num, str } from "../functions/_fortnox/mod.ts";

const round2 = (n: number) => Math.round(n * 100) / 100;

// ---------------------------------------------------------------- markers

const SUPPLIER_MARKER_RE = /\{VV cf sup ([A-Za-z0-9_-]+)\}/;
const VOUCHER_MARKER_RE = /^\{VV cf ([A-Za-z0-9_-]+)\}/;
const INVOICE_NUMBER_RE = /^VV-CF-([A-Za-z0-9_-]+)$/;

export const supplierMarkerFor = (key: string): string => `{VV cf sup ${key}}`;
export function supplierMarkerIn(text: string | null | undefined): string | null {
  const m = SUPPLIER_MARKER_RE.exec(text ?? "");
  return m ? m[1] : null;
}

export const supplierInvoiceNumberFor = (key: string): string => `VV-CF-${key}`;
export function supplierInvoiceKeyIn(invoiceNumber: string | null | undefined): string | null {
  const m = INVOICE_NUMBER_RE.exec((invoiceNumber ?? "").trim());
  return m ? m[1] : null;
}

export const voucherMarkerFor = (key: string): string => `{VV cf ${key}}`;
export function voucherMarkerIn(description: string | null | undefined): string | null {
  const m = VOUCHER_MARKER_RE.exec((description ?? "").trim());
  return m ? m[1] : null;
}

// ---------------------------------------------------------------- description hygiene

export const MAX_DESCRIPTION_LENGTH = 200;

// The literal hyphen is LAST in the class on purpose (anywhere else it forms a range).
// U+00A0 non-breaking space, U+2013 en dash, U+2019 curly apostrophe are spelled out so
// nothing in this line is invisible. À-ÿ is the Latin-1 letter block (åäöÅÄÖ, é, ü).
const ALLOWED_DESCRIPTION_CHARS = /[^0-9A-Za-zÀ-ÿ  –’§°€'"(){}#*:/\\_.+=@%&,;!?-]/g;
const TYPOGRAPHIC: Array<[RegExp, string]> = [
  [/[—―]/g, "-"],
  [/…/g, "..."],
  [/[“”„«»]/g, '"'],
  [/[‘‚]/g, "'"],
];

/** Anything Fortnox would reject in a voucher description becomes a space. */
export function sanitizeDescription(s: string): string {
  let out = s;
  for (const [pattern, replacement] of TYPOGRAPHIC) out = out.replace(pattern, replacement);
  return out.replace(ALLOWED_DESCRIPTION_CHARS, " ").replace(/\s+/g, " ").trim();
}

/** `{VV cf key} text`, the text trimmed to fit — the marker is never the part that gets cut. */
export function taggedDescription(key: string, text: string): string {
  const tag = voucherMarkerFor(key);
  const room = MAX_DESCRIPTION_LENGTH - tag.length - 1;
  return `${tag} ${sanitizeDescription(text).slice(0, Math.max(0, room))}`.trim();
}

// ---------------------------------------------------------------- suppliers

export interface NewSupplier {
  key: string;
  name: string;
  organisationNumber?: string | null;
  email?: string | null;
  city?: string | null;
  /** The supplier's default cost account (Fortnox PreDefinedAccount). */
  costAccount: number;
  termsOfPayment?: string | null;
}

export function supplierPayload(s: NewSupplier) {
  return {
    Supplier: {
      Name: s.name.slice(0, 1024),
      ...(s.organisationNumber ? { OrganisationNumber: s.organisationNumber } : {}),
      ...(s.email ? { Email: s.email } : {}),
      ...(s.city ? { City: s.city } : {}),
      PreDefinedAccount: s.costAccount,
      ...(s.termsOfPayment ? { TermsOfPayment: s.termsOfPayment } : {}),
      Comments: supplierMarkerFor(s.key),
      Active: true,
    },
  };
}

export async function createSupplier(g: GuardedFortnox, s: NewSupplier): Promise<{ supplierNumber: string; name: string }> {
  const res = await g.write<{ Supplier?: { SupplierNumber?: string | number; Name?: string } }>(
    "POST",
    "/suppliers",
    supplierPayload(s),
  );
  const no = str(res?.Supplier?.SupplierNumber);
  if (!no) throw new Error(`Fortnox created a supplier but returned no SupplierNumber: ${JSON.stringify(res)}`);
  return { supplierNumber: no, name: str(res?.Supplier?.Name) };
}

// ---------------------------------------------------------------- supplier invoices

export interface NewSupplierInvoice {
  key: string;
  supplierNumber: string;
  invoiceDate: string;
  dueDate: string;
  /** Amount ex VAT, on `account`. */
  net: number;
  /** VAT amount (0 for VAT-free rows such as insurance or a permit fee). Fortnox books it on 2641 itself. */
  vat: number;
  account: number;
  description: string;
  comments?: string;
}

/**
 * Only the cost row is sent: Fortnox books the 2440 total row and the 2641 VAT row itself
 * from `Total` and `VAT` (verified live 2026-09-09 — an explicit 2641 row doubled the VAT
 * and the invoice "balanserar inte" at bookkeep).
 */
export function supplierInvoicePayload(i: NewSupplierInvoice) {
  const net = round2(i.net);
  const vat = round2(i.vat);
  return {
    SupplierInvoice: {
      SupplierNumber: i.supplierNumber,
      InvoiceNumber: supplierInvoiceNumberFor(i.key),
      InvoiceDate: i.invoiceDate,
      DueDate: i.dueDate,
      Total: round2(net + vat),
      VAT: vat,
      Currency: "SEK",
      Comments: (i.comments ?? `Syntetisk leverantorsfaktura (seed, Vega Vista runda 2): ${i.description}`).slice(0, 1024),
      SupplierInvoiceRows: [
        { Account: i.account, Debit: net, Credit: 0, TransactionInformation: i.description.slice(0, 50) },
      ],
    },
  };
}

/** Replace the rows of an unbooked supplier invoice (used once, to repair the experiment's #1). */
export async function updateSupplierInvoiceRows(
  g: GuardedFortnox,
  givenNumber: string,
  i: NewSupplierInvoice,
): Promise<void> {
  const payload = supplierInvoicePayload(i);
  await g.write("PUT", `/supplierinvoices/${encodeURIComponent(givenNumber)}`, {
    SupplierInvoice: { SupplierInvoiceRows: payload.SupplierInvoice.SupplierInvoiceRows, Total: payload.SupplierInvoice.Total, VAT: payload.SupplierInvoice.VAT },
  });
}

export interface CreatedSupplierInvoice {
  givenNumber: string;
  total: number;
  balance: number;
}

export async function createSupplierInvoice(g: GuardedFortnox, i: NewSupplierInvoice): Promise<CreatedSupplierInvoice> {
  const res = await g.write<{
    SupplierInvoice?: { GivenNumber?: string | number; Total?: number | string; Balance?: number | string };
  }>("POST", "/supplierinvoices", supplierInvoicePayload(i));
  const no = str(res?.SupplierInvoice?.GivenNumber);
  if (!no) throw new Error(`Fortnox created a supplier invoice but returned no GivenNumber: ${JSON.stringify(res)}`);
  return { givenNumber: no, total: num(res?.SupplierInvoice?.Total), balance: num(res?.SupplierInvoice?.Balance) };
}

export async function bookkeepSupplierInvoice(g: GuardedFortnox, givenNumber: string): Promise<void> {
  await g.write("PUT", `/supplierinvoices/${encodeURIComponent(givenNumber)}/bookkeep`, {});
}

export async function cancelSupplierInvoice(g: GuardedFortnox, givenNumber: string): Promise<void> {
  await g.write("PUT", `/supplierinvoices/${encodeURIComponent(givenNumber)}/cancel`, {});
}

/**
 * Register and bookkeep a supplier payment. The fortnox-agent's integration lacks the
 * `payment` scope, so on 1848969 this is refused; the seed then books the bank voucher
 * itself and lists the invoice in fortnox.settings.dev_fake_supplier_payments.
 */
export async function paySupplierInvoice(
  g: GuardedFortnox,
  p: { givenNumber: string; amount: number; paymentDate: string },
): Promise<string> {
  const res = await g.write<{ SupplierInvoicePayment?: { Number?: string | number } }>("POST", "/supplierinvoicepayments", {
    SupplierInvoicePayment: {
      InvoiceNumber: Number(p.givenNumber),
      Amount: round2(p.amount),
      PaymentDate: p.paymentDate,
    },
  });
  const no = str(res?.SupplierInvoicePayment?.Number);
  if (!no) throw new Error(`Fortnox registered a supplier payment but returned no Number: ${JSON.stringify(res)}`);
  await g.write("PUT", `/supplierinvoicepayments/${encodeURIComponent(no)}/bookkeep`, {});
  return no;
}

// ---------------------------------------------------------------- vouchers

export interface VoucherLeg {
  account: number;
  debit: number;
  credit: number;
}

export interface NewVoucher {
  key: string;
  series: string;
  date: string;
  text: string;
  legs: VoucherLeg[];
}

/** Why a set of legs is not a voucher, or undefined when it is (checked leg by leg, in öre). */
export function checkLegs(legs: readonly VoucherLeg[]): string | undefined {
  if (legs.length < 2) return `A voucher needs at least two legs; got ${legs.length}.`;
  let debitOre = 0;
  let creditOre = 0;
  for (const [i, l] of legs.entries()) {
    const where = `leg ${i + 1} (account ${l.account || "?"})`;
    if (!Number.isInteger(l.account) || l.account < 1000 || l.account > 9999) return `${where}: not a BAS account.`;
    for (const [side, v] of [["debit", l.debit], ["credit", l.credit]] as const) {
      if (typeof v !== "number" || !Number.isFinite(v)) return `${where}: ${side} is not a finite number.`;
      if (v < 0) return `${where}: ${side} is negative (${v}). Reverse the leg instead.`;
      if (Math.abs(v * 100 - Math.round(v * 100)) > 1e-6) return `${where}: ${side} ${v} has more than two decimals.`;
    }
    if (l.debit > 0 && l.credit > 0) return `${where}: has both a debit and a credit. Split it in two.`;
    if (l.debit === 0 && l.credit === 0) return `${where}: moves nothing.`;
    debitOre += Math.round(l.debit * 100);
    creditOre += Math.round(l.credit * 100);
  }
  if (debitOre !== creditOre) return `Unbalanced: debit ${(debitOre / 100).toFixed(2)} vs credit ${(creditOre / 100).toFixed(2)}.`;
  if (debitOre === 0) return "Voucher moves nothing.";
  return undefined;
}

export function voucherPayload(v: NewVoucher) {
  const bad = checkLegs(v.legs);
  if (bad) throw new Error(`Refusing to build voucher "${v.text}" (${v.date}): ${bad}`);
  return {
    Voucher: {
      VoucherSeries: v.series,
      TransactionDate: v.date,
      Description: taggedDescription(v.key, v.text),
      VoucherRows: v.legs.map((l) => ({ Account: l.account, Debit: round2(l.debit), Credit: round2(l.credit) })),
    },
  };
}

export async function createVoucher(g: GuardedFortnox, v: NewVoucher): Promise<{ series: string; number: string }> {
  const res = await g.write<{ Voucher?: { VoucherNumber?: string | number; VoucherSeries?: string } }>(
    "POST",
    "/vouchers",
    voucherPayload(v),
  );
  const no = str(res?.Voucher?.VoucherNumber);
  if (!no) throw new Error(`Fortnox created a voucher but returned no VoucherNumber: ${JSON.stringify(res)}`);
  return { series: str(res?.Voucher?.VoucherSeries) || v.series, number: no };
}

/** Two-leg helper: money leaves the bank for `account` (or arrives, when `direction` is in). */
export function bankLegs(account: number, amount: number, direction: "out" | "in", bankAccount = 1930): VoucherLeg[] {
  const a = round2(amount);
  return direction === "out"
    ? [
        { account, debit: a, credit: 0 },
        { account: bankAccount, debit: 0, credit: a },
      ]
    : [
        { account: bankAccount, debit: a, credit: 0 },
        { account, debit: 0, credit: a },
      ];
}
