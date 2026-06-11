import jsPDF from "jspdf";
import autoTable from "jspdf-autotable";
import { format as fmtDate, subDays, parseISO, addWeeks, getISOWeek } from "date-fns";
import logoUrl from "@/assets/vega-vista-logo.png";

const SEK = (n: number) =>
  new Intl.NumberFormat("sv-SE", {
    style: "decimal",
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  }).format(n || 0) + " SEK";

const VAT_RATE = 0.25;

// Brand palette
const BRAND = [108, 78, 232] as const;        // primary violet
const BRAND_DARK = [26, 26, 46] as const;     // header band
const INK = [33, 33, 45] as const;            // body text
const MUTED = [120, 120, 135] as const;       // labels
const LINE = [228, 228, 235] as const;        // dividers
const SOFT_BG = [247, 247, 251] as const;     // table stripe

export type OrderPdfInput = {
  deal: any;
  customer: any | null;
  product: any | null;
  pkg: any | null;
  sellerName?: string | null;
  sellerEmail?: string | null;
  sellerTitle?: string | null;
};

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
  const { deal, customer, product, pkg, sellerName, sellerEmail, sellerTitle } = input;
  const doc = new jsPDF({ unit: "pt", format: "a4" });
  const pageW = doc.internal.pageSize.getWidth();
  const pageH = doc.internal.pageSize.getHeight();
  const margin = 48;

  const orderRef = (deal.id || "").slice(0, 8).toUpperCase();
  const today = fmtDate(new Date(), "yyyy-MM-dd");

  // ---------------- HEADER BAND ----------------
  doc.setFillColor(...BRAND_DARK);
  doc.rect(0, 0, pageW, 130, "F");
  // accent stripe
  doc.setFillColor(...BRAND);
  doc.rect(0, 130, pageW, 4, "F");

  const logo = await loadLogo();
  if (logo) {
    doc.addImage(logo, "PNG", margin, 36, 130, 52);
  }

  doc.setFont("helvetica", "bold");
  doc.setFontSize(22);
  doc.setTextColor(255, 255, 255);
  doc.text("ORDERBEKRÄFTELSE", pageW - margin, 64, { align: "right" });

  doc.setFont("helvetica", "normal");
  doc.setFontSize(9);
  doc.setTextColor(200, 200, 220);
  doc.text(`Order #${orderRef}`, pageW - margin, 84, { align: "right" });
  doc.text(`Datum  ${today}`, pageW - margin, 98, { align: "right" });

  // ---------------- FRÅN / TILL ----------------
  let y = 168;
  const colW = (pageW - margin * 2 - 20) / 2;

  const drawInfoCard = (x: number, title: string, lines: string[]) => {
    doc.setDrawColor(...LINE);
    doc.setFillColor(...SOFT_BG);
    doc.roundedRect(x, y, colW, 110, 6, 6, "FD");

    doc.setFont("helvetica", "bold");
    doc.setFontSize(8);
    doc.setTextColor(...BRAND);
    doc.text(title, x + 14, y + 20);

    doc.setFont("helvetica", "normal");
    doc.setFontSize(10);
    doc.setTextColor(...INK);
    let ly = y + 38;
    lines.forEach((line, i) => {
      if (!line) return;
      if (i === 0) doc.setFont("helvetica", "bold");
      else doc.setFont("helvetica", "normal");
      doc.text(line, x + 14, ly);
      ly += 14;
    });
  };

  drawInfoCard(margin, "FRÅN", [
    "Vega Vista",
    sellerName || "—",
    sellerEmail || "",
  ]);

  drawInfoCard(margin + colW + 20, "FAKTURERAS TILL", [
    customer?.company_name || "—",
    customer?.contact_name || "",
    customer?.billing_address || "",
    [customer?.postal_code, customer?.city].filter(Boolean).join(" "),
    customer?.email || "",
  ]);

  y += 130;

  // ---------------- PERIOD CALC ----------------
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
    periodText = wStart === wEnd ? `Vecka ${wStart}` : `Vecka ${wStart}–${wEnd}`;
  } else if (deal.campaign_weeks) {
    periodText = `${deal.campaign_weeks} veckor`;
  } else {
    periodText = "—";
  }

  // ---------------- PRODUCT TABLE ----------------
  const priceExcl = Number(deal.value || 0);
  const vat = priceExcl * VAT_RATE;
  const priceIncl = priceExcl + vat;

  autoTable(doc, {
    startY: y,
    margin: { left: margin, right: margin },
    head: [["Produkt", "Period", "Antal", "À-pris", "Belopp"]],
    body: [[
      pkg?.name || product?.name || deal.title || "—",
      periodText,
      "1",
      SEK(priceExcl),
      SEK(priceExcl),
    ]],
    styles: {
      font: "helvetica",
      fontSize: 10,
      cellPadding: 12,
      textColor: [...INK] as any,
      lineColor: [...LINE] as any,
      lineWidth: 0.5,
    },
    headStyles: {
      fillColor: [...BRAND_DARK] as any,
      textColor: 255,
      fontStyle: "bold",
      fontSize: 9,
      halign: "left",
    },
    bodyStyles: { minCellHeight: 40, valign: "middle" },
    columnStyles: {
      0: { fontStyle: "bold" },
      1: { halign: "center" },
      2: { halign: "center" },
      3: { halign: "right" },
      4: { halign: "right", fontStyle: "bold" },
    },
    theme: "grid",
  });

  y = (doc as any).lastAutoTable.finalY + 18;

  // ---------------- TOTALS CARD ----------------
  const totalsW = 240;
  const totalsX = pageW - margin - totalsW;
  const totalsH = 92;

  doc.setDrawColor(...LINE);
  doc.setFillColor(255, 255, 255);
  doc.roundedRect(totalsX, y, totalsW, totalsH, 6, 6, "FD");

  doc.setFontSize(10);
  const rowY = (i: number) => y + 22 + i * 18;

  doc.setTextColor(...MUTED);
  doc.setFont("helvetica", "normal");
  doc.text("Summa ex moms", totalsX + 16, rowY(0));
  doc.text("Moms (25%)", totalsX + 16, rowY(1));

  doc.setTextColor(...INK);
  doc.text(SEK(priceExcl), totalsX + totalsW - 16, rowY(0), { align: "right" });
  doc.text(SEK(vat), totalsX + totalsW - 16, rowY(1), { align: "right" });

  // divider
  doc.setDrawColor(...LINE);
  doc.line(totalsX + 16, rowY(2) - 6, totalsX + totalsW - 16, rowY(2) - 6);

  // total
  doc.setFont("helvetica", "bold");
  doc.setFontSize(11);
  doc.setTextColor(...BRAND);
  doc.text("Totalt inkl moms", totalsX + 16, rowY(2) + 8);
  doc.text(SEK(priceIncl), totalsX + totalsW - 16, rowY(2) + 8, { align: "right" });

  y += totalsH + 28;

  // ---------------- KAMPANJDETALJER ----------------
  doc.setFont("helvetica", "bold");
  doc.setFontSize(8);
  doc.setTextColor(...BRAND);
  doc.text("KAMPANJDETALJER", margin, y);
  y += 14;

  doc.setDrawColor(...LINE);
  doc.line(margin, y, pageW - margin, y);
  y += 16;

  doc.setFontSize(10);
  doc.setTextColor(...INK);

  const detailRow = (label: string, value: string) => {
    doc.setFont("helvetica", "normal");
    doc.setTextColor(...MUTED);
    doc.text(label, margin, y);
    doc.setFont("helvetica", "bold");
    doc.setTextColor(...INK);
    doc.text(value, margin + 140, y);
    y += 16;
  };

  detailRow("Period", periodText);
  if (campaignStart && campaignEnd) {
    detailRow("Datum", `${fmtDate(campaignStart, "yyyy-MM-dd")} → ${fmtDate(campaignEnd, "yyyy-MM-dd")}`);
  }
  if (deal.sov_pct != null) detailRow("SOV", `${deal.sov_pct}%`);
  if (deal.impressions != null) detailRow("Antal visningar", Number(deal.impressions).toLocaleString("sv-SE"));

  y += 8;
  doc.setFont("helvetica", "bold");
  doc.setTextColor(...MUTED);
  doc.setFontSize(9);
  doc.text("SKÄRMAR", margin, y);
  y += 14;

  doc.setFont("helvetica", "normal");
  doc.setFontSize(10);
  doc.setTextColor(...INK);
  const screens: string[] = [];
  if (product?.name) screens.push(product.name + (product?.address ? `  ·  ${product.address}` : ""));
  if (screens.length === 0) screens.push("—");
  screens.forEach((s) => {
    doc.text("•  " + s, margin + 6, y);
    y += 14;
  });

  // ---------------- FOOTER (page 1) ----------------
  drawFooter(doc, pageW, pageH, margin, 1, 2);

  // ================ PAGE 2 ================
  doc.addPage();

  // header band slim
  doc.setFillColor(...BRAND_DARK);
  doc.rect(0, 0, pageW, 60, "F");
  doc.setFillColor(...BRAND);
  doc.rect(0, 60, pageW, 3, "F");

  doc.setFont("helvetica", "bold");
  doc.setFontSize(14);
  doc.setTextColor(255, 255, 255);
  doc.text("MATERIAL & VILLKOR", margin, 38);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(9);
  doc.setTextColor(200, 200, 220);
  doc.text(`Order #${orderRef}`, pageW - margin, 38, { align: "right" });

  y = 100;

  // Material spec heading
  doc.setFont("helvetica", "bold");
  doc.setFontSize(8);
  doc.setTextColor(...BRAND);
  doc.text(`MATERIALSPECIFIKATION  ·  ${(product?.name || "—").toUpperCase()}`, margin, y);
  y += 14;
  doc.setDrawColor(...LINE);
  doc.line(margin, y, pageW - margin, y);
  y += 18;

  const specLines: Array<[string, string]> = [];
  if (product?.format) specLines.push(["Format", product.format]);
  if (product?.dimensions) specLines.push(["Mått", product.dimensions]);
  specLines.push(["Längd", "5–10 sekunder"]);
  specLines.push(["Filformat", "MP4, JPG, PNG"]);
  if (product?.material_spec) specLines.push(["Övrigt", product.material_spec]);

  doc.setFontSize(10);
  specLines.forEach(([k, v]) => {
    doc.setFont("helvetica", "normal");
    doc.setTextColor(...MUTED);
    doc.text(k, margin, y);
    doc.setFont("helvetica", "bold");
    doc.setTextColor(...INK);
    doc.text(v, margin + 110, y);
    y += 16;
  });

  // Deadline highlight box
  y += 12;
  const materialDeadline = campaignStart ? subDays(campaignStart, 7) : null;
  doc.setFillColor(245, 242, 255);
  doc.setDrawColor(...BRAND);
  doc.setLineWidth(0.8);
  doc.roundedRect(margin, y, pageW - margin * 2, 50, 6, 6, "FD");
  doc.setFont("helvetica", "bold");
  doc.setFontSize(9);
  doc.setTextColor(...BRAND);
  doc.text("SISTA MATERIALDEADLINE", margin + 16, y + 20);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(13);
  doc.setTextColor(...INK);
  doc.text(
    materialDeadline
      ? `${fmtDate(materialDeadline, "yyyy-MM-dd")}`
      : "1 vecka före kampanjstart",
    margin + 16,
    y + 38,
  );
  doc.setFont("helvetica", "normal");
  doc.setFontSize(9);
  doc.setTextColor(...MUTED);
  doc.text("(1 vecka före kampanjstart)", pageW - margin - 16, y + 38, { align: "right" });
  doc.setLineWidth(0.5);

  y += 80;

  // Fakturavillkor
  doc.setFont("helvetica", "bold");
  doc.setFontSize(8);
  doc.setTextColor(...BRAND);
  doc.text("FAKTURAVILLKOR", margin, y);
  y += 14;
  doc.setDrawColor(...LINE);
  doc.line(margin, y, pageW - margin, y);
  y += 18;

  doc.setFont("helvetica", "normal");
  doc.setFontSize(10);
  doc.setTextColor(...INK);
  doc.text("30 dagar netto från orderdatum.", margin, y);
  y += 14;
  doc.text("Vid frågor om denna order, kontakta din säljare nedan.", margin, y);

  // Signature block
  const sigY = pageH - margin - 130;
  doc.setDrawColor(...LINE);
  doc.line(margin, sigY, pageW - margin, sigY);

  doc.setFont("helvetica", "normal");
  doc.setFontSize(10);
  doc.setTextColor(...MUTED);
  doc.text("Med vänliga hälsningar,", margin, sigY + 22);

  doc.setFont("helvetica", "bold");
  doc.setFontSize(13);
  doc.setTextColor(...INK);
  doc.text(sellerName || "—", margin, sigY + 44);

  doc.setFont("helvetica", "normal");
  doc.setFontSize(10);
  doc.setTextColor(...MUTED);
  doc.text(sellerTitle || "Account Manager", margin, sigY + 60);
  if (sellerEmail) {
    doc.setTextColor(...BRAND);
    doc.text(sellerEmail, margin, sigY + 74);
  }

  drawFooter(doc, pageW, pageH, margin, 2, 2);

  const filename = `Orderbekraftelse_${(customer?.company_name || "kund").replace(/[^a-z0-9]+/gi, "_")}_${orderRef}.pdf`;
  doc.save(filename);
}

function drawFooter(
  doc: jsPDF,
  pageW: number,
  pageH: number,
  margin: number,
  page: number,
  total: number,
) {
  const fy = pageH - 36;
  doc.setDrawColor(...LINE);
  doc.line(margin, fy, pageW - margin, fy);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(8);
  doc.setTextColor(...MUTED);
  doc.text("Vega Vista  ·  Digital Out-of-Home", margin, fy + 14);
  doc.text(`Sida ${page} av ${total}`, pageW - margin, fy + 14, { align: "right" });
}
