import { assert, assertEquals } from "jsr:@std/assert@1";
import {
  extractCode,
  nameWithoutCode,
  NO_CANDIDATE_REASON,
  normalizeName,
  normalizeOrgNumber,
  proposeCustomer,
  proposeProject,
  similarity,
} from "./matcher.ts";

Deno.test("org numbers normalise to ten digits", () => {
  assertEquals(normalizeOrgNumber("556677-8899"), "5566778899");
  assertEquals(normalizeOrgNumber("16 5566778899"), "5566778899");
  assertEquals(normalizeOrgNumber(null), "");
});

Deno.test("names normalise: case, punctuation, legal form", () => {
  assertEquals(normalizeName("ICA Maxi Arninge AB"), "ica maxi arninge");
  assertEquals(normalizeName("Lån & Spar Sverige Bank, filial"), "lån spar bank");
  assertEquals(normalizeName("  Nordic   Screens Aktiebolag (publ) "), "nordic screens");
});

Deno.test("four-digit codes are found in either shape", () => {
  assertEquals(extractCode("1101 - Stenungstorg"), "1101");
  assertEquals(extractCode("stor2104"), "2104");
  assertEquals(extractCode("Kungens Kurva"), null);
  assertEquals(extractCode("556677-8899"), null, "a longer digit run is not a code");
  assertEquals(nameWithoutCode("1101 - Stenungstorg"), "stenungstorg");
});

Deno.test("similarity is 1 for equal, 0 for disjoint, in between otherwise", () => {
  assertEquals(similarity("abc", "abc"), 1);
  assertEquals(similarity("abc", "xyz"), 0);
  const s = similarity("stenungstorg", "stenungsund");
  assert(s > 0.4 && s < 0.85, String(s));
});

const pool = [
  { number: "10", name: "Exempel Handel AB", orgNumber: "556000-1111" },
  { number: "11", name: "Nordic Screens Aktiebolag", orgNumber: "556000-2222" },
  { number: "12", name: "Kaffebaren i Stan AB", orgNumber: null },
];

Deno.test("customer: a Fortnox number that is an organisation number is proposed as that string", () => {
  const p = proposeCustomer(
    { id: "c9", company_name: "Exempelkund med org.nr AB", org_number: "556527-5590" },
    [...pool, { number: "556527-5590", name: "Exempelkund med org.nr AB", orgNumber: "556527-5590" }],
  );
  assertEquals(p.candidateNumber, "556527-5590");
  assertEquals(p.confidence, "exact");
  // Taken is keyed by the same string: once linked, it is not offered again.
  const again = proposeCustomer(
    { id: "c10", company_name: "Exempelkund med org.nr AB", org_number: "556527-5590" },
    [{ number: "556527-5590", name: "Exempelkund med org.nr AB", orgNumber: "556527-5590" }],
    new Set(["556527-5590"]),
  );
  assertEquals(again.candidateNumber, null);
});

Deno.test("customer: same org number wins, exact", () => {
  const p = proposeCustomer(
    { id: "c1", company_name: "Något Helt Annat", org_number: "5560001111" },
    pool,
  );
  assertEquals([p.candidateNumber, p.confidence, p.method], ["10", "exact", "orgnr"]);
  assertEquals(p.reason, "Samma organisationsnummer (556000-1111)");
});

Deno.test("customer: same normalised name is high, not auto-linkable", () => {
  const p = proposeCustomer(
    { id: "c2", company_name: "nordic screens AB", org_number: null },
    pool,
  );
  assertEquals([p.candidateNumber, p.confidence, p.method], ["11", "high", "name"]);
});

Deno.test("customer: similar name is fuzzy with a percentage in the reason", () => {
  const p = proposeCustomer(
    { id: "c3", company_name: "Kaffebaren i Staden AB", org_number: null },
    pool,
  );
  assertEquals([p.candidateNumber, p.method], ["12", "fuzzy"]);
  assert(p.confidence === "medium" || p.confidence === "low");
  assert(/Liknande namn \(\d+ %\)/.test(p.reason), p.reason);
});

Deno.test("customer: no candidate is a valid proposal meaning create", () => {
  const p = proposeCustomer(
    { id: "c4", company_name: "Zebra Zonen", org_number: "5560009999" },
    pool,
  );
  assertEquals(
    [p.candidateNumber, p.confidence, p.method, p.reason],
    [null, "none", "none", NO_CANDIDATE_REASON],
  );
});

Deno.test("customer: a Fortnox number already linked elsewhere is never proposed again", () => {
  const p = proposeCustomer(
    { id: "c5", company_name: "x", org_number: "5560001111" },
    pool,
    new Set(["10"]),
  );
  assertEquals(p.candidateNumber, null);
});

Deno.test("customer: the {VV id} marker beats everything", () => {
  const withMarker = [
    ...pool,
    { number: "13", name: "Skapad av synken", orgNumber: null, markerId: "c6" },
  ];
  const p = proposeCustomer(
    { id: "C6", company_name: "Exempel Handel AB", org_number: "5560001111" },
    withMarker,
  );
  assertEquals([p.candidateNumber, p.method, p.confidence], ["13", "marker", "exact"]);
});

const projects = [
  { number: "1101", description: "Stenungsund" },
  { number: "2", description: "stor2104 Stora Nygatan" },
  { number: "3", description: "Kungens Kurva" },
];

Deno.test("screen: code equal to the Fortnox ProjectNumber is exact", () => {
  const p = proposeProject({ id: "s1", name: "1101 - Stenungstorg" }, projects);
  assertEquals([p.candidateNumber, p.confidence, p.method], ["1101", "exact", "code"]);
  assertEquals(p.reason, "Samma fyrsiffriga kod 1101 (Fortnox projektnummer)");
});

Deno.test("screen: code inside the Fortnox project name is exact too", () => {
  const p = proposeProject({ id: "s2", name: "2104 - Stora Nygatan" }, projects);
  assertEquals([p.candidateNumber, p.method], ["2", "code"]);
});

Deno.test("screen: same label without code is high", () => {
  const p = proposeProject({ id: "s3", name: "Kungens Kurva" }, projects);
  assertEquals([p.candidateNumber, p.confidence, p.method], ["3", "high", "name"]);
});

Deno.test("screen: Stenungstorg vs Stenungsund is fuzzy, never exact", () => {
  const p = proposeProject({ id: "s4", name: "Stenungstorg" }, projects);
  assertEquals([p.candidateNumber, p.method], ["1101", "fuzzy"]);
  assert(p.confidence !== "exact");
});

Deno.test("screen: nothing similar means create", () => {
  const p = proposeProject({ id: "s5", name: "3101 - ICA Maxi Arninge" }, projects);
  assertEquals([p.candidateNumber, p.confidence], [null, "none"]);
});
