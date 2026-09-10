/**
 * The guard probe (user-seat proofs b and c).
 *
 *   deno run --allow-env --env-file=<fortnox-agent .env> probe.ts refuse 1030384
 *     → the tenant pointed at another number refuses before a single request
 *       (fetch is a spy that counts; --allow-net is not even granted).
 *   deno run --allow-env --allow-net --env-file=<fortnox-agent .env> probe.ts
 *     → the real probe against 1848969: company name, DatabaseNumber, and the counts
 *       of customers, projects and articles; round one adds the financial years and the
 *       invoices; round two the suppliers, supplier invoices, vouchers and the SIE export
 *       per financial year. Nothing secret is printed; the org number is left out on
 *       purpose (a test company carries the live company's).
 *   deno run --allow-env --allow-net --env-file=<fortnox-agent .env> probe.ts writerefuse
 *     → proof (c): with PROBE_FORCE_WRITE_TENANT set to a number other than 1848969 in the
 *       process environment, connects to 1848969 as GuardedFortnox would once Vega Vista's
 *       DatabaseNumber joins READ_TENANTS without being WRITE_TENANT. Attempts one write
 *       (refused, message printed), then a read (succeeds) -- the exact posture Vega Vista
 *       will be in. PROBE_FORCE_WRITE_TENANT is read only here; guard.ts and env.ts never
 *       consult it, and it narrows the write target rather than widening it.
 *
 * Normally run through scripts/fortnox-dev.ps1, which sets FORTNOX_TENANT_ID=1848969
 * in the process environment (the read/write constants' shared test company) before
 * loading the env file.
 */
import {
  ccOptionsFromEnv,
  FortnoxCcClient,
  GuardedFortnox,
  guardedFortnoxFromEnv,
  isCancelled,
  listArticles,
  listCustomers,
  listFinancialYears,
  listInvoices,
  listProjects,
  listSupplierInvoices,
  listSuppliers,
  listVouchers,
  num,
  sieForYear,
  WRITE_TENANT,
} from "./mod.ts";

const [mode, tenantArg] = Deno.args;

if (mode === "writerefuse") {
  const forced = Number(Deno.env.get("PROBE_FORCE_WRITE_TENANT") ?? "");
  if (!Number.isFinite(forced) || forced <= 0 || forced === WRITE_TENANT) {
    console.log("Set PROBE_FORCE_WRITE_TENANT to a number other than 1848969 before this mode.");
    Deno.exit(1);
  }
  const g = new GuardedFortnox(new FortnoxCcClient(ccOptionsFromEnv()), forced);
  try {
    await g.write("POST", "/customers", {
      Customer: { Name: "WO-114 guard proof -- must never reach Fortnox" },
    });
    console.log("UNEXPECTED: the write was not refused");
    Deno.exit(1);
  } catch (e) {
    console.log(`Write REFUSED: ${(e as Error).message}`);
  }
  const customers = await listCustomers(g);
  console.log(
    `Read after the refusal still works: Customers ${customers.rows.length} ` +
      `(pages read: ${customers.read.pages}, Fortnox reported: ${customers.read.reportedTotal})`,
  );
  Deno.exit(0);
}

if (mode === "refuse") {
  let requests = 0;
  const spy = ((..._args: unknown[]) => {
    requests++;
    throw new Error("the network must not be touched");
  }) as unknown as typeof fetch;
  const wrongTenant = tenantArg ?? "1030384";
  const env = (k: string) => (k === "FORTNOX_TENANT_ID" ? wrongTenant : Deno.env.get(k));
  try {
    guardedFortnoxFromEnv(env, spy);
    console.log("UNEXPECTED: a client was constructed for tenant " + wrongTenant);
    Deno.exit(1);
  } catch (e) {
    console.log(`REFUSED before any request (requests sent: ${requests})`);
    console.log(`  ${(e as Error).name}: ${(e as Error).message}`);
    Deno.exit(0);
  }
}

const started = Date.now();
const g = guardedFortnoxFromEnv();
const company = await g.company();
console.log(`Company: "${company.name}"  DatabaseNumber: ${company.databaseNumber}`);

