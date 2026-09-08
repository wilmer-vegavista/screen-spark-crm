import { assert, assertEquals, assertStringIncludes } from "jsr:@std/assert@1";
import { BOM, type LedgerSnapshot } from "../_fortnox/mod.ts";
import { type FeedDeps, handleFeed, tokenFromPath } from "./feed.ts";

const GOOD = "a".repeat(64);
const BASE = "https://x.supabase.co/functions/v1/fortnox-ledger-feed";

function snapshot(year: number, generatedAt: string): LedgerSnapshot {
  return {
    year,
    row_count: 1,
    generated_at: generatedAt,
    sync_run_id: 9,
    rows: [
      {
        saljare: "Anna Andersson",
        projekt: "1101 - Stenungstorg",
        kundnamn: "Exempel Handel AB",
        fakturadatum: `${year}-02-01`,
        forfallodatum: `${year}-03-03`,
        belopp_ex_moms: 1127.92,
        moms: 281.98,
        totalt: 1409.9,
        betald: true,
        sald: true,
        inlagd_i_rapport: true,
        document_number: "1",
        cancelled: false,
      },
    ],
  };
}

function deps(over: Partial<FeedDeps> = {}): FeedDeps & { refreshes: number[] } {
  const refreshes: number[] = [];
  return {
    refreshes,
    verifyToken: async (t) => t === GOOD,
    loadSnapshot: async (year) => snapshot(year, "2026-09-08T10:00:00.000Z"),
    refreshSnapshot: async (year) => {
      refreshes.push(year);
      return snapshot(year, "2026-09-08T12:00:00.000Z");
    },
    now: () => new Date("2026-09-08T12:00:00Z"),
    ...over,
  };
}

Deno.test("the token is the last path segment; the bare function path has none", () => {
  assertEquals(tokenFromPath(`/functions/v1/fortnox-ledger-feed/${GOOD}`), GOOD);
  assertEquals(tokenFromPath(`/${GOOD}`), GOOD);
  assertEquals(tokenFromPath("/functions/v1/fortnox-ledger-feed"), null);
  assertEquals(tokenFromPath("/"), null);
});

Deno.test("a wrong token is refused with 403 and no detail; a missing one with 401", async () => {
  const d = deps();
  const wrong = await handleFeed(new Request(`${BASE}/${"b".repeat(64)}`), d);
  assertEquals(wrong.status, 403);
  assertEquals(wrong.headers.get("cache-control"), "no-store");
  const short = await handleFeed(new Request(`${BASE}/short`), d);
  assertEquals(short.status, 403);
  const none = await handleFeed(new Request(BASE), d);
  assertEquals(none.status, 401);
  assertEquals(d.refreshes.length, 0, "nothing is read before the token passes");
});

Deno.test("only GET (and HEAD) are served", async () => {
  const res = await handleFeed(new Request(`${BASE}/${GOOD}`, { method: "POST" }), deps());
  assertEquals(res.status, 405);
  const head = await handleFeed(new Request(`${BASE}/${GOOD}`, { method: "HEAD" }), deps());
  assertEquals(head.status, 200);
  assertEquals(await head.text(), "");
});

Deno.test("the right token gets Filip's CSV: BOM, the eleven headers verbatim, the rows, the caching headers", async () => {
  const res = await handleFeed(new Request(`${BASE}/${GOOD}`), deps());
  assertEquals(res.status, 200);
  assertEquals(res.headers.get("content-type"), "text/csv; charset=utf-8");
  assertEquals(res.headers.get("cache-control"), "private, max-age=900");
  assertEquals(res.headers.get("x-ledger-rows"), "1");
  assertEquals(res.headers.get("x-ledger-refreshed"), "no");
  const body = await res.text();
  assert(body.startsWith(BOM));
  const lines = body.slice(1).split("\r\n");
  assertEquals(
    lines[0],
    "Säljare,Projekt,Kundnamn,Fakturadatum,Förfallodatum,Belopp ex moms (SEK),Moms (SEK),Totalt belopp (SEK),Betald,Såld,Inlagd i rapport",
  );
  assertEquals(lines[1], "Anna Andersson,1101 - Stenungstorg,Exempel Handel AB,2026-02-01,2026-03-03,1127.92,281.98,1409.90,TRUE,TRUE,TRUE");
});

Deno.test("year and sep parameters are honoured; a bad year is 400", async () => {
  const d = deps();
  const res = await handleFeed(new Request(`${BASE}/${GOOD}?year=2025&sep=;`), d);
  assertEquals(res.status, 200);
  assertStringIncludes(await res.text(), "2025-02-01;2025-03-03;1127,92;281,98;1409,90;TRUE;TRUE;TRUE");
  assertEquals((await handleFeed(new Request(`${BASE}/${GOOD}?year=abc`), d)).status, 400);
});

Deno.test("a missing or stale snapshot is refreshed once, a fresh one is served as it is", async () => {
  const missing = deps({ loadSnapshot: async () => null });
  const r1 = await handleFeed(new Request(`${BASE}/${GOOD}`), missing);
  assertEquals(r1.headers.get("x-ledger-refreshed"), "yes");
  assertEquals(missing.refreshes, [2026]);

  const stale = deps({ loadSnapshot: async (y) => snapshot(y, "2026-09-07T00:00:00.000Z") });
  const r2 = await handleFeed(new Request(`${BASE}/${GOOD}`), stale);
  assertEquals(r2.headers.get("x-ledger-refreshed"), "yes");
  assertEquals(r2.headers.get("x-ledger-generated-at"), "2026-09-08T12:00:00.000Z");

  const fresh = deps();
  await handleFeed(new Request(`${BASE}/${GOOD}`), fresh);
  assertEquals(fresh.refreshes.length, 0);
});
