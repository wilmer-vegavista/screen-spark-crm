/**
 * The general ledger (round two, the cash-flow page). Reads only.
 *
 * Postings come from Fortnox's SIE type-4 export, one GET per financial year
 * (`GET /sie/4?financialyear=<id>`): every voucher with every row, the chart of accounts
 * (#KONTO) and the balances brought forward and carried forward (#IB / #UB) in one file.
 * The alternative — `GET /vouchers` for the headers and one detail GET per voucher for the
 * rows — costs a request per voucher; a live year at Vega Vista is a few hundred to a few
 * thousand vouchers. The SIE route is complete by construction (the file IS the ledger),
 * gives the opening balances the cash rows need for free, and has run in production for
 * A&H in the fortnox-agent since 2026-08-06. The file is CP437 ("PC8"), so it is decoded
 * here before parsing; the request sends the wildcard Accept header (Fortnox refuses the
 * one that names the payload — client.ts requestRaw).
 *
 * Suppliers and supplier invoices are ordinary list reads (paging.ts): the list is walked
 * whole and a truncated list is a thrown error. Every amount a figure depends on goes
 * through `requiredNum` — a missing Total, Balance or VAT fails the run, never reads as 0.
 * The supplier invoice LIST lacks the cost rows and the VAT, so each new or changed
 * invoice costs one detail GET, like round one's customer invoices.
 *
 * Financial years: Fortnox rejects a `fromdate` outside the queried financial year
 * (2002363 "Fråndatumet ligger utanför aktuellt räkenskapsår"), so every dated read here
 * goes through `financialYearsCovering` and is clamped to each year's own bounds.
 */
import type { GuardedFortnox } from "./guard.ts";
import { getAllWithMeta } from "./paging.ts";
import { formatLastmodified, type ListResult } from "./reads.ts";
import { fxBool, type FinancialYear, isCancelled, isoDate } from "./invoices.ts";
import { num, requiredNum, str } from "./numbers.ts";
import { FortnoxReadError } from "./errors.ts";

// ---------------------------------------------------------------- financial years

/** Every financial year overlapping [from, to], in date order. Throws when none does. */
export function financialYearsCovering(years: FinancialYear[], from: string, to: string): FinancialYear[] {
  const hit = years.filter((y) => y.from <= to && y.to >= from).sort((a, b) => a.from.localeCompare(b.from));
  if (hit.length === 0) {
    throw new FortnoxReadError(
      `No Fortnox financial year covers ${from}…${to}. The period cannot be read — the year may not be opened in Fortnox yet.`,
    );
  }
  return hit;
}

/** The financial year a date falls in, or null. */
export function financialYearFor(years: FinancialYear[], date: string): FinancialYear | null {
  return years.find((y) => y.from <= date && date <= y.to) ?? null;
}

/** A dated window clamped to one financial year's bounds; null when they do not intersect. */
export function clampToYear(y: FinancialYear, from: string, to: string): { from: string; to: string } | null {
  const f = from > y.from ? from : y.from;
  const t = to < y.to ? to : y.to;
  return f > t ? null : { from: f, to: t };
}

// ---------------------------------------------------------------- SIE (the posted ledger)

/**
 * CP437 (PC8) high half — the encoding Fortnox emits SIE files in (`#FORMAT PC8`). The low
 * 128 code points are ASCII and pass through. Getting this wrong is not cosmetic: account
 * names and voucher texts carry å/ä/ö. Ported from the fortnox-agent.
 */
const CP437_HIGH =
  "ÇüéâäàåçêëèïîìÄÅÉæÆôöòûùÿÖÜ¢£¥₧ƒáíóúñÑªº¿⌐¬½¼¡«»░▒▓│┤╡╢╖╕╣║╗╝╜╛┐└┴┬├─┼╞╟╚╔╩╦╠═╬╧╨╤╥╙╘╒╓╫╪┘┌█▄▌▐▀αßΓπΣσµτΦΘΩδ∞φε∩≡±≥≤⌠⌡÷≈°∙·√ⁿ²■ ";

export function decodeCp437(bytes: Uint8Array): string {
  let out = "";
  for (const b of bytes) out += b < 0x80 ? String.fromCharCode(b) : (CP437_HIGH[b - 0x80] ?? "\uFFFD");
  return out;
}