type Read = () => Promise<{
  rows: unknown[];
  read: { pages: number; reportedTotal: number | null };
}>;
const reads: Array<[string, Read]> = [
  ["Customers", () => listCustomers(g)],
  ["Projects", () => listProjects(g)],
  ["Articles", () => listArticles(g)],
];
let failed = 0;
for (const [label, read] of reads) {
  try {
    const r = await read();
    console.log(
      `${label}: ${r.rows.length} (pages read: ${r.read.pages}, Fortnox reported: ${r.read.reportedTotal})`,
    );
  } catch (e) {
    failed++;
    // A missing scope on this integration is reported, not hidden: the Vega Vista
    // integration registered at go-live must carry it.
    console.log(`${label}: NOT READABLE — ${(e as Error).message}`);
  }
}
// Round one: the invoices and the financial years the first sync run will read.
let years: Awaited<ReturnType<typeof listFinancialYears>> = [];
try {
  years = await listFinancialYears(g);
  console.log(
    `Financial years: ${years.length}${years.length ? " — " + years.map((y) => `${y.from}…${y.to} (id ${y.id})`).join(", ") : ""}`,
  );
} catch (e) {
  console.log(`Financial years: NOT READABLE — ${(e as Error).message}`);
}
try {
  const inv = await listInvoices(g);
  const live = inv.rows.filter((r) => !isCancelled(r));
  const dates = live.map((r) => String(r.InvoiceDate ?? "").slice(0, 10)).filter(Boolean).sort();
  const paid = live.filter((r) => num(r.Balance) === 0).length;
  console.log(
    `Invoices: ${inv.rows.length} (pages read: ${inv.read.pages}, Fortnox reported: ${inv.read.reportedTotal}); ${live.length} not cancelled, ${paid} paid, ${live.length - paid} open; dates ${dates[0] ?? "–"}…${dates[dates.length - 1] ?? "–"}`,
  );
} catch (e) {
  failed++;
  console.log(`Invoices: NOT READABLE — ${(e as Error).message}`);
}
// Round two: the ledger — suppliers, supplier invoices, vouchers per financial year, the SIE export.
try {
  const s = await listSuppliers(g);
  console.log(`Suppliers: ${s.rows.length} (pages read: ${s.read.pages}, Fortnox reported: ${s.read.reportedTotal})`);
} catch (e) {
  console.log(`Suppliers: NOT READABLE — ${(e as Error).message}`);
}
try {
  const si = await listSupplierInvoices(g);
  const live = si.rows.filter((r) => !isCancelled(r));
  const open = live.filter((r) => num(r.Balance) !== 0).length;
  console.log(
    `Supplier invoices: ${si.rows.length} (pages read: ${si.read.pages}, Fortnox reported: ${si.read.reportedTotal}); ${live.length} not cancelled, ${live.length - open} paid, ${open} open`,
  );
} catch (e) {
  console.log(`Supplier invoices: NOT READABLE — ${(e as Error).message}`);
}
for (const y of years) {
  try {
    const v = await listVouchers(g, y.id);
    const bySeries = new Map<string, number>();
    for (const r of v.rows) bySeries.set(r.series, (bySeries.get(r.series) ?? 0) + 1);
    const seed = v.rows.filter((r) => r.description.startsWith("{VV cf ")).length;
    console.log(
      `Vouchers ${y.from}…${y.to}: ${v.rows.length} (${[...bySeries].map(([s, n]) => `${s} ${n}`).join(", ")}); ${seed} with a {VV cf …} marker`,
    );
    const doc = await sieForYear(g, y.id);
    const rows = doc.vouchers.reduce((n, x) => n + x.lines.length, 0);
    const ib = Object.entries(doc.openingBalances[0] ?? {}).filter(([a]) => a.startsWith("19"));
    console.log(
      `SIE 4 ${y.from}…${y.to}: ${doc.vouchers.length} vouchers, ${rows} postings, ${Object.keys(doc.accounts).length} accounts; bank IB ${ib.map(([a, b]) => `${a}=${b}`).join(", ") || "none"}`,
    );
  } catch (e) {
    console.log(`Ledger ${y.from}…${y.to}: NOT READABLE — ${(e as Error).message}`);
  }
}
console.log(
  `Done in ${Date.now() - started} ms.${failed ? ` ${failed} endpoint(s) not readable with this integration's scopes.` : ""}`,
);
Deno.exit(failed && failed === reads.length + 1 ? 1 : 0);
