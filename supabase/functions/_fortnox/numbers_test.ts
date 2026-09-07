import { assertEquals, assertThrows } from "jsr:@std/assert@1";
import { num, requiredNum, swedishNumber } from "./numbers.ts";
import { FortnoxReadError } from "./errors.ts";

Deno.test("Swedish money strings parse: spaces, non-breaking spaces, comma decimal", () => {
  assertEquals(swedishNumber("1 713,94"), "1713.94");
  assertEquals(num("1 713,94"), 1713.94);
  assertEquals(num("12 500,00"), 12500);
  assertEquals(num(7762), 7762);
  assertEquals(num(""), 0);
  assertEquals(num(null), 0);
});

Deno.test("requiredNum refuses missing or malformed values", () => {
  assertEquals(requiredNum("833", "Total"), 833);
  assertThrows(() => requiredNum("", "Total"), FortnoxReadError);
  assertThrows(() => requiredNum("abc", "Total"), FortnoxReadError);
});
