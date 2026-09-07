import { assert, assertEquals, assertRejects, assertStringIncludes } from "jsr:@std/assert@1";
import { FortnoxCcClient, FORTNOX_TOKEN_URL } from "./client.ts";
import { FortnoxApiError, TenantGuardError } from "./errors.ts";
import { json, mockFetch, noSleep, TOKEN_OK } from "./_test_helpers.ts";

const opts = { clientId: "id-1", clientSecret: "secret-1", tenantId: "1848969" };

Deno.test("mints a token with Basic auth and the TenantId header, then sends Bearer", async () => {
  const f = mockFetch([
    ["POST", "oauth-v1/token", TOKEN_OK],
    [
      "GET",
      "/companyinformation",
      () => json(200, { CompanyInformation: { DatabaseNumber: 1848969 } }),
    ],
  ]);
  const client = new FortnoxCcClient({ ...opts, fetchFn: f.fetch, sleep: noSleep });
  const res = await client.request<{ CompanyInformation: { DatabaseNumber: number } }>(
    "GET",
    "/companyinformation",
  );
  assertEquals(res.CompanyInformation.DatabaseNumber, 1848969);

  const mint = f.to(FORTNOX_TOKEN_URL)[0];
  assertEquals(mint.headers["tenantid"], "1848969");
  assertEquals(mint.headers["authorization"], `Basic ${btoa("id-1:secret-1")}`);
  assertEquals(mint.body, "grant_type=client_credentials");
  const get = f.to("/companyinformation")[0];
  assertEquals(get.headers["authorization"], "Bearer tok-1");
});

Deno.test("caches the token across requests and re-mints exactly once on 401", async () => {
  let tokenNo = 0;
  const f = mockFetch([
    [
      "POST",
      "oauth-v1/token",
      () => json(200, { access_token: `tok-${++tokenNo}`, expires_in: 3600 }),
    ],
    [
      "GET",
      "/customers",
      (_c, nth) => (nth === 1 ? json(401, { message: "expired" }) : json(200, { Customers: [] })),
    ],
  ]);
  const client = new FortnoxCcClient({ ...opts, fetchFn: f.fetch, sleep: noSleep });
  await client.request("GET", "/customers");
  await client.request("GET", "/customers");
  assertEquals(f.to("oauth-v1/token").length, 2, "one mint at start, one after the 401");
  assertEquals(
    f.to("/customers").map((c) => c.headers["authorization"]),
    ["Bearer tok-1", "Bearer tok-2", "Bearer tok-2"],
  );
});

Deno.test("a second 401 surfaces as a FortnoxApiError instead of looping", async () => {
  const f = mockFetch([
    ["POST", "oauth-v1/token", TOKEN_OK],
    [
      "GET",
      "/customers",
      () => json(401, { ErrorInformation: { Code: 2000663, Message: "Invalid token" } }),
    ],
  ]);
  const client = new FortnoxCcClient({ ...opts, fetchFn: f.fetch, sleep: noSleep });
  const err = await assertRejects(() => client.request("GET", "/customers"), FortnoxApiError);
  assertEquals(err.status, 401);
  assertEquals(err.fortnoxCode, 2000663);
  assertEquals(f.to("/customers").length, 2);
});

Deno.test("backs off once on 429 honouring Retry-After, capped at 30 s", async () => {
  const slept: number[] = [];
  const f = mockFetch([
    ["POST", "oauth-v1/token", TOKEN_OK],
    [
      "GET",
      "/projects",
      (_c, nth) =>
        nth === 1 ? json(429, {}, { "retry-after": "2" }) : json(200, { Projects: [] }),
    ],
    [
      "GET",
      "/articles",
      (_c, nth) =>
        nth === 1 ? json(429, {}, { "retry-after": "600" }) : json(200, { Articles: [] }),
    ],
  ]);
  const client = new FortnoxCcClient({
    ...opts,
    fetchFn: f.fetch,
    sleep: (ms) => {
      slept.push(ms);
      return Promise.resolve();
    },
  });
  await client.request("GET", "/projects");
  await client.request("GET", "/articles");
  assertEquals(slept, [2000, 30000]);
});

Deno.test(
  "refuses any non-GET that did not come through the guard, before any request",
  async () => {
    const f = mockFetch([["POST", "oauth-v1/token", TOKEN_OK]]);
    const client = new FortnoxCcClient({ ...opts, fetchFn: f.fetch, sleep: noSleep });
    await assertRejects(
      () => client.request("POST", "/customers", { Customer: {} }),
      TenantGuardError,
    );
    assertEquals(f.calls.length, 0, "no token mint, no request");
  },
);

Deno.test("redacts credentials echoed in an error body", async () => {
  const f = mockFetch([
    [
      "POST",
      "oauth-v1/token",
      () =>
        new Response(
          '{"error":"invalid_client","client_secret":"secret-1"} Basic aWQtMTpzZWNyZXQtMQ==',
          { status: 400 },
        ),
    ],
  ]);
  const client = new FortnoxCcClient({ ...opts, fetchFn: f.fetch, sleep: noSleep });
  const err = await assertRejects(() => client.request("GET", "/customers"), FortnoxApiError);
  assert(!err.message.includes("secret-1"), err.message);
  assert(!err.message.includes("aWQtMTpzZWNyZXQtMQ=="), err.message);
  assertStringIncludes(err.message, "[REDACTED]");
});
