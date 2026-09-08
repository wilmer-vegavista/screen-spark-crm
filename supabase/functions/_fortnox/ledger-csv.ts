/**
 * The Google Sheet feed's CSV: Filip's eleven columns, headers verbatim from row 2 of his
 * Kundreskontra tab, in his order. Only Säljare, Projekt, Fakturadatum and Belopp ex moms
 * are read by his Budget pivot (Säljare × Projekt × month(Fakturadatum), SUM of Belopp ex
 * moms); Moms and Totalt are sheet formulas there (=F*0.25, =F+G) and become plain values
 * here; Betald/Såld/Inlagd i rapport are read by nothing, emitted as TRUE/FALSE.
 *
 * Format: UTF-8 with BOM (so Excel opens Swedish letters right), CRLF, RFC 4180 quoting.
 * Default comma + dot decimal — what IMPORTDATA parses in any locale; `sep=;` gives the
 * Swedish-Excel shape (semicolon + comma decimal) for a direct download. Dates are
 * YYYY-MM-DD, which Sheets coerces to real dates (the pivot needs MONTH() on them).
 * Cancelled invoices are left out: for the pivot they never happened. Credit notes stay,
 * with their negative amounts, so "fakturerat" shrinks by what was credited.
 */

export const LEDGER_HEADERS = [
  "Säljare",
  "Projekt",
  "Kundnamn",
  "Fakturadatum",
  "Förfallodatum",
  "Belopp ex moms (SEK)",
  "Moms (SEK)",
  "Totalt belopp (SEK)",
  "Betald",
  "Såld",
  "Inlagd i rapport",
] as const;

/** One feed row, exactly what the snapshot stores. */
export interface LedgerFeedRow {
  saljare: string | null;
  projekt: string | null;
  kundnamn: string | null;
  fakturadatum: string;
  forfallodatum: string | null;
  belopp_ex_moms: number;
  moms: number;
  totalt: number;
  betald: boolean;
  sald: boolean;
  inlagd_i_rapport: boolean;
  /** Not emitted; kept so the snapshot can be checked against the view. */
  document_number: string;
  cancelled: boolean;
}

/** The v_ledger columns the feed needs (numeric comes back as string from PostgREST). */
export interface LedgerViewRow {
  document_number: string;
  saljare: string | null;
  projekt: string | null;
  kundnamn: string | null;
  fakturadatum: string;
  forfallodatum: string | null;
  belopp_ex_moms: number | string;
  moms: number | string;
  totalt: number | string;
  betald: boolean;
  sald: boolean;
  inlagd_i_rapport: boolean;
  cancelled: boolean;
}

const toNumber = (v: number | string): number => {
  const n = typeof v === "number" ? v : Number(v);
  if (!Number.isFinite(n)) throw new Error(`Ledger amount ${JSON.stringify(v)} is not a number.`);
  return n;
};

export function toFeedRow(r: LedgerViewRow): LedgerFeedRow {
  return {
    saljare: r.saljare,
    projekt: r.projekt,
    kundnamn: r.kundnamn,
    fakturadatum: r.fakturadatum.slice(0, 10),
    forfallodatum: r.forfallodatum ? r.forfallodatum.slice(0, 10) : null,
    belopp_ex_moms: toNumber(r.belopp_ex_moms),
    moms: toNumber(r.moms),
    totalt: toNumber(r.totalt),
    betald: r.betald === true,
    sald: r.sald === true,
    inlagd_i_rapport: r.inlagd_i_rapport === true,
    document_number: r.document_number,
    cancelled: r.cancelled === true,
  };
}

export interface CsvOptions {
  /** "," (default, IMPORTDATA) or ";" (Swedish Excel; decimal comma follows). */
  sep?: "," | ";";
}

/** U+FEFF, written as a code so no editor can swallow it. */
export const BOM = String.fromCharCode(0xfeff);

function formatAmount(n: number, decimalComma: boolean): string {
  // Whole kronor stay whole (Filip's sheet is all integers); öre keep two decimals.
  const s = Number.isInteger(n) ? String(n) : n.toFixed(2);
  return decimalComma ? s.replace(".", ",") : s;
}

export function csvField(v: string, sep: string): string {
  return /[",\r\n;]/.test(v) || v.includes(sep) ? `"${v.replace(/"/g, '""')}"` : v;
}

/** The whole CSV text: header, then one line per non-cancelled row, in the given order. */
export function renderLedgerCsv(rows: LedgerFeedRow[], opts: CsvOptions = {}): string {
  const sep = opts.sep ?? ",";
  const decimalComma = sep === ";";
  const lines: string[] = [LEDGER_HEADERS.map((h) => csvField(h, sep)).join(sep)];
  for (const r of rows) {
    if (r.cancelled) continue;
    lines.push(
      [
        csvField(r.saljare ?? "", sep),
        csvField(r.projekt ?? "", sep),
        csvField(r.kundnamn ?? "", sep),
        r.fakturadatum,
        r.forfallodatum ?? "",
        formatAmount(r.belopp_ex_moms, decimalComma),
        formatAmount(r.moms, decimalComma),
        formatAmount(r.totalt, decimalComma),
        r.betald ? "TRUE" : "FALSE",
        r.sald ? "TRUE" : "FALSE",
        r.inlagd_i_rapport ? "TRUE" : "FALSE",
      ].join(sep),
    );
  }
  return BOM + lines.join("\r\n") + "\r\n";
}
