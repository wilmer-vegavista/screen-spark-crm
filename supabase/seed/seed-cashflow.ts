/**
 * The ledger seed (round two): makes test company 1848969's general ledger look like a
 * small screen-advertising company's for a year, so the cash-flow page has actuals to
 * show. Everything goes through the guard; every record carries a marker and is read
 * back before anything is created, so a second run creates nothing.
 *
 *   suppliers          thirteen invented ones: leasing, office rent, electricity, media, the
 *                      three SaaS, an insurer, a screen service firm, two screen landlords,
 *                      a permit consultant, a screen-parts importer
 *   supplier invoices  September 2025 – September 2026 in the workbook's cadences and sizes
 *                      (not Filip's figures): most paid (a bank voucher 2440/1930 two days
 *                      before due), some open, a few overdue
 *   vouchers (series A)
 *     opening balance  1930 / 2091 on the previous fiscal year's first day
 *     payroll          monthly on the 25th in Bron's shape: 7010, 7510 debit; 2710, 2731, 1930 credit
 *     tax payment      the 12th of the following month: 2710, 2731 debit; 1930 credit
 *     VAT settlement   the 12th of the second month after the period (monthly period):
 *                      2611 debit, 2641 credit, 1930 credit — from the seeded invoices' VAT
 *     customer receipt 1930 / 1510 per customer invoice the dev project marks paid, on the
 *                      day the fake payment says (so ledger and fake-payment table agree)
 *     bank fee         monthly 6570 / 1930; a direct purchase with VAT (5490 + 2641 / 1930);
 *                      quarterly loan interest 8410 / 1930
 *
 * The test company refuses supplier payments (payment scope), so paid supplier invoices
 * are listed in fortnox.settings.dev_fake_supplier_payments with their pay date, exactly
 * as round one does for customer invoices; the page says so in red. The BAS accounts the
 * seed posts to are activated first (a Fortnox chart has every account, few are active).
 */
import type { SupabaseClient } from "npm:@supabase/supabase-js@2.108.1";
import {
  getSupplier,
  type GuardedFortnox,
  isCancelled,
  listFinancialYears,
  listSupplierInvoices,
  listSuppliers,
  listVouchers,
  num,
  redact,
} from "../functions/_fortnox/mod.ts";
import {
  activateAccounts,
  bankLegs,
  bookkeepSupplierInvoice,
  createSupplier,
  createSupplierInvoice,
  createVoucher,
  type NewVoucher,
  paySupplierInvoice,
  supplierInvoiceKeyIn,
  supplierMarkerIn,
  voucherMarkerIn,
} from "./fortnox-cashflow-writes.ts";

/** Every account the seed posts to; activated in every financial year first. */
const ACCOUNTS_USED = [1510, 1930, 2091, 2440, 2611, 2641, 2710, 2731, 5010, 5011, 5012, 5020, 5490, 5500, 5615, 5910, 6310, 6540, 6570, 6950, 7010, 7510, 8410];

const round2 = (n: number) => Math.round(n * 100) / 100;
const addDays = (iso: string, n: number): string =>
  new Date(new Date(`${iso}T00:00:00Z`).getTime() + n * 86_400_000).toISOString().slice(0, 10);
const addMonths = (iso: string, n: number): string => {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCMonth(d.getUTCMonth() + n);
  return d.toISOString().slice(0, 10);
};
const ym = (iso: string) => iso.slice(0, 7);
const monthDay = (yyyymm: string, day: number) => `${yyyymm}-${String(day).padStart(2, "0")}`;
const lastDay = (yyyymm: string) => addDays(addMonths(`${yyyymm}-01`, 1), -1);

// ---------------------------------------------------------------- the suppliers

interface Supplier {
  key: string;
  name: string;
  org: string;
  city: string;
  account: number;
  /** VAT rate on this supplier's invoices (insurance and permit fees are VAT-free). */
  vatRate: number;
}

