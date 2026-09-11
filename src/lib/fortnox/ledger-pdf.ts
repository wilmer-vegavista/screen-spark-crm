/**
 * Kundreskontran as PDF, through the repo's own jsPDF + autotable pattern
 * (src/lib/screen-report-pdf.ts). Plain layout: title, filter line, the eleven columns
 * plus Kvar att betala and the instalment counter, a totals row.
 */
import jsPDF from "jspdf";
import autoTable from "jspdf-autotable";
import { format as fmtDate } from "date-fns";
import { sv } from "date-fns/locale";
import { installmentLabel, type LedgerRow, SEK2, SOURCE_MISSING, SOURCE_MISSING_HINT } from "./ledger";

export interface LedgerPdfInput {
  title: string;
  filterLabel: string;
  syncedLabel: string;
  rows: LedgerRow[];
}

const ja = (b: boolean) => (b ? "Ja" : "Nej");

export function generateLedgerPdf(input: LedgerPdfInput) {
  const doc = new jsPDF({ unit: "pt", format: "a4", orientation: "landscape" });
  const M = 36;
  let y = 48;

  doc.setFont("helvetica", "bold");
  doc.setFontSize(16);
  doc.text(input.title, M, y);
  y += 18;
  doc.setFont("helvetica", "normal");
  doc.setFontSize(9);
  doc.text(input.filterLabel, M, y);
  y += 12;
  doc.text(
    `${input.syncedLabel} · Utskriven: ${fmtDate(new Date(), "d MMMM yyyy HH:mm", { locale: sv })}`,
    M,
    y,
  );
  y += 12;
  // Paper has no hover: the page's tooltip on Såld / Inlagd i rapport is this line.
  doc.text(`Såld och Inlagd i rapport: ${SOURCE_MISSING} = ${SOURCE_MISSING_HINT}`, M, y);

  const live = input.rows.filter((r) => !r.cancelled);
  const sum = (f: (r: LedgerRow) => number) => live.reduce((s, r) => s + f(r), 0);

  autoTable(doc, {
    startY: y + 14,
    margin: { left: M, right: M },
    head: [
      [
        "Säljare",
        "Projekt",
        "Kundnamn",
        "Fakturadatum",
        "Förfallodatum",
        "Belopp ex moms",
        "Moms",
        "Totalt",
        "Betald",
        "Såld",
        "Inlagd i rapport",
        "Kvar att betala",
        "Delfaktura",
        "Fortnox-nr",
      ],
    ],
    body: input.rows.map((r) => [
      r.saljare ?? "",
      r.projekt ?? "",
      r.kundnamn ?? "",
      r.fakturadatum.slice(0, 10),
      r.forfallodatum?.slice(0, 10) ?? "",
      SEK2(r.belopp_ex_moms),
      SEK2(r.moms),
      SEK2(r.totalt),
      r.cancelled ? "Makulerad" : ja(r.betald),
      SOURCE_MISSING,
      SOURCE_MISSING,
      r.cancelled ? "" : SEK2(r.kvar_att_betala),
      installmentLabel(r),
      r.document_number,
    ]),
    foot: [
      [
        `Totalt (${live.length} fakturor)`,
        "",
        "",
        "",
        "",
        SEK2(sum((r) => r.belopp_ex_moms)),
        SEK2(sum((r) => r.moms)),
        SEK2(sum((r) => r.totalt)),
        `${live.filter((r) => r.betald).length} betalda`,
        "",
        "",
        SEK2(sum((r) => r.kvar_att_betala)),
        "",
        "",
      ],
    ],
    styles: { fontSize: 7, cellPadding: 3 },
    headStyles: { fillColor: [40, 40, 40], textColor: 255 },
    footStyles: { fillColor: [235, 235, 235], textColor: 20, fontStyle: "bold" },
    columnStyles: {
      5: { halign: "right" },
      6: { halign: "right" },
      7: { halign: "right" },
      11: { halign: "right" },
    },
  });

  doc.save(`kundreskontra-${fmtDate(new Date(), "yyyy-MM-dd")}.pdf`);
}
