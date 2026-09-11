import { assertEquals } from "jsr:@std/assert@1";
import { writesEnabled } from "./posture.ts";
import { GuardedFortnox } from "./guard.ts";
import { FortnoxCcClient } from "./client.ts";
import { json, mockFetch, noSleep, TOKEN_OK } from "./_test_helpers.ts";

function connectedTo(settings: () => Response) {
  const f = mockFetch([
    ["POST", "oauth-v1/token", TOKEN_OK],
    ["GET", "/settings/company", settings],
  ]);
  const g = new GuardedFortnox(
    new FortnoxCcClient({ clientId: "id", clientSecret: "s", tenantId: "1571636", fetchFn: f.fetch, sleep: noSleep }),
  );
  return { f, g };
}

Deno.test("writesEnabled is false for a read-only tenant (Vega Vista, 1571636) and sends no write", async () => {
  const { f, g } = connectedTo(() =>
    json(200, { CompanySettings: { Name: "Vega Adscreens AB", DatabaseNumber: 1571636 } })
  );
  assertEquals(await writesEnabled(g), false);
  assertEquals(f.calls.filter((c) => c.method !== "GET" && !c.url.includes("oauth-v1/token")).length, 0);
});

Deno.test("writesEnabled is true for the write tenant 1848969 (as a number or a string)", async () => {
  assertEquals(
    await writesEnabled(connectedTo(() => json(200, { CompanySettings: { Name: "Testbolaget", DatabaseNumber: 1848969 } })).g),
    true,
  );
  assertEquals(
    await writesEnabled(connectedTo(() => json(200, { CompanySettings: { Name: "Testbolaget", DatabaseNumber: "1848969" } })).g),
    true,
  );
});

Deno.test("writesEnabled is false when the company cannot say who it is, or the read fails", async () => {
  assertEquals(await writesEnabled(connectedTo(() => json(200, { CompanySettings: { Name: "?" } })).g), false);
  assertEquals(await writesEnabled(connectedTo(() => json(500, { ErrorInformation: { Message: "down" } })).g), false);
});
