import { assertEquals, assertRejects, assertStringIncludes } from "jsr:@std/assert@1";
import { getAllWithMeta, type Getter } from "./paging.ts";
import { FortnoxReadError } from "./errors.ts";
import { page } from "./_test_helpers.ts";

const getter = (pages: Record<string, unknown>): Getter & { urls: string[] } => {
  const urls: string[] = [];
  return {
    urls,
    get: <T>(path: string) => {
      urls.push(path);
      const pageNo = Number(/page=(\d+)/.exec(path)?.[1] ?? "1");
      return Promise.resolve(pages[String(pageNo)] as T);
    },
  };
};

Deno.test("walks every page and reports what it read", async () => {
  const g = getter({
    "1": page("Customers", [{ CustomerNumber: "1" }, { CustomerNumber: "2" }], 1, 2, 3),
    "2": page("Customers", [{ CustomerNumber: "3" }], 2, 2, 3),
  });
  const { rows, read } = await getAllWithMeta<{ CustomerNumber: string }>(
    g,
    "/customers",
    "Customers",
    { limit: 2, exactTotal: true },
  );
  assertEquals(
    rows.map((r) => r.CustomerNumber),
    ["1", "2", "3"],
  );
  assertEquals(read, { endpoint: "/customers", pages: 2, reportedTotal: 3, rowsRead: 3 });
  assertEquals(g.urls, ["/customers?page=1&limit=2", "/customers?page=2&limit=2"]);
});

Deno.test("keeps an existing query string and appends the page parameters", async () => {
  const g = getter({ "1": page("Customers", [], 1, 1, 0) });
  await getAllWithMeta(g, "/customers?lastmodified=2026-09-07%2014%3A00", "Customers");
  assertEquals(g.urls, ["/customers?lastmodified=2026-09-07%2014%3A00&page=1&limit=500"]);
});

Deno.test("throws on a page without complete pagination metadata", async () => {
  const g = getter({ "1": { MetaInformation: { "@TotalPages": 1 }, Customers: [] } });
  const err = await assertRejects(
    () => getAllWithMeta(g, "/customers", "Customers"),
    FortnoxReadError,
  );
  assertStringIncludes(err.message, "@TotalResources");
});

Deno.test(
  "throws when the collection key is missing (schema drift is not an empty company)",
  async () => {
    const g = getter({
      "1": { MetaInformation: { "@CurrentPage": 1, "@TotalPages": 1, "@TotalResources": 0 } },
    });
    await assertRejects(() => getAllWithMeta(g, "/customers", "Customers"), FortnoxReadError);
  },
);

Deno.test("throws when the walk does not advance", async () => {
  const g = getter({
    "1": page("Projects", [{ ProjectNumber: "1" }], 1, 2, 2),
    "2": page("Projects", [{ ProjectNumber: "1" }], 1, 2, 2),
  });
  const err = await assertRejects(
    () => getAllWithMeta(g, "/projects", "Projects", { limit: 1 }),
    FortnoxReadError,
  );
  assertStringIncludes(err.message, "did not advance");
});

Deno.test("throws on a short read rather than return a truncated list", async () => {
  const g = getter({ "1": page("Projects", [{ ProjectNumber: "1" }], 1, 1, 5) });
  const err = await assertRejects(
    () => getAllWithMeta(g, "/projects", "Projects"),
    FortnoxReadError,
  );
  assertStringIncludes(err.message, "only 1 were read");
});

Deno.test("exactTotal refuses an over-read; a filtered walk tolerates it", async () => {
  const over = () =>
    getter({ "1": page("Customers", [{ CustomerNumber: "1" }, { CustomerNumber: "2" }], 1, 1, 1) });
  await assertRejects(
    () => getAllWithMeta(over(), "/customers", "Customers", { exactTotal: true }),
    FortnoxReadError,
  );
  const { rows } = await getAllWithMeta(over(), "/customers?lastmodified=x", "Customers", {
    exactTotal: false,
  });
  assertEquals(rows.length, 2);
});

Deno.test("refuses a page limit outside 1–500", async () => {
  const g = getter({});
  await assertRejects(
    () => getAllWithMeta(g, "/customers", "Customers", { limit: 501 }),
    FortnoxReadError,
  );
  assertEquals(g.urls.length, 0);
});
