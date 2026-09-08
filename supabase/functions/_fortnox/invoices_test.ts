import { assertEquals, assertStringIncludes, assertThrows } from "jsr:@std/assert@1";
import {
  backfillWindow,
  getInvoice,
  isCancelled,
  listFinancialYears,
  listInvoices,
  parseInvoice,
} from "./invoices.ts";
import { GuardedFortnox } from "./guard.ts";
import { FortnoxCcClient } from "./client.ts";
import { json, mockFetch, noSleep, page, TOKEN_OK } from "./_test_helpers.ts";

function guarded(f: ReturnType<typeof mockFetch>) {
  return new GuardedFortnox(
    new FortnoxCcClient({
      clientId: "id",
      clientSecret: "s",
      tenantId: "1848969",
      fetchFn: f.fetch,
      sleep: noSleep,
    }),
  );
}

const detail = {
  DocumentNumber: 12,
  CustomerNumber: 1,
  CustomerName: "Exempel Handel AB",
  InvoiceDate: "2026-02-01",
  DueDate: "2026-03-03",
  Net: 1127.92,
  TotalVAT: 281.98,
  Total: "1 409,90",
  Balance: "0",
  Currency: "SEK",
  Booked: true,
  Sent: true,
  Cancelled: false,
  Project: "1101",
  TermsOfPayment: "30",
  OurReference: "Anna Andersson",
  ExternalInvoiceReference1: "{VV inv 1}",
  InvoiceType: "INVOICE",
};

Deno.test("parseInvoice reads Net, VAT, Total and Balance as numbers (Swedish strings too)", () => {
  const row = parseInvoice(detail);
  assertEquals(row.document_number, "12");
  assertEquals(row.customer_number, "1");
  assertEquals(row.amount_excl_vat, 1127.92);
  assertEquals(row.vat, 281.98);
  assertEquals(row.total, 1409.9);
  assertEquals(row.balance, 0);
  assertEquals(row.project_number, "1101");
  assertEquals(row.external_reference, "{VV inv 1}");
  assertEquals(row.credit, false);
  assertEquals(row.cancelled, false);
  assertEquals(row.invoice_type, "INVOICE");
});

Deno.test("a missing Balance throws — it is never read as paid", () => {
  const { Balance: _b, ...noBalance } = detail;
  assertThrows(() => parseInvoice(noBalance), Error, "Balance is missing");
});

Deno.test("a malformed Balance throws — it is never read as paid", () => {
  assertThrows(() => parseInvoice({ ...detail, Balance: "n/a" }), Error, "not a number");
});

Deno.test("a missing Net or TotalVAT throws — the ledger's figures are decisions too", () => {
  const { Net: _n, ...noNet } = detail;
  assertThrows(() => parseInvoice(noNet), Error, "Net is missing");
  assertThrows(() => parseInvoice({ ...detail, TotalVAT: "" }), Error, "TotalVAT is missing");
});

Deno.test("a cancelled invoice keeps its figures but has no balance; credits are recognised", () => {
  const c = parseInvoice({ ...detail, Cancelled: true, Balance: "1409.90" });
  assertEquals(c.cancelled, true);
  assertEquals(c.balance, 0);
  const cr = parseInvoice({ ...detail, Credit: true, Net: -1127.92, TotalVAT: -281.98, Total: -1409.9, Balance: 0 });
  assertEquals(cr.credit, true);
  assertEquals(cr.amount_excl_vat, -1127.92);
  assertEquals(isCancelled({ Cancel: true }), true, "the other spelling counts too");
  assertEquals(isCancelled({}), false, "absent means not cancelled");
});

Deno.test("a present but non-date InvoiceDate is an error, not a null", () => {
  assertThrows(() => parseInvoice({ ...detail, InvoiceDate: "igår" }), Error, "not a YYYY-MM-DD");
  assertThrows(() => parseInvoice({ ...detail, InvoiceDate: "" }), Error, "no InvoiceDate");
  assertEquals(parseInvoice({ ...detail, DueDate: undefined }).due_date, null);
});