/** One row of a posted voucher. SIE sign: debit positive, credit negative. */
export interface SiePosting {
  account: number;
  amount: number;
}

/** One posted voucher (#VER block) with its rows. */
export interface SieVoucher {
  series: string;
  number: string;
  /** ISO yyyy-mm-dd. */
  date: string;
  text: string;
  regDate: string | null;
  lines: SiePosting[];
}

export interface SieDocument {
  companyId: string | null;
  companyName: string | null;
  orgNo: string | null;
  /** #RAR: year offset (0 = this file's year, -1 = the previous) → its dates. */
  years: Record<number, { from: string; to: string }>;
  /** #KONTO: account number → name. */
  accounts: Record<string, string>;
  /** #IB / #UB by year offset → account → amount (SIE sign, debit positive). */
  openingBalances: Record<number, Record<string, number>>;
  closingBalances: Record<number, Record<string, number>>;
  vouchers: SieVoucher[];
}

const sieDate = (yyyymmdd: string): string =>
  /^\d{8}$/.test(yyyymmdd) ? `${yyyymmdd.slice(0, 4)}-${yyyymmdd.slice(4, 6)}-${yyyymmdd.slice(6, 8)}` : "";

// The text capture allows backslash-escaped characters (a quote inside a voucher text
// does not truncate the field): `(?:\\.|[^"\\])*`.
const VER_RE = /^#VER\s+(\S+)\s+(\S+)\s+(\d{8})\s+"((?:\\.|[^"\\])*)"(?:\s+(\d{8}))?/;
// #TRANS <account> {<dimensions>} <amount> [transdate] [text] [quantity] — the amount is the
// first token after the braces. #RTRANS/#BTRANS (adjustment pairs) are not postings.
const TRANS_RE = /^#TRANS\s+(\d+)\s+\{[^}]*\}\s+(-?\d+(?:[.,]\d+)?)/;
const KONTO_RE = /^#KONTO\s+(\d+)\s+"((?:\\.|[^"\\])*)"/;
const BALANCE_RE = /^#(IB|UB)\s+(-?\d+)\s+(\d+)\s+(-?\d+(?:[.,]\d+)?)/;
const RAR_RE = /^#RAR\s+(-?\d+)\s+(\d{8})\s+(\d{8})/;

const sieNumber = (s: string, what: string): number => {
  const n = Number(s.replace(",", "."));
  if (!Number.isFinite(n)) throw new FortnoxReadError(`${what}: ${JSON.stringify(s)} is not a number.`);
  return n;
};

/**
 * Parse a decoded SIE type-4 text. Strict where a figure depends on it: a #TRANS line whose
 * amount cannot be read throws (it would otherwise be a posting of 0 — the silent error
 * this ledger must never make), and an unbalanced voucher is an error too (Fortnox's own
 * exports always balance; an unbalanced one means the parse went wrong).
 */
