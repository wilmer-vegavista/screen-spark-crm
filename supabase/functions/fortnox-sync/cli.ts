/**
 * One sync run from the command line, against the dev project and the test company.
 *   ./scripts/fortnox-dev.ps1 sync             (writes: links, creates, sync_runs)
 *   ./scripts/fortnox-dev.ps1 sync -Dry        (computes and prints, writes nothing)
 *   ./scripts/fortnox-dev.ps1 sync -FullLedger (round two: re-read the previous financial year's SIE too)
 */
import { createClient } from "npm:@supabase/supabase-js@2.108.1";
import { guardedFortnoxFromEnv } from "../_fortnox/mod.ts";
import { runSync } from "./sync.ts";

const url = Deno.env.get("SUPABASE_URL");
const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
if (!url || !key)
  throw new Error(
    "SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY missing (run through scripts/fortnox-dev.ps1).",
  );

const summary = await runSync(
  {
    db: createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } }),
    fortnox: guardedFortnoxFromEnv(),
    anthropicApiKey: Deno.env.get("ANTHROPIC_API_KEY") || undefined,
    anthropicModel: Deno.env.get("ANTHROPIC_MODEL") || undefined,
    log: (line) => console.log(line),
  },
  { triggeredBy: "cli", dryRun: Deno.args.includes("--dry"), fullLedger: Deno.args.includes("--full-ledger") },
);

const { log: _log, ...rest } = summary;
console.log(JSON.stringify(rest, null, 2));
Deno.exit(summary.status === "ok" ? 0 : 1);
