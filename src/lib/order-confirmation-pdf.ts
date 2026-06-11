import jsPDF from "jspdf";
import autoTable from "jspdf-autotable";
import { format as fmtDate, subDays, parseISO, addWeeks } from "date-fns";
import { sv } from "date-fns/locale";

const SEK = (n: number) =>
  new Intl.NumberFormat("sv-SE", { style: "currency", currency: "SEK", maximumFractionDigits: 2 }).format(n || 0);

const VAT_RATE = 0.25; // 25% moms

export type OrderPdfInput = {
  deal: any;
  customer: any | null;
  product: any | null;
  pkg: any | null;
  sellerName?: string | null;
  sellerEmail?: string | null;
};

export function generateOrderConfirmationPdf(input: OrderPdfInput) {
  const { deal, customer, product, pkg, sellerName, sellerEmail } = input;
  const doc = new jsPDF({ unit: "pt", format: "a4" });
  const pageW = doc.internal.pageSize.getWidth();
  const margin = 40;
  let y = margin;

  // Header
  doc.setFont("helvetica", "bold");
  doc.setFontSize(22);
  doc.text("Orderbekräftelse", margin, y);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(10);
  y += 18;
  doc.text(`Order-ID: ${deal.id.slice(0, 8).toUpperCase()}`, margin, y);
  doc.text(`Datum: ${fmtDate(new Date(), "d MMM yyyy", { locale: sv })}`, pageW - margin, y, { align: "right" });

  y += 24;

  // Two-column: Kund / Beställare
  const colW = (pageW - margin * 2 - 20) / 2;
  const drawBox = (x: number, top: number, title: string, lines: string[]) => {
    doc.setFont("helvetica", "bold");
    doc.setFontSize(9);
    doc.setTextColor(120);
    doc.text(title.toUpperCase(), x, top);
    doc.setTextColor(0);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(10);
    let ly = top + 14;
    lines.filter(Boolean).forEach((l) => { doc.text(l, x, ly); ly += 13; });
    return ly;
  };

  const custLines = [
    customer?.company_name ?? "—",
    customer?.billing_address || "",
    [customer?.postal_code, customer?.city].filter(Boolean).join(" "),
    customer?.org_number ? `Org.nr: ${customer.org_number}` : "",
    customer?.vat_number ? `Momsreg.nr: ${customer.vat_number}` : "",
  ];
  const contactLines = [
    customer?.contact_name || "—",
    customer?.email || "",
    customer?.phone || "",
    "",
    sellerName ? `Säljare: ${sellerName}` : "",
    sellerEmail || "",
  ];
  const yA = drawBox(margin, y, "Kund", custLines);
  const yB = drawBox(margin + colW + 20, y, "Beställare / kontakt", contactLines);
  y = Math.max(yA, yB) + 10;

  // Kampanjperiod & material deadline
  let campaignStart: Date | null = deal.campaign_start ? parseISO(deal.campaign_start) : null;
  let campaignEnd: Date | null = deal.campaign_end ? parseISO(deal.campaign_end) : null;
  if (!campaignStart && deal.campaign_weeks && campaignEnd) {
    campaignStart = addWeeks(campaignEnd, -deal.campaign_weeks);
  }
  if (campaignStart && !campaignEnd && deal.campaign_weeks) {
    campaignEnd = addWeeks(campaignStart, deal.campaign_weeks);
  }

  const periodText =
    campaignStart && campaignEnd
      ? `${fmtDate(campaignStart, "d MMM yyyy", { locale: sv })} – ${fmtDate(campaignEnd, "d MMM yyyy", { locale: sv })}`
      : deal.campaign_weeks
        ? `${deal.campaign_weeks} veckor (datum ej fastställda)`
        : "—";

  const materialDeadline = campaignStart ? subDays(campaignStart, 7) : null;

  doc.setFont("helvetica", "bold");
  doc.setFontSize(11);
  doc.text("Kampanjdetaljer", margin, y);
  y += 6;
  doc.setDrawColor(220);
  doc.line(margin, y, pageW - margin, y);
  y += 12;
  doc.setFont("helvetica", "normal");
  doc.setFontSize(10);

  const detailRow = (label: string, value: string) => {
    doc.setTextColor(120);
    doc.text(label, margin, y);
    doc.setTextColor(0);
    doc.text(value, margin + 170, y);
    y += 14;
  };

  detailRow("Kampanjperiod:", periodText);
  detailRow("SOV:", deal.sov_pct != null ? `${deal.sov_pct} %` : "—");
  detailRow("Antal visningar:", deal.impressions != null ? Number(deal.impressions).toLocaleString("sv-SE") : "—");
  detailRow("Material spec:", product?.material_spec || product?.format || "—");
  detailRow(
    "Sista materialdeadline:",
    materialDeadline
      ? `${fmtDate(materialDeadline, "d MMM yyyy", { locale: sv })} (1 vecka före start)`
      : "1 vecka före kampanjstart",
  );

  y += 8;

  // Produkter / skärmar
  doc.setFont("helvetica", "bold");
  doc.setFontSize(11);
  doc.text("Skärmar / produkter", margin, y);
  y += 4;

  const priceExcl = Number(deal.value || 0);
  const vat = priceExcl * VAT_RATE;
  const priceIncl = priceExcl + vat;

  const productRows: any[] = [];
  if (product) {
    productRows.push([
      product.name,
      [product.dimensions, product.format].filter(Boolean).join(" · ") || "—",
      pkg?.name || (deal.campaign_weeks ? `${deal.campaign_weeks} v` : "—"),
      SEK(priceExcl),
    ]);
  } else {
    productRows.push([deal.title || "—", "—", pkg?.name || "—", SEK(priceExcl)]);
  }

  autoTable(doc, {
    startY: y + 6,
    margin: { left: margin, right: margin },
    head: [["Produkt", "Spec", "Paket", "Pris exkl. moms"]],
    body: productRows,
    styles: { font: "helvetica", fontSize: 10, cellPadding: 6 },
    headStyles: { fillColor: [30, 41, 59], textColor: 255 },
    columnStyles: { 3: { halign: "right" } },
  });

  // Totals
  const finalY = (doc as any).lastAutoTable.finalY + 10;
  const totalsX = pageW - margin - 200;
  const totalsRow = (label: string, value: string, bold = false) => {
    doc.setFont("helvetica", bold ? "bold" : "normal");
    doc.text(label, totalsX, y2);
    doc.text(value, pageW - margin, y2, { align: "right" });
    y2 += 16;
  };
  let y2 = finalY;
  doc.setFontSize(10);
  totalsRow("Summa exkl. moms", SEK(priceExcl));
  totalsRow(`Moms (${Math.round(VAT_RATE * 100)} %)`, SEK(vat));
  doc.setDrawColor(180);
  doc.line(totalsX, y2 - 6, pageW - margin, y2 - 6);
  totalsRow("Att betala inkl. moms", SEK(priceIncl), true);

  // Footer / notes
  y2 += 20;
  doc.setFont("helvetica", "italic");
  doc.setFontSize(9);
  doc.setTextColor(120);
  if (deal.notes) {
    const split = doc.splitTextToSize(`Noteringar: ${deal.notes}`, pageW - margin * 2);
    doc.text(split, margin, y2);
    y2 += split.length * 12 + 6;
  }
  doc.text(
    "Tack för din order! Materialet ska levereras senast 1 vecka innan kampanjstart.",
    margin,
    y2,
  );

  const filename = `Orderbekraftelse_${(customer?.company_name || "kund").replace(/[^a-z0-9]+/gi, "_")}_${deal.id.slice(0, 8)}.pdf`;
  doc.save(filename);
}