export function parseSie(content: string): SieDocument {
  const doc: SieDocument = {
    companyId: null,
    companyName: null,
    orgNo: null,
    years: {},
    accounts: {},
    openingBalances: {},
    closingBalances: {},
    vouchers: [],
  };
  const lines = content.split(/\r?\n/);
  let current: SieVoucher | null = null;
  let inBlock = false;
  let lineNo = 0;
  for (const raw of lines) {
    lineNo++;
    const text = raw.trim();
    if (text === "") continue;

    if (current && inBlock) {
      if (text === "}") {
        let ore = 0;
        for (const l of current.lines) ore += Math.round(l.amount * 100);
        if (ore !== 0) {
          throw new FortnoxReadError(
            `SIE voucher ${current.series} ${current.number} (${current.date}) does not balance (${ore / 100}). Refusing to store a ledger that cannot be right.`,
          );
        }
        doc.vouchers.push(current);
        current = null;
        inBlock = false;
        continue;
      }
      if (text.startsWith("#TRANS")) {
        const tm = TRANS_RE.exec(text);
        if (!tm) throw new FortnoxReadError(`SIE line ${lineNo}: cannot read the posting ${JSON.stringify(text.slice(0, 80))}.`);
        current.lines.push({ account: Number(tm[1]), amount: sieNumber(tm[2], `SIE line ${lineNo} amount`) });
      }
      continue;
    }

    if (text === "{") {
      if (!current) throw new FortnoxReadError(`SIE line ${lineNo}: a block opens without a #VER.`);
      inBlock = true;
      continue;
    }

    if (text.startsWith("#VER")) {
      const vm = VER_RE.exec(text);
      if (!vm) throw new FortnoxReadError(`SIE line ${lineNo}: cannot read the voucher header ${JSON.stringify(text.slice(0, 80))}.`);
      current = {
        series: vm[1],
        number: vm[2],
        date: sieDate(vm[3]),
        text: vm[4].replace(/\\(.)/g, "$1"),
        regDate: vm[5] ? sieDate(vm[5]) : null,
        lines: [],
      };
      continue;
    }

    const km = KONTO_RE.exec(text);
    if (km) {
      doc.accounts[km[1]] = km[2].replace(/\\(.)/g, "$1");
      continue;
    }
    const bm = BALANCE_RE.exec(text);
    if (bm) {
      const target = bm[1] === "IB" ? doc.openingBalances : doc.closingBalances;
      const offset = Number(bm[2]);
      (target[offset] ??= {})[bm[3]] = sieNumber(bm[4], `SIE line ${lineNo} ${bm[1]} ${bm[3]}`);
      continue;
    }
    const rm = RAR_RE.exec(text);
    if (rm) {
      doc.years[Number(rm[1])] = { from: sieDate(rm[2]), to: sieDate(rm[3]) };
      continue;
    }
    if (text.startsWith("#FNR ")) doc.companyId = text.slice(5).trim().replace(/^"|"$/g, "");
    else if (text.startsWith("#FNAMN ")) doc.companyName = text.slice(7).trim().replace(/^"|"$/g, "");
    else if (text.startsWith("#ORGNR ")) doc.orgNo = text.slice(7).trim();
  }
  if (current) throw new FortnoxReadError(`SIE ends inside voucher ${current.series} ${current.number}.`);
  return doc;
}

/** The SIE type-4 export of one financial year, decoded and parsed. */
export async function sieForYear(g: GuardedFortnox, financialYearId: number): Promise<SieDocument> {
  const bytes = await g.getRaw(`/sie/4?financialyear=${financialYearId}`);
  if (!bytes.length) throw new FortnoxReadError(`GET /sie/4?financialyear=${financialYearId} returned an empty file.`);
  const doc = parseSie(decodeCp437(bytes));
  if (!doc.years[0]) throw new FortnoxReadError(`SIE for financial year ${financialYearId} carries no #RAR 0 line — not a Fortnox export.`);
  return doc;
}

/** The row fortnox.ledger_postings stores: one per SIE #TRANS. */
export interface LedgerPostingRow {
  financial_year_id: number;
  voucher_series: string;
  voucher_number: number;
  row_no: number;
  transaction_date: string;
  account: number;
  debit: number;
  credit: number;
  /** SIE sign: debit positive, credit negative. */
  amount: number;
  description: string;
  reg_date: string | null;
}

export interface AccountBalanceRow {
  financial_year_id: number;
  account: number;
  opening_balance: number;
  closing_balance: number;
}

export interface AccountRow {
  account: number;
  description: string;
}

const round2 = (n: number) => Math.round(n * 100) / 100;

/** The SIE document as table rows: postings, this year's balances (#IB 0 / #UB 0), the chart. */
export function postingsFromSie(
  doc: SieDocument,
  financialYearId: number,
): { postings: LedgerPostingRow[]; balances: AccountBalanceRow[]; accounts: AccountRow[] } {
  const postings: LedgerPostingRow[] = [];
  for (const v of doc.vouchers) {
    if (!v.date) throw new FortnoxReadError(`SIE voucher ${v.series} ${v.number} has no date.`);
    const number = Number(v.number);
    if (!Number.isInteger(number)) throw new FortnoxReadError(`SIE voucher ${v.series} ${v.number}: the number is not an integer.`);
    v.lines.forEach((l, i) => {
      postings.push({
        financial_year_id: financialYearId,
        voucher_series: v.series,
        voucher_number: number,
        row_no: i + 1,
        transaction_date: v.date,
        account: l.account,
        debit: l.amount > 0 ? round2(l.amount) : 0,
        credit: l.amount < 0 ? round2(-l.amount) : 0,
        amount: round2(l.amount),
        description: v.text,
        reg_date: v.regDate,
      });
    });
  }
  const accountsSeen = new Set<string>([
    ...Object.keys(doc.openingBalances[0] ?? {}),
    ...Object.keys(doc.closingBalances[0] ?? {}),
  ]);
  const balances: AccountBalanceRow[] = [...accountsSeen]
    .map((a) => ({
      financial_year_id: financialYearId,
      account: Number(a),
      opening_balance: round2(doc.openingBalances[0]?.[a] ?? 0),
      closing_balance: round2(doc.closingBalances[0]?.[a] ?? 0),
    }))
    .sort((x, y) => x.account - y.account);
  const accounts: AccountRow[] = Object.entries(doc.accounts)
    .map(([n, d]) => ({ account: Number(n), description: d }))
    .filter((a) => Number.isInteger(a.account))
    .sort((x, y) => x.account - y.account);
  return { postings, balances, accounts };
}

