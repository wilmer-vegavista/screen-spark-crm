import { assertEquals, assertRejects } from "jsr:@std/assert@1";
import {
  createCustomer,
  createProject,
  customerPayload,
  markerFor,
  markerIn,
  projectPayload,
} from "./writes.ts";
import { GuardedFortnox } from "./guard.ts";
import { FortnoxCcClient } from "./client.ts";
import { TenantGuardError } from "./errors.ts";
import { json, mockFetch, noSleep, TOKEN_OK } from "./_test_helpers.ts";

const ID = "3f2b7c1e-9d4a-4c0b-8e6f-1a2b3c4d5e6f";

Deno.test("marker round-trips through a Comments field", () => {
  assertEquals(markerFor(ID), `{VV ${ID}}`);
  assertEquals(markerIn(`Kund skapad av CRM. {VV ${ID.toUpperCase()}}`), ID);
  assertEquals(markerIn("inget här"), null);
  assertEquals(markerIn(undefined), null);
});

Deno.test("customer payload carries the marker and drops empty fields", () => {
  const body = customerPayload({
    crmId: ID,
    name: " Exempel Handel AB ",
    organisationNumber: "556000-1111",
    email: "",
    city: null,
  });
  assertEquals(body.Customer.Name, "Exempel Handel AB");
  assertEquals(body.Customer.Type, "COMPANY");
  assertEquals(body.Customer.OrganisationNumber, "556000-1111");
  assertEquals(body.Customer.Comments, `{VV ${ID}}`);
  assertEquals("Email" in JSON.parse(JSON.stringify(body)).Customer, false);
  assertEquals("City" in JSON.parse(JSON.stringify(body)).Customer, false);
});

Deno.test("project payload uses the four-digit code as ProjectNumber when given", () => {
  const body = projectPayload({
    crmId: ID,
    description: "Stenungstorg",
    projectNumber: "1101",
    startDate: "2026-01-01",
  });
  assertEquals(body.Project, {
    ProjectNumber: "1101",
    Description: "Stenungstorg",
    Status: "ONGOING",
    StartDate: "2026-01-01",
    Comments: `{VV ${ID}}`,
  });
  assertEquals(
    "ProjectNumber" in
      JSON.parse(JSON.stringify(projectPayload({ crmId: ID, description: "x" }))).Project,
    false,
  );
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

Deno.test(
  "createCustomer posts through the guard and returns the number Fortnox chose",
  async () => {
    const f = mockFetch([
      ["POST", "oauth-v1/token", TOKEN_OK],
      [
        "GET",
        "/settings/company",
        () => json(200, { CompanySettings: { Name: "Test", DatabaseNumber: 1848969 } }),
      ],
      [
        "POST",
        "/customers",
        (c) =>
          json(201, { Customer: { CustomerNumber: 42, Name: JSON.parse(c.body!).Customer.Name } }),
      ],
    ]);
    const created = await createCustomer(guarded(f), { crmId: ID, name: "Exempel Handel AB" });
    assertEquals(created, { customerNumber: "42", name: "Exempel Handel AB" });
    assertEquals(
      f.calls.map((c) => c.method + " " + new URL(c.url).pathname),
      ["POST /oauth-v1/token", "GET /3/settings/company", "POST /3/customers"],
    );
  },
);

Deno.test("createProject is refused when the connected company is wrong", async () => {
  const f = mockFetch([
    ["POST", "oauth-v1/token", TOKEN_OK],
    [
      "GET",
      "/settings/company",
      () => json(200, { CompanySettings: { Name: "Live", DatabaseNumber: 1030384 } }),
    ],
    ["POST", "/projects", () => json(201, { Project: { ProjectNumber: "1" } })],
  ]);
  await assertRejects(
    () => createProject(guarded(f), { crmId: ID, description: "x" }),
    TenantGuardError,
  );
  assertEquals(f.to("/projects").length, 0);
});
