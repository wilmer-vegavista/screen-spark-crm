import { assertEquals, assertRejects, assertStringIncludes, assertThrows } from "jsr:@std/assert@1";
import { assertAllowedTenant, GuardedFortnox, READ_TENANTS, WRITE_TENANT } from "./guard.ts";
import { TenantGuardError } from "./errors.ts";
import { FortnoxCcClient } from "./client.ts";
import { ccOptionsFromEnv, guardedFortnoxFromEnv } from "./env.ts";
import { json, mockFetch, noSleep, TOKEN_OK } from "./_test_helpers.ts";

Deno.test("the constants are the test company and nothing else", () => {
  assertEquals(READ_TENANTS, [1848969]);
  assertEquals(WRITE_TENANT, 1848969);
});

Deno.test("startup check accepts 1848969 and refuses every other tenant, or no tenant", () => {
  assertEquals(assertAllowedTenant("1848969"), 1848969);
  assertEquals(assertAllowedTenant(1848969), 1848969);
  const live = assertThrows(() => assertAllowedTenant("1030384"), TenantGuardError);
  assertStringIncludes(live.message, "1030384");
  assertThrows(() => assertAllowedTenant(""), TenantGuardError);
  assertThrows(() => assertAllowedTenant(undefined), TenantGuardError);
  assertThrows(() => assertAllowedTenant("abc"), TenantGuardError);
});

Deno.test(
  "an unlisted tenant refuses at construction, with no request made, even with valid credentials",
  () => {
    const f = mockFetch([["POST", "oauth-v1/token", TOKEN_OK]]);
    const env = (k: string) =>
      ({ FORTNOX_CLIENT_ID: "id", FORTNOX_CLIENT_SECRET: "s", FORTNOX_TENANT_ID: "1030384" })[k];
    assertThrows(() => guardedFortnoxFromEnv(env, f.fetch), TenantGuardError);
    assertThrows(() => ccOptionsFromEnv(env), TenantGuardError);
    assertEquals(f.calls.length, 0, "not a single request was sent");
  },
);

Deno.test("the tenant check runs before the missing-secret check", () => {
  const env = (k: string) => ({ FORTNOX_TENANT_ID: "1030384" })[k];
  assertThrows(() => ccOptionsFromEnv(env), TenantGuardError);
});

Deno.test(
  "a write against a company whose DatabaseNumber is not 1848969 is refused before the POST",
  async () => {
    const f = mockFetch([
      ["POST", "oauth-v1/token", TOKEN_OK],
      [
        "GET",
        "/companyinformation",
        () =>
          json(200, {
            CompanyInformation: {
              CompanyName: "Live AB",
              OrganizationNumber: "556714-7532",
              DatabaseNumber: 1030384,
            },
          }),
      ],
      ["POST", "/customers", () => json(201, { Customer: { CustomerNumber: "1" } })],
    ]);
    const g = new GuardedFortnox(
      new FortnoxCcClient({
        clientId: "id",
        clientSecret: "s",
        tenantId: "1848969",
        fetchFn: f.fetch,
        sleep: noSleep,
      }),
    );
    const err = await assertRejects(
      () => g.write("POST", "/customers", { Customer: { Name: "X" } }),
      TenantGuardError,
    );
    assertStringIncludes(err.message, "1030384");
    assertEquals(f.to("/customers").length, 0, "the POST never left");
  },
);

