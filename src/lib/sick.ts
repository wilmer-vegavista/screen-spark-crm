// Sjukavdrag enligt sjuklönelagen, förenklad modell för månadslön:
//
// - Dagslön beräknas per kalenderdag: månadslön × 12 / 365.
// - Dag 1–14 i en sjukperiod betalar arbetsgivaren sjuklön (80 %),
//   så nettoavdraget är 20 % av dagslönen per sjukdag.
// - Från dag 15 tar Försäkringskassan över (sjukpenning) och hela
//   dagslönen dras från lönen.
// - Karensavdrag: 20 % av sjuklönen för en genomsnittlig arbetsvecka
//   = 0,2 × 0,8 × (månadslön × 12 / 52). Dras en gång per sjukperiod,
//   den månad periodens första dag infaller, och kan aldrig överstiga
//   periodens totala sjuklön.
// - Återinsjuknanderegeln: börjar en ny sjukfrånvaro inom 5 kalenderdagar
//   räknas den som fortsättning på samma period (inget nytt karensavdrag).
//
// Förenklingar: dagsnumreringen i perioden räknar markerade sjukdagar
// (inte mellanliggande friska kalenderdagar), och deltid/schema hanteras
// inte — modellen utgår från heltid med månadslön.

const MS_PER_DAY = 24 * 60 * 60 * 1000;

export type SickSummary = {
  deduction: number;      // totalt löneavdrag i månaden (kr)
  sickDaysInMonth: number;
  karensCount: number;    // antal karensavdrag som dragits i månaden
};

// days: yyyy-mm-dd-strängar (får innehålla dagar före månaden för korrekt
// periodindelning — skicka med ~60 dagars historik före `from`).
export function computeSickDeduction(baseSalary: number, days: string[], from: Date, to: Date): SickSummary {
  const empty = { deduction: 0, sickDaysInMonth: 0, karensCount: 0 };
  if (!baseSalary || baseSalary <= 0 || !days.length) {
    const inMonth = days.filter(d => {
      const t = new Date(`${d}T12:00:00`);
      return t >= from && t <= to;
    }).length;
    return { ...empty, sickDaysInMonth: inMonth };
  }

  const sorted = Array.from(new Set(days)).sort();
  const dates = sorted.map(d => new Date(`${d}T12:00:00`));

  const dailyPay = (baseSalary * 12) / 365;
  const weeklySickPay = 0.8 * (baseSalary * 12) / 52;
  const karens = 0.2 * weeklySickPay;

  // Dela upp i sjukperioder (gap > 5 kalenderdagar => ny period)
  const periods: Date[][] = [];
  for (const d of dates) {
    const cur = periods[periods.length - 1];
    if (cur && (d.getTime() - cur[cur.length - 1].getTime()) / MS_PER_DAY <= 5) {
      cur.push(d);
    } else {
      periods.push([d]);
    }
  }

  let deduction = 0;
  let sickDaysInMonth = 0;
  let karensCount = 0;

  for (const period of periods) {
    const sickPayDays = Math.min(period.length, 14);
    const periodSickPay = sickPayDays * 0.8 * dailyPay;

    period.forEach((d, i) => {
      if (d < from || d > to) return;
      sickDaysInMonth += 1;
      deduction += i < 14 ? 0.2 * dailyPay : dailyPay;
    });

    // Karensavdrag den månad perioden börjar, max periodens sjuklön
    const first = period[0];
    if (first >= from && first <= to) {
      deduction += Math.min(karens, periodSickPay);
      karensCount += 1;
    }
  }

  return { deduction: Math.min(deduction, baseSalary), sickDaysInMonth, karensCount };
}
