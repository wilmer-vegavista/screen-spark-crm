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
    head: [["Kund", "Fakturadatum", "Går live", "Perioder", "Pris", "Belopp"]],
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