Deno.test(
  "a read tenant that is not the write tenant refuses every write; reads in the same run still pass",
  async () => {
    const f = mockFetch([
      ["POST", "oauth-v1/token", TOKEN_OK],
      [
        "GET",
        "/companyinformation",
        () =>
          json(200, {
            CompanyInformation: { CompanyName: "Testbolaget", DatabaseNumber: 1848969 },
          }),
      ],
      ["GET", "/customers", () => json(200, { Customers: [] })],
    ]);
    // 1848969 is really in READ_TENANTS; the write tenant is forced away from it here --
    // the same trick probe.ts's "writerefuse" mode uses (user-seat proof c) to demonstrate
    // the posture Vega Vista will be in once their number joins READ_TENANTS without
    // becoming WRITE_TENANT.
    const g = new GuardedFortnox(
      new FortnoxCcClient({
        clientId: "id",
        clientSecret: "s",
        tenantId: "1848969",
        fetchFn: f.fetch,
        sleep: noSleep,
      }),
      1030384,
    );
    for (let i = 0; i < 2; i++) {
      const err = await assertRejects(
        () => g.write("POST", "/customers", { Customer: { Name: `X${i}` } }),
        TenantGuardError,
      );
      assertStringIncludes(err.message, "Testbolaget");
      assertStringIncludes(err.message, "locked to the test company 1030384");
    }
    assertEquals(
      f.calls.filter((c) => c.method === "POST" && c.url.includes("/customers")).length,
      0,
      "no write ever left",
    );
    assertEquals(f.to("/companyinformation").length, 1, "the failed check is memoised too");
    const read = await g.get<{ Customers: unknown[] }>("/customers");
    assertEquals(read.Customers.length, 0);
  },
);

Deno.test(
  "an override cannot widen the write tenant: forcing both the connected company and " +
    "the override to the same non-WRITE_TENANT number still refuses",
  async () => {
    const f = mockFetch([
      ["POST", "oauth-v1/token", TOKEN_OK],
      [
        "GET",
        "/companyinformation",
        () =>
          json(200, {
            CompanyInformation: { CompanyName: "Live AB", DatabaseNumber: 7777777 },
          }),
      ],
      ["POST", "/customers", () => json(201, { Customer: { CustomerNumber: "1" } })],
    ]);
    const g = new GuardedFortnox(
      new FortnoxCcClient({
        clientId: "id",
        clientSecret: "s",
        tenantId: "1848969",
        fetchFn: f.fetch,
        sleep: noSleep,
      }),
      7777777,
    );
    const err = await assertRejects(
      () => g.write("POST", "/customers", { Customer: { Name: "X" } }),
      TenantGuardError,
    );
    assertStringIncludes(err.message, "7777777");
    assertEquals(f.to("/customers").length, 0, "the POST never left");
  },
);

Deno.test("a write against 1848969 passes, and the company check runs once per run", async () => {
  const f = mockFetch([
    ["POST", "oauth-v1/token", TOKEN_OK],
    [
      "GET",
      "/companyinformation",
      () =>
        json(200, {
          CompanyInformation: { CompanyName: "Testbolaget", DatabaseNumber: "1848969" },
        }),
    ],
    ["POST", "/customers", () => json(201, { Customer: { CustomerNumber: "7", Name: "X" } })],
  ]);
  const g = new GuardedFortnox(
    new FortnoxCcClient({
      clientId: "id",
      clientSecret: "s",
      tenantId: "1848969",
      fetchFn: f.fetch,
      sleep: noSleep,
    }),
  );
  await g.write("POST", "/customers", { Customer: { Name: "X" } });
  await g.write("POST", "/customers", { Customer: { Name: "Y" } });
  assertEquals(f.to("/companyinformation").length, 1);
  assertEquals(f.to("/customers").length, 2);
  const company = await g.company();
  assertEquals(company.name, "Testbolaget");
  assertEquals(company.databaseNumber, 1848969);
});

Deno.test("a company response without a DatabaseNumber is refused (never assume)", async () => {
  const f = mockFetch([
    ["POST", "oauth-v1/token", TOKEN_OK],
    ["GET", "/companyinformation", () => json(200, { CompanyInformation: { CompanyName: "?" } })],
  ]);
  const g = new GuardedFortnox(
    new FortnoxCcClient({
      clientId: "id",
      clientSecret: "s",
      tenantId: "1848969",
      fetchFn: f.fetch,
      sleep: noSleep,
    }),
  );
  await assertRejects(() => g.write("POST", "/projects", {}), TenantGuardError);
});
