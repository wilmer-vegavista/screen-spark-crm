import { addMonths, parseISO, startOfMonth } from "date-fns";

export type BillingFrequency = "engang" | "manad" | "kvartal" | "halvar";

export interface InvoiceEntry {
  date: Date;
  amount: number;
}

const periodMonths: Record<BillingFrequency, number> = {
  engang: 0, // single invoice
  manad: 1,
  kvartal: 3,
  halvar: 6,
};

/**
 * Generate the list of invoice events for an order:
 * total amount spread across N installments based on frequency + duration.
 */
export function buildInvoiceSchedule(
  startDate: Date | string | null | undefined,
  frequency: BillingFrequency,
  durationMonths: number,
  totalAmount: number,
): InvoiceEntry[] {
  if (!startDate || !totalAmount) return [];
  const start = typeof startDate === "string" ? parseISO(startDate) : startDate;
  if (isNaN(start.getTime())) return [];

  if (frequency === "engang") {
    return [{ date: start, amount: totalAmount }];
  }

  const step = periodMonths[frequency];
  const dur = Math.max(1, durationMonths || step);
  const count = Math.max(1, Math.ceil(dur / step));
  const per = totalAmount / count;

  return Array.from({ length: count }, (_, i) => ({
    date: addMonths(start, i * step),
    amount: per,
  }));
}

/** Sum amounts that fall inside [from, to] (inclusive) */
export function sumInRange(entries: InvoiceEntry[], from: Date, to: Date): number {
  return entries
    .filter(e => e.date >= startOfMonth(from) && e.date <= to)
    .reduce((s, e) => s + e.amount, 0);
}

export const frequencyLabels: Record<BillingFrequency, string> = {
  engang: "Engångsfaktura",
  manad: "Månadsvis",
  kvartal: "Kvartalsvis",
  halvar: "Halvårsvis",
};
