// The seed's ledger writers live in supabase/seed/ (the functions folder never writes the
// ledger); their tests live here so `deno test supabase/functions/` covers them.
import { assertEquals, assertThrows } from "jsr:@std/assert@1";
import {
  bankLegs,
  checkLegs,
  sanitizeDescription,
  supplierInvoiceKeyIn,
  supplierInvoiceNumberFor,
  supplierInvoicePayload,
  supplierMarkerFor,
  supplierMarkerIn,
  supplierPayload,
  taggedDescription,
  voucherMarkerIn,
  voucherPayload,
} from "../../seed/fortnox-cashflow-writes.ts";

Deno.test("the three markers round-trip: supplier Comments, supplier InvoiceNumber, voucher Description", () => {
  assertEquals(supplierMarkerIn(`Upplagd av seed ${supplierMarkerFor("leasing")}`), "leasing");
  assertEquals(supplierMarkerIn("no marker"), null);
  assertEquals(supplierInvoiceKeyIn(supplierInvoiceNumberFor("leasing-2026-08")), "leasing-2026-08");
  assertEquals(supplierInvoiceKeyIn("12345"), null);
  assertEquals(voucherMarkerIn("{VV cf pay-5} Inbetalning faktura 5"), "pay-5");
  assertEquals(voucherMarkerIn("{AGENT q-1} something"), null);
});

Deno.test("descriptions: forbidden characters become spaces, typographic ones ASCII, the marker is never cut", () => {
  assertEquals(sanitizeDescription("Lön — september [2026] <test> | ~ok…"), "Lön - september 2026 test ok...");
  const long = taggedDescription("salary-2026-09", "x".repeat(300));
  assertEquals(long.length, 200);
  assertEquals(long.startsWith("{VV cf salary-2026-09} "), true);
});

Deno.test("checkLegs refuses what Fortnox would silently accept: negatives, two-sided legs, unbalanced öre", () => {
  assertEquals(checkLegs(bankLegs(2440, 1250.5, "out")), undefined);
  assertEquals(checkLegs([{ account: 1930, debit: 10, credit: 0 }]), "A voucher needs at least two legs; got 1.");
  assertEquals(
    checkLegs([
      { account: 1930, debit: -10, credit: 0 },
      { account: 2440, debit: 0, credit: 10 },
    ])?.includes("negative"),
    true,
  );
  assertEquals(
    checkLegs([
      { account: 1930, debit: 10, credit: 0 },
      { account: 2440, debit: 0, credit: 9.99 },
    ])?.startsWith("Unbalanced"),
    true,
  );
  assertEquals(
    checkLegs([
      { account: 1930, debit: 10, credit: 5 },
      { account: 2440, debit: 0, credit: 5 },
    ])?.includes("both"),
    true,
  );
  assertThrows(() => voucherPayload({ key: "k", series: "A", date: "2026-01-01", text: "t", legs: [] }), Error, "at least two legs");
});

Deno.test("payload shapes: supplier with PreDefinedAccount and marker; supplier invoice with the cost row only (Fortnox adds TOT and VAT); voucher rows as numbers", () => {
  assertEquals(supplierPayload({ key: "leasing", name: "Skärmleasing Nord AB", organisationNumber: "556000-1111", costAccount: 5615 }), {
    Supplier: {
      Name: "Skärmleasing Nord AB",
      OrganisationNumber: "556000-1111",
      PreDefinedAccount: 5615,
      Comments: "{VV cf sup leasing}",
      Active: true,
    },
  });
  const inv = supplierInvoicePayload({
    key: "leasing-2026-08",
    supplierNumber: "3",
    invoiceDate: "2026-08-01",
    dueDate: "2026-08-31",
    net: 10000,
    vat: 2500,
    account: 5615,
    description: "Leasing skarm augusti",
  });
  assertEquals(inv.SupplierInvoice.InvoiceNumber, "VV-CF-leasing-2026-08");
  assertEquals(inv.SupplierInvoice.Total, 12500);
  assertEquals(inv.SupplierInvoice.VAT, 2500);
  assertEquals(inv.SupplierInvoice.SupplierInvoiceRows, [
    { Account: 5615, Debit: 10000, Credit: 0, TransactionInformation: "Leasing skarm augusti" },
  ]);
  const noVat = supplierInvoicePayload({ key: "k", supplierNumber: "3", invoiceDate: "2026-08-01", dueDate: "2026-08-31", net: 100, vat: 0, account: 6310, description: "Forsakring" });
  assertEquals(noVat.SupplierInvoice.VAT, 0);
  assertEquals(noVat.SupplierInvoice.Total, 100);
  const v = voucherPayload({ key: "pay-5", series: "A", date: "2026-02-25", text: "Inbetalning faktura 5", legs: bankLegs(1510, 1409.9, "in") });
  assertEquals(v, {
    Voucher: {
      VoucherSeries: "A",
      TransactionDate: "2026-02-25",
      Description: "{VV cf pay-5} Inbetalning faktura 5",
      VoucherRows: [
        { Account: 1930, Debit: 1409.9, Credit: 0 },
        { Account: 1510, Debit: 0, Credit: 1409.9 },
      ],
    },
  });
});