// ---------------------------------------------------------------- vouchers (headers; the seed's read-back)

export interface VoucherRef {
  series: string;
  number: string;
  date: string;
  description: string;
  /** Financial year id. */
  year: number;
}

/** Voucher headers of one financial year (rows are not on the list; the SIE has them). */
export async function listVouchers(
  g: GuardedFortnox,
  financialYearId: number,
  opts: { from?: string; to?: string } = {},
): Promise<ListResult<VoucherRef>> {
  const q = [`financialyear=${financialYearId}`];
  if (opts.from) q.push(`fromdate=${opts.from}`);
  if (opts.to) q.push(`todate=${opts.to}`);
  const { rows, read } = await getAllWithMeta<{
    VoucherSeries?: string;
    VoucherNumber?: number | string;
    TransactionDate?: string;
    Description?: string;
    Year?: number;
  }>(g, `/vouchers?${q.join("&")}`, "Vouchers", { exactTotal: !opts.from && !opts.to });
  return {
    rows: rows.map((v) => ({
      series: str(v.VoucherSeries),
      number: str(v.VoucherNumber),
      date: str(v.TransactionDate).slice(0, 10),
      description: str(v.Description),
      year: Number(v.Year ?? financialYearId),
    })),
    read,
  };
}

// ---------------------------------------------------------------- suppliers

export interface SupplierSummary {
  SupplierNumber: string | number;
  Name?: string;
  OrganisationNumber?: string;
  Active?: boolean | string;
  Email?: string;
  City?: string;
}

export interface SupplierDetail extends SupplierSummary {
  Comments?: string;
  PreDefinedAccount?: number | string;
  TermsOfPayment?: string;
  VATType?: string;
  BG?: string;
  PG?: string;
}

export interface SupplierRow {
  supplier_number: string;
  name: string;
  org_number: string | null;
  active: boolean;
  email: string | null;
  city: string | null;
  predefined_account: number | null;
}

const LASTMODIFIED_OVERLAP_MS = 10 * 60 * 1000;

function sinceParam(since: Date | undefined): string | null {
  if (!since) return null;
  const widened = new Date(since.getTime() - LASTMODIFIED_OVERLAP_MS);
  return `lastmodified=${encodeURIComponent(formatLastmodified(widened))}`;
}

export async function listSuppliers(g: GuardedFortnox, since?: Date): Promise<ListResult<SupplierSummary>> {
  const s = sinceParam(since);
  const { rows, read } = await getAllWithMeta<SupplierSummary>(g, s ? `/suppliers?${s}` : "/suppliers", "Suppliers", {
    exactTotal: !s,
  });
  return { rows: rows.map((r) => ({ ...r, SupplierNumber: str(r.SupplierNumber) })), read };
}

export async function getSupplier(g: GuardedFortnox, supplierNumber: string): Promise<SupplierDetail> {
  const res = await g.get<{ Supplier?: SupplierDetail }>(`/suppliers/${encodeURIComponent(supplierNumber)}`);
  if (!res?.Supplier) throw new FortnoxReadError(`GET /suppliers/${supplierNumber} returned no Supplier object.`);
  return { ...res.Supplier, SupplierNumber: str(res.Supplier.SupplierNumber) };
}

