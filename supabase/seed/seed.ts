/**
 * Seed set for the round-zero demo: fills the DEV Supabase project (never theirs) with
 * synthetic data shaped like Filip's ledger rows, and — with --fortnox — plants a few
 * hand-made-looking customers and projects in Fortnox test company 1848969 so the match
 * proposer has every kind of case to show.
 *
 *   ./scripts/fortnox-dev.ps1 seed            CRM side only
 *   ./scripts/fortnox-dev.ps1 seed -Fortnox   CRM side + the Fortnox side
 *   ./scripts/fortnox-dev.ps1 seed -Invoices  round one: a year of invoices in the test company
 *                                             (add -FakePayments if the company refuses to bookkeep payments)
 *   ./scripts/fortnox-dev.ps1 seed -Cashflow  round two: the ledger — suppliers, a year of supplier
 *                                             invoices, salary / tax / VAT vouchers, bank payments
 *
 * Idempotent: fixed ids, upserts, existing users get a fresh password. Company names
 * are made up; none is a real Vega Vista customer. Screens carry four-digit codes in the
 * workbook's three series (1xxx, 2xxx, 3xxx) in the workbook's own "NNNN - Namn" shape.
 *
 * Prints the demo login (email + a freshly generated password) once, on the console.
 * Nothing is written to a file.
 */
import { createClient } from "npm:@supabase/supabase-js@2.108.1";
import {
  createCustomer,
  createProject,
  getInvoice,
  guardedFortnoxFromEnv,
  isCancelled,
  listCustomers,
  listInvoices,
  listProjects,
  num,
  redact,
} from "../functions/_fortnox/mod.ts";
import {
  bookkeepInvoice,
  cancelInvoice,
  createInvoice,
  creditInvoice,
  invoiceMarkerIn,
  payInvoice,
  setProjectStartDate,
} from "./fortnox-invoice-writes.ts";
import { seedCashflow } from "./seed-cashflow.ts";

const url = Deno.env.get("SUPABASE_URL");
const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
if (!url || !serviceKey)
  throw new Error(
    "SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY missing (run through scripts/fortnox-dev.ps1).",
  );
if (!/^https:\/\/fcxmtlbrwfbbjudjmloh\.supabase\.co/.test(url)) {
  throw new Error(`Refusing to seed ${url}: the seed only ever targets the dev project.`);
}
const db = createClient(url, serviceKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});
const withFortnox = Deno.args.includes("--fortnox");
const withInvoices = Deno.args.includes("--invoices");
const fakePayments = Deno.args.includes("--fake-payments");
const withCashflow = Deno.args.includes("--cashflow");
/** "Today" for the seed: instalments dated after it are not invoiced yet. */
const TODAY = (Deno.env.get("SEED_TODAY") ?? new Date().toISOString()).slice(0, 10);

// ---------------------------------------------------------------- helpers

/** A ten-digit Swedish org number with a valid Luhn check digit, from nine given digits. */
function orgNumber(base9: string): string {
  let sum = 0;
  for (let i = 0; i < 9; i++) {
    let n = Number(base9[i]) * (i % 2 === 0 ? 2 : 1);
    if (n > 9) n -= 9;
    sum += n;
  }
  const check = (10 - (sum % 10)) % 10;
  const d = base9 + check;
  return `${d.slice(0, 6)}-${d.slice(6)}`;
}