const SUPPLIERS: Supplier[] = [
  { key: "leasing", name: "Skärmleasing Nord AB", org: "556101-2345", city: "Göteborg", account: 5615, vatRate: 0.25 },
  { key: "kontorshyra", name: "Fastighets AB Torget", org: "556102-3456", city: "Stenungsund", account: 5010, vatRate: 0.25 },
  { key: "el", name: "Kungälvs Elhandel AB", org: "556103-4567", city: "Kungälv", account: 5020, vatRate: 0.25 },
  { key: "media", name: "Mediabyrån Väst AB", org: "556104-5678", city: "Göteborg", account: 5910, vatRate: 0.25 },
  { key: "google", name: "Google Workspace", org: "", city: "Dublin", account: 6540, vatRate: 0.25 },
  { key: "squarespace", name: "Squarespace Ireland Ltd", org: "", city: "Dublin", account: 6540, vatRate: 0.25 },
  { key: "fortnox", name: "Fortnox AB", org: "556469-6291", city: "Växjö", account: 6540, vatRate: 0.25 },
  { key: "forsakring", name: "Trygg Skärmförsäkring AB", org: "516401-2345", city: "Stockholm", account: 6310, vatRate: 0 },
  { key: "service", name: "Skärmservice Sverige AB", org: "556105-6789", city: "Borås", account: 5500, vatRate: 0.25 },
  { key: "hyra-stenungsund", name: "Stenungsund Centrum AB", org: "556106-7890", city: "Stenungsund", account: 5011, vatRate: 0.25 },
  { key: "hyra-boras", name: "Citygallerian Borås AB", org: "556107-8901", city: "Borås", account: 5011, vatRate: 0.25 },
  { key: "bygglov", name: "Byggkonsult Väst AB", org: "556108-9012", city: "Göteborg", account: 6950, vatRate: 0 },
  { key: "skarmteknik", name: "Skärmteknik Import AB", org: "556109-0123", city: "Malmö", account: 5490, vatRate: 0.25 },
];

// ---------------------------------------------------------------- the year of supplier invoices

interface PlannedSupplierInvoice {
  key: string;
  supplier: string;
  invoiceDate: string;
  dueDate: string;
  net: number;
  vat: number;
  account: number;
  description: string;
  /** false = left unpaid on purpose (overdue if the due date has passed). */
  paid: boolean;
}

const UNPAID_SUPPLIER = new Set(["media-2026-08", "service-2026-07", "el-2026-08"]);

function planSupplierInvoices(today: string, months: string[]): PlannedSupplierInvoice[] {
  const out: PlannedSupplierInvoice[] = [];
  const add = (key: string, supplierKey: string, invoiceDate: string, net: number, description: string, account?: number, terms = 30) => {
    const s = SUPPLIERS.find((x) => x.key === supplierKey)!;
    out.push({
      key,
      supplier: supplierKey,
      invoiceDate,
      dueDate: addDays(invoiceDate, terms),
      net: round2(net),
      vat: round2(net * s.vatRate),
      account: account ?? s.account,
      description,
      paid: !UNPAID_SUPPLIER.has(key),
    });
  };
  months.forEach((m, i) => {
    const mm = Number(m.slice(5, 7));
    add(`leasing-${m}-a`, "leasing", monthDay(m, 1), 9500, `Leasing skarm 1101, ${m}`);
    add(`leasing-${m}-b`, "leasing", monthDay(m, 1), 6200, `Leasing skarm 2104, ${m}`);
    add(`kontorshyra-${m}`, "kontorshyra", monthDay(m, 1), 28000, `Kontorshyra ${m}`);
    add(`el-${m}`, "el", monthDay(m, 8), 3800 + ((mm + 8) % 12) * 260, `El skarmar ${m}`);
    add(`google-${m}`, "google", monthDay(m, 3), 1800, `Google Workspace ${m}`);
    add(`squarespace-${m}`, "squarespace", monthDay(m, 5), 290, `Squarespace ${m}`);
    add(`fortnox-${m}`, "fortnox", monthDay(m, 2), 599, `Fortnox ${m}`);
    add(`hyra-stenungsund-${m}`, "hyra-stenungsund", monthDay(m, 1), 12500, `Hyra skarmplats Stenungstorg ${m}`);
    add(`hyra-boras-${m}`, "hyra-boras", monthDay(m, 1), 8300, `Hyra skarmplats Storknallen ${m}`);
    if (mm % 3 === 0) {
      add(`forsakring-${m}`, "forsakring", monthDay(m, 15), 7800, `Skarmforsakring kvartal`);
      add(`hyra-boras-rorlig-${m}`, "hyra-boras", monthDay(m, 20), 9000 + (i % 3) * 2500, `Rorlig hyra Storknallen kvartal`, 5012);
    }
  });
  // The very first supplier invoice in the test company (9 Sept, the live shape experiment): a third
  // leasing invoice for August, kept as the seed's own so its bank payment (A 104) reconciles.
  add("leasing-2026-08", "leasing", "2026-08-01", 9500, "Leasing skarm 1101, augusti 2026");
  // media: five campaigns over the year; service: four calls; the permit once; screen parts twice
  add("media-2025-10", "media", "2025-10-14", 18500, "Kampanj oktober");
  add("media-2026-01", "media", "2026-01-20", 24000, "Kampanj januari");
  add("media-2026-03", "media", "2026-03-11", 31000, "Kampanj var");
  add("media-2026-06", "media", "2026-06-09", 15500, "Kampanj sommar");
  add("media-2026-08", "media", "2026-08-18", 22000, "Kampanj augusti");
  add("service-2025-11", "service", "2025-11-06", 6500, "Service skarm 1103");
  add("service-2026-02", "service", "2026-02-17", 12800, "Service och byte av modul 2105");
  add("service-2026-05", "service", "2026-05-12", 8900, "Service skarm 1101");
  add("service-2026-07", "service", "2026-07-23", 17500, "Storservice 3101");
  add("bygglov-2026-04", "bygglov", "2026-04-08", 14000, "Bygglovsansokan ny skarm 2106");
  add("skarmteknik-2025-12", "skarmteknik", "2025-12-02", 89000, "Ny LED-modul 2104");
  add("skarmteknik-2026-06", "skarmteknik", "2026-06-16", 9900, "Faste och kablage");
  return out.filter((p) => p.invoiceDate <= today).sort((a, b) => a.invoiceDate.localeCompare(b.invoiceDate) || a.key.localeCompare(b.key));
}

