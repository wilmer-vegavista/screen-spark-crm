/**
 * The shared Fortnox layer for Vega Vista's CRM, ported from the fortnox-agent.
 *
 *   client.ts        token mint (client credentials + TenantId), 401 retry, 429 back-off
 *   guard.ts         the DatabaseNumber 1848969 guard; every write goes through it
 *   posture.ts       the guard's write question asked ahead of time, for the page (decides nothing)
 *   env.ts           options from the environment, guard applied before construction
 *   paging.ts        the pagination walk that refuses truncated lists
 *   numbers.ts       Swedish number parsing
 *   reads.ts         company information, customers, projects, articles
 *   writes.ts        create customer / project, with the {VV <id>} idempotency marker
 *   matcher.ts       the match proposer's rules and reasons
 *   fuzzy-claude.ts  one Claude call per unresolved row, when ANTHROPIC_API_KEY is set
 *   redact.ts        the one redactor every error passes through
 *
 *   round one:
 *   invoices.ts         customer invoices, financial years, the backfill window (reads only)
 *   invoice-matcher.ts  the four-rule invoice → order matcher and the admin-wins merge
 *   ledger-csv.ts       Filip's eleven columns as CSV for the Google Sheet feed
 *   ledger-snapshot.ts  the per-year snapshot the feed serves
 *
 *   round two:
 *   ledger.ts           the general ledger: SIE type-4 export (CP437) → postings and balances,
 *                       suppliers, supplier invoices, voucher headers, financial-year clamping
 */
export * from "./client.ts";
export * from "./errors.ts";
export * from "./env.ts";
export * from "./guard.ts";
export * from "./posture.ts";
export * from "./paging.ts";
export * from "./numbers.ts";
export * from "./reads.ts";
export * from "./writes.ts";
export * from "./matcher.ts";
export * from "./fuzzy-claude.ts";
export * from "./invoices.ts";
export * from "./invoice-matcher.ts";
export * from "./ledger-csv.ts";
export * from "./ledger-snapshot.ts";
export * from "./ledger.ts";
export { redact } from "./redact.ts";
