/**
 * Kassaflödet as PDF, through the repo's jsPDF + autotable pattern: one landscape page with
 * the workbook's rows in order, the (Inför) start column, the twelve months and Summa.
 * Actual and forecast are told apart in print without colour: forecast cells are italic,
 * cells that carry planned (not yet invoiced) money end with *, sum rows are bold and the
 * legend says so. The running cash rows are the same figures the page shows.
 */
import jsPDF from "jspdf";
import autoTable from "jspdf-autotable";
import { format as fmtDate } from "date-fns";
import { sv } from "date-fns/locale";
import { type Grid, KR0 } from "./cashflow";

export interface CashflowPdfInput {
  title: string;
  fiscalYearLabel: string;
  syncedLabel: string;
  grid: Grid;
}

export function generateCashflowPdf(input: CashflowPdfInput) {
  const doc = new jsPDF({ unit: "pt", format: "a4", orientation: "landscape" });
  const M = 24;
  let y = 34;
  doc.setFont("helvetica", "bold");
  doc.setFontSize(13);
  doc.text(`${input.title} ${input.fiscalYearLabel}`, M, y);
  y += 13;
  doc.setFont("helvetica", "normal");
  doc.setFontSize(7.5);
  doc.text(
    `${input.syncedLabel} · Utskriven: ${fmtDate(new Date(), "d MMMM yyyy HH:mm", { locale: sv })} · Belopp i kronor, exkl. moms per rad, momsen på egna rader`,
    M,
    y,
  );
  y += 10;
  doc.text(
    "Kursiv = prognos (förfallodatum, plan) · * = innehåller planerade belopp från orderboken som inte är fakturerade · Fet = summa och kassa · Innevarande månad = utfall hittills + prognos",
    M,
    y,
  );

  const { columns, lines } = input.grid;
  const head = [["", ...columns.map((c) => (c.monthKind === "current" ? `${c.label} (nu)` : c.label)), "Summa"]];
  const body = lines.map((l) => [
    l.def.label,
    ...columns.map((c) => {
      const cell = l.cells[c.key];
      if (!cell || cell.value === null) return "";
      const text = KR0(cell.value);
      if (text === "–") return "–";
      return cell.tone === "planned" ? `${text}*` : text;
    }),
    l.def.kind === "header" ? "" : KR0(l.total.value),
  ]);

  autoTable(doc, {
    startY: y + 8,
    margin: { left: M, right: M },
    head,
    body,
    styles: { fontSize: 6, cellPadding: 1.6, overflow: "ellipsize", halign: "right", valign: "middle" },
    headStyles: { fillColor: [40, 40, 40], textColor: 255, halign: "right", fontSize: 6 },
    columnStyles: { 0: { halign: "left", cellWidth: 150 } },
    didParseCell: (data) => {
      if (data.section !== "body") return;
      const line = lines[data.row.index];
      if (!line) return;
      const isSum = line.def.kind === "sum" || line.def.kind === "balance";
      if (isSum) data.cell.styles.fontStyle = "bold";
      if (line.def.kind === "header") {
        data.cell.styles.fontStyle = "bold";
        data.cell.styles.fillColor = [235, 235, 235];
      }
      if (line.def.kind === "balance" && line.def.position !== 6) data.cell.styles.fillColor = [226, 240, 244];
      if (data.column.index >= 1 && data.column.index <= columns.length) {
        const col = columns[data.column.index - 1];
        const cell = line.cells[col.key];
        if (cell && cell.value !== null && (cell.tone === "forecast" || cell.tone === "planned" || (col.monthKind === "ahead" && cell.tone === "computed"))) {
          data.cell.styles.fontStyle = isSum ? "bolditalic" : "italic";
        }
        if (col.monthKind === "current") data.cell.styles.fillColor = data.cell.styles.fillColor ?? [255, 250, 235];
      }
    },
  });

  doc.save(`kassaflode-${input.fiscalYearLabel.replace(/[^0-9a-z–-]/gi, "")}-${fmtDate(new Date(), "yyyy-MM-dd")}.pdf`);
}
