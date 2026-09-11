import { assert, assertEquals, assertStringIncludes } from "jsr:@std/assert@1";
import {
  amountMatches,
  dateInWindow,
  type MatchIndex,
  type MatchInvoice,
  type MatchOrder,
  matchInvoice,
  mergeMatch,
  orderLabel,
  plannedSchedule,
  rejudge,
  type StoredInvoice,
} from "./invoice-matcher.ts";

const monthly: MatchOrder = {
  id: "order-1",
  customer_id: "cust-1",
  company_name: "Exempel Handel AB",
  billing_frequency: "manad",
  billing_duration_months: 12,
  total_excl_vat: 13535,
  invoice_start_date: "2026-02-01",
  created_at: "2026-01-20T10:00:00Z",
  product_ids: ["prod-1101"],
};
const oneOff: MatchOrder = {
  id: "order-3",
  customer_id: "cust-1",
  company_name: "Exempel Handel AB",
  billing_frequency: "engang",
  billing_duration_months: 1,
  total_excl_vat: 4500,
  invoice_start_date: "2026-03-15",
  created_at: "2026-03-10T10:00:00Z",
  product_ids: ["prod-1103"],
};

const index = (): MatchIndex => ({
  customerIdByNumber: new Map([["1", "cust-1"]]),
  productIdByProject: new Map([
    ["1101", "prod-1101"],
    ["1103", "prod-1103"],
  ]),
  ordersByCustomer: new Map([["cust-1", [monthly, oneOff]]]),
});

const inv = (over: Partial<MatchInvoice>): MatchInvoice => ({
  document_number: "7",
  customer_number: "1",
  project_number: "1101",
  amount_excl_vat: 1127.92,
  invoice_date: "2026-05-01",
  credit: false,
  ...over,
});

Deno.test("plannedSchedule mirrors buildInvoiceSchedule", () => {
  const s = plannedSchedule(monthly);
  assertEquals(s.count, 12);
  assert(Math.abs(s.perInstalment - 1127.9166) < 0.001);
  assertEquals(s.first?.toISOString().slice(0, 10), "2026-02-01");
  assertEquals(s.last?.toISOString().slice(0, 10), "2027-01-01");
  const q = plannedSchedule({ ...monthly, billing_frequency: "kvartal", total_excl_vat: 25000 });
  assertEquals([q.count, q.perInstalment], [4, 6250]);
  assertEquals(plannedSchedule(oneOff).count, 1);
});

Deno.test("amount tolerance: 1 kr or 0,5 %, whichever is larger", () => {
  assert(amountMatches(1127.92, 13535 / 12));
  assert(amountMatches(1128, 13535 / 12));
  assert(!amountMatches(999, 13535 / 12));
  assert(amountMatches(100_400, 100_000), "0,5 % of 100 000 is 500");
  assert(!amountMatches(100_600, 100_000));
  assert(amountMatches(-1127.92, 13535 / 12), "a credit note matches by absolute value");
});

Deno.test("date window: 14 days before the first planned date, 31 after the last", () => {
  const s = plannedSchedule(monthly);
  assert(dateInWindow("2026-01-18", s));
  assert(!dateInWindow("2026-01-17", s));
  assert(dateInWindow("2027-02-01", s));
  assert(!dateInWindow("2027-02-02", s));
});

Deno.test("all four rules → linked by the sync, confidence exact, reason names the order", () => {
  const m = matchInvoice(inv({}), index());
  assertEquals(m.status, "linked");
  assertEquals(m.orderId, "order-1");
  assertEquals(m.confidence, "exact");
  assertEquals(m.method, "rules");
  assertStringIncludes(m.reason, "Kund, projekt, belopp");
  assertStringIncludes(m.reason, "Exempel Handel AB");
});

Deno.test("wrong amount → proposal (medium) with the planned instalment in the reason", () => {
  const m = matchInvoice(inv({ amount_excl_vat: 999 }), index());
  assertEquals(m.status, "proposed");
  assertEquals(m.orderId, null);
  assertEquals(m.candidateOrderId, "order-1");
  assertEquals(m.confidence, "medium");
  assertStringIncludes(m.reason, "matchar ingen delfaktura");
  assertStringIncludes(m.reason, "1 127,92 kr");
});

