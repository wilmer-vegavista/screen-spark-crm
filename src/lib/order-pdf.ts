import jsPDF from "jspdf";
import autoTable from "jspdf-autotable";
import { format as fmtDate } from "date-fns";
import logoAsset from "@/assets/vega-vista-logo.png.asset.json";

const SEK = (n: number) =>
  new Intl.NumberFormat("sv-SE", { style: "decimal", minimumFractionDigits: 0, maximumFractionDigits: 0 }).format(Math.round(n || 0)) + " SEK";

const VAT_RATE = 0.25;

export type OrderPdfInput = {
  order: any;
  items: any[];
  products: Record<string, any>;
  sellerName?: string | null;
  sellerEmail?: string | null;
  sellerTitle?: string | null;
  /** "download" sparar filen (standard). "blob" returnerar en object-URL för förhandsvisning. */
  mode?: "download" | "blob";
};

let logoDataUrl: string | null = null;
let logoAspect: number | null = null;

async function loadLogo(): Promise<{ dataUrl: string | null; aspect: number | null }> {
  if (logoDataUrl && logoAspect) return { dataUrl: logoDataUrl, aspect: logoAspect };
  try {
    const res = await fetch(logoAsset.url);
    const blob = await res.blob();
    const rawDataUrl = await new Promise<string>((resolve, reject) => {
      const r = new FileReader();
      r.onload = () => resolve(r.result as string);
      r.onerror = reject;
      r.readAsDataURL(blob);
    });
    const img = new Image();
    await new Promise<void>((resolve, reject) => {
      img.onload = () => resolve();
      img.onerror = reject;
      img.src = rawDataUrl;
    });
    // Komponera på vit bakgrund så jsPDF inte renderar transparens som svart
    const canvas = document.createElement("canvas");
    canvas.width = img.naturalWidth;
    canvas.height = img.naturalHeight;
    const ctx = canvas.getContext("2d")!;
    ctx.fillStyle = "#FFFFFF";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(img, 0, 0);
    const dataUrl = canvas.toDataURL("image/jpeg", 0.95);
    logoDataUrl = dataUrl;
    logoAspect = img.naturalWidth / img.naturalHeight;
    return { dataUrl, aspect: logoAspect };
  } catch {
    return { dataUrl: null, aspect: null };
  }
}

function buildPeriodText(order: any, item: any): string {
  const sw: number[] | undefined = Array.isArray(order?.selected_weeks) ? order.selected_weeks : undefined;
  if (sw && sw.length) {
    if (sw.length === 1) return `Vecka ${sw[0]}`;
    if (sw.length === 2) return `Vecka ${sw[0]} & ${sw[1]}`;
    return `Vecka ${sw.join(", ")}`;
  }
  const ed: string[] | undefined = Array.isArray(order?.exact_dates) ? order.exact_dates : undefined;
  if (ed && ed.length) {
    return ed.length === 1 ? ed[0] : `${ed[0]} – ${ed[ed.length - 1]}`;
  }
  const w = Number(item?.weeks || 0);
  return w > 0 ? `${w} ${w === 1 ? "vecka" : "veckor"}` : "—";
}

