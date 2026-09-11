/**
 * Invoice → order matching. Pure: an invoice, the CRM's orders and round zero's links in,
 * a verdict with a Swedish reason out. Four rules, all on the same footing:
 *
 *   customer — the invoice's CustomerNumber is linked (customer_links) to the order's customer;
 *   project  — the invoice's Project is linked (project_links) to one of the order's screens;
 *   amount   — |amount ex VAT| equals one instalment of the order's plan (billing.ts's
 *              buildInvoiceSchedule: total / count), within AMOUNT_TOLERANCE;
 *   date     — the invoice date lies inside the order's billing window: from
 *              WINDOW_BEFORE_DAYS before the first planned date to WINDOW_AFTER_DAYS after
 *              the last (Filip invoices the month's instalment around its date; a month
 *              late is still the same order).
 *
 * All four → linked (`exact`), by the sync itself. Fewer → a proposal an admin confirms:
 * `high` = customer + project + amount (date off), `medium` = customer + project (amount
 * off — the "wrong amount" leftover), `low` = customer only, with or without amount (the
 * "project not in the CRM" leftover). No customer link → unmatched: nothing to propose.
 * Two orders passing all four → a proposal, never a link: ambiguity is a person's call.
 *
 * One rule before the four: a credit note goes to the same order as the invoice it credits,
 * when that invoice is linked — that is what makes "fakturerat" shrink by what was credited
 * (ruling on credit notes: they reduce fakturerat and are listed, nothing more). Fortnox
 * keeps the reference on the ORIGINAL (its CreditInvoiceReference names the note), so the
 * index carries the reverse map note → original.
 *
 * Tolerances are the builder's, stated here and on the meeting page: 1,00 kr or 0,5 %,
 * whichever is larger (öre rounding of total/12 and Fortnox's own rounding); 14 days
 * before, 31 days after.
 */

export const AMOUNT_TOLERANCE_ABS = 1.0;
export const AMOUNT_TOLERANCE_REL = 0.005;
export const WINDOW_BEFORE_DAYS = 14;
export const WINDOW_AFTER_DAYS = 31;

export type InvoiceMatchStatus = "linked" | "proposed" | "unmatched";
export type InvoiceConfidence = "exact" | "high" | "medium" | "low" | "none";

export interface MatchOrder {
  id: string;
  customer_id: string | null;
  company_name: string;
  billing_frequency: string | null;
  billing_duration_months: number | null;
  total_excl_vat: number;
  invoice_start_date: string | null;
  created_at: string;
  /** product ids of the order's screens (order_items.product_id). */
  product_ids: string[];
}

export interface MatchInvoice {
  document_number: string;
  /** Fortnox's CustomerNumber, an opaque string: Vega Vista has one that is an organisation
   * number ("556527-5590", invoice 85). Compared as-is, never parsed or reshaped. */
  customer_number: string;
  /** Fortnox's CustomerName, for the reason text only. */
  customer_name?: string | null;
  project_number: string | null;
  amount_excl_vat: number;
  invoice_date: string;
  credit: boolean;
  /** On a credit note: the DocumentNumber of the invoice it credits, when known. */
  credits_document_number?: string | null;
}

export interface MatchIndex {
  /** Fortnox CustomerNumber → CRM customer id, linked rows only. */
  customerIdByNumber: Map<string, string>;
  /** Fortnox ProjectNumber → CRM product id, linked rows only. */
  productIdByProject: Map<string, string>;
  /** CRM customer id → that customer's orders. */
  ordersByCustomer: Map<string, MatchOrder[]>;
  /** Fortnox DocumentNumber → order id, for every invoice already linked (credit notes follow their invoice). */
  orderIdByDocument?: Map<string, string>;
  /** Credit note DocumentNumber → the original's DocumentNumber (from the originals' CreditInvoiceReference). */
  originalOfCreditNote?: Map<string, string>;
}

export interface RuleSet {
  customer: boolean;
  project: boolean;
  amount: boolean;
  date: boolean;
}

export interface InvoiceMatch {
  status: InvoiceMatchStatus;
  orderId: string | null;
  candidateOrderId: string | null;
  confidence: InvoiceConfidence;
  method: "rules" | "none";
  reason: string;
  rules: RuleSet | null;
}