Deno.test("project not in the CRM → proposal (low) that says so", () => {
  const m = matchInvoice(inv({ project_number: "9999" }), index());
  assertEquals(m.status, "proposed");
  assertEquals(m.confidence, "low");
  assertStringIncludes(m.reason, "Fortnox-projekt 9999 är inte kopplat");
});

Deno.test("date outside the window → proposal (high)", () => {
  const m = matchInvoice(inv({ invoice_date: "2025-06-01" }), index());
  assertEquals(m.status, "proposed");
  assertEquals(m.confidence, "high");
  assertStringIncludes(m.reason, "utanför orderns faktureringsfönster");
});

Deno.test("customer not linked → unmatched with a reason; customer without orders → unmatched", () => {
  const m = matchInvoice(inv({ customer_number: "42" }), index());
  assertEquals(m.status, "unmatched");
  assertEquals(m.confidence, "none");
  assertStringIncludes(m.reason, "Fortnox-kund 42 är inte kopplad");
  const ix = index();
  ix.ordersByCustomer.set("cust-1", []);
  assertStringIncludes(matchInvoice(inv({}), ix).reason, "ingen order");
});

Deno.test("a customer number that is an organisation number (556527-5590, invoice 85) is an opaque string", () => {
  // Vega Vista's Borås Energi och Miljö AB has CustomerNumber "556527-5590" in Fortnox.
  const orgLike = "556527-5590";
  const unlinked = matchInvoice(
    inv({ document_number: "85", customer_number: orgLike, customer_name: "Borås Energi och Miljö AB" }),
    index(),
  );
  assertEquals(unlinked.status, "unmatched");
  assertEquals(
    unlinked.reason,
    "Fortnox-kund 556527-5590 (Borås Energi och Miljö AB) är inte kopplad till någon kund i CRM:et",
  );
  // Linked like any other: the link table's key is the number exactly as Fortnox sends it.
  const ix = index();
  ix.customerIdByNumber = new Map([[orgLike, "cust-1"]]);
  const linked = matchInvoice(inv({ customer_number: orgLike }), ix);
  assertEquals(linked.status, "linked");
  assertEquals(linked.orderId, "order-1");
  // No reshaping: the digits alone, or a number, are other customers.
  for (const other of ["5565275590", "556527", "556527-559"]) {
    assertEquals(matchInvoice(inv({ customer_number: other }), ix).status, "unmatched", other);
  }
});

Deno.test("two orders passing all four → a proposal, never a link", () => {
  const twin: MatchOrder = { ...monthly, id: "order-2", created_at: "2026-01-21T10:00:00Z" };
  const ix = index();
  ix.ordersByCustomer.set("cust-1", [monthly, twin]);
  const m = matchInvoice(inv({}), ix);
  assertEquals(m.status, "proposed");
  assertEquals(m.candidateOrderId, "order-1", "the earliest created is proposed");
  assertStringIncludes(m.reason, "2 ordrar passar lika bra");
});

Deno.test("the best candidate wins: project outranks amount outranks date", () => {
  // Amount 4500 matches the one-off (project 1103) but the invoice says project 1101.
  const m = matchInvoice(inv({ amount_excl_vat: 4500, invoice_date: "2026-03-15" }), index());
  assertEquals(m.status, "proposed");
  assertEquals(m.candidateOrderId, "order-1", "the order whose project matches is proposed");
  assertEquals(m.confidence, "medium");
});

Deno.test("a credit note with matching absolute amount links and is named as a credit", () => {
  const m = matchInvoice(inv({ amount_excl_vat: -1127.92, credit: true }), index());
  assertEquals(m.status, "linked");
  assertStringIncludes(m.reason, "Kreditfaktura");
});