export async function generateOrderPdf({ order, items, products, sellerName, sellerEmail, sellerTitle, mode = "download" }: OrderPdfInput): Promise<string | void> {
  const doc = new jsPDF({ unit: "pt", format: "a4" });
  const pageW = doc.internal.pageSize.getWidth();
  const pageH = doc.internal.pageSize.getHeight();
  const margin = 56;
  const isOffert = order.order_type === "offert";
  const docTitle = isOffert ? "Offert" : "Orderbekräftelse";

  // ---- Header: logo left, big light title right ----
  const { dataUrl: logo, aspect } = await loadLogo();
  if (logo && aspect) {
    const maxH = 110; // större logga
    const logoH = maxH;
    const logoW = logoH * aspect;
    doc.addImage(logo, "JPEG", margin, 40, logoW, logoH);
  }

  doc.setFont("helvetica", "normal");
  doc.setFontSize(34);
  doc.setTextColor(190);
  doc.text(docTitle, pageW - margin, 90, { align: "right" });

  // Datum (label vänster om värde, med ordentligt avstånd)
  doc.setFontSize(10);
  doc.setTextColor(0);
  const today = fmtDate(new Date(), "yyyy-MM-dd");
  const orderDateRaw = order?.created_at ? new Date(order.created_at) : null;
  const orderDate = orderDateRaw && !isNaN(orderDateRaw.getTime()) ? fmtDate(orderDateRaw, "yyyy-MM-dd") : today;

  const drawDateRow = (label: string, value: string, rowY: number) => {
    doc.setFont("helvetica", "normal");
    const valueW = doc.getTextWidth(value);
    doc.text(value, pageW - margin, rowY, { align: "right" });
    doc.setFont("helvetica", "bold");
    doc.text(label, pageW - margin - valueW - 10, rowY, { align: "right" });
  };
  drawDateRow("Orderdatum:", orderDate, 110);
  drawDateRow("Utskriftsdatum:", today, 126);

  // Company address (right aligned)
  let addrY = 155;
  const addrLines = [
    order.company_name,
    order.billing_address,
    [order.postal_code, order.city].filter(Boolean).join(" "),
  ].filter(Boolean) as string[];
  doc.setFontSize(10);
  doc.setTextColor(0);
  addrLines.forEach((line) => {
    doc.text(line, pageW - margin, addrY, { align: "right" });
    addrY += 14;
  });

  // ---- Contact table ----
  let y = Math.max(addrY + 40, 250);

  autoTable(doc, {
    startY: y,
    margin: { left: margin, right: margin },
    head: [["Kontakt", "E-post", "Telefonnummer"]],
    body: [[order.contact_name || "", order.contact_email || "", order.contact_phone || ""]],
    styles: { font: "helvetica", fontSize: 10, cellPadding: 12, lineColor: [0, 0, 0], lineWidth: 0.5, textColor: 0 },
    headStyles: { fillColor: [255, 255, 255], textColor: 0, fontStyle: "bold", halign: "left" },
    bodyStyles: { fontStyle: "bold", minCellHeight: 46, valign: "middle" },
    theme: "grid",
  });

  y = (doc as any).lastAutoTable.finalY + 40;

  // ---- Product table ----
  const body = items.map((it) => {
    const lineTotalExcl = Number(it.unit_price || 0) * Number(it.weeks || 1);
    const lineTotalIncl = lineTotalExcl * (1 + VAT_RATE);
    return [
      it.product_name || "—",
      buildPeriodText(order, it),
      SEK(Number(it.unit_price || 0)),
      "1",
      "25 %",
      SEK(lineTotalIncl),
    ];
  });

  autoTable(doc, {
    startY: y,
    margin: { left: margin, right: margin },
    head: [["Produkt", "Period", "Enhetspris", "Antal", "Moms", "Belopp"]],
    body,
    styles: { font: "helvetica", fontSize: 10, cellPadding: 10, lineColor: [0, 0, 0], lineWidth: 0.5, textColor: 0 },
    headStyles: { fillColor: [255, 255, 255], textColor: 0, fontStyle: "bold", halign: "left" },
    bodyStyles: { minCellHeight: 50, valign: "middle" },
    columnStyles: {
      1: { fontStyle: "bold" },
      2: { halign: "left" },
      3: { halign: "left" },
      4: { halign: "left" },
      5: { halign: "left" },
    },
    theme: "grid",
  });

  y = (doc as any).lastAutoTable.finalY + 24;

  // ---- Totals (right aligned, no box) ----
  const subtotal = items.reduce((sum, it) => sum + Number(it.unit_price || 0) * Number(it.weeks || 1), 0);
  const vat = subtotal * VAT_RATE;
  const total = subtotal + vat;

  doc.setFontSize(10);
  doc.setTextColor(0);
  const totalsRight = pageW - margin;
  const drawTotal = (label: string, value: string) => {
    doc.setFont("helvetica", "bold");
    const labelW = doc.getTextWidth(label);
    const valueW = doc.getTextWidth(value);
    // value right
    doc.text(value, totalsRight, y, { align: "right" });
    // label just left of value with small gap
    doc.text(label, totalsRight - valueW - 8, y, { align: "right" });
    y += 20;
  };
  drawTotal("Summa ex moms:", SEK(subtotal));
  drawTotal("Summa moms:", SEK(vat));
  drawTotal("Totalt inkl moms:", SEK(total));

  // ---- Notes (left side) ----
  if (order.notes && String(order.notes).trim()) {
    y += 10;
    doc.setFont("helvetica", "bold");
    doc.setFontSize(10);
    doc.text("Order Anteckningar:", margin, y);
    y += 18;
    doc.setFont("helvetica", "normal");
    const lines = doc.splitTextToSize(String(order.notes), pageW - margin * 2);
    lines.forEach((ln: string) => {
      if (y > pageH - margin - 20) { doc.addPage(); y = margin + 20; }
      doc.text(ln, margin, y);
      y += 14;
    });
  }

  // ================ PAGE 2 — material spec + villkor ================
  doc.addPage();
  y = margin + 10;

  doc.setFont("helvetica", "bold");
  doc.setFontSize(11);
  doc.setTextColor(0);

  items.forEach((it) => {
    const p = products[it.product_id] || {};
    const specs: Array<[string, string]> = [];
    if (p.format) specs.push(["Format:", p.format]);
    if (p.dimensions) specs.push(["Mått:", p.dimensions]);
    if (p.ad_duration_seconds) specs.push(["Längd:", `${p.ad_duration_seconds} sekunder`]);
    else specs.push(["Längd:", "5-10 sekunder"]);
    specs.push(["Filformat:", p.file_format || "MP4, JPG, PNG"]);
    if (p.material_spec) specs.push(["Övrigt:", p.material_spec]);

    if (y > pageH - margin - 120) { doc.addPage(); y = margin + 20; }

    doc.setFont("helvetica", "bold");
    doc.setFontSize(10);
    doc.text(`Material spec: ${it.product_name || p.name || "—"}`, margin, y);
    y += 16;
    specs.forEach(([k, v]) => {
      doc.setFont("helvetica", "bold");
      doc.text(`${k} ${v}`, margin, y);
      y += 14;
    });
    y += 10;
  });

  // Fakturavillkor
  y += 10;
  if (y > pageH - margin - 140) { doc.addPage(); y = margin + 20; }
  doc.setFont("helvetica", "normal");
  doc.setFontSize(10);
  doc.text("Fakturavillkor:", margin, y);
  y += 14;
  doc.text("30 dagar netto från erlagd order", margin, y);
  y += 30;

  // Signature
  doc.text("Med vänliga hälsningar,", margin, y);
  y += 22;
  doc.setFont("helvetica", "bold");
  doc.text(sellerName || "", margin, y);
  if (sellerEmail) {
    y += 14;
    doc.setFont("helvetica", "normal");
    doc.text(sellerEmail, margin, y);
  }

  const prefix = isOffert ? "Offert" : "Orderbekraftelse";
  const filename = `${prefix}_${(order.company_name || "kund").replace(/[^a-z0-9]+/gi, "_")}_${(order.id || "").slice(0, 8)}.pdf`;

  if (mode === "blob") {
    const blob = doc.output("blob");
    return URL.createObjectURL(blob);
  }

  doc.save(filename);
}
