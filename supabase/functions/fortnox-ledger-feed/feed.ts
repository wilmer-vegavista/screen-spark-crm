/**
 * The Google Sheet feed's handler, separated from Deno.serve so it can be tested with
 * fakes. GET /fortnox-ledger-feed/<token>[?year=2026&sep=,] → Filip's ledger as CSV.
 *
 * Authentication is the token in the path (Google Sheets' IMPORTDATA sends no headers):
 * a 64-hex string generated inside the database into Vault, checked by
 * fortnox.verify_feed_token. Wrong or revoked → 403 with no detail. The token is never
 * logged, never echoed.
 *
 * Load: the feed serves fortnox.ledger_snapshot (one row per year), refreshed by every
 * successful sync; only when the snapshot is missing or older than SNAPSHOT_STALE_MS does
 * the feed read the live view itself, and then it stores the result. A sheet polling
 * every few minutes reads one row. Cache-Control asks Google for 15 minutes on top.
 */
import { type LedgerSnapshot, renderLedgerCsv, SNAPSHOT_STALE_MS } from "../_fortnox/mod.ts";

export interface FeedDeps {
  verifyToken(token: string): Promise<boolean>;
  loadSnapshot(year: number): Promise<LedgerSnapshot | null>;
  refreshSnapshot(year: number): Promise<LedgerSnapshot>;
  now?: () => Date;
  log?: (line: string) => void;
}

const text = (status: number, body: string, headers: Record<string, string> = {}) =>
  new Response(body, {
    status,
    headers: { "content-type": "text/plain; charset=utf-8", "cache-control": "no-store", ...headers },
  });

const TOKEN_RE = /^[0-9a-f]{64}$/;
const FUNCTION_NAME = "fortnox-ledger-feed";

/** The last path segment that is not the function's own name — locally the path is just /<token>. */
export function tokenFromPath(pathname: string): string | null {
  const parts = pathname.split("/").filter(Boolean);
  const last = parts[parts.length - 1];
  if (!last || last === FUNCTION_NAME) return null;
  return last;
}

export async function handleFeed(req: Request, deps: FeedDeps): Promise<Response> {
  if (req.method === "OPTIONS") return new Response(null, { status: 204 });
  if (req.method !== "GET" && req.method !== "HEAD") return text(405, "Endast GET");
  const url = new URL(req.url);
  const token = tokenFromPath(url.pathname);
  if (!token) return text(401, "Ingen länk – klistra in hela adressen från Fortnox-kopplingen");
  if (!TOKEN_RE.test(token) || !(await deps.verifyToken(token))) {
    return text(403, "Ogiltig eller återkallad länk. Skapa en ny på sidan Fortnox-koppling.");
  }

  const now = (deps.now ?? (() => new Date()))();
  const yearRaw = url.searchParams.get("year");
  const year = yearRaw ? Number(yearRaw) : now.getUTCFullYear();
  if (!Number.isInteger(year) || year < 2000 || year > 2100) return text(400, "year måste vara ett årtal");
  const sepRaw = url.searchParams.get("sep");
  const sep: "," | ";" = sepRaw === ";" ? ";" : ",";

  let snapshot = await deps.loadSnapshot(year);
  const age = snapshot ? now.getTime() - new Date(snapshot.generated_at).getTime() : Infinity;
  let refreshed = false;
  if (!snapshot || !(age < SNAPSHOT_STALE_MS)) {
    snapshot = await deps.refreshSnapshot(year);
    refreshed = true;
  }
  const csv = renderLedgerCsv(snapshot.rows, { sep });
  deps.log?.(`feed served year=${year} rows=${snapshot.row_count} sep=${sep} refreshed=${refreshed}`);
  return new Response(req.method === "HEAD" ? null : csv, {
    status: 200,
    headers: {
      "content-type": "text/csv; charset=utf-8",
      "content-disposition": `inline; filename="kundreskontra-${year}.csv"`,
      "cache-control": "private, max-age=900",
      "x-ledger-generated-at": snapshot.generated_at,
      "x-ledger-rows": String(snapshot.row_count),
      "x-ledger-refreshed": refreshed ? "yes" : "no",
    },
  });
}
