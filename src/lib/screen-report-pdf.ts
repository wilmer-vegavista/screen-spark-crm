import jsPDF from "jspdf";
import autoTable from "jspdf-autotable";
import { format as fmtDate } from "date-fns";
import { sv } from "date-fns/locale";

const SEK = (n: number) =>
  new Intl.NumberFormat("sv-SE", { maximumFractionDigits: 0 }).format(Math.round(n || 0)) + " SEK";

export type ScreenReportRow = {
  company: string;
  date: string | null;
  weeks: number;
  live?: string | null;
  unitPrice: number;
  amount: number;
};

export type ScreenReportInput = {
  screenName: string;
  city?: string | null;
  ownerName?: string | null;
  sharePct: number;
  periodLabel: string;
  rows: ScreenReportRow[];
};

export function generateScreenReportPdf(input: ScreenReportInput) {
  const doc = new jsPDF({ unit: "pt", format: "a4" });
  const M = 48;
  let y = 56;

  doc.setFont("helvetica", "bold");
  doc.setFontSize(18);
  doc.text("Redovisning – skärm", M, y);

  y += 22;
  doc.setFontSize(13);
  doc.text(input.screenName + (input.city ? ` · ${input.city}` : ""), M, y);

  y += 18;
  doc.setFont("helvetica", "normal");
  doc.setFontSize(10);
  doc.text(`Period: ${input.periodLabel}`, M, y);
  y += 14;
  doc.text(`Ägare: ${input.ownerName || "—"}`, M, y);
  y += 14;
  doc.text(`Fördelning till ägare: ${input.sharePct}%`, M, y);
  y += 14;
  doc.text(`Utskriven: ${fmtDate(new Date(), "d MMMM yyyy", { locale: sv })}`, M, y);

  const total = input.rows.reduce((s, r) => s + r.amount, 0);
  const share = (total * input.sharePct) / 100;

  autoTable(doc, {
    startY: y + 20,
    margin: { left: M, right: M },
    head: [["Kund", "Orderdatum", "Går live", "Perioder", "Pris", "Belopp"]],
    body: input.rows.map(r => [
      r.company,
      r.date ? fmtDate(new Date(r.date), "d MMM yyyy", { locale: sv }) : "—",
      r.live || "—",
      String(r.weeks),
      SEK(r.unitPrice),
      SEK(r.amount),
    ]),
    styles: { fontSize: 9, cellPadding: 6 },
    headStyles: { fillColor: [40, 40, 40], textColor: 255 },
    columnStyles: {
      3: { halign: "right" },
      4: { halign: "right" },
      5: { halign: "right" },
    },
  });

  const endY = (doc as any).lastAutoTable?.finalY ?? y + 40;
  autoTable(doc, {
    startY: endY + 14,
    margin: { left: M, right: M },
    body: [
      ["Total intäkt", SEK(total)],
      [`Till ägare (${input.sharePct}%)`, SEK(share)],
      ["Kvar till oss", SEK(total - share)],
    ],
    styles: { fontSize: 10, cellPadding: 6 },
    columnStyles: { 0: { fontStyle: "bold" }, 1: { halign: "right" } },
    theme: "grid",
  });

  const safe = input.screenName.replace(/[^\w\d-]+/g, "_");
  doc.save(`redovisning-${safe}.pdf`);
}

export type ScreenMonthlyRow = {
  name: string;
  city?: string | null;
  months: number[]; // 12 belopp, jan–dec
  yearTotal: number;
  totalOrderValue: number; // totalt ordervärde hittills (alla år)
};

export type ScreenMonthlyReportInput = {
  year: number;
  rows: ScreenMonthlyRow[];
};

export function generateScreenMonthlyReportPdf(input: ScreenMonthlyReportInput) {
  const doc = new jsPDF({ unit: "pt", format: "a4", orientation: "landscape" });
  const M = 40;
  let y = 52;

  const NUM = (n: number) =>
    n ? new Intl.NumberFormat("sv-SE", { maximumFractionDigits: 0 }).format(Math.round(n)) : "—";

  doc.setFont("helvetica", "bold");
  doc.setFontSize(18);
  doc.text(`Omsättning per skärm och månad ${input.year}`, M, y);

  y += 18;
  doc.setFont("helvetica", "normal");
  doc.setFontSize(10);
  doc.text(
    `Alla belopp i SEK exkl. moms · Utskriven: ${fmtDate(new Date(), "d MMMM yyyy", { locale: sv })}`,
    M,
    y,
  );

  const monthNames = Array.from({ length: 12 }, (_, i) =>
    fmtDate(new Date(2000, i, 1), "MMM", { locale: sv }),
  );

  const monthTotals = Array.from({ length: 12 }, (_, i) =>
    input.rows.reduce((s, r) => s + (r.months[i] || 0), 0),
  );
  const yearSum = input.rows.reduce((s, r) => s + r.yearTotal, 0);
  const orderValueSum = input.rows.reduce((s, r) => s + r.totalOrderValue, 0);

  autoTable(doc, {
    startY: y + 16,
    margin: { left: M, right: M },
    head: [["Skärm", ...monthNames, `Totalt ${input.year}`, "Ordervärde hittills"]],
    body: input.rows.map(r => [
      r.name + (r.city ? ` · ${r.city}` : ""),
      ...r.months.map(NUM),
      NUM(r.yearTotal),
      NUM(r.totalOrderValue),
    ]),
    foot: [["Totalt", ...monthTotals.map(NUM), NUM(yearSum), NUM(orderValueSum)]],
    styles: { fontSize: 7.5, cellPadding: 4 },
    headStyles: { fillColor: [40, 40, 40], textColor: 255 },
    footStyles: { fillColor: [230, 230, 230], textColor: 20, fontStyle: "bold" },
    columnStyles: Object.fromEntries(
      Array.from({ length: 14 }, (_, i) => [i + 1, { halign: "right" as const }]),
    ),
  });

  doc.save(`omsattning-per-skarm-${input.year}.pdf`);
}

