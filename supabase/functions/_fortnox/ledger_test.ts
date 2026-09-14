import { assert, assertEquals, assertThrows } from "jsr:@std/assert@1";
import { assertRejects } from "jsr:@std/assert@1";
import {
  clampToYear,
  costRowsOf,
  decodeCp437,
  financialYearsCovering,
  listSupplierInvoices,
  listVouchers,
  parseSie,
  parseSupplierInvoice,
  postingsFromSie,
  sieForYear,
} from "./ledger.ts";
import { FortnoxCcClient } from "./client.ts";
import { GuardedFortnox } from "./guard.ts";
import { FortnoxReadError } from "./errors.ts";
import { mockFetch, noSleep, page, TOKEN_OK } from "./_test_helpers.ts";

const YEARS = [
  { id: 1, from: "2025-05-01", to: "2026-04-30" },
  { id: 2, from: "2026-05-01", to: "2027-04-30" },
];

const SIE = `#FLAGGA 0
#FORMAT PC8
#SIETYP 4
#PROGRAM "Fortnox" 3.61.17
#GEN 20260909
#FNR 1848969
#FNAMN "Nytt test eriks konto"
#RAR 0 20260501 20270430
#RAR -1 20250501 20260430
#ORGNR 556714-7532
#KPTYP EUBAS97
#KONTO 1510 "Kundfordringar"
#KONTO 1930 "Företagskonto"
#KONTO 5010 "Lokalhyra \\"kontoret\\""
#IB 0 1930 12345.50 0
#UB 0 1930 10000 0
#IB -1 1930 0 0
#VER B 9 20260201 "Kundfaktura 5" 20260908
{
#TRANS 1510 {} 1409.90 "" "" 0
#TRANS 3001 {} -1127.92 "" "" 0
#TRANS 2611 {} -281.98 "" "" 0
}
#VER A 4 20260225 "{VV cf pay-5} Inbetalning faktura 5" 20260909
{
#TRANS 1930 {6 "1005"} 1409.90 "" "" 0
#TRANS 1510 {} -1409.90 "" "" 0
}
`;

Deno.test("parseSie reads years, accounts, balances and balanced vouchers with dimensions and escaped quotes", () => {
  const doc = parseSie(SIE);
  assertEquals(doc.companyId, "1848969");
  assertEquals(doc.companyName, "Nytt test eriks konto");
  assertEquals(doc.years[0], { from: "2026-05-01", to: "2027-04-30" });
  assertEquals(doc.years[-1], { from: "2025-05-01", to: "2026-04-30" });
  assertEquals(doc.accounts["5010"], 'Lokalhyra "kontoret"');
  assertEquals(doc.openingBalances[0]["1930"], 12345.5);
  assertEquals(doc.closingBalances[0]["1930"], 10000);
  assertEquals(doc.vouchers.length, 2);
  assertEquals(doc.vouchers[0], {
    series: "B",
    number: "9",
    date: "2026-02-01",
    text: "Kundfaktura 5",
    regDate: "2026-09-08",
    lines: [
      { account: 1510, amount: 1409.9 },
      { account: 3001, amount: -1127.92 },
      { account: 2611, amount: -281.98 },
    ],
  });
  assertEquals(doc.vouchers[1].lines[0], { account: 1930, amount: 1409.9 });
});

Deno.test("parseSie refuses a posting whose amount cannot be read, and an unbalanced voucher", () => {
  assertThrows(
    () => parseSie('#VER A 1 20260101 "x"\n{\n#TRANS 1930 {} abc "" "" 0\n#TRANS 2440 {} -1 "" "" 0\n}\n'),
    FortnoxReadError,
    "cannot read the posting",
  );
  assertThrows(
    () => parseSie('#VER A 1 20260101 "x"\n{\n#TRANS 1930 {} 10 "" "" 0\n#TRANS 2440 {} -9 "" "" 0\n}\n'),
    FortnoxReadError,
    "does not balance",
  );
  assertThrows(() => parseSie('#VER A 1 20260101 "x"\n{\n#TRANS 1930 {} 1 "" "" 0\n'), FortnoxReadError, "ends inside");
});