export function parseSupplier(s: SupplierSummary & Partial<SupplierDetail>): SupplierRow {
  const no = str(s.SupplierNumber);
  if (!no) throw new FortnoxReadError("A supplier without SupplierNumber cannot be stored.");
  const pre = num(s.PreDefinedAccount);
  return {
    supplier_number: no,
    name: str(s.Name) || `Leverantör ${no}`,
    org_number: str(s.OrganisationNumber).trim() || null,
    active: s.Active === undefined ? true : fxBool(s.Active),
    email: str(s.Email) || null,
    city: str(s.City) || null,
    predefined_account: pre > 0 ? pre : null,
  };
}

// ---------------------------------------------------------------- supplier invoices

export interface SupplierInvoiceSummary {
  /** Fortnox's own number (the key). The list and the full record both carry it. */
  GivenNumber: string | number;
  SupplierNumber?: string | number;
  SupplierName?: string;
  /** The supplier's own invoice number (where the seed writes its marker). */
  InvoiceNumber?: string;
  ExternalInvoiceNumber?: string;
  InvoiceDate?: string;
  DueDate?: string;
  FinalPayDate?: string;
  Total?: number | string;
  Balance?: number | string;
  Currency?: string;
  Booked?: boolean | string;
  Cancel?: boolean | string;
  Cancelled?: boolean | string;
  Credit?: boolean | string;
  VoucherSeries?: string;
  VoucherNumber?: number | string;
  VoucherYear?: number | string;
  Vouchers?: Array<{ Series?: string; Number?: number | string; Year?: number | string; ReferenceType?: string }>;
  OCR?: string;
  Project?: string;
}

export interface SupplierInvoiceDetail extends SupplierInvoiceSummary {
  VAT?: number | string;
  Comments?: string;
  SupplierInvoiceRows?: Array<{
    Account?: number | string;
    Debit?: number | string;
    Credit?: number | string;
    /** Fortnox tags its own rows: TOT (the 2440 total), VAT (the input-VAT row), PRE (preliminary). */
    Code?: string;
    Total?: number | string;
    Project?: string;
    CostCenter?: string;
    TransactionInformation?: string;
  }>;
}

/** The row fortnox.supplier_invoices stores. */
export interface SupplierInvoiceRow {
  given_number: string;
  supplier_number: string;
  supplier_name: string | null;
  invoice_number: string | null;
  invoice_date: string;
  due_date: string | null;
  final_pay_date: string | null;
  total: number;
  vat: number;
  balance: number;
  currency: string;
  booked: boolean;
  cancelled: boolean;
  credit: boolean;
  /** The cost account with the largest amount (the row's default placement). */
  account: number | null;
  /** Every cost row: account → amount (debit − credit), VAT and total rows left out. */
  cost_rows: Array<{ account: number; amount: number }>;
  voucher_series: string | null;
  voucher_number: number | null;
  voucher_year: number | null;
  project_number: string | null;
  comments: string | null;
}

export interface ListSupplierInvoicesOptions {
  since?: Date;
  fromDate?: string;
  toDate?: string;
}

/** All supplier invoices (in an InvoiceDate window, or changed since `since`); GivenNumber stringified. */
export async function listSupplierInvoices(
  g: GuardedFortnox,
  opts: ListSupplierInvoicesOptions = {},
): Promise<ListResult<SupplierInvoiceSummary>> {
  const params: string[] = [];
  const s = sinceParam(opts.since);
  if (s) params.push(s);
  if (opts.fromDate) params.push(`fromdate=${encodeURIComponent(opts.fromDate)}`);
  if (opts.toDate) params.push(`todate=${encodeURIComponent(opts.toDate)}`);
  const path = params.length ? `/supplierinvoices?${params.join("&")}` : "/supplierinvoices";
  // Unfiltered on purpose (never filter=unpaid: on this endpoint it means unpaid-and-overdue
  // and drops early-paid rows — fortnox-agent, EVIDENCE-SOURCES.md:21). A filtered read
  // over-reports the total; a short read is still refused by the walk.
  const { rows, read } = await getAllWithMeta<SupplierInvoiceSummary>(g, path, "SupplierInvoices", {
    exactTotal: params.length === 0,
  });
  const seen = new Set<string>();
  for (const r of rows) {
    const no = str(r.GivenNumber);
    if (no && seen.has(no)) {
      throw new FortnoxReadError(`/supplierinvoices returned invoice ${no} twice — pages repeated or shifted mid-read.`);
    }
    seen.add(no);
  }
  return {
    rows: rows.map((r) => ({ ...r, GivenNumber: str(r.GivenNumber), SupplierNumber: str(r.SupplierNumber) })),
    read,
  };
}