export type OwnerReportRow = {
  company: string;
  screen: string;
  date: string | null;
  metric: string;
  period: string;
  amount: number;
};

export type OwnerScreenSum = {
  screen: string;
  amount: number;
};

export type OwnerReportInput = {
  ownerName: string;
  periodLabel: string;
  sharePct?: number | null;
  rows: OwnerReportRow[];
  /** Fakturerat per skärm under rapportens period */
  screenPeriodSums?: OwnerScreenSum[];
  /** Total ordersumma per skärm, alla ordrar oavsett period */
  screenTotalSums?: OwnerScreenSum[];
};

export function generateOwnerReportPdf(input: OwnerReportInput) {
  const doc = new jsPDF({ unit: "pt", format: "a4" });
  const M = 48;
  let y = 56;

  doc.setFont("helvetica", "bold");
  doc.setFontSize(18);
  doc.text("Bokningar – ägare", M, y);

  y += 22;
  doc.setFontSize(13);
  doc.text(input.ownerName || "—", M, y);

  y += 18;
  doc.setFont("helvetica", "normal");
  doc.setFontSize(10);
  doc.text(`Period: ${input.periodLabel}`, M, y);
  y += 14;
  doc.text(`Utskriven: ${fmtDate(new Date(), "d MMMM yyyy", { locale: sv })}`, M, y);

  const total = input.rows.reduce((s, r) => s + r.amount, 0);

  autoTable(doc, {
    startY: y + 20,
    margin: { left: M, right: M },
    head: [["Kund", "Skärm", "Orderdatum", "SOV / visningar", "Period", "Pris"]],
    body: input.rows.map(r => [
      r.company,
      r.screen,
      r.date ? fmtDate(new Date(r.date), "d MMM yyyy", { locale: sv }) : "—",
      r.metric,
      r.period,
      SEK(r.amount),
    ]),
    styles: { fontSize: 9, cellPadding: 6 },
    headStyles: { fillColor: [40, 40, 40], textColor: 255 },
    columnStyles: { 5: { halign: "right" } },
  });

  const endY = (doc as any).lastAutoTable?.finalY ?? y + 40;
  const body: string[][] = [["Total intäkt", SEK(total)]];
  if (input.sharePct != null) {
    const share = (total * input.sharePct) / 100;
    body.push([`Till ägare (${input.sharePct}%)`, SEK(share)]);
    body.push(["Kvar till oss", SEK(total - share)]);
  }

  autoTable(doc, {
    startY: endY + 14,
    margin: { left: M, right: M },
    body,
    styles: { fontSize: 10, cellPadding: 6 },
    columnStyles: { 0: { fontStyle: "bold" }, 1: { halign: "right" } },
    theme: "grid",
  });

  // Sektion med rubrik + tabell "Skärm | Belopp", med sidbrytning vid behov
  const screenSection = (title: string, sums: OwnerScreenSum[]) => {
    let startY = ((doc as any).lastAutoTable?.finalY ?? y) + 28;
    const pageH = doc.internal.pageSize.getHeight();
    if (startY > pageH - 120) {
      doc.addPage();
      startY = 56;
    }
    doc.setFont("helvetica", "bold");
    doc.setFontSize(12);
    doc.text(title, M, startY);
    autoTable(doc, {
      startY: startY + 8,
      margin: { left: M, right: M },
      head: [["Skärm", "Belopp"]],
      body: sums.map(s => [s.screen, SEK(s.amount)]),
      foot: [["Totalt", SEK(sums.reduce((t, s) => t + s.amount, 0))]],
      styles: { fontSize: 9, cellPadding: 6 },
      headStyles: { fillColor: [40, 40, 40], textColor: 255 },
      footStyles: { fillColor: [230, 230, 230], textColor: 20, fontStyle: "bold" },
      columnStyles: { 1: { halign: "right" } },
    });
  };

  if (input.screenPeriodSums?.length) {
    screenSection(`Omsättning per skärm – ${input.periodLabel}`, input.screenPeriodSums);
  }
  if (input.screenTotalSums?.length) {
    screenSection("Total omsättning per skärm (alla ordrar)", input.screenTotalSums);
  }

  const safe = (input.ownerName || "agare").replace(/[^\w\d-]+/g, "_");
  doc.save(`bokningar-${safe}.pdf`);
}
