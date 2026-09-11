/**
 * A minimal .xlsx writer for "Ladda ner XLSX": one sheet, a bold header row, text / date /
 * amount / boolean cells with real Excel types (dates as serials with a yyyy-mm-dd format,
 * amounts with #,##0.00), column widths. Zipped with fflate (zero dependencies); the six
 * parts below are the smallest workbook Excel, LibreOffice and Google Sheets all open.
 * Written here instead of pulling a spreadsheet library into Wilmer's lockfile.
 */
import { strToU8, zipSync } from "fflate";

export type XlsxCell = string | number | boolean | Date | null | undefined;
export type XlsxKind = "text" | "date" | "amount" | "boolean";

export interface XlsxColumn<T> {
  header: string;
  kind: XlsxKind;
  width?: number;
  value: (row: T) => XlsxCell;
}

const esc = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/** A1, B1 … Z1, AA1 … */
export function cellRef(col: number, row: number): string {
  let n = col + 1;
  let letters = "";
  while (n > 0) {
    const r = (n - 1) % 26;
    letters = String.fromCharCode(65 + r) + letters;
    n = Math.floor((n - 1) / 26);
  }
  return `${letters}${row}`;
}

/** Excel's date serial: days since 1899-12-30 (the 1900 system). */
export function excelSerial(d: Date): number {
  const utc = Date.UTC(d.getFullYear(), d.getMonth(), d.getDate());
  return Math.round((utc - Date.UTC(1899, 11, 30)) / 86_400_000);
}

const STYLE = { header: 1, date: 2, amount: 3 } as const;

function cellXml<T>(col: XlsxColumn<T>, c: number, r: number, v: XlsxCell): string {
  const ref = cellRef(c, r);
  if (v === null || v === undefined || v === "") return "";
  switch (col.kind) {
    case "date": {
      const d = v instanceof Date ? v : new Date(`${String(v).slice(0, 10)}T00:00:00`);
      if (Number.isNaN(d.getTime())) return "";
      return `<c r="${ref}" s="${STYLE.date}"><v>${excelSerial(d)}</v></c>`;
    }
    case "amount": {
      const n = Number(v);
      return Number.isFinite(n) ? `<c r="${ref}" s="${STYLE.amount}"><v>${n}</v></c>` : "";
    }
    case "boolean":
      return `<c r="${ref}" t="b"><v>${v ? 1 : 0}</v></c>`;
    default:
      return `<c r="${ref}" t="inlineStr"><is><t xml:space="preserve">${esc(String(v))}</t></is></c>`;
  }
}

/** `notes`: plain lines in column A below the rows, after one empty row (what a column means). */
export function buildXlsx<T>(
  rows: T[],
  columns: XlsxColumn<T>[],
  sheetName = "Blad1",
  notes: string[] = [],
): Uint8Array {
  const cols = columns
    .map((c, i) => `<col min="${i + 1}" max="${i + 1}" width="${c.width ?? 14}" customWidth="1"/>`)
    .join("");
  const header = columns
    .map(
      (c, i) =>
        `<c r="${cellRef(i, 1)}" s="${STYLE.header}" t="inlineStr"><is><t>${esc(c.header)}</t></is></c>`,
    )
    .join("");
  const body = rows
    .map((row, ri) => {
      const r = ri + 2;
      return `<row r="${r}">${columns.map((c, ci) => cellXml(c, ci, r, c.value(row))).join("")}</row>`;
    })
    .join("");
  const noteRows = notes
    .map((text, i) => {
      const r = rows.length + 3 + i;
      return `<row r="${r}"><c r="${cellRef(0, r)}" t="inlineStr"><is><t xml:space="preserve">${esc(text)}</t></is></c></row>`;
    })
    .join("");
  const sheet =
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
    `<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">` +
    `<sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews>` +
    `<cols>${cols}</cols><sheetData><row r="1">${header}</row>${body}${noteRows}</sheetData></worksheet>`;

  const contentTypes =
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
    `<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">` +
    `<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>` +
    `<Default Extension="xml" ContentType="application/xml"/>` +
    `<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>` +
    `<Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>` +
    `<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>` +
    `</Types>`;
  const rels =
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
    `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">` +
    `<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>` +
    `</Relationships>`;
  const workbook =
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
    `<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">` +
    `<sheets><sheet name="${esc(sheetName.slice(0, 31))}" sheetId="1" r:id="rId1"/></sheets></workbook>`;
  const workbookRels =
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
    `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">` +
    `<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>` +
    `<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>` +
    `</Relationships>`;
  const styles =
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
    `<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">` +
    `<numFmts count="2"><numFmt numFmtId="164" formatCode="yyyy-mm-dd"/><numFmt numFmtId="165" formatCode="#,##0.00"/></numFmts>` +
    `<fonts count="2"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><name val="Calibri"/></font></fonts>` +
    `<fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill></fills>` +
    `<borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders>` +
    `<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>` +
    `<cellXfs count="4">` +
    `<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>` +
    `<xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1"/>` +
    `<xf numFmtId="164" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>` +
    `<xf numFmtId="165" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>` +
    `</cellXfs>` +
    `<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>` +
    `</styleSheet>`;

  return zipSync(
    {
      "[Content_Types].xml": strToU8(contentTypes),
      "_rels/.rels": strToU8(rels),
      "xl/workbook.xml": strToU8(workbook),
      "xl/_rels/workbook.xml.rels": strToU8(workbookRels),
      "xl/styles.xml": strToU8(styles),
      "xl/worksheets/sheet1.xml": strToU8(sheet),
    },
    { level: 6 },
  );
}

/** Hand the workbook to the browser as a download. */
export function downloadXlsx<T>(
  fileName: string,
  rows: T[],
  columns: XlsxColumn<T>[],
  sheetName?: string,
  notes?: string[],
) {
  const bytes = buildXlsx(rows, columns, sheetName, notes);
  const blob = new Blob([bytes as BlobPart], {
    type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