const id = (prefix: string, n: number) =>
  `${prefix}0000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const cust = (n: number) => id("c", n);
const prod = (n: number) => id("d", n);
const order = (n: number) => id("e", n);
const item = (n: number) => id("f", n);

function password(): string {
  const alphabet = "abcdefghjkmnpqrstuvwxyzABCDEFGHJKMNPQRSTUVWXYZ23456789";
  const bytes = crypto.getRandomValues(new Uint8Array(14));
  return Array.from(bytes, (b) => alphabet[b % alphabet.length]).join("") + "!1";
}

function fail(what: string, error: { message: string } | null) {
  if (error) throw new Error(`${what}: ${error.message}`);
}

// ---------------------------------------------------------------- users

const USERS = [
  { email: "admin@vegavista.test", full_name: "Demo Admin", roles: ["admin", "saljare"] },
  { email: "anna@vegavista.test", full_name: "Anna Andersson", roles: ["saljare"] },
  { email: "bjorn@vegavista.test", full_name: "Björn Berg", roles: ["saljare"] },
  { email: "cecilia@vegavista.test", full_name: "Cecilia Carlsson", roles: ["saljare"] },
];

const demoPassword = password();
const userIds = new Map<string, string>();
{
  const { data: existing, error } = await db.auth.admin.listUsers({ page: 1, perPage: 200 });
  fail("listUsers", error);
  for (const u of USERS) {
    const found = existing.users.find((x) => x.email === u.email);
    if (found) {
      const { error } = await db.auth.admin.updateUserById(found.id, {
        password: demoPassword,
        user_metadata: { full_name: u.full_name },
      });
      fail(`update ${u.email}`, error);
      userIds.set(u.email, found.id);
    } else {
      const { data, error } = await db.auth.admin.createUser({
        email: u.email,
        password: demoPassword,
        email_confirm: true,
        user_metadata: { full_name: u.full_name },
      });
      fail(`create ${u.email}`, error);
      if (!data.user) throw new Error(`create ${u.email}: no user returned`);
      userIds.set(u.email, data.user.id);
    }
    const uid = userIds.get(u.email)!;
    fail(
      "profile",
      (await db.from("profiles").upsert({ id: uid, full_name: u.full_name, email: u.email })).error,
    );
    for (const role of u.roles) {
      fail(
        "role",
        (await db.from("user_roles").upsert({ user_id: uid, role }, { onConflict: "user_id,role" }))
          .error,
      );
    }
  }
}
const seller = (email: string) => userIds.get(email)!;

// ---------------------------------------------------------------- customers (10)

const CUSTOMERS = [
  // 1: same org number as a hand-made Fortnox customer → exact / orgnr
  {
    n: 1,
    company_name: "Exempel Handel AB",
    org: orgNumber("556000111"),
    city: "Göteborg",
    owner: "anna@vegavista.test",
  },
  // 2: same name as a Fortnox customer, different legal-form spelling → high / name
  {
    n: 2,
    company_name: "Nordic Screens AB",
    org: orgNumber("556000222"),
    city: "Stockholm",
    owner: "bjorn@vegavista.test",
  },
  // 3: similar name to a Fortnox customer → fuzzy
  {
    n: 3,
    company_name: "Kaffebaren i Staden AB",
    org: null,
    city: "Uppsala",
    owner: "cecilia@vegavista.test",
  },
  // 4–10: not in Fortnox → the sync creates them
  {
    n: 4,
    company_name: "Bergslagens Bygg & Måleri AB",
    org: orgNumber("556000444"),
    city: "Örebro",
    owner: "anna@vegavista.test",
  },
  {
    n: 5,
    company_name: "Fjällbackens Fastigheter AB",
    org: orgNumber("556000555"),
    city: "Stenungsund",
    owner: "bjorn@vegavista.test",
  },
  {
    n: 6,
    company_name: "Södra Tandkliniken Ekonomisk förening",
    org: orgNumber("769600666"),
    city: "Malmö",
    owner: "cecilia@vegavista.test",
  },
  {
    n: 7,
    company_name: "Optikern på Torget AB",
    org: orgNumber("556000777"),
    city: "Stenungsund",
    owner: "anna@vegavista.test",
  },
  {
    n: 8,
    company_name: "Västkustens Bilcenter AB",
    org: orgNumber("556000888"),
    city: "Kungälv",
    owner: "bjorn@vegavista.test",
  },
  {
    n: 9,
    company_name: "Lokala Gymmet i Nacka AB",
    org: null,
    city: "Nacka",
    owner: "cecilia@vegavista.test",
  },
  {
    n: 10,
    company_name: "Trädgårdsmästarn Hammarö HB",
    org: orgNumber("969700100"),
    city: "Hammarö",
    owner: "anna@vegavista.test",
  },
];

for (const c of CUSTOMERS) {
  const slug = c.company_name
    .toLowerCase()
    .replace(/[^a-z]+/g, "-")
    .replace(/(^-|-$)/g, "");
  const row = {
    id: cust(c.n),
    company_name: c.company_name,
    org_number: c.org,
    vat_number: c.org ? `SE${c.org.replace(/\D/g, "")}01` : null,
    billing_address: `Exempelgatan ${c.n}`,
    postal_code: `${400 + c.n} 0${c.n % 10}`,
    city: c.city,
    invoice_email: `faktura@${slug}.test`,
    invoice_peppol_id: c.n % 3 === 0 && c.org ? `0007:${c.org.replace(/\D/g, "")}` : null,
    invoice_reference: c.n % 2 === 0 ? `Ref ${c.n}` : null,
    contact_name: `Kontakt ${c.n}`,
    email: `kontakt@${slug}.test`,
    owner_id: seller(c.owner),
    created_by: seller("admin@vegavista.test"),
  };
  fail(`customer ${c.company_name}`, (await db.from("customers").upsert(row)).error);
}

// ---------------------------------------------------------------- screens (6), the workbook's shape and series

const SCREENS = [
  { n: 1, name: "1101 - Stenungstorg", city: "Stenungsund", screen_type: "egen" }, // Fortnox has 1101 "Stenungsund" → exact / code
  { n: 2, name: "1103 - Storknallen Köpcentrum", city: "Borås", screen_type: "egen" },
  { n: 3, name: "1104 - Kungens Kurva", city: "Stockholm", screen_type: "egen" }, // Fortnox has "Kungens Kurva" → high / name
  { n: 4, name: "2104 - Stora Nygatan", city: "Göteborg", screen_type: "egen" }, // Fortnox has "stor2104 Stora Nygatan" → exact / code in name
  { n: 5, name: "2105 - Scheelegatan", city: "Stockholm", screen_type: "digital" },
  { n: 6, name: "3101 - ICA Maxi Arninge", city: "Täby", screen_type: "extern" },
];

for (const s of SCREENS) {
  const row = {
    id: prod(s.n),
    name: s.name,
    description: `Digital reklamskärm, ${s.city}`,
    address: `${s.name.split(" - ")[1]} 1`,
    city: s.city,
    screen_type: s.screen_type,
    format: "16:9",
    dimensions: "1920x1080",
    ad_duration_seconds: 10,
    contacts_per_week: 25000 + s.n * 5000,
    default_commission_pct: 10,
    active: true,
    live_date: "2026-01-01",
  };
  fail(`screen ${s.name}`, (await db.from("products").upsert(row)).error);
}

// ---------------------------------------------------------------- orders (12), one row per ledger line

// Ledger shape: seller · project (screen) · customer · invoice date · due date (+1 month) ·
// amount ex VAT · VAT 25 % · total · paid · sold · in report. The CRM keeps the amount
// and the invoice status; VAT and total are derived, as in the workbook.
const ORDERS: Array<{
  n: number;
  customer: number;
  screen: number;
  owner: string;
  amount: number;
  start: string;
  freq: string;
  months: number;
  invoiced: boolean;
}> = [
  {
    n: 1,
    customer: 1,
    screen: 1,
    owner: "anna@vegavista.test",
    amount: 13535,
    start: "2026-02-01",
    freq: "manad",
    months: 12,
    invoiced: true,
  },
  {
    n: 2,
    customer: 2,
    screen: 4,
    owner: "bjorn@vegavista.test",
    amount: 7762,
    start: "2026-03-01",
    freq: "manad",
    months: 6,
    invoiced: true,
  },
  {
    n: 3,
    customer: 3,
    screen: 2,
    owner: "cecilia@vegavista.test",
    amount: 4500,
    start: "2026-03-15",
    freq: "engang",
    months: 1,
    invoiced: true,
  },
  {
    n: 4,
    customer: 4,
    screen: 3,
    owner: "anna@vegavista.test",
    amount: 25000,
    start: "2026-04-01",
    freq: "kvartal",
    months: 12,
    invoiced: true,
  },
  {
    n: 5,
    customer: 5,
    screen: 1,
    owner: "bjorn@vegavista.test",
    amount: 9800,
    start: "2026-05-01",
    freq: "manad",
    months: 12,
    invoiced: true,
  },
  {
    n: 6,
    customer: 6,
    screen: 5,
    owner: "cecilia@vegavista.test",
    amount: 2000,
    start: "2026-05-01",
    freq: "manad",
    months: 12,
    invoiced: true,
  },
  {
    n: 7,
    customer: 7,
    screen: 1,
    owner: "anna@vegavista.test",
    amount: 833,
    start: "2026-06-01",
    freq: "engang",
    months: 1,
    invoiced: true,
  },
  {
    n: 8,
    customer: 8,
    screen: 6,
    owner: "bjorn@vegavista.test",
    amount: 18500,
    start: "2026-06-15",
    freq: "halvar",
    months: 12,
    invoiced: false,
  },
  {
    n: 9,
    customer: 9,
    screen: 5,
    owner: "cecilia@vegavista.test",
    amount: 5000,
    start: "2026-07-01",
    freq: "manad",
    months: 12,
    invoiced: false,
  },
  {
    n: 10,
    customer: 10,
    screen: 6,
    owner: "anna@vegavista.test",
    amount: 12000,
    start: "2026-08-01",
    freq: "engang",
    months: 1,
    invoiced: false,
  },
  {
    n: 11,
    customer: 1,
    screen: 4,
    owner: "bjorn@vegavista.test",
    amount: 40000,
    start: "2026-09-01",
    freq: "manad",
    months: 12,
    invoiced: false,
  },
  {
    n: 12,
    customer: 4,
    screen: 2,
    owner: "cecilia@vegavista.test",
    amount: 125000,
    start: "2026-09-15",
    freq: "engang",
    months: 1,
    invoiced: false,
  },
  // 13–22 (round one): one-off bookings spread over the year, so every month of the
  // ledger has rows and the seller / screen totals mean something. 23–24 sit in the
  // previous calendar year, to show the "previous financial year" read.
  { n: 13, customer: 2, screen: 6, owner: "bjorn@vegavista.test", amount: 8000, start: "2026-01-12", freq: "engang", months: 1, invoiced: true },
  { n: 14, customer: 5, screen: 1, owner: "anna@vegavista.test", amount: 15000, start: "2026-01-20", freq: "engang", months: 1, invoiced: true },
  { n: 15, customer: 7, screen: 3, owner: "cecilia@vegavista.test", amount: 3200, start: "2026-02-10", freq: "engang", months: 1, invoiced: true },
  { n: 16, customer: 8, screen: 2, owner: "bjorn@vegavista.test", amount: 22000, start: "2026-02-24", freq: "engang", months: 1, invoiced: true },
  { n: 17, customer: 9, screen: 5, owner: "cecilia@vegavista.test", amount: 6400, start: "2026-03-03", freq: "engang", months: 1, invoiced: true },
  { n: 18, customer: 10, screen: 4, owner: "anna@vegavista.test", amount: 9900, start: "2026-04-14", freq: "engang", months: 1, invoiced: true },
  { n: 19, customer: 6, screen: 6, owner: "cecilia@vegavista.test", amount: 12500, start: "2026-05-19", freq: "engang", months: 1, invoiced: true },
  { n: 20, customer: 3, screen: 2, owner: "bjorn@vegavista.test", amount: 4500, start: "2026-06-02", freq: "engang", months: 1, invoiced: true },
  { n: 21, customer: 1, screen: 3, owner: "anna@vegavista.test", amount: 18500, start: "2026-07-07", freq: "engang", months: 1, invoiced: true },
  { n: 22, customer: 4, screen: 5, owner: "cecilia@vegavista.test", amount: 7762, start: "2026-08-18", freq: "engang", months: 1, invoiced: true },
  { n: 23, customer: 2, screen: 4, owner: "bjorn@vegavista.test", amount: 5600, start: "2025-12-05", freq: "engang", months: 1, invoiced: true },
  { n: 24, customer: 7, screen: 1, owner: "anna@vegavista.test", amount: 833, start: "2025-12-15", freq: "engang", months: 1, invoiced: true },
];

for (const o of ORDERS) {
  const c = CUSTOMERS.find((x) => x.n === o.customer)!;
  const s = SCREENS.find((x) => x.n === o.screen)!;
  const row = {
    id: order(o.n),
    order_type: "bokning",
    customer_id: cust(o.customer),
    company_name: c.company_name,
    org_number: c.org,
    billing_address: `Exempelgatan ${c.n}`,
    postal_code: `${400 + c.n} 0${c.n % 10}`,
    city: c.city,
    invoice_email: `faktura@${c.company_name
      .toLowerCase()
      .replace(/[^a-z]+/g, "-")
      .replace(/(^-|-$)/g, "")}.test`,
    invoice_start_date: o.start,
    billing_frequency: o.freq,
    billing_duration_months: o.months,
    payment_terms: "30 dagar netto",
    vat_exempt: false,
    total_excl_vat: o.amount,
    invoice_status: o.invoiced ? "fakturerad" : "klar",
    invoiced_at: o.invoiced ? `${o.start}T09:00:00Z` : null,
    owner_id: seller(o.owner),
    created_by: seller(o.owner),
    notes: `Seed: ledgerrad ${o.n} (${s.name})`,
  };
  fail(`order ${o.n}`, (await db.from("orders").upsert(row)).error);
  // The CRM's convention: the line total is unit_price × weeks, and the revenue report
  // spreads that total over the schedule — so the per-week price is the order total / weeks
  // (round zero stored the total as unit_price, which made "planerat" 48× the invoices).
  const weeks = o.freq === "engang" ? 4 : o.months * 4;
  const line = {
    id: item(o.n),
    order_id: order(o.n),
    product_id: prod(o.screen),
    product_name: s.name,
    unit_price: Math.round((o.amount / weeks) * 100) / 100,
    weeks,
    period_unit: "veckor",
    position: 1,
    commission_pct: 10,
    commission_amount: Math.round(o.amount * 0.1),
  };
  fail(`order item ${o.n}`, (await db.from("order_items").upsert(line)).error);
}

const counts = await Promise.all(
  ["customers", "products", "orders", "order_items"].map(async (t) => {
    const { count } = await db.from(t).select("*", { count: "exact", head: true });
    return `${t}=${count}`;
  }),
);
console.log(`CRM side seeded on the dev project: ${counts.join(", ")}`);
console.log(`Demo login: admin@vegavista.test  (sellers: anna@, bjorn@, cecilia@vegavista.test)`);
console.log(`Demo password (all four, freshly generated, shown once): ${demoPassword}`);

// ---------------------------------------------------------------- Fortnox side (optional)

if (withFortnox) {
  const g = guardedFortnoxFromEnv();
  const company = await g.company();
  console.log(`Fortnox side: "${company.name}" (DatabaseNumber ${company.databaseNumber})`);
  const existingCustomers = (await listCustomers(g)).rows;
  const existingProjects = (await listProjects(g)).rows;

  // Hand-made-looking rows: no {VV …} marker, so the proposer has to earn the match.
  const FX_CUSTOMERS = [
    { name: "Exempel Handel AB", org: CUSTOMERS[0].org }, // org number match
    { name: "Nordic Screens Aktiebolag", org: null }, // name match after normalisation
    { name: "Kaffebaren i Stan AB", org: null }, // fuzzy
  ];
  for (const c of FX_CUSTOMERS) {
    if (existingCustomers.some((x) => x.Name === c.name)) {
      console.log(`  customer "${c.name}" already in Fortnox`);
      continue;
    }
    const created = await createCustomer(g, {
      crmId: null,
      name: c.name,
      organisationNumber: c.org,
      comments: "Upplagd för hand (seed)",
    });
    console.log(`  created customer ${created.customerNumber} "${created.name}"`);
  }

  const FX_PROJECTS = [
    { number: "1101", description: "Stenungsund" }, // code = ProjectNumber, name differs (the meeting's example)
    { number: "2", description: "stor2104 Stora Nygatan" }, // code inside the name
    { number: "3", description: "Kungens Kurva" }, // name match
  ];
  for (const p of FX_PROJECTS) {
    if (
      existingProjects.some((x) => x.ProjectNumber === p.number || x.Description === p.description)
    ) {
      console.log(`  project ${p.number} "${p.description}" already in Fortnox`);
      continue;
    }
    const created = await createProject(g, {
      crmId: null,
      projectNumber: p.number,
      description: p.description,
      comments: "Upplagt för hand (seed)",
    });
    console.log(`  created project ${created.projectNumber} "${created.description}"`);
  }
}

// ---------------------------------------------------------------- Fortnox invoices (round one, optional)
//
// A year of invoices in the test company, shaped like Filip's ledger: for every seeded
// order, the instalments dated up to TODAY — monthly and quarterly series with the right
// counter in the row text, one-offs — with payment terms drawn from the workbook's real
// gap distribution (30 days on 244 of 320 rows, then 31, 28, 1 and 60), about 90 % paid,
// several overdue, one cancelled, and two deliberate leftovers: one whose amount matches
// no instalment, one on a project the CRM does not have. Idempotent: the `{VV inv <key>}`
// marker in ExternalInvoiceReference1 is read back from the list before anything is created.
//
// Prerequisite: the sync has run and the seeded customers and screens are linked, so the
// invoices can carry the Fortnox numbers the matcher will look for.

interface PlannedInvoice {
  key: string; // marker key, e.g. "1-3" = order 1, instalment 3; "L1", "L2", "C1"
  order: number | null;
  customerNumber: string;
  projectNumber: string | null;
  invoiceDate: string;
  dueDate: string;
  amount: number;
  description: string;
  seller: string;
  paid: boolean;
  /** Created unbooked and cancelled at once (a booked invoice cannot be cancelled in Fortnox). */
  cancel?: boolean;
  /** Booked, then credited with a credit note (the realistic way to undo a booked invoice). */
  credit?: boolean;
}

const STEP: Record<string, number> = { manad: 1, kvartal: 3, halvar: 6 };
const addMonths = (iso: string, n: number): string => {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCMonth(d.getUTCMonth() + n);
  return d.toISOString().slice(0, 10);
};
const addDays = (iso: string, n: number): string =>
  new Date(new Date(`${iso}T00:00:00Z`).getTime() + n * 86_400_000).toISOString().slice(0, 10);
const round2 = (n: number) => Math.round(n * 100) / 100;

/** The workbook's gap distribution: 30 days 76 %, 31 days 10 %, 28 days 8 %, 1 day 5 %, 60 days 1 %. */
function paymentTermDays(seed: number): number {
  const r = seed % 100;
  if (r < 76) return 30;
  if (r < 86) return 31;
  if (r < 94) return 28;
  if (r < 99) return 1;
  return 60;
}

/** Which instalments stay unpaid — an explicit list, so the proofs can name them. */
const UNPAID = new Set(["1-8", "2-6", "5-2", "9-1", "6-5", "15-1"]);

function planInvoices(
  customerNumberOf: (customerN: number) => string | undefined,
  projectNumberOf: (screenN: number) => string | undefined,
  sellerName: (email: string) => string,
): { planned: PlannedInvoice[]; skipped: string[] } {
  const planned: PlannedInvoice[] = [];
  const skipped: string[] = [];
  for (const o of ORDERS) {
    const s = SCREENS.find((x) => x.n === o.screen)!;
    const customerNumber = customerNumberOf(o.customer);
    const projectNumber = projectNumberOf(o.screen);
    if (!customerNumber || !projectNumber) {
      skipped.push(`order ${o.n}: customer ${o.customer} or screen ${o.screen} is not linked yet`);
      continue;
    }
    const step = STEP[o.freq];
    const count = step ? Math.max(1, Math.ceil(Math.max(1, o.months) / step)) : 1;
    const per = round2(o.amount / count);
    for (let k = 1; k <= count; k++) {
      const invoiceDate = step ? addMonths(o.start, (k - 1) * step) : o.start;
      if (invoiceDate > TODAY) break;
      const key = `${o.n}-${k}`;
      planned.push({
        key,
        order: o.n,
        customerNumber,
        projectNumber,
        invoiceDate,
        dueDate: addDays(invoiceDate, paymentTermDays(o.n * 37 + k * 11)),
        amount: per,
        description: count > 1 ? `${s.name}, delfaktura ${k}/${count}` : `${s.name}, engångsfaktura`,
        seller: sellerName(o.owner),
        paid: !UNPAID.has(key),
      });
    }
  }
  // The deliberate leftovers and the cancelled one.
  const c1 = customerNumberOf(1);
  const c3 = customerNumberOf(3);
  const c4 = customerNumberOf(4);
  const p1101 = projectNumberOf(1);
  const p1103 = projectNumberOf(2);
  if (c1 && p1101)
    planned.push({
      key: "L1",
      order: null,
      customerNumber: c1,
      projectNumber: p1101,
      invoiceDate: "2026-04-15",
      dueDate: "2026-05-15",
      amount: 999,
      description: "1101 - Stenungstorg, tilläggsvisning",
      seller: sellerName("anna@vegavista.test"),
      paid: true,
    });
  if (c4)
    planned.push({
      key: "L2",
      order: null,
      customerNumber: c4,
      projectNumber: "9999", // created below; not a screen in the CRM
      invoiceDate: "2026-07-01",
      dueDate: "2026-07-31",
      amount: 6250, // = one instalment of order 4, so only the project rule fails
      description: "9999 - Okänd skärm, delfaktura 2/4",
      seller: sellerName("anna@vegavista.test"),
      paid: true,
    });
  if (c3 && p1103)
    planned.push({
      key: "C1",
      order: 3,
      customerNumber: c3,
      projectNumber: p1103,
      invoiceDate: "2026-03-15",
      dueDate: "2026-04-14",
      amount: 4500,
      description: "1103 - Storknallen Kopcentrum, dubblett - krediteras",
      seller: sellerName("cecilia@vegavista.test"),
      paid: false,
      credit: true,
    });
  const c8 = customerNumberOf(8);
  if (c8 && p1103)
    planned.push({
      key: "C2",
      order: null,
      customerNumber: c8,
      projectNumber: p1103,
      invoiceDate: "2026-06-20",
      dueDate: "2026-07-20",
      amount: 2200,
      description: "1103 - Storknallen Kopcentrum, felaktig - makulerad",
      seller: sellerName("bjorn@vegavista.test"),
      paid: false,
      cancel: true,
    });
  planned.sort((a, b) => a.invoiceDate.localeCompare(b.invoiceDate) || a.key.localeCompare(b.key));
  return { planned, skipped };
}

if (withInvoices) {
  const g = guardedFortnoxFromEnv();
  const company = await g.company();
  console.log(`Fortnox invoices: "${company.name}" (DatabaseNumber ${company.databaseNumber}), today = ${TODAY}`);

  // The Fortnox numbers the sync linked; the invoices must carry them to be matchable.
  const { data: custLinks, error: e1 } = await db
    .schema("fortnox")
    .from("customer_links")
    .select("customer_id, fortnox_customer_number")
    .eq("status", "linked");
  fail("read customer_links", e1);
  const { data: projLinks, error: e2 } = await db
    .schema("fortnox")
    .from("project_links")
    .select("product_id, fortnox_project_number")
    .eq("status", "linked");
  fail("read project_links", e2);
  const customerNumberOf = (n: number) =>
    (custLinks ?? []).find((l) => l.customer_id === cust(n))?.fortnox_customer_number ?? undefined;
  const projectNumberOf = (n: number) =>
    (projLinks ?? []).find((l) => l.product_id === prod(n))?.fortnox_project_number ?? undefined;
  const sellerName = (email: string) => USERS.find((u) => u.email === email)?.full_name ?? email;

  const { planned, skipped } = planInvoices(customerNumberOf, projectNumberOf, sellerName);
  for (const s of skipped) console.log(`  SKIPPED ${s}`);

  // The unknown project for leftover L2 (not a screen in the CRM, so never linked).
  const existingProjects = (await listProjects(g)).rows;
  if (!existingProjects.some((p) => p.ProjectNumber === "9999")) {
    await createProject(g, {
      crmId: null,
      projectNumber: "9999",
      description: "Okänd skärm (seed, finns inte i CRM:et)",
      comments: "Upplagt för hand (seed) – projektet finns inte som skärm i CRM:et",
    });
    console.log(`  created project 9999 "Okänd skärm" (not in the CRM — leftover L2 points here)`);
  }

  // Fortnox refuses to bookkeep an invoice on a project whose accounting period does not
  // cover the invoice date; the hand-made seed projects had no start date. Open them.
  const earliest = planned.reduce((m, p) => (p.invoiceDate < m ? p.invoiceDate : m), TODAY);
  for (const proj of existingProjects) {
    const used = planned.some((p) => p.projectNumber === proj.ProjectNumber);
    const start = String(proj.StartDate ?? "").slice(0, 10);
    if (used && (!start || start > earliest)) {
      await setProjectStartDate(g, proj.ProjectNumber, "2025-01-01");
      console.log(`  project ${proj.ProjectNumber} "${proj.Description}": StartDate ${start || "(none)"} → 2025-01-01 so invoices can be bookkept`);
    }
  }

  // Read back what earlier runs created: marker → invoice.
  const existing = (await listInvoices(g, { fromDate: "2020-01-01", toDate: "2030-12-31" })).rows;
  const byMarker = new Map<string, (typeof existing)[number]>();
  for (const inv of existing) {
    const key = invoiceMarkerIn(inv.ExternalInvoiceReference1);
    // A credit note inherits the original's reference (and marker): the original wins.
    if (key && (!byMarker.has(key) || num(inv.Total) > 0)) byMarker.set(key, inv);
  }
  console.log(`  ${existing.length} invoice(s) already in the test company, ${byMarker.size} with a {VV inv …} marker`);

  let created = 0;
  let paidNow = 0;
  let cancelledNow = 0;
  let creditedNow = 0;
  let bookedNow = 0;
  let paymentsRefused: string | null = null;
  const fakeList: string[] = [];
  const report: string[] = [];
  const bookkeep = async (documentNumber: string): Promise<boolean> => {
    try {
      await bookkeepInvoice(g, documentNumber);
      bookedNow++;
      return true;
    } catch (e) {
      console.log(`  invoice ${documentNumber}: bookkeep FAILED — ${redact((e as Error).message)}`);
      return false;
    }
  };

  for (const p of planned) {
    const inv = byMarker.get(p.key);
    let documentNumber = inv ? String(inv.DocumentNumber) : "";
    if (!inv) {
      try {
        const res = await createInvoice(g, {
          markerKey: p.key,
          customerNumber: p.customerNumber,
          projectNumber: p.projectNumber,
          invoiceDate: p.invoiceDate,
          dueDate: p.dueDate,
          amount: p.amount,
          description: p.description,
          ourReference: p.seller,
          // Plain ASCII: Fortnox rejects document text with characters outside Latin-1 ("ogiltiga tecken").
          remarks: `Seed Vega Vista runda 1 - ${p.order ? `order ${p.order}` : `leftover ${p.key}`}`,
        });
        documentNumber = res.documentNumber;
        created++;
        // A cancel candidate stays unbooked: Fortnox cannot cancel a booked invoice.
        if (!p.cancel) await bookkeep(documentNumber);
      } catch (e) {
        const msg = redact((e as Error).message);
        console.log(`  ${p.key} (${p.invoiceDate}, ${p.amount} kr): create FAILED — ${msg}`);
        report.push(`${p.key.padEnd(5)} ${p.invoiceDate}  ${String(p.amount).padStart(9)} kr  NOT CREATED: ${msg.slice(0, 120)}`);
        continue;
      }
    } else if (!p.cancel && inv.Booked !== true && !isCancelled(inv)) {
      await bookkeep(documentNumber); // an earlier run could not (project period); try again
    }
    const balance = inv ? num(inv.Balance ?? p.amount) : NaN;
    const alreadyCancelled = inv ? isCancelled(inv) : false;

    let state = "open";
    if (p.cancel) {
      if (alreadyCancelled) state = "CANCELLED";
      else {
        try {
          await cancelInvoice(g, documentNumber);
          cancelledNow++;
          state = "CANCELLED";
        } catch (e) {
          state = `cancel FAILED: ${redact((e as Error).message).slice(0, 100)}`;
        }
      }
    } else if (p.credit) {
      // Fortnox books the credit note at once and copies the original's references onto it,
      // so it cannot carry its own marker; the ORIGINAL names its credit note in
      // CreditInvoiceReference ("0" = none). One detail read of the original decides.
      const original = await getInvoice(g, documentNumber);
      const ref = String(original.CreditInvoiceReference ?? "0").trim();
      if (ref && ref !== "0") state = `open, credited by #${ref}`;
      else {
        try {
          const creditNo = await creditInvoice(g, documentNumber);
          const d = await getInvoice(g, creditNo);
          if (d.Booked !== true) await bookkeep(creditNo);
          creditedNow++;
          state = `open, credited by #${creditNo} (credit note created now)`;
        } catch (e) {
          state = `credit FAILED: ${redact((e as Error).message).slice(0, 100)}`;
        }
      }
    } else if (p.paid) {
      const needsPayment = !inv || (Number.isFinite(balance) ? balance > 0 : true);
      if (!needsPayment) state = "paid";
      else if (fakePayments) {
        fakeList.push(documentNumber);
        state = "paid (FAKE, dev table only)";
      } else if (paymentsRefused) {
        state = `unpaid (payments refused earlier: ${paymentsRefused})`;
      } else {
        try {
          const payDate = p.dueDate <= TODAY ? addDays(p.dueDate, -2) : p.invoiceDate;
          await payInvoice(g, { documentNumber, amount: round2(p.amount * 1.25), paymentDate: payDate < p.invoiceDate ? p.invoiceDate : payDate });
          paidNow++;
          state = "paid";
        } catch (e) {
          paymentsRefused = redact((e as Error).message).slice(0, 200);
          console.log(`  invoice ${documentNumber}: payment FAILED — ${paymentsRefused}`);
          console.log(`  → the test company refuses payments; rerun with -FakePayments to mark paid rows in the dev table only`);
          state = "unpaid (payment refused)";
        }
      }
    } else {
      state = p.dueDate < TODAY ? "unpaid, OVERDUE" : "unpaid, open";
    }
    report.push(
      `${p.key.padEnd(5)} #${documentNumber.padEnd(4)} ${p.invoiceDate} → ${p.dueDate}  ${String(p.amount).padStart(9)} kr  ${(p.description).padEnd(48)} ${state}`,
    );
  }

  if (fakePayments) {
    fail(
      "write dev_fake_payments",
      (
        await db
          .schema("fortnox")
          .from("settings")
          .upsert({ key: "dev_fake_payments", value: JSON.stringify(fakeList) }, { onConflict: "key" })
      ).error,
    );
    console.log(`  DEV ONLY: ${fakeList.length} invoice(s) will be stored as paid by the sync (fortnox.settings.dev_fake_payments)`);
  } else {
    fail("clear dev_fake_payments", (await db.schema("fortnox").from("settings").delete().eq("key", "dev_fake_payments")).error);
  }

  console.log(`\nInvoices in ${company.name} (key · Fortnox number · invoice date → due date · amount ex VAT · row text · state):`);
  for (const line of report) console.log(`  ${line}`);
  console.log(
    `\nPlanned ${planned.length}: created ${created} now, bookkept ${bookedNow} now, paid ${paidNow} now${fakePayments ? ` (+${fakeList.length} FAKE)` : ""}, credited ${creditedNow} now, cancelled ${cancelledNow} now; leftovers L1 (amount 999 matches no instalment) and L2 (project 9999 is not a screen in the CRM); C1 booked and credited, C2 cancelled.${paymentsRefused ? ` Payments refused by the test company: ${paymentsRefused}` : ""}`,
  );
}