export interface PlannedSchedule {
  count: number;
  perInstalment: number;
  first: Date | null;
  last: Date | null;
}

const STEP: Record<string, number> = { manad: 1, kvartal: 3, halvar: 6 };

const addMonths = (d: Date, n: number): Date => {
  const r = new Date(d.getTime());
  r.setUTCMonth(r.getUTCMonth() + n);
  return r;
};
const addDays = (d: Date, n: number): Date => new Date(d.getTime() + n * 86_400_000);
const parseDay = (s: string | null | undefined): Date | null => {
  if (!s) return null;
  const d = new Date(`${s.slice(0, 10)}T00:00:00Z`);
  return Number.isNaN(d.getTime()) ? null : d;
};

/** Mirrors src/lib/billing.ts buildInvoiceSchedule and the SQL fortnox.installments_planned. */
export function plannedSchedule(o: MatchOrder): PlannedSchedule {
  const start = parseDay(o.invoice_start_date) ?? parseDay(o.created_at);
  const freq = o.billing_frequency ?? "engang";
  if (freq === "engang" || !STEP[freq]) {
    return { count: 1, perInstalment: o.total_excl_vat, first: start, last: start };
  }
  const step = STEP[freq];
  const dur = Math.max(1, o.billing_duration_months || step);
  const count = Math.max(1, Math.ceil(dur / step));
  return {
    count,
    perInstalment: o.total_excl_vat / count,
    first: start,
    last: start ? addMonths(start, (count - 1) * step) : null,
  };
}

export function amountMatches(invoiceAmount: number, instalment: number): boolean {
  const tol = Math.max(AMOUNT_TOLERANCE_ABS, Math.abs(instalment) * AMOUNT_TOLERANCE_REL);
  return Math.abs(Math.abs(invoiceAmount) - Math.abs(instalment)) <= tol;
}

export function dateInWindow(invoiceDate: string, s: PlannedSchedule): boolean {
  const d = parseDay(invoiceDate);
  if (!d || !s.first || !s.last) return false;
  return d >= addDays(s.first, -WINDOW_BEFORE_DAYS) && d <= addDays(s.last, WINDOW_AFTER_DAYS);
}

/** "1 127,92 kr" — Swedish grouping with a plain space (Intl's non-breaking one is invisible in a diff). */
export const kr = (n: number) =>
  new Intl.NumberFormat("sv-SE", { maximumFractionDigits: 2 }).format(n).replace(/\s/g, " ") + " kr";

const FREQ_LABEL: Record<string, string> = {
  engang: "engångsfaktura",
  manad: "månadsvis",
  kvartal: "kvartalsvis",
  halvar: "halvårsvis",
};

/** "Exempel Handel AB · 1 128 kr × 12 månadsvis från 2026-02-01" — how the page names an order. */
export function orderLabel(o: MatchOrder): string {
  const s = plannedSchedule(o);
  const freq = FREQ_LABEL[o.billing_frequency ?? "engang"] ?? o.billing_frequency ?? "";
  const from = o.invoice_start_date ? ` från ${o.invoice_start_date.slice(0, 10)}` : "";
  return s.count === 1
    ? `${o.company_name} · ${kr(o.total_excl_vat)} ${freq}${from}`
    : `${o.company_name} · ${kr(s.perInstalment)} × ${s.count} ${freq}${from}`;
}

interface Scored {
  order: MatchOrder;
  rules: RuleSet;
  score: number;
  amountDiff: number;
}

function judge(inv: MatchInvoice, o: MatchOrder, index: MatchIndex): Scored {
  const s = plannedSchedule(o);
  const productId = inv.project_number ? index.productIdByProject.get(inv.project_number) : undefined;
  const rules: RuleSet = {
    customer: true, // the candidate list is already the customer's orders
    project: Boolean(productId) && o.product_ids.includes(productId!),
    amount: amountMatches(inv.amount_excl_vat, s.perInstalment),
    date: dateInWindow(inv.invoice_date, s),
  };
  // Weights order the candidates: project outranks amount outranks date.
  const score = (rules.project ? 4 : 0) + (rules.amount ? 2 : 0) + (rules.date ? 1 : 0);
  return { order: o, rules, score, amountDiff: Math.abs(Math.abs(inv.amount_excl_vat) - Math.abs(s.perInstalment)) };
}

