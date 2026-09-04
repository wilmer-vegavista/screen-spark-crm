// Hjälpfunktioner för att importera kundlistor från Google Sheets (länk, inklistring eller CSV-fil)

export interface ListColumn {
  id: string;
  name: string;
}

export function newColumnId() {
  return Math.random().toString(36).slice(2, 10);
}

/** Parsar CSV (hanterar citattecken, kommatecken och radbrytningar inuti celler) */
export function parseCsv(text: string, delimiter = ","): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let inQuotes = false;
  const src = text.replace(/^\uFEFF/, "");
  for (let i = 0; i < src.length; i++) {
    const ch = src[i];
    if (inQuotes) {
      if (ch === '"') {
        if (src[i + 1] === '"') {
          cell += '"';
          i++;
        } else inQuotes = false;
      } else cell += ch;
    } else if (ch === '"') {
      inQuotes = true;
    } else if (ch === delimiter) {
      row.push(cell);
      cell = "";
    } else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && src[i + 1] === "\n") i++;
      row.push(cell);
      cell = "";
      rows.push(row);
      row = [];
    } else {
      cell += ch;
    }
  }
  if (cell.length > 0 || row.length > 0) {
    row.push(cell);
    rows.push(row);
  }
  // Släng helt tomma rader
  return rows.filter((r) => r.some((c) => c.trim() !== ""));
}

/** Inklistrat innehåll från Google Sheets är tab-separerat */
export function parsePasted(text: string): string[][] {
  return parseCsv(text, "\t");
}

/** Plockar ut spreadsheet-id och gid ur en Google Sheets-länk */
export function parseSheetUrl(url: string): { spreadsheetId: string; gid: string } | null {
  const m = url.match(/docs\.google\.com\/spreadsheets\/d\/([a-zA-Z0-9_-]+)/);
  if (!m) return null;
  const gidMatch = url.match(/[#?&]gid=(\d+)/);
  return { spreadsheetId: m[1], gid: gidMatch?.[1] ?? "0" };
}

/**
 * Hämtar ett Google Sheet som CSV direkt från webbläsaren.
 * Kräver att arket är delat med "Alla som har länken" (läsbehörighet räcker).
 */
export async function fetchSheetCsv(url: string): Promise<string[][]> {
  const ref = parseSheetUrl(url);
  if (!ref)
    throw new Error(
      "Det där ser inte ut som en Google Sheets-länk. Kopiera adressen från webbläsarens adressfält.",
    );
  const endpoints = [
    // gviz-endpointen skickar CORS-headers och funkar för länkdelade ark.
    // headers=0 hindrar Google från att gissa rubrikrader och slå ihop dem till en.
    `https://docs.google.com/spreadsheets/d/${ref.spreadsheetId}/gviz/tq?tqx=out:csv&headers=0&gid=${ref.gid}`,
    `https://docs.google.com/spreadsheets/d/${ref.spreadsheetId}/export?format=csv&gid=${ref.gid}`,
  ];
  let lastError: unknown = null;
  for (const endpoint of endpoints) {
    try {
      const res = await fetch(endpoint);
      if (!res.ok) {
        lastError = new Error(`Google svarade ${res.status}`);
        continue;
      }
      const text = await res.text();
      // Ej delade ark ger en HTML-inloggningssida i stället för CSV
      if (
        text.trimStart().toLowerCase().startsWith("<!doctype") ||
        text.trimStart().startsWith("<html")
      ) {
        lastError = new Error("not shared");
        continue;
      }
      const rows = parseCsv(text);
      if (rows.length === 0) throw new Error("Arket verkar vara tomt.");
      return rows;
    } catch (e) {
      lastError = e;
    }
  }
  throw new Error(
    'Kunde inte hämta arket. Kontrollera att det är delat: öppna arket i Google Sheets → Dela → "Alla som har länken" → Läsare. Du kan också kopiera cellerna och använda fliken Klistra in.',
    { cause: lastError },
  );
}

/**
 * Bygger en CSV av listan och laddar ned den. Semikolon + BOM gör att svensk
 * Excel öppnar filen rätt direkt; Google Sheets läser den också utan problem.
 */
export function exportListToCsv(
  fileName: string,
  columns: ListColumn[],
  rows: Record<string, string>[],
) {
  const delimiter = ";";
  const esc = (v: string) =>
    /["\n\r]/.test(v) || v.includes(delimiter) ? '"' + v.replace(/"/g, '""') + '"' : v;
  const lines = [
    columns.map((c) => esc(c.name)).join(delimiter),
    ...rows.map((r) => columns.map((c) => esc(r[c.id] ?? "")).join(delimiter)),
  ];
  const blob = new Blob(["\uFEFF" + lines.join("\r\n")], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `${fileName.replace(/[\\/:*?"<>|]/g, "-").trim() || "kundlista"}.csv`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

/** Gör om råa rader (första raden = rubriker) till kolumner + radobjekt */
export function rowsToListData(
  raw: string[][],
  firstRowIsHeader: boolean,
): {
  columns: ListColumn[];
  rows: Record<string, string>[];
} {
  if (raw.length === 0) return { columns: [], rows: [] };
  const width = Math.max(...raw.map((r) => r.length));
  const headerCells = firstRowIsHeader ? raw[0] : [];
  const columns: ListColumn[] = Array.from({ length: width }, (_, i) => ({
    id: newColumnId(),
    name: (firstRowIsHeader ? headerCells[i]?.trim() : "") || `Kolumn ${i + 1}`,
  }));
  const dataRows = firstRowIsHeader ? raw.slice(1) : raw;
  const rows = dataRows.map((r) => {
    const obj: Record<string, string> = {};
    columns.forEach((col, i) => {
      obj[col.id] = (r[i] ?? "").trim();
    });
    return obj;
  });
  return { columns, rows };
}
