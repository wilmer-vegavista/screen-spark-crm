/**
 * The shared Fortnox layer for Vega Vista's CRM, ported from the fortnox-agent.
 *
 *   client.ts        token mint (client credentials + TenantId), 401 retry, 429 back-off
 *   guard.ts         the DatabaseNumber 1848969 guard; every write goes through it
 *   env.ts           options from the environment, guard applied before construction
 *   paging.ts        the pagination walk that refuses truncated lists
 *   numbers.ts       Swedish number parsing
 *   reads.ts         company information, customers, projects, articles
 *   writes.ts        create customer / project, with the {VV <id>} idempotency marker
 *   matcher.ts       the match proposer's rules and reasons
 *   fuzzy-claude.ts  one Claude call per unresolved row, when ANTHROPIC_API_KEY is set
 *   redact.ts        the one redactor every error passes through
 */
export * from "./client.ts";
export * from "./errors.ts";
export * from "./env.ts";
export * from "./guard.ts";
export * from "./paging.ts";
export * from "./numbers.ts";
export * from "./reads.ts";
export * from "./writes.ts";
export * from "./matcher.ts";
export * from "./fuzzy-claude.ts";
export { redact } from "./redact.ts";