Deno.test("decodeCp437 maps the Swedish letters (PC8) and passes ASCII through", () => {
  // "Företagskonto" in CP437: ö = 0x94; "å" = 0x86, "ä" = 0x84, "Ö" = 0x99, "Ä" = 0x8E, "Å" = 0x8F
  const bytes = new Uint8Array([0x46, 0x94, 0x72, 0x20, 0x86, 0x84, 0x99, 0x8e, 0x8f]);
  assertEquals(decodeCp437(bytes), "För åäÖÄÅ");
});

Deno.test("postingsFromSie turns vouchers into one row per posting with debit/credit split, plus balances and the chart", () => {
  const { postings, balances, accounts } = postingsFromSie(parseSie(SIE), 2);
  assertEquals(postings.length, 5);
  assertEquals(postings[0], {
    financial_year_id: 2,
    voucher_series: "B",
    voucher_number: 9,
    row_no: 1,
    transaction_date: "2026-02-01",
    account: 1510,
    debit: 1409.9,
    credit: 0,
    amount: 1409.9,
    description: "Kundfaktura 5",
    reg_date: "2026-09-08",
  });
  assertEquals(postings[1].credit, 1127.92);
  assertEquals(postings[1].debit, 0);
  assertEquals(postings[1].amount, -1127.92);
  assertEquals(balances, [{ financial_year_id: 2, account: 1930, opening_balance: 12345.5, closing_balance: 10000 }]);
  assertEquals(accounts.map((a) => a.account), [1510, 1930, 5010]);
});

Deno.test("financialYearsCovering picks every year a period touches, in order, and throws when none does", () => {
  assertEquals(financialYearsCovering(YEARS, "2026-04-01", "2026-06-30").map((y) => y.id), [1, 2]);
  assertEquals(financialYearsCovering(YEARS, "2026-06-01", "2026-06-30").map((y) => y.id), [2]);
  assertThrows(() => financialYearsCovering(YEARS, "2030-01-01", "2030-01-31"), FortnoxReadError, "No Fortnox financial year");
  assertEquals(clampToYear(YEARS[0], "2026-04-01", "2026-06-30"), { from: "2026-04-01", to: "2026-04-30" });
  assertEquals(clampToYear(YEARS[1], "2026-04-01", "2026-06-30"), { from: "2026-05-01", to: "2026-06-30" });
  assertEquals(clampToYear(YEARS[1], "2025-01-01", "2025-02-01"), null);
});

function client(fx: ReturnType<typeof mockFetch>) {
  return new GuardedFortnox(
    new FortnoxCcClient({ clientId: "id", clientSecret: "secret", tenantId: "1848969", fetchFn: fx.fetch, sleep: noSleep }),
  );
}

Deno.test("sieForYear sends the wildcard Accept header and decodes CP437 before parsing", async () => {
  const body = new TextEncoder().encode(SIE.replace("Företagskonto", "F?retagskonto"));
  // Put a real CP437 ö (0x94) where the placeholder is.
  const idx = body.indexOf(0x3f);
  body[idx] = 0x94;
  const fx = mockFetch([
    ["POST", "/oauth-v1/token", TOKEN_OK],
    ["GET", "/sie/4?financialyear=2", () => new Response(body, { status: 200, headers: { "content-type": "application/octet-stream" } })],
  ]);
  const doc = await sieForYear(client(fx), 2);
  assertEquals(fx.to("/sie/4")[0].headers["accept"], "*/*");
  assertEquals(doc.accounts["1930"], "Företagskonto");
  assertEquals(doc.vouchers.length, 2);
});

