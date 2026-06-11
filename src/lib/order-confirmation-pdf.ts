import jsPDF from "jspdf";
import autoTable from "jspdf-autotable";
import { format as fmtDate, subDays, parseISO, addWeeks, getISOWeek } from "date-fns";
import { sv } from "date-fns/locale";
import logoUrl from "@/assets/vega-vista-logo.png";

const SEK = (n: number) =>
  new Intl.NumberFormat("sv-SE", {
    style: "decimal",
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  }).format(n || 0) + " SEK";

const VAT_RATE = 0.25;

export type OrderPdfInput = {
  deal: any;
  customer: any | null;
  product: any | null;
  pkg: any | null;
  sellerName?: string | null;
  sellerEmail?: string | null;
};

// Cache logo as data URL
let logoDataUrl: string | null = null;
async function loadLogo(): Promise<string | null> {
  if (logoDataUrl) return logoDataUrl;
  try {
    const res = await fetch(logoUrl);
    const blob = await res.blob();
    logoDataUrl = await new Promise<string>((resolve, reject) => {
      const r = new FileReader();
      r.onload = () => resolve(r.result as string);
      r.onerror = reject;
      r.readAsDataURL(blob);
    });
    return logoDataUrl;
  } catch {
    return null;
  }
}

export async function generateOrderConfirmationPdf(input: OrderPdfInput) {
  const { deal, customer, product, pkg, sellerName, sellerEmail } = input;
  const doc = new jsPDF({ unit: "pt", format: "a4" });
  const pageW = doc.internal.pageSize.getWidth();
  const pageH = doc.internal.pageSize.getHeight();
  const margin = 48;

  // ---------- Header ----------
  const logo = await loadLogo();
  if (logo) {
    doc.addImage(logo, "PNG", margin, 40, 150, 60);
  }

  // "Orderbekräftelse" light gray top-right
  doc.setFont("helvetica", "normal");
  doc.setFontSize(28);
  doc.setTextColor(190);
  doc.text("Orderbekräftelse", pageW - margin, 70, { align: "right" });

  // Date
  doc.setFontSize(10);
  doc.setTextColor(0);
  doc.setFont("helvetica", "bold");
  doc.text("Datum:", pageW - margin - 90, 95);
  doc.setFont("helvetica", "normal");
  doc.text(fmtDate(new Date(), "yyyy-MM-dd"), pageW - margin, 95, { align: "right" });

  // Customer address (top right)
  let addrY = 135;
  doc.setFontSize(10);
  const addrLines = [
    customer?.company_name,
    customer?.billing_address,
    [customer?.postal_code, customer?.city].filter(Boolean).join(" "),
  ].filter(Boolean) as string[];
  addrLines.forEach((line) => {
    doc.text(line, pageW - margin, addrY, { align: "right" });
    addrY += 14;
  });

  // ---------- Contact table ----------
  let y = Math.max(addrY + 30, 220);

  autoTable(doc, {
    startY: y,
    margin: { left: margin, right: margin },
    head: [["Kontakt", "E-post", "Telefonnummer"]],
    body: [[
      customer?.contact_name || "—",
      customer?.email || "—",
      customer?.phone || "—",
    ]],
    styles: { font: "helvetica", fontSize: 10, cellPadding: 10, lineColor: [0, 0, 0], lineWidth: 0.5 },
    headStyles: { fillColor: [255, 255, 255], textColor: 0, fontStyle: "bold", halign: "center" },
    bodyStyles: { halign: "left", minCellHeight: 35 },
    theme: "grid",
  });

  y = (doc as any).lastAutoTable.finalY + 40;

  // ---------- Period calc ----------
  let campaignStart: Date | null = deal.campaign_start ? parseISO(deal.campaign_start) : null;
  let campaignEnd: Date | null = deal.campaign_end ? parseISO(deal.campaign_end) : null;
  if (campaignStart && !campaignEnd && deal.campaign_weeks) {
    campaignEnd = addWeeks(campaignStart, deal.campaign_weeks);
  }
  if (!campaignStart && deal.campaign_weeks && campaignEnd) {
    campaignStart = addWeeks(campaignEnd, -deal.campaign_weeks);
  }

  let periodText: string;
  if (campaignStart && campaignEnd) {
    const wStart = getISOWeek(campaignStart);
    const wEnd = getISOWeek(campaignEnd);
    periodText = wStart === wEnd ? `Vecka: ${wStart}` : `Veckor: ${wStart} & ${wEnd}`;
  } else if (deal.campaign_weeks) {
    periodText = `${deal.campaign_weeks} veckor`;
  } else {
    periodText = "—";
  }

  // ---------- Product table ----------
  const priceExcl = Number(deal.value || 0);
  const vat = priceExcl * VAT_RATE;
  const priceIncl = priceExcl + vat;

  autoTable(doc, {
    startY: y,
    margin: { left: margin, right: margin },
    head: [["Produkt", "Period", "Enhetspris", "Antal", "Moms", "Belopp"]],
    body: [[
      pkg?.name || product?.name || deal.title || "—",
      periodText,
      SEK(priceExcl),
      "1",
      "25 %",
      SEK(priceIncl),
    ]],
    styles: { font: "helvetica", fontSize: 10, cellPadding: 10, lineColor: [0, 0, 0], lineWidth: 0.5, halign: "center" },
    headStyles: { fillColor: [255, 255, 255], textColor: 0, fontStyle: "bold" },
    bodyStyles: { minCellHeight: 45 },
    columnStyles: { 1: { fontStyle: "bold" } },
    theme: "grid",
  });

  y = (doc as any).lastAutoTable.finalY + 16;

  // ---------- Totals (right aligned) ----------
  doc.setFontSize(10);
  const totalsRight = pageW - margin;
  const drawTotal = (label: string, value: string, bold = false) => {
    doc.setFont("helvetica", "bold");
    doc.text(label, totalsRight - 110, y, { align: "right" });
    doc.setFont("helvetica", bold ? "bold" : "normal");
    doc.text(value, totalsRight, y, { align: "right" });
    y += 18;
  };
  drawTotal("Summa ex moms:", SEK(priceExcl));
  drawTotal("Summa moms:", SEK(vat));
  drawTotal("Totalt inkl moms:", SEK(priceIncl), true);

  y += 20;

  // ---------- Order anteckningar ----------
  doc.setFont("helvetica", "bold");
  doc.setFontSize(11);
  doc.text("Order Anteckningar:", margin, y);
  y += 20;

  doc.setFontSize(10);
  if (deal.sov_pct != null) {
    doc.setFont("helvetica", "bold");
    doc.text(`SOV: ${deal.sov_pct}%`, margin, y);
    y += 15;
  }
  if (deal.impressions != null) {
    doc.setFont("helvetica", "bold");
    doc.text(`Antal visningar: ${Number(deal.impressions).toLocaleString("sv-SE")}`, margin, y);
    y += 15;
  }
  doc.setFont("helvetica", "bold");
  doc.text(periodText, margin, y);
  y += 18;

  doc.setFont("helvetica", "bold");
  doc.text("Skärmar", margin, y);
  y += 15;
  doc.setFont("helvetica", "normal");
  const screens: string[] = [];
  if (product?.name) screens.push(product.name);
  if (product?.address) screens.push(product.address);
  if (screens.length === 0) screens.push("—");
  screens.forEach((s) => {
    doc.text(s, margin, y);
    y += 14;
  });

  // ---------- Page 2: Material spec ----------
  doc.addPage();
  y = margin + 20;

  doc.setFont("helvetica", "bold");
  doc.setFontSize(12);
  doc.text(`Material spec: ${product?.name || "—"}`, margin, y);
  y += 20;

  doc.setFontSize(10);
  const specLines: Array<[string, string]> = [];
  if (product?.format) specLines.push(["Format:", product.format]);
  if (product?.dimensions) specLines.push(["Mått:", product.dimensions]);
  specLines.push(["Längd:", "5–10 sekunder"]);
  specLines.push(["Filformat:", "MP4, JPG, PNG"]);
  if (product?.material_spec) specLines.push(["Övrigt:", product.material_spec]);

  specLines.forEach(([k, v]) => {
    doc.setFont("helvetica", "bold");
    doc.text(k, margin, y);
    doc.setFont("helvetica", "normal");
    doc.text(v, margin + 90, y);
    y += 16;
  });

  // Material deadline
  y += 14;
  const materialDeadline = campaignStart ? subDays(campaignStart, 7) : null;
  doc.setFont("helvetica", "bold");
  doc.text("Sista materialdeadline:", margin, y);
  doc.setFont("helvetica", "normal");
  doc.text(
    materialDeadline
      ? `${fmtDate(materialDeadline, "yyyy-MM-dd")} (1 vecka före kampanjstart)`
      : "1 vecka före kampanjstart",
    margin + 160,
    y,
  );
  y += 30;

  // Faktura
  doc.setFont("helvetica", "bold");
  doc.setFontSize(11);
  doc.text("Fakturavillkor:", margin, y);
  y += 16;
  doc.setFont("helvetica", "normal");
  doc.setFontSize(10);
  doc.text("30 dagar netto från erlagd order", margin, y);

  // Signature bottom
  const footY = pageH - margin - 50;
  doc.setFont("helvetica", "normal");
  doc.setFontSize(10);
  doc.text("Med vänliga hälsningar,", margin, footY);
  doc.setFont("helvetica", "bold");
  doc.text(sellerName || "—", margin, footY + 18);
  if (sellerEmail) {
    doc.setFont("helvetica", "normal");
    doc.text(sellerEmail, margin, footY + 32);
  }

  const filename = `Orderbekraftelse_${(customer?.company_name || "kund").replace(/[^a-z0-9]+/gi, "_")}_${deal.id.slice(0, 8)}.pdf`;
  doc.save(filename);
}