// ---------------------------------------------------------------- payroll and tax (Bron's shape)

const EMPLOYEES = [42000, 38000, 35000, 31000];
const GROSS = EMPLOYEES.reduce((a, b) => a + b, 0);
const PRELIMINARY_TAX = round2(GROSS * 0.3);
const EMPLOYER_CONTRIBUTIONS = round2(GROSS * 0.3142);
const NET_SALARY = round2(GROSS - PRELIMINARY_TAX);

export interface SeedCashflowInput {
  g: GuardedFortnox;
  db: SupabaseClient;
  today: string;
  /** The customer invoices the dev project marks paid: their Fortnox number, total, pay date. */
  paidInvoices: Array<{ documentNumber: string; total: number; paidAt: string; vat: number; invoiceDate: string }>;
  /** Every live customer invoice: invoice date and VAT, for the output-VAT settlements. */
  allInvoices: Array<{ invoiceDate: string; vat: number }>;
}

export async function seedCashflow(input: SeedCashflowInput): Promise<void> {
  const { g, db, today } = input;
  const company = await g.company();
  console.log(`\nLedger seed: "${company.name}" (DatabaseNumber ${company.databaseNumber}), today = ${today}`);
  const years = await listFinancialYears(g);
  if (years.length === 0) throw new Error("The test company has no financial years.");
  const first = years[0];
  const yearFor = (date: string) => years.find((y) => y.from <= date && date <= y.to);
  const counts = { accountsActivated: 0, suppliersCreated: 0, suppliersFound: 0, invoicesCreated: 0, invoicesFound: 0, booked: 0, vouchersCreated: 0, vouchersFound: 0, failed: 0 };
  const failures: string[] = [];
  const report: string[] = [];

  // ---- the accounts: a Fortnox chart has every BAS account, few are active
  counts.accountsActivated = await activateAccounts(g, years.map((y) => y.id), ACCOUNTS_USED, (s) => console.log(s));
  console.log(`  accounts: ${counts.accountsActivated} activated now (${ACCOUNTS_USED.length} checked in ${years.length} financial year(s))`);

  // ---- suppliers: marker in Comments (a detail read each), created when missing
  const supplierNumbers = new Map<string, string>();
  for (const s of (await listSuppliers(g)).rows) {
    const d = await getSupplier(g, String(s.SupplierNumber));
    const key = supplierMarkerIn(d.Comments);
    if (key) supplierNumbers.set(key, String(s.SupplierNumber));
  }
  for (const s of SUPPLIERS) {
    if (supplierNumbers.has(s.key)) {
      counts.suppliersFound++;
      continue;
    }
    try {
      const created = await createSupplier(g, {
        key: s.key,
        name: s.name,
        organisationNumber: s.org || null,
        city: s.city,
        email: `faktura@${s.key.replace(/[^a-z]/g, "")}.test`,
        costAccount: s.account,
        termsOfPayment: "30",
      });
      supplierNumbers.set(s.key, created.supplierNumber);
      counts.suppliersCreated++;
      console.log(`  supplier ${created.supplierNumber} "${s.name}" created`);
    } catch (e) {
      counts.failed++;
      failures.push(`supplier ${s.key}: ${redact((e as Error).message)}`);
    }
  }
  console.log(`  suppliers: ${counts.suppliersFound} already there, ${counts.suppliersCreated} created`);

  // ---- supplier invoices: marker in InvoiceNumber (on the list)
  const months: string[] = [];
  for (let m = "2025-09-01"; m <= today; m = addMonths(m, 1)) months.push(ym(m));
  const plannedInvoices = planSupplierInvoices(today, months);
  const existingInvoices = (await listSupplierInvoices(g)).rows;
  const invoiceByKey = new Map<string, (typeof existingInvoices)[number]>();
  for (const r of existingInvoices) {
    const key = supplierInvoiceKeyIn(r.InvoiceNumber);
    if (key && !isCancelled(r)) invoiceByKey.set(key, r);
  }
  const fakeSupplierPayments: Array<{ given_number: string; paid_at: string }> = [];
  const supplierPayments: NewVoucher[] = [];
  let paymentsRefused: string | null = null;
  for (const p of plannedInvoices) {
    const supplierNumber = supplierNumbers.get(p.supplier);
    if (!supplierNumber) {
      failures.push(`invoice ${p.key}: supplier ${p.supplier} missing`);
      continue;
    }
    const existing = invoiceByKey.get(p.key);
    let givenNumber = existing ? String(existing.GivenNumber) : "";
    if (!existing) {
      try {
        const created = await createSupplierInvoice(g, {
          key: p.key,
          supplierNumber,
          invoiceDate: p.invoiceDate,
          dueDate: p.dueDate,
          net: p.net,
          vat: p.vat,
          account: p.account,
          description: p.description,
        });
        givenNumber = created.givenNumber;
        counts.invoicesCreated++;
        await bookkeepSupplierInvoice(g, givenNumber);
        counts.booked++;
        await new Promise((r) => setTimeout(r, 150));
      } catch (e) {
        counts.failed++;
        failures.push(`supplier invoice ${p.key} (${p.invoiceDate}, ${p.net} kr): ${redact((e as Error).message).slice(0, 160)}`);
        continue;
      }
    } else {
      counts.invoicesFound++;
      if (existing.Booked !== true) {
        try {
          await bookkeepSupplierInvoice(g, givenNumber);
          counts.booked++;
        } catch (e) {
          failures.push(`bookkeep ${p.key}: ${redact((e as Error).message).slice(0, 160)}`);
        }
      }
    }
    const total = round2(p.net + p.vat);
    let state = p.dueDate < today ? "open, OVERDUE" : "open";
    if (p.paid && p.dueDate <= today) {
      const payDate = addDays(p.dueDate, -2) < p.invoiceDate ? p.invoiceDate : addDays(p.dueDate, -2);
      const alreadyPaid = existing ? num(existing.Balance) === 0 : false;
      if (alreadyPaid) state = "paid";
      else if (paymentsRefused === null) {
        try {
          await paySupplierInvoice(g, { givenNumber, amount: total, paymentDate: payDate });
          state = "paid";
        } catch (e) {
          paymentsRefused = redact((e as Error).message).slice(0, 160);
          console.log(`  supplier payments refused by the test company: ${paymentsRefused} — booking bank vouchers and listing the invoices in fortnox.settings.dev_fake_supplier_payments instead`);
        }
      }
      if (state !== "paid") {
        fakeSupplierPayments.push({ given_number: givenNumber, paid_at: payDate });
        supplierPayments.push({
          key: `suppay-${p.key}`,
          series: "A",
          date: payDate,
          text: `Betalning levfaktura ${SUPPLIERS.find((s) => s.key === p.supplier)!.name} ${p.description}`,
          legs: bankLegs(2440, total, "out"),
        });
        state = "paid (FAKE: bank voucher + dev table)";
      }
    } else if (p.paid) {
      state = "open (not due yet)";
    }
    report.push(`${p.key.padEnd(28)} #${givenNumber.padEnd(4)} ${p.invoiceDate} → ${p.dueDate}  ${String(p.net).padStart(8)} + ${String(p.vat).padStart(7)} moms  ${String(p.account)}  ${state}`);
  }
  console.log(`  supplier invoices: ${counts.invoicesFound} already there, ${counts.invoicesCreated} created, ${counts.booked} bookkept now`);

  // ---- vouchers: opening balance, payroll, tax, VAT, customer receipts, bank fees, direct purchase, interest
  const vouchers: NewVoucher[] = [];
  // Opening cash on the previous fiscal year's first day, in two vouchers (the first run
  // booked 420 000; the workbook-sized costs against the sandbox's small invoiced revenue
  // need about seven million for the cash row to stay above zero through the year).
  vouchers.push({
    key: "opening-1930",
    series: "A",
    date: first.from,
    text: "Ingaende kassa (seed)",
    legs: [
      { account: 1930, debit: 420000, credit: 0 },
      { account: 2091, debit: 0, credit: 420000 },
    ],
  });
  vouchers.push({
    key: "opening-1930-b",
    series: "A",
    date: first.from,
    text: "Ingaende kassa, del 2 (seed)",
    legs: [
      { account: 1930, debit: 6580000, credit: 0 },
      { account: 2091, debit: 0, credit: 6580000 },
    ],
  });
  for (const m of months) {
    const payday = monthDay(m, 25);
    if (payday <= today) {
      vouchers.push({
        key: `salary-${m}`,
        series: "A",
        date: payday,
        text: `Lonekorning ${m} (Bron): bruttolon, arbetsgivaravgifter, preliminarskatt, nettolon`,
        legs: [
          { account: 7010, debit: GROSS, credit: 0 },
          { account: 7510, debit: EMPLOYER_CONTRIBUTIONS, credit: 0 },
          { account: 2710, debit: 0, credit: PRELIMINARY_TAX },
          { account: 2731, debit: 0, credit: EMPLOYER_CONTRIBUTIONS },
          { account: 1930, debit: 0, credit: NET_SALARY },
        ],
      });
      const taxDay = monthDay(ym(addMonths(`${m}-01`, 1)), 12);
      if (taxDay <= today) {
        vouchers.push({
          key: `tax-${ym(taxDay)}`,
          series: "A",
          date: taxDay,
          text: `Skattebetalning: preliminarskatt och arbetsgivaravgifter for ${m}`,
          legs: [
            { account: 2710, debit: PRELIMINARY_TAX, credit: 0 },
            { account: 2731, debit: EMPLOYER_CONTRIBUTIONS, credit: 0 },
            { account: 1930, debit: 0, credit: round2(PRELIMINARY_TAX + EMPLOYER_CONTRIBUTIONS) },
          ],
        });
      }
    }
    const feeDay = lastDay(m);
    if (feeDay <= today) {
      vouchers.push({ key: `bankfee-${m}`, series: "A", date: feeDay, text: `Bankavgift ${m}`, legs: bankLegs(6570, 120, "out") });
    }
    // VAT settlement for period m on the 12th of the second month after: output VAT from the
    // seeded customer invoices, input VAT from the seeded supplier invoices, net when positive.
    const settleDay = monthDay(ym(addMonths(`${m}-01`, 2)), 12);
    if (settleDay <= today) {
      const outVat = round2(input.allInvoices.filter((i) => ym(i.invoiceDate) === m).reduce((s, i) => s + i.vat, 0));
      const inVat = round2(plannedInvoices.filter((p) => ym(p.invoiceDate) === m).reduce((s, p) => s + p.vat, 0));
      const net = round2(outVat - inVat);
      if (net > 0 && outVat > 0) {
        const legs = [
          { account: 2611, debit: outVat, credit: 0 },
          ...(inVat > 0 ? [{ account: 2641, debit: 0, credit: inVat }] : []),
          { account: 1930, debit: 0, credit: net },
        ];
        vouchers.push({ key: `vat-${m}`, series: "A", date: settleDay, text: `Momsavstamning period ${m}: utgaende ${outVat}, ingaende ${inVat}`, legs });
      }
    }
    if (Number(m.slice(5, 7)) % 3 === 0) {
      const day = monthDay(m, 27);
      if (day <= today) vouchers.push({ key: `interest-${m}`, series: "A", date: day, text: `Ranta banklan kvartal`, legs: bankLegs(8410, 1250, "out") });
    }
  }
  vouchers.push({
    key: "direct-2026-03",
    series: "A",
    date: "2026-03-10",
    text: "Kortkop: kabel och fasten till skarm 2105",
    legs: [
      { account: 5490, debit: 2400, credit: 0 },
      { account: 2641, debit: 600, credit: 0 },
      { account: 1930, debit: 0, credit: 3000 },
    ],
  });
  for (const inv of input.paidInvoices) {
    vouchers.push({
      key: `pay-${inv.documentNumber}`,
      series: "A",
      date: inv.paidAt,
      text: `Inbetalning kundfaktura ${inv.documentNumber}`,
      legs: bankLegs(1510, inv.total, "in"),
    });
  }
  vouchers.push(...supplierPayments);

  // read back every voucher marker per financial year, then create the missing ones
  const markers = new Set<string>();
  for (const y of years) {
    for (const v of (await listVouchers(g, y.id)).rows) {
      const k = voucherMarkerIn(v.description);
      if (k) markers.add(k);
    }
  }
  const byKind = new Map<string, { found: number; created: number; failed: number }>();
  const kindOf = (key: string) => key.split("-")[0];
  for (const v of vouchers.sort((a, b) => a.date.localeCompare(b.date) || a.key.localeCompare(b.key))) {
    const k = byKind.get(kindOf(v.key)) ?? { found: 0, created: 0, failed: 0 };
    byKind.set(kindOf(v.key), k);
    if (markers.has(v.key)) {
      k.found++;
      counts.vouchersFound++;
      continue;
    }
    if (!yearFor(v.date)) {
      k.failed++;
      failures.push(`voucher ${v.key}: no financial year covers ${v.date}`);
      continue;
    }
    try {
      const created = await createVoucher(g, v);
      k.created++;
      counts.vouchersCreated++;
      if (counts.vouchersCreated % 25 === 0) console.log(`  …${counts.vouchersCreated} vouchers created (${created.series} ${created.number})`);
      // Fortnox allows 25 requests per sliding five seconds; a short pause keeps a long run under it.
      await new Promise((r) => setTimeout(r, 150));
    } catch (e) {
      k.failed++;
      counts.failed++;
      failures.push(`voucher ${v.key} (${v.date}): ${redact((e as Error).message).slice(0, 160)}`);
    }
  }

  // ---- the dev-only fake supplier payments (the test company refuses real ones)
  if (fakeSupplierPayments.length) {
    const { error } = await db
      .schema("fortnox")
      .from("settings")
      .upsert({ key: "dev_fake_supplier_payments", value: JSON.stringify(fakeSupplierPayments) }, { onConflict: "key" });
    if (error) throw new Error(`write dev_fake_supplier_payments: ${error.message}`);
    console.log(`  DEV ONLY: ${fakeSupplierPayments.length} supplier invoice(s) will be stored as paid by the sync (fortnox.settings.dev_fake_supplier_payments)`);
  }
  // …and the customer fake payments now carry the bank voucher's date, so the ledger and the table agree
  if (input.paidInvoices.length) {
    const { error } = await db
      .schema("fortnox")
      .from("settings")
      .upsert(
        { key: "dev_fake_payments", value: JSON.stringify(input.paidInvoices.map((i) => ({ document_number: i.documentNumber, paid_at: i.paidAt }))) },
        { onConflict: "key" },
      );
    if (error) throw new Error(`write dev_fake_payments: ${error.message}`);
    console.log(`  DEV ONLY: ${input.paidInvoices.length} customer invoice(s) stay fake-paid, now with the bank voucher's date (fortnox.settings.dev_fake_payments)`);
  }

  console.log(`\nSupplier invoices in ${company.name} (key · Fortnox number · invoice date → due date · net + VAT · account · state):`);
  for (const line of report) console.log(`  ${line}`);
  console.log(`\nVouchers by kind (found already / created now / failed):`);
  for (const [kind, k] of [...byKind].sort()) console.log(`  ${kind.padEnd(10)} ${String(k.found).padStart(3)} / ${String(k.created).padStart(3)} / ${k.failed}`);
  console.log(
    `\nLedger seed done: accounts ${counts.accountsActivated} activated; suppliers ${counts.suppliersFound} found + ${counts.suppliersCreated} created; supplier invoices ${counts.invoicesFound} found + ${counts.invoicesCreated} created (${counts.booked} bookkept now); vouchers ${counts.vouchersFound} found + ${counts.vouchersCreated} created; ${counts.failed} failure(s). Payroll per month: gross ${GROSS}, tax ${PRELIMINARY_TAX}, employer contributions ${EMPLOYER_CONTRIBUTIONS}, net ${NET_SALARY}.${paymentsRefused ? ` Supplier payments refused: ${paymentsRefused}` : ""}`,
  );
  if (failures.length) {
    console.log(`\nWhat the test company refused (goes to KNOWN-ISSUES):`);
    for (const f of failures) console.log(`  ${f}`);
  }
}