Deno.test("listVouchers walks the headers of one financial year; listSupplierInvoices refuses a duplicate GivenNumber", async () => {
  const fx = mockFetch([
    ["POST", "/oauth-v1/token", TOKEN_OK],
    ["GET", "/vouchers?financialyear=2", () =>
      new Response(
        JSON.stringify(page("Vouchers", [{ VoucherSeries: "A", VoucherNumber: 4, TransactionDate: "2026-02-25", Description: "{VV cf pay-5} x", Year: 2 }], 1, 1, 1)),
        { status: 200, headers: { "content-type": "application/json" } },
      )],
    ["GET", "/supplierinvoices", () =>
      new Response(
        JSON.stringify(page("SupplierInvoices", [{ GivenNumber: 1, Total: 100, Balance: 100 }, { GivenNumber: 1, Total: 100, Balance: 100 }], 1, 1, 2)),
        { status: 200, headers: { "content-type": "application/json" } },
      )],
  ]);
  const g = client(fx);
  const v = await listVouchers(g, 2);
  assertEquals(v.rows, [{ series: "A", number: "4", date: "2026-02-25", description: "{VV cf pay-5} x", year: 2 }]);
  await assertRejects(() => listSupplierInvoices(g), FortnoxReadError, "twice");
});

Deno.test("parseSupplierInvoice reads Total, VAT and Balance as decisions, finds the cost rows and the leading account", () => {
  const row = parseSupplierInvoice({
    GivenNumber: "7",
    SupplierNumber: "3",
    SupplierName: "Skärmleasing Nord AB",
    InvoiceNumber: "VV-CF-leasing-2026-08",
    InvoiceDate: "2026-08-01",
    DueDate: "2026-08-31",
    Total: "12 500,00",
    VAT: 2500,
    Balance: 0,
    Booked: true,
    FinalPayDate: "2026-08-29",
    VoucherSeries: undefined,
    VoucherNumber: undefined,
    Vouchers: [{ Series: "D", Number: 12, Year: 2, ReferenceType: "SUPPLIERINVOICE" }],
    SupplierInvoiceRows: [
      { Account: 2440, Credit: 12500, Debit: 0, Code: "TOT" },
      { Account: 2641, Debit: 2500, Credit: 0, Code: "VAT" },
      { Account: 5615, Debit: 8000, Credit: 0 },
      { Account: 5220, Debit: 2000, Credit: 0 },
    ],
  });
  assertEquals(row.total, 12500);
  assertEquals(row.vat, 2500);
  assertEquals(row.balance, 0);
  assertEquals(row.final_pay_date, "2026-08-29");
  assertEquals(row.account, 5615);
  assertEquals(row.cost_rows, [
    { account: 5615, amount: 8000 },
    { account: 5220, amount: 2000 },
  ]);
  assertEquals(row.voucher_series, "D");
  assertEquals(row.voucher_number, 12);
  assertEquals(row.voucher_year, 2);
  assert(row.booked);
  assert(!row.cancelled);
});

Deno.test("a supplier invoice without Balance, Total or VAT throws — never 0; a cancelled one has no balance", () => {
  const base = { GivenNumber: "8", InvoiceDate: "2026-08-01", Total: 100, VAT: 25, Balance: 125 };
  assertThrows(() => parseSupplierInvoice({ ...base, Balance: undefined }), FortnoxReadError, "Balance is missing");
  assertThrows(() => parseSupplierInvoice({ ...base, Total: "n/a" }), FortnoxReadError, "not a number");
  assertThrows(() => parseSupplierInvoice({ ...base, VAT: undefined }), FortnoxReadError, "VAT is missing");
  assertEquals(parseSupplierInvoice({ ...base, Cancel: true, Balance: 125 }).balance, 0);
  assertEquals(costRowsOf({ GivenNumber: "9", SupplierInvoiceRows: [{ Account: 2641, Debit: 5 }, { Account: 6540, Debit: 20 }] }), [
    { account: 6540, amount: 20 },
  ]);
});
