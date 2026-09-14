import { assertEquals, assertStringIncludes } from "jsr:@std/assert@1";
import { formatLastmodified, getCustomer, listCustomers, listProjects } from "./reads.ts";
import { GuardedFortnox } from "./guard.ts";
import { FortnoxCcClient } from "./client.ts";
import { json, mockFetch, noSleep, page, TOKEN_OK } from "./_test_helpers.ts";

Deno.test("lastmodified is formatted in Swedish local time", () => {
  // 12:00 UTC on 7 Sept 2026 is 14:00 in Stockholm (CEST).
  assertEquals(formatLastmodified(new Date("2026-09-07T12:00:00Z")), "2026-09-07 14:00");
  // 12:00 UTC on 7 Jan 2026 is 13:00 in Stockholm (CET).
  assertEquals(formatLastmodified(new Date("2026-01-07T12:00:00Z")), "2026-01-07 13:00");
});

function guarded(f: ReturnType<typeof mockFetch>) {
  return new GuardedFortnox(
    new FortnoxCcClient({
      clientId: "id",
      clientSecret: "s",
      tenantId: "1848969",
      fetchFn: f.fetch,
      sleep: noSleep,
    }),
  );
}

Deno.test("listCustomers walks all pages and stringifies numbers", async () => {
  const f = mockFetch([
    ["POST", "oauth-v1/token", TOKEN_OK],
    [
      "GET",
      "/customers?page=1",
      () => json(200, page("Customers", [{ CustomerNumber: 1, Name: "A" }], 1, 2, 2)),
    ],
    [
      "GET",
      "/customers?page=2",
      () => json(200, page("Customers", [{ CustomerNumber: 2, Name: "B" }], 2, 2, 2)),
    ],
  ]);
  const { rows, read } = await listCustomers(guarded(f));
  assertEquals(
    rows.map((r) => r.CustomerNumber),
    ["1", "2"],
  );
  assertEquals(read.pages, 2);
});

Deno.test("an incremental read sends lastmodified widened by ten minutes", async () => {
  const f = mockFetch([
    ["POST", "oauth-v1/token", TOKEN_OK],
    ["GET", "/projects?lastmodified=", () => json(200, page("Projects", [], 1, 1, 0))],
  ]);
  await listProjects(guarded(f), new Date("2026-09-07T12:00:00Z"));
  const url = decodeURIComponent(f.to("/projects")[0].url);
  assertStringIncludes(url, "/projects?lastmodified=2026-09-07 13:50&page=1&limit=500");
});

Deno.test("getCustomer returns the full record with Comments", async () => {
  const f = mockFetch([
    ["POST", "oauth-v1/token", TOKEN_OK],
    [
      "GET",
      "/customers/42",
      () => json(200, { Customer: { CustomerNumber: 42, Name: "A", Comments: "{VV abc}" } }),
    ],
  ]);
  const c = await getCustomer(guarded(f), "42");
  assertEquals(c.CustomerNumber, "42");
  assertEquals(c.Comments, "{VV abc}");
});
