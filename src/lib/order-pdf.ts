import jsPDF from "jspdf";
import autoTable from "jspdf-autotable";
import { format as fmtDate } from "date-fns";
import logoUrl from "@/assets/vega-vista-logo.png";

const SEK = (n: number) =>
  new Intl.NumberFormat("sv-SE", { style: "decimal", minimumFractionDigits: 0, maximumFractionDigits: 2 }).format(n || 0) + " SEK";

const VAT_RATE = 0.25;

export type OrderPdfInput = {
  order: any;
  items: any[];
  products: Record<string, any>;
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

export async function generateOrderPdf({ order, items, products, sellerName, sellerEmail, sellerTitle }: OrderPdfInput) {
  const doc = new jsPDF({ unit: "pt", format: "a4" });
  const pageW = doc.internal.pageSize.getWidth();
  const pageH = doc.internal.pageSize.getHeight();
  const margin = 48;
  const isOffert = order.order_type === "offert";
  const docTitle = isOffert ? "Offert" : "Orderbekräftelse";

  const logo = await loadLogo();
  if (logo) doc.addImage(logo, "PNG", margin, 40, 150, 60);

  doc.setFont("helvetica", "normal");
  doc.setFontSize(28);
  doc.setTextColor(190);
  doc.text(docTitle, pageW - margin, 70, { align: "right" });

  doc.setFontSize(10);
  doc.setTextColor(0);
  doc.setFont("helvetica", "bold");
  doc.text("Datum:", pageW - margin - 90, 95);
  doc.setFont("helvetica", "normal");
  doc.text(fmtDate(new Date(), "yyyy-MM-dd"), pageW - margin, 95, { align: "right" });

  let addrY = 135;
  const addrLines = [
    order.company_name,
    order.billing_address,
    [order.postal_code, order.city].filter(Boolean).join(" "),
    order.org_number ? `Org.nr: ${order.org_number}` : null,
    order.vat_number ? `Moms: ${order.vat_number}` : null,
  ].filter(Boolean) as string[];
  addrLines.forEach((line) => {
    doc.text(line, pageW - margin, addrY, { align: "right" });
    addrY += 14;
  });

  let y = Math.max(addrY + 30, 230);

  autoTable(doc, {
    startY: y,
    margin: { left: margin, right: margin },
    head: [["Kontakt", "E-post", "Telefonnummer"]],
    body: [[order.contact_name || "—", order.contact_email || "—", order.contact_phone || "—"]],
    styles: { font: "helvetica", fontSize: 10, cellPadding: 10, lineColor: [0, 0, 0], lineWidth: 0.5 },
    headStyles: { fillColor: [255, 255, 255], textColor: 0, fontStyle: "bold", halign: "center" },
    bodyStyles: { halign: "left", minCellHeight: 30 },
    theme: "grid",
  });

  y = (doc as any).lastAutoTable.finalY + 30;

  const body = items.map((it) => {
    const total = Number(it.unit_price || 0) * Number(it.weeks || 1);
    return [
      it.product_name || "—",
      it.sov_pct != null ? `${it.sov_pct}%` : "—",
      it.impressions != null ? Number(it.impressions).toLocaleString("sv-SE") : "—",
      `${it.weeks || 1}`,
      SEK(Number(it.unit_price || 0)),
      SEK(total),
    ];
  });

  autoTable(doc, {
    startY: y,
    margin: { left: margin, right: margin },
    head: [["Skärm", "SOV", "Visningar", "Veckor", "Pris/vecka", "Belopp"]],
    body,
    styles: { font: "helvetica", fontSize: 10, cellPadding: 8, lineColor: [0, 0, 0], lineWidth: 0.5, halign: "center" },
    headStyles: { fillColor: [255, 255, 255], textColor: 0, fontStyle: "bold" },
    bodyStyles: { minCellHeight: 30 },
    theme: "grid",
  });

  y = (doc as any).lastAutoTable.finalY + 16;

  const subtotal = items.reduce((sum, it) => sum + Number(it.unit_price || 0) * Number(it.weeks || 1), 0);
  const vat = subtotal * VAT_RATE;
  const total = subtotal + vat;

  doc.setFontSize(10);
  const totalsRight = pageW - margin;
  const drawTotal = (label: string, value: string, bold = false) => {
    doc.setFont("helvetica", "bold");
    doc.text(label, totalsRight - 110, y, { align: "right" });
    doc.setFont("helvetica", bold ? "bold" : "normal");
    doc.text(value, totalsRight, y, { align: "right" });
    y += 18;
  };
  drawTotal("Summa ex moms:", SEK(subtotal));
  drawTotal("Moms 25%:", SEK(vat));
  drawTotal("Totalt inkl moms:", SEK(total), true);

  if (order.notes) {
    y += 20;
    doc.setFont("helvetica", "bold");
    doc.text("Anteckningar:", margin, y);
    y += 14;
    doc.setFont("helvetica", "normal");
    const lines = doc.splitTextToSize(order.notes, pageW - margin * 2);
    doc.text(lines, margin, y);
    y += lines.length * 14;
  }

  // Page 2 — material spec per skärm
  doc.addPage();
  y = margin + 20;
  doc.setFont("helvetica", "bold");
  doc.setFontSize(14);
  doc.text("Materialspecifikation", margin, y);
  y += 24;

  items.forEach((it) => {
    const p = products[it.product_id] || {};
    if (y > pageH - 200) {
      doc.addPage();
      y = margin + 20;
    }
    doc.setFont("helvetica", "bold");
    doc.setFontSize(11);
    doc.text(it.product_name || p.name || "—", margin, y);
    y += 16;
    doc.setFontSize(10);
    const specs: Array<[string, string]> = [];
    if (p.address) specs.push(["Adress:", p.address]);
    if (p.format) specs.push(["Format:", p.format]);
    if (p.dimensions) specs.push(["Mått:", p.dimensions]);
    if (p.file_format) specs.push(["Filformat:", p.file_format]);
    if (p.ad_duration_seconds) specs.push(["Längd:", `${p.ad_duration_seconds} sek`]);
    if (p.material_spec) specs.push(["Övrigt:", p.material_spec]);
    if (specs.length === 0) specs.push(["—", "Ingen materialspec angiven"]);
    specs.forEach(([k, v]) => {
      doc.setFont("helvetica", "bold");
      doc.text(k, margin, y);
      doc.setFont("helvetica", "normal");
      const vLines = doc.splitTextToSize(v, pageW - margin * 2 - 100);
      doc.text(vLines, margin + 100, y);
      y += vLines.length * 14;
    });
    y += 14;
  });

  // Footer signature
  const footY = pageH - margin - 50;
  doc.setFont("helvetica", "normal");
  doc.setFontSize(10);
  doc.text("Med vänliga hälsningar,", margin, footY);
  doc.text(sellerTitle || "Account Manager", margin, footY + 18);
  doc.setFont("helvetica", "bold");
  doc.text(sellerName || "—", margin, footY + 34);
  if (sellerEmail) {
    doc.setFont("helvetica", "normal");
    doc.text(sellerEmail, margin, footY + 48);
  }

  const prefix = isOffert ? "Offert" : "Order";
  const filename = `${prefix}_${(order.company_name || "kund").replace(/[^a-z0-9]+/gi, "_")}_${order.id.slice(0, 8)}.pdf`;
  doc.save(filename);
}
