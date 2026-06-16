// Swedish public holidays (röda dagar) for business-day calculations.
// Includes fixed dates and Easter-derived movable dates.

function easterSunday(year: number): Date {
  // Anonymous Gregorian algorithm
  const a = year % 19;
  const b = Math.floor(year / 100);
  const c = year % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31);
  const day = ((h + l - 7 * m + 114) % 31) + 1;
  return new Date(year, month - 1, day);
}

function addDays(d: Date, n: number): Date {
  const r = new Date(d);
  r.setDate(r.getDate() + n);
  return r;
}

function ymd(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

// Midsummer's eve = Friday between 19-25 June.
function midsummersEve(year: number): Date {
  for (let day = 19; day <= 25; day++) {
    const d = new Date(year, 5, day);
    if (d.getDay() === 5) return d;
  }
  return new Date(year, 5, 19);
}

// All Saints' Day = Saturday between Oct 31 and Nov 6.
function allSaintsDay(year: number): Date {
  for (let day = 31; day <= 31 + 6; day++) {
    const d = new Date(year, 9, day); // start from Oct 31
    if (d.getDay() === 6) return d;
  }
  return new Date(year, 10, 1);
}

export function swedishHolidays(year: number): Set<string> {
  const easter = easterSunday(year);
  const set = new Set<string>();
  // Fixed
  set.add(`${year}-01-01`); // Nyårsdagen
  set.add(`${year}-01-06`); // Trettondedag jul
  set.add(`${year}-05-01`); // Första maj
  set.add(`${year}-06-06`); // Sveriges nationaldag
  set.add(`${year}-12-24`); // Julafton (de facto röd)
  set.add(`${year}-12-25`); // Juldagen
  set.add(`${year}-12-26`); // Annandag jul
  set.add(`${year}-12-31`); // Nyårsafton (de facto röd)
  // Easter-derived
  set.add(ymd(addDays(easter, -2))); // Långfredagen
  set.add(ymd(addDays(easter, 1)));  // Annandag påsk
  set.add(ymd(addDays(easter, 39))); // Kristi himmelsfärds dag
  // Pingstdagen (söndag, inte arbetsdag ändå) -> hoppa
  // Midsummer
  set.add(ymd(midsummersEve(year)));
  set.add(ymd(addDays(midsummersEve(year), 1))); // Midsommardagen
  // All Saints'
  set.add(ymd(allSaintsDay(year)));
  return set;
}

const cache = new Map<number, Set<string>>();
function holidaysFor(year: number): Set<string> {
  let s = cache.get(year);
  if (!s) { s = swedishHolidays(year); cache.set(year, s); }
  return s;
}

export function isSwedishBusinessDay(d: Date): boolean {
  const day = d.getDay();
  if (day === 0 || day === 6) return false; // Sun/Sat
  return !holidaysFor(d.getFullYear()).has(ymd(d));
}

/** Inclusive count of business days between `from` and `to` (excluding weekends + Swedish holidays). */
export function businessDaysBetween(from: Date, to: Date): number {
  if (to < from) return 0;
  const start = new Date(from.getFullYear(), from.getMonth(), from.getDate());
  const end = new Date(to.getFullYear(), to.getMonth(), to.getDate());
  let count = 0;
  for (let d = start; d <= end; d = addDays(d, 1)) {
    if (isSwedishBusinessDay(d)) count++;
  }
  return count;
}
