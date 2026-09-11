/**
 * Seed set for the round-zero demo: fills the DEV Supabase project (never theirs) with
 * synthetic data shaped like Filip's ledger rows, and — with --fortnox — plants a few
 * hand-made-looking customers and projects in Fortnox test company 1848969 so the match
 * proposer has every kind of case to show.
 *
 *   ./scripts/fortnox-dev.ps1 seed            CRM side only
 *   ./scripts/fortnox-dev.ps1 seed -Fortnox   CRM side + the Fortnox side
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
  guardedFortnoxFromEnv,
  listCustomers,
  listProjects,
} from "../functions/_fortnox/mod.ts";

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
  const line = {
    id: item(o.n),
    order_id: order(o.n),
    product_id: prod(o.screen),
    product_name: s.name,
    unit_price: o.amount,
    weeks: o.freq === "engang" ? 4 : o.months * 4,
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