Deno.test("a credit note follows the invoice it credits, whatever its own amount or date", () => {
  const ix = index();
  ix.orderIdByDocument = new Map([["12", "order-3"]]);
  // Fortnox keeps the reference on the original, so the index carries note → original.
  ix.originalOfCreditNote = new Map([["13", "12"]]);
  const m = matchInvoice(
    inv({ document_number: "13", amount_excl_vat: -4500, invoice_date: "2026-09-08", project_number: "1103", credit: true }),
    ix,
  );
  assertEquals(m.status, "linked");
  assertEquals(m.orderId, "order-3");
  assertStringIncludes(m.reason, "Kreditfaktura till faktura 12");
  // Without a linked original it falls back to the four rules.
  ix.orderIdByDocument = new Map();
  const fallback = matchInvoice(inv({ document_number: "13", amount_excl_vat: -4500, credit: true }), ix);
  assertEquals(fallback.status, "proposed");
});

Deno.test("orderLabel names the plan", () => {
  assertEquals(orderLabel(oneOff), "Exempel Handel AB · 4 500 kr engångsfaktura från 2026-03-15");
  assertStringIncludes(orderLabel(monthly), "× 12 månadsvis från 2026-02-01");
});

Deno.test("rejudge: an invoice read before its customer was linked is matched once the link exists; nothing new writes nothing", () => {
  const now = new Date("2026-09-11T14:00:00Z");
  const stale = (over: Partial<StoredInvoice>): StoredInvoice => ({
    ...inv({}),
    match_status: "unmatched",
    matched_by: null,
    order_id: null,
    candidate_order_id: null,
    match_confidence: "none",
    match_method: "none",
    match_reason: "Fortnox-kund 1 är inte kopplad till någon kund i CRM:et",
    ...over,
  });
  const noLinks: MatchIndex = { ...index(), customerIdByNumber: new Map() };
  // Before the link: the stored verdict still holds, so nothing is written.
  const before = stale({});
  assertEquals(rejudge([before], noLinks, now), []);
  // After the link: the same row is linked (all four rules), and a credit note on it follows.
  const ix = index();
  ix.orderIdByDocument = new Map();
  ix.originalOfCreditNote = new Map([["8", "7"]]);
  const note = stale({ document_number: "8", credit: true, amount_excl_vat: -1127.92, invoice_date: "2026-05-20" });
  const updates = rejudge([note, before], ix, now);
  assertEquals(updates.map((u) => [u.document_number, u.match_status, u.order_id]), [
    ["7", "linked", "order-1"],
    ["8", "linked", "order-1"],
  ]);
  // Run it again on what was written: no changes, no writes.
  const written = updates.map((u) => ({ ...(u.document_number === "7" ? before : note), ...u }) as StoredInvoice);
  assertEquals(rejudge(written, ix, now), []);
  // An admin's "Lämna okopplad" / choice is never re-judged.
  assertEquals(rejudge([stale({ match_status: "proposed", matched_by: "admin:abc" })], ix, now), []);
});

Deno.test("mergeMatch: an admin's choice is never overwritten, a sync link is kept, the rest is re-judged", () => {
  const now = new Date("2026-09-08T10:00:00Z");
  const fresh = matchInvoice(inv({ amount_excl_vat: 999 }), index());
  assertEquals(mergeMatch({ match_status: "linked", matched_by: "admin:abc", order_id: "order-3" }, fresh, now), null);
  assertEquals(mergeMatch({ match_status: "ignored", matched_by: "admin:abc", order_id: null }, fresh, now), null);
  assertEquals(mergeMatch({ match_status: "linked", matched_by: "sync", order_id: "order-1" }, fresh, now), null);
  const re = mergeMatch({ match_status: "proposed", matched_by: null, order_id: null }, fresh, now);
  assertEquals(re?.match_status, "proposed");
  assertEquals(re?.candidate_order_id, "order-1");
  assertEquals(re?.matched_by, null);
  const linked = mergeMatch(undefined, matchInvoice(inv({}), index()), now);
  assertEquals(linked?.match_status, "linked");
  assertEquals(linked?.matched_by, "sync");
  assertEquals(linked?.matched_at, now.toISOString());
  // A sync link whose order was deleted (FK set null) is re-judged.
  const orphan = mergeMatch({ match_status: "linked", matched_by: "sync", order_id: null }, fresh, now);
  assertEquals(orphan?.match_status, "proposed");
});
