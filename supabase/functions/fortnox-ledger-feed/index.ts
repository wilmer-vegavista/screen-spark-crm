/**
 * fortnox-ledger-feed — the URL Filip pastes into Google Sheets once:
 *   =IMPORTDATA("https://<ref>.supabase.co/functions/v1/fortnox-ledger-feed/<token>")
 *
 * Deployed with --no-verify-jwt (the sheet sends no headers; the token in the path is the
 * whole authentication, verified in the database). Reads only the snapshot table with the
 * service role, which never leaves this function. See feed.ts for the handler.
 *
 * Locally: `deno run --allow-env --allow-net index.ts` with SUPABASE_URL and
 * SUPABASE_SERVICE_ROLE_KEY in the environment (scripts/fortnox-dev.ps1 feed), on PORT 8001.
 */
import { createClient } from "npm:@supabase/supabase-js@2.108.1";
import { loadLedgerSnapshot, refreshLedgerSnapshot } from "../_fortnox/mod.ts";
import { handleFeed } from "./feed.ts";

function env(name: string): string {
  const v = Deno.env.get(name);
  if (!v) throw new Error(`${name} is not set`);
  return v;
}

async function handler(req: Request): Promise<Response> {
  try {
    const db = createClient(env("SUPABASE_URL"), env("SUPABASE_SERVICE_ROLE_KEY"), {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    return await handleFeed(req, {
      verifyToken: async (token) => {
        const { data, error } = await db.schema("fortnox").rpc("verify_feed_token", { p_token: token });
        if (error) throw new Error(`verify_feed_token: ${error.message}`);
        return data === true;
      },
      loadSnapshot: (year) => loadLedgerSnapshot(db, year),
      refreshSnapshot: (year) => refreshLedgerSnapshot(db, year, null),
      log: (line) => console.log(line),
    });
  } catch (e) {
    // Never echo details to the sheet: the error is in the function log.
    console.error((e as Error).stack ?? (e as Error).message);
    return new Response("Fel i kundreskontra-flödet – se funktionsloggen", {
      status: 500,
      headers: { "content-type": "text/plain; charset=utf-8", "cache-control": "no-store" },
    });
  }
}

Deno.serve({ port: Number(Deno.env.get("PORT") ?? "8000") }, handler);