export async function getSupplierInvoice(g: GuardedFortnox, givenNumber: string): Promise<SupplierInvoiceDetail> {
  const res = await g.get<{ SupplierInvoice?: SupplierInvoiceDetail }>(
    `/supplierinvoices/${encodeURIComponent(givenNumber)}`,
  );
  if (!res?.SupplierInvoice) throw new FortnoxReadError(`GET /supplierinvoices/${givenNumber} returned no SupplierInvoice object.`);
  return { ...res.SupplierInvoice, GivenNumber: str(res.SupplierInvoice.GivenNumber), SupplierNumber: str(res.SupplierInvoice.SupplierNumber) };
}

/** Which rows of a supplier invoice are its cost rows: not Fortnox's TOT/VAT/PRE rows, not 24xx/26xx. */
export function costRowsOf(d: SupplierInvoiceDetail): Array<{ account: number; amount: number }> {
  const out: Array<{ account: number; amount: number }> = [];
  for (const r of d.SupplierInvoiceRows ?? []) {
    const code = str(r.Code).toUpperCase();
    if (code === "TOT" || code === "VAT" || code === "PRE") continue;
    const account = Number(r.Account);
    if (!Number.isInteger(account) || account <= 0) continue;
    if ((account >= 2400 && account < 2500) || (account >= 2600 && account < 2700)) continue;
    const amount = round2(num(r.Debit) - num(r.Credit));
    if (amount === 0) continue;
    out.push({ account, amount });
  }
  return out;
}

/**
 * The stored row from the full record. Total, Balance and VAT are decisions (paid, what to
 * forecast, the Ingående moms row): all three through requiredNum. A cancelled invoice has
 * no claim: Fortnox may still echo its balance.
 */
export function parseSupplierInvoice(d: SupplierInvoiceDetail): SupplierInvoiceRow {
  const no = str(d.GivenNumber);
  if (!no) throw new FortnoxReadError("A supplier invoice without GivenNumber cannot be stored.");
  const what = `Supplier invoice ${no}`;
  const invoiceDate = isoDate(d.InvoiceDate, `${what} InvoiceDate`);
  if (!invoiceDate) throw new FortnoxReadError(`${what} has no InvoiceDate.`);
  const cancelled = isCancelled(d);
  const total = requiredNum(d.Total, `${what} Total`);
  const costRows = costRowsOf(d).sort((a, b) => Math.abs(b.amount) - Math.abs(a.amount));
  // The header's VoucherSeries/VoucherNumber stay null on a booked invoice (verified live
  // 2026-09-09); the booking voucher is the SUPPLIERINVOICE entry of Vouchers[].
  const booking = (d.Vouchers ?? []).find((v) => str(v.ReferenceType).toUpperCase() === "SUPPLIERINVOICE") ?? (d.Vouchers ?? [])[0];
  const voucherSeries = str(d.VoucherSeries) || str(booking?.Series);
  const voucherNumber = num(d.VoucherNumber) || num(booking?.Number);
  const voucherYear = num(d.VoucherYear) || num(booking?.Year);
  return {
    given_number: no,
    supplier_number: str(d.SupplierNumber),
    supplier_name: str(d.SupplierName) || null,
    invoice_number: str(d.InvoiceNumber).trim() || null,
    invoice_date: invoiceDate,
    due_date: isoDate(d.DueDate, `${what} DueDate`),
    final_pay_date: isoDate(d.FinalPayDate, `${what} FinalPayDate`),
    total,
    vat: requiredNum(d.VAT, `${what} VAT`),
    balance: cancelled ? 0 : requiredNum(d.Balance, `${what} Balance`),
    currency: str(d.Currency) || "SEK",
    booked: fxBool(d.Booked),
    cancelled,
    credit: fxBool(d.Credit) || total < 0,
    account: costRows[0]?.account ?? null,
    cost_rows: costRows,
    voucher_series: voucherSeries || null,
    voucher_number: voucherNumber > 0 ? voucherNumber : null,
    voucher_year: voucherYear > 0 ? voucherYear : null,
    project_number: str(d.Project).trim() || null,
    comments: str(d.Comments) || null,
  };
}
