// Helpers for Swedish organisationsnummer (works in both client and server code)

/** Strip everything but digits and drop a leading 16-prefix (12-digit form). */
export function normalizeOrgNumber(raw: string): string {
  let digits = (raw || "").replace(/\D/g, "");
  if (digits.length === 12 && digits.startsWith("16")) digits = digits.slice(2);
  return digits;
}

/** Luhn check over all 10 digits (the last digit is the check digit). */
export function isValidOrgNumber(raw: string): boolean {
  const digits = normalizeOrgNumber(raw);
  if (digits.length !== 10) return false;
  let sum = 0;
  for (let i = 0; i < 10; i++) {
    let n = Number(digits[i]);
    if (i % 2 === 0) {
      n *= 2;
      if (n > 9) n -= 9;
    }
    sum += n;
  }
  return sum % 10 === 0;
}

/** 5560021846 -> 556002-1846 */
export function formatOrgNumber(raw: string): string {
  const digits = normalizeOrgNumber(raw);
  return digits.length === 10 ? `${digits.slice(0, 6)}-${digits.slice(6)}` : raw;
}
