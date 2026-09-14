import { assert, assertEquals } from "jsr:@std/assert@1";
import { BOM, csvField, LEDGER_HEADERS, type LedgerFeedRow, renderLedgerCsv, toFeedRow } from "./ledger-csv.ts";

const row = (over: Partial<LedgerFeedRow> = {}): LedgerFeedRow => ({
  saljare: "Anna Andersson",
  projekt: "1101 - Stenungstorg",
  kundnamn: "Exempel Handel AB",
  fakturadatum: "2026-02-01",
  forfallodatum: "2026-03-03",
  belopp_ex_moms: 1127.92,
  moms: 281.98,
  totalt: 1409.9,
  betald: true,
  sald: true,
  inlagd_i_rapport: true,
  document_number: "1",
  cancelled: false,
  ...over,
});

Deno.test("the header row is Filip's eleven headers, verbatim and in his order", () => {
  const csv = renderLedgerCsv([]);
  assert(csv.startsWith(BOM), "UTF-8 BOM first");
  const header = csv.slice(1).split("\r\n")[0];
  assertEquals(
    header,
    "Säljare,Projekt,Kundnamn,Fakturadatum,Förfallodatum,Belopp ex moms (SEK),Moms (SEK),Totalt belopp (SEK),Betald,Såld,Inlagd i rapport",
  );
  assertEquals(LEDGER_HEADERS.length, 11);
});

Deno.test("a row: ISO dates, dot decimals, whole kronor stay whole, TRUE/FALSE booleans", () => {
  const lines = renderLedgerCsv([row(), row({ belopp_ex_moms: 4500, moms: 1125, totalt: 5625, betald: false })])
    .slice(1)
    .split("\r\n");
  assertEquals(
    lines[1],
    "Anna Andersson,1101 - Stenungstorg,Exempel Handel AB,2026-02-01,2026-03-03,1127.92,281.98,1409.90,TRUE,TRUE,TRUE",
  );
  assertEquals(lines[2], "Anna Andersson,1101 - Stenungstorg,Exempel Handel AB,2026-02-01,2026-03-03,4500,1125,5625,FALSE,TRUE,TRUE");
  assertEquals(lines[3], "", "trailing CRLF");
});

Deno.test("sep=; gives the Swedish Excel shape with decimal commas", () => {
  const lines = renderLedgerCsv([row()], { sep: ";" }).slice(1).split("\r\n");
  assertEquals(lines[0].split(";").length, 11);
  assertEquals(lines[1], "Anna Andersson;1101 - Stenungstorg;Exempel Handel AB;2026-02-01;2026-03-03;1127,92;281,98;1409,90;TRUE;TRUE;TRUE");
});

Deno.test("fields with the separator, quotes or newlines are quoted RFC 4180 style", () => {
  assertEquals(csvField('Bygg & Måleri, AB', ","), '"Bygg & Måleri, AB"');
  assertEquals(csvField('Say "hi"', ","), '"Say ""hi"""');
  assertEquals(csvField("plain", ","), "plain");
  const line = renderLedgerCsv([row({ kundnamn: "Kalle, Kula AB" })]).slice(1).split("\r\n")[1];
  assert(line.includes('"Kalle, Kula AB"'));
});

Deno.test("cancelled invoices are left out; credit notes stay with negative amounts; empties are blank", () => {
  const lines = renderLedgerCsv([
    row({ cancelled: true }),
    row({ belopp_ex_moms: -1127.92, moms: -281.98, totalt: -1409.9, saljare: null, forfallodatum: null }),
  ])
    .slice(1)
    .split("\r\n");
  assertEquals(lines.length, 3, "header + one row + trailing");
  assertEquals(lines[1], ",1101 - Stenungstorg,Exempel Handel AB,2026-02-01,,-1127.92,-281.98,-1409.90,TRUE,TRUE,TRUE");
});

Deno.test("toFeedRow turns PostgREST's numeric strings and timestamps into feed values", () => {
  const r = toFeedRow({
    document_number: "5",
    saljare: "Wilmer",
    projekt: "2104 - Stora Nygatan",
    kundnamn: "Nordic Screens AB",
    fakturadatum: "2026-03-01",
    forfallodatum: "2026-03-31",
    belopp_ex_moms: "1293.67",
    moms: "323.42",
    totalt: "1617.09",
    betald: false,
    sald: true,
    inlagd_i_rapport: true,
    cancelled: false,
  });
  assertEquals(r.belopp_ex_moms, 1293.67);
  assertEquals(r.betald, false);
  assertEquals(r.fakturadatum, "2026-03-01");
});