Deno.test("listInvoices sends fromdate/todate and walks every page", async () => {
  const f = mockFetch([
    ["POST", "oauth-v1/token", TOKEN_OK],
    ["GET", "/invoices?fromdate=2025-01-01&todate=2026-12-31&page=1", () =>
      json(200, page("Invoices", [{ DocumentNumber: 1, CustomerNumber: 1 }], 1, 2, 2))],
    ["GET", "/invoices?fromdate=2025-01-01&todate=2026-12-31&page=2", () =>
      json(200, page("Invoices", [{ DocumentNumber: 2, CustomerNumber: 1 }], 2, 2, 2))],
  ]);
  const { rows, read } = await listInvoices(guarded(f), { fromDate: "2025-01-01", toDate: "2026-12-31" });
  assertEquals(rows.map((r) => r.DocumentNumber), ["1", "2"]);
  assertEquals(read.pages, 2);
});

Deno.test("an incremental invoice read sends lastmodified widened by ten minutes", async () => {
  const f = mockFetch([
    ["POST", "oauth-v1/token", TOKEN_OK],
    ["GET", "/invoices?lastmodified=", () => json(200, page("Invoices", [], 1, 1, 0))],
  ]);
  await listInvoices(guarded(f), { since: new Date("2026-09-08T10:00:00Z") });
  const url = decodeURIComponent(f.to("/invoices")[0].url);
  assertStringIncludes(url, "/invoices?lastmodified=2026-09-08 11:50&page=1&limit=500");
});

Deno.test("a truncated invoice list is a thrown error, not a shorter ledger", async () => {
  const f = mockFetch([
    ["POST", "oauth-v1/token", TOKEN_OK],
    ["GET", "/invoices?page=1", () => json(200, page("Invoices", [{ DocumentNumber: 1, CustomerNumber: 1 }], 1, 1, 3))],
  ]);
  let msg = "";
  try {
    await listInvoices(guarded(f));
  } catch (e) {
    msg = (e as Error).message;
  }
  assertStringIncludes(msg, "reported 3 resources but only 1 were read");
});

Deno.test("getInvoice returns the full record", async () => {
  const f = mockFetch([
    ["POST", "oauth-v1/token", TOKEN_OK],
    ["GET", "/invoices/12", () => json(200, { Invoice: detail })],
  ]);
  const d = await getInvoice(guarded(f), "12");
  assertEquals(d.DocumentNumber, "12");
  assertEquals(d.Net, 1127.92);
});

Deno.test("financial years sort by start date", async () => {
  const f = mockFetch([
    ["POST", "oauth-v1/token", TOKEN_OK],
    ["GET", "/financialyears", () =>
      json(
        200,
        page(
          "FinancialYears",
          [
            { Id: 2, FromDate: "2026-01-01", ToDate: "2026-12-31" },
            { Id: 1, FromDate: "2025-01-01", ToDate: "2025-12-31" },
          ],
          1,
          1,
          2,
        ),
      )],
  ]);
  const years = await listFinancialYears(guarded(f));
  assertEquals(years.map((y) => y.id), [1, 2]);
});

Deno.test("backfillWindow: current + previous financial year; current alone when there is no previous; calendar years without any", () => {
  const years = [
    { id: 1, from: "2025-01-01", to: "2025-12-31" },
    { id: 2, from: "2026-01-01", to: "2026-12-31" },
  ];
  const today = new Date("2026-09-08T10:00:00Z");
  assertEquals(backfillWindow(years, today), {
    fromDate: "2025-01-01",
    toDate: "2026-12-31",
    note: "financial years 2025-01-01…2025-12-31 and 2026-01-01…2026-12-31",
  });
  const only = backfillWindow([years[1]], today);
  assertEquals(only.fromDate, "2026-01-01");
  assertStringIncludes(only.note, "no previous financial year");
  const none = backfillWindow([], today);
  assertEquals([none.fromDate, none.toDate], ["2025-01-01", "2026-12-31"]);
  // A broken year (today outside every year) falls back to calendar years too.
  const off = backfillWindow([{ id: 9, from: "2020-05-01", to: "2021-04-30" }], today);
  assertEquals(off.fromDate, "2025-01-01");
});
