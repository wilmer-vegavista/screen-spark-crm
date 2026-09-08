/**
 * The ledger snapshot the Google Sheet feed serves: fortnox.v_ledger frozen per year,
 * refreshed at the end of every successful sync and — only when missing or older than
 * SNAPSHOT_STALE_MS — by the feed itself, which then stores it. A sheet polling every few
 * minutes therefore costs one indexed row read, never a join.
 */
import type { SupabaseClient } from "npm:@supabase/supabase-js@2.108.1";
import { type LedgerFeedRow, type LedgerViewRow, toFeedRow } from "./ledger-csv.ts";

export const SNAPSHOT_STALE_MS = 6 * 60 * 60 * 1000;

export interface LedgerSnapshot {
  year: number;
  rows: LedgerFeedRow[];
  row_count: number;
  generated_at: string;
  sync_run_id: number | null;
}

function must<T>(res: { data: T | null; error: { message: string } | null }, what: string): T {
  if (res.error) throw new Error(`${what}: ${res.error.message}`);
  return res.data as T;
}

/** Read the live view for one year (service role) and store it. Returns the snapshot. */
export async function refreshLedgerSnapshot(
  db: SupabaseClient,
  year: number,
  syncRunId: number | null = null,
  now: Date = new Date(),
): Promise<LedgerSnapshot> {
  const fx = db.schema("fortnox");
  const viewRows = must(
    await fx
      .from("v_ledger")
      .select(
        "document_number, saljare, projekt, kundnamn, fakturadatum, forfallodatum, belopp_ex_moms, moms, totalt, betald, sald, inlagd_i_rapport, cancelled",
      )
      .gte("fakturadatum", `${year}-01-01`)
      .lte("fakturadatum", `${year}-12-31`)
      .order("fakturadatum", { ascending: true })
      .order("document_number", { ascending: true }),
    "read v_ledger",
  ) as LedgerViewRow[];
  const rows = viewRows.map(toFeedRow);
  const snapshot: LedgerSnapshot = {
    year,
    rows,
    row_count: rows.filter((r) => !r.cancelled).length,
    generated_at: now.toISOString(),
    sync_run_id: syncRunId,
  };
  must(await fx.from("ledger_snapshot").upsert(snapshot, { onConflict: "year" }), "write ledger_snapshot");
  return snapshot;
}

export async function loadLedgerSnapshot(db: SupabaseClient, year: number): Promise<LedgerSnapshot | null> {
  const res = await db.schema("fortnox").from("ledger_snapshot").select("*").eq("year", year).maybeSingle();
  if (res.error) throw new Error(`read ledger_snapshot: ${res.error.message}`);
  return (res.data as LedgerSnapshot | null) ?? null;
}

/** The years the sync refreshes: the current one and the previous one. */
export const snapshotYears = (now: Date): number[] => [now.getUTCFullYear() - 1, now.getUTCFullYear()];