function confidenceOf(r: RuleSet): InvoiceConfidence {
  if (r.customer && r.project && r.amount && r.date) return "exact";
  if (r.customer && r.project && r.amount) return "high";
  if (r.customer && r.project) return "medium";
  if (r.customer) return "low";
  return "none";
}

function whyNot(inv: MatchInvoice, best: Scored, index: MatchIndex): string {
  const parts: string[] = [];
  const s = plannedSchedule(best.order);
  if (!best.rules.project) {
    if (!inv.project_number) parts.push("fakturan saknar projekt");
    else if (!index.productIdByProject.has(inv.project_number))
      parts.push(`Fortnox-projekt ${inv.project_number} är inte kopplat till någon skärm i CRM:et`);
    else parts.push(`projektet ${inv.project_number} hör inte till ordern`);
  }
  if (!best.rules.amount)
    parts.push(
      `beloppet ${kr(inv.amount_excl_vat)} matchar ingen delfaktura (planerat ${kr(s.perInstalment)}${s.count > 1 ? ` × ${s.count}` : ""})`,
    );
  if (!best.rules.date)
    parts.push(
      s.first && s.last
        ? `fakturadatum ${inv.invoice_date} ligger utanför orderns faktureringsfönster ${s.first.toISOString().slice(0, 10)}…${s.last.toISOString().slice(0, 10)} (±${WINDOW_BEFORE_DAYS}/${WINDOW_AFTER_DAYS} dagar)`
        : "ordern saknar faktureringsdatum",
    );
  return parts.join("; ");
}

/** The verdict for one invoice. Cancelled invoices are judged like the rest, so the row shows where it belonged. */
export function matchInvoice(inv: MatchInvoice, index: MatchIndex): InvoiceMatch {
  if (inv.credit) {
    const original = inv.credits_document_number ?? index.originalOfCreditNote?.get(inv.document_number);
    const orderId = original ? index.orderIdByDocument?.get(original) : undefined;
    if (original && orderId) {
      return {
        status: "linked",
        orderId,
        candidateOrderId: orderId,
        confidence: "exact",
        method: "rules",
        reason: `Kreditfaktura till faktura ${original}, som är kopplad till samma order – minskar fakturerat med ${kr(Math.abs(inv.amount_excl_vat))}`,
        rules: { customer: true, project: true, amount: true, date: true },
      };
    }
  }
  const customerId = index.customerIdByNumber.get(inv.customer_number);
  if (!customerId) {
    return {
      status: "unmatched",
      orderId: null,
      candidateOrderId: null,
      confidence: "none",
      method: "none",
      reason: `Fortnox-kund ${inv.customer_number}${inv.customer_name ? ` (${inv.customer_name})` : ""} är inte kopplad till någon kund i CRM:et`,
      rules: null,
    };
  }
  const orders = index.ordersByCustomer.get(customerId) ?? [];
  if (orders.length === 0) {
    return {
      status: "unmatched",
      orderId: null,
      candidateOrderId: null,
      confidence: "none",
      method: "none",
      reason: "Kunden finns i CRM:et men har ingen order",
      rules: { customer: true, project: false, amount: false, date: false },
    };
  }
  const scored = orders
    .map((o) => judge(inv, o, index))
    .sort(
      (a, b) =>
        b.score - a.score ||
        a.amountDiff - b.amountDiff ||
        a.order.created_at.localeCompare(b.order.created_at),
    );
  const best = scored[0];
  const full = scored.filter((s) => s.score === 7);
  const credit = inv.credit ? "Kreditfaktura: " : "";

  if (full.length === 1) {
    return {
      status: "linked",
      orderId: best.order.id,
      candidateOrderId: best.order.id,
      confidence: "exact",
      method: "rules",
      reason: `${credit}Kund, projekt, belopp (${kr(inv.amount_excl_vat)} = en delfaktura) och datum stämmer med ordern ${orderLabel(best.order)}`,
      rules: best.rules,
    };
  }
  if (full.length > 1) {
    return {
      status: "proposed",
      orderId: null,
      candidateOrderId: best.order.id,
      confidence: "high",
      method: "rules",
      reason: `${credit}${full.length} ordrar passar lika bra (${full.map((s) => orderLabel(s.order)).join(" / ")}) – välj vilken`,
      rules: best.rules,
    };
  }
  const confidence = confidenceOf(best.rules);
  return {
    status: "proposed",
    orderId: null,
    candidateOrderId: best.order.id,
    confidence,
    method: "rules",
    reason: `${credit}Förslag ${orderLabel(best.order)} – ${whyNot(inv, best, index)}`,
    rules: best.rules,
  };
}

