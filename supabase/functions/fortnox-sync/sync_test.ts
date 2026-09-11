import { assertEquals } from "jsr:@std/assert@1";
import { createFailedReason } from "./sync.ts";
import { TenantGuardError } from "../_fortnox/errors.ts";

Deno.test("a create the guard refused reads Swedish on the row; any other failure keeps its message", () => {
  const refusal =
    'REFUSING to write: connected company is "Vega Adscreens AB" with DatabaseNumber 1571636. ' +
    "Writes are locked to the test company 1848969; this connection may only read.";
  assertEquals(createFailedReason(new TenantGuardError(refusal), refusal), "Skapas vid driftsättning");
  assertEquals(
    createFailedReason(new Error("POST /customers → 400: Ogiltigt org.nr"), "POST /customers → 400: Ogiltigt org.nr"),
    "Kunde inte skapa i Fortnox: POST /customers → 400: Ogiltigt org.nr",
  );
});
