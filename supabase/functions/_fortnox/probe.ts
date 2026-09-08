/**
 * The guard probe (user-seat proof b).
 *
 *   deno run --allow-env --env-file=<fortnox-agent .env> probe.ts refuse 1030384
 *     → the tenant pointed at another number refuses before a single request
 *       (fetch is a spy that counts; --allow-net is not even granted).
 *   deno run --allow-env --allow-net --env-file=<fortnox-agent .env> probe.ts
 *     → the real probe against 1848969: company name, DatabaseNumber, and the counts
 *       of customers, projects and articles. Nothing secret is printed; the org number
 *       is left out on purpose (a test company carries the live company's).
 *
 * Normally run through scripts/fortnox-dev.ps1, which sets FORTNOX_TENANT_ID=1848969
 * in the process environment (the guard's constant) before loading the env file.
 */
import {
  guardedFortnoxFromEnv,
  isCancelled,
  listArticles,
  listCustomers,
  listFinancialYears,
  listInvoices,
  listProjects,
  num,
} from "./mod.ts";

const [mode, tenantArg] = Deno.args;

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
try {
  const years = await listFinancialYears(g);
  console.log(
    `Financial years: ${years.length}${years.length ? " — " + years.map((y) => `${y.from}…${y.to}`).join(", ") : ""}`,
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
console.log(
  `Done in ${Date.now() - started} ms.${failed ? ` ${failed} endpoint(s) not readable with this integration's scopes.` : ""}`,
);
Deno.exit(failed && failed === reads.length + 1 ? 1 : 0);