/** What an existing row says about who decided it. */
export interface ExistingMatch {
  match_status: "unmatched" | "proposed" | "linked" | "ignored";
  matched_by: string | null;
  order_id: string | null;
}

/** A stored invoice as fortnox.invoices holds it: what the matcher reads plus its current verdict. */
export interface StoredInvoice extends MatchInvoice, ExistingMatch {
  candidate_order_id: string | null;
  match_confidence: InvoiceConfidence;
  match_method: "rules" | "manual" | "none";
  match_reason: string | null;
}

export type MatchUpdate = { document_number: string } & NonNullable<ReturnType<typeof mergeMatch>>;

/**
 * The stored invoices a run did not read, judged again against today's links and bookings.
 * An incremental run reads only what Fortnox changed, so an invoice read before its customer
 * or screen was linked (or its order booked) would keep "Fortnox-kund … är inte kopplad" for
 * good — on the first read of Vega Vista's books, every invoice was judged before any
 * customer could be linked. Same rules as a fresh read (mergeMatch: an admin's choice and a
 * standing sync link are never touched). Returns only the rows whose verdict changes, so a
 * run with nothing new writes nothing. Ordinary invoices go first, so a credit note can
 * follow an invoice linked in the same pass.
 */
export function rejudge(stored: StoredInvoice[], index: MatchIndex, now: Date): MatchUpdate[] {
  const updates: MatchUpdate[] = [];
  const ordered = [...stored].sort(
    (a, b) => Number(a.credit) - Number(b.credit) || a.invoice_date.localeCompare(b.invoice_date),
  );
  for (const s of ordered) {
    const merged = mergeMatch(s, matchInvoice(s, index), now);
    if (!merged) continue;
    if (merged.match_status === "linked" && merged.order_id) index.orderIdByDocument?.set(s.document_number, merged.order_id);
    const same =
      merged.match_status === s.match_status &&
      merged.order_id === s.order_id &&
      merged.candidate_order_id === s.candidate_order_id &&
      merged.match_confidence === s.match_confidence &&
      merged.match_method === s.match_method &&
      merged.match_reason === s.match_reason;
    if (!same) updates.push({ document_number: s.document_number, ...merged });
  }
  return updates;
}

export const isAdminDecision = (e: ExistingMatch | undefined | null): boolean =>
  Boolean(e?.matched_by && e.matched_by.startsWith("admin:"));

/**
 * The match columns to write for an invoice this run: an admin's choice (a link or
 * "Lämna okopplad") is kept as it is — the sync never overwrites it; a sync link whose
 * order still exists is kept too (re-judging a linked row could only unlink it on a
 * changed tolerance, which is a person's call); everything else takes the fresh verdict.
 */
export function mergeMatch(
  existing: ExistingMatch | undefined | null,
  fresh: InvoiceMatch,
  now: Date,
): {
  order_id: string | null;
  candidate_order_id: string | null;
  match_status: "unmatched" | "proposed" | "linked" | "ignored";
  match_confidence: InvoiceConfidence;
  match_method: "rules" | "manual" | "none";
  match_reason: string;
  matched_by: string | null;
  matched_at: string | null;
} | null {
  if (isAdminDecision(existing)) return null;
  if (existing?.match_status === "linked" && existing.order_id) return null;
  return {
    order_id: fresh.orderId,
    candidate_order_id: fresh.candidateOrderId,
    match_status: fresh.status,
    match_confidence: fresh.confidence,
    match_method: fresh.method,
    match_reason: fresh.reason,
    matched_by: fresh.status === "linked" ? "sync" : null,
    matched_at: fresh.status === "linked" ? now.toISOString() : null,
  };
}
