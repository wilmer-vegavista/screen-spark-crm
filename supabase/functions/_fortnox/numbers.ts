/**
 * Swedish number parsing, ported from the fortnox-agent's read layer.
 *
 * Fortnox sometimes returns money as `"1 713,94"` — thousands separated by a plain or
 * non-breaking space, comma as the decimal sign. `Number("1 713,94")` is NaN, and a NaN
 * that quietly becomes 0 is invisible on a screen. So: strip both kinds of space, swap
 * the comma, and let the caller decide whether a missing value is 0 or an error.
 */
import { FortnoxReadError } from "./errors.ts";

export const swedishNumber = (s: string): string => s.replace(/[\s\u00a0]/g, "").replace(",", ".");

/** Optional number: absent is 0, malformed is 0 too (use requiredNum where it matters). */
export const num = (v: unknown): number => {
  if (v === undefined || v === null || v === "") return 0;
  const n = typeof v === "number" ? v : Number(swedishNumber(String(v)));
  return Number.isFinite(n) ? n : 0;
};

/** A number a decision depends on: missing or malformed is an error, never a silent 0. */
export const requiredNum = (v: unknown, what: string): number => {
  if (v === undefined || v === null || v === "") {
    throw new FortnoxReadError(`${what} is missing. Refusing to read it as 0.`);
  }
  const n = typeof v === "number" ? v : Number(swedishNumber(String(v)));
  if (!Number.isFinite(n)) {
    throw new FortnoxReadError(`${what} is ${JSON.stringify(v)}, which is not a number.`);
  }
  return n;
};

export const str = (v: unknown): string => (v === undefined || v === null ? "" : String(v));