// ---------------------------------------------------------------- the ledger (round two, optional)
//
// Suppliers, a year of supplier invoices, the salary / tax / VAT vouchers, a bank voucher per
// customer invoice the dev project marks paid, and an opening balance — seed-cashflow.ts.
// Needs the invoices of round one in the test company (the customer receipts follow them).

if (withCashflow) {
  const g = guardedFortnoxFromEnv();
  const { data: custLinks, error: e1 } = await db
    .schema("fortnox")
    .from("customer_links")
    .select("customer_id, fortnox_customer_number")
    .eq("status", "linked");
  fail("read customer_links", e1);
  const { data: projLinks, error: e2 } = await db
    .schema("fortnox")
    .from("project_links")
    .select("product_id, fortnox_project_number")
    .eq("status", "linked");
  fail("read project_links", e2);
  const customerNumberOf = (n: number) =>
    (custLinks ?? []).find((l) => l.customer_id === cust(n))?.fortnox_customer_number ?? undefined;
  const projectNumberOf = (n: number) =>
    (projLinks ?? []).find((l) => l.product_id === prod(n))?.fortnox_project_number ?? undefined;
  const sellerName = (email: string) => USERS.find((u) => u.email === email)?.full_name ?? email;
  const { planned } = planInvoices(customerNumberOf, projectNumberOf, sellerName);
  const existing = (await listInvoices(g, { fromDate: "2020-01-01", toDate: "2030-12-31" })).rows;
  const byMarker = new Map<string, (typeof existing)[number]>();
  for (const inv of existing) {
    const key = invoiceMarkerIn(inv.ExternalInvoiceReference1);
    if (key && (!byMarker.has(key) || num(inv.Total) > 0)) byMarker.set(key, inv);
  }
  // The customer invoices the dev project marks paid, with the day the money "arrived":
  // due date minus two days once due, else the invoice date — the same rule round one uses.
  const paidInvoices = planned
    .filter((p) => p.paid && !p.cancel && !p.credit && byMarker.has(p.key))
    .map((p) => {
      const inv = byMarker.get(p.key)!;
      const pay = p.dueDate <= TODAY ? addDays(p.dueDate, -2) : p.invoiceDate;
      return {
        documentNumber: String(inv.DocumentNumber),
        total: num(inv.Total) || round2(p.amount * 1.25),
        paidAt: pay < p.invoiceDate ? p.invoiceDate : pay,
        vat: round2(p.amount * 0.25),
        invoiceDate: p.invoiceDate,
      };
    });
  await seedCashflow({
    g,
    db,
    today: TODAY,
    paidInvoices,
    // Every live customer invoice's VAT feeds the output side of the VAT settlements.
    allInvoices: planned.filter((p) => !p.cancel && byMarker.has(p.key)).map((p) => ({ invoiceDate: p.invoiceDate, vat: round2(p.amount * 0.25) })),
  });
}
