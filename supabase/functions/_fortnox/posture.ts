/**
 * The write posture, asked ahead of time: does the connected company take writes? It is the
 * question `assertWriteTenant` in guard.ts answers before every write, asked when the
 * Fortnox-koppling page loads so the page can switch "Skapa i Fortnox" off and say why in
 * Swedish — instead of showing the guard's English refusal after a click (the first read of
 * Vega Vista's books, 11 Sept 2026). It decides nothing and writes nothing: every write still
 * goes through `GuardedFortnox.write`, whose check runs regardless of what this answered.
 */
import { type GuardedFortnox, WRITE_TENANT } from "./guard.ts";

/** The page's line when writes are off. The page carries the same sentence (it cannot import from here). */
export const WRITES_OFF_NOTICE =
  "Skapa i Fortnox är avstängt i förhandsvisningen — kopplingar och läsning fungerar, nya kunder skapas vid driftsättning";

/** A row's reason after the guard refused its create; the sync's log keeps the guard's own words. */
export const CREATE_DEFERRED_REASON = "Skapas vid driftsättning";

/** True only when GET /settings/company names WRITE_TENANT. Anything else — another company,
 * no DatabaseNumber, a failed read — answers false: when in doubt, writes are off. */
export async function writesEnabled(fortnox: GuardedFortnox): Promise<boolean> {
  try {
    return (await fortnox.company()).databaseNumber === WRITE_TENANT;
  } catch {
    return false;
  }
}
