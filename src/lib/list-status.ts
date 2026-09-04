import type { ListColumn } from "@/lib/sheet-import";

// Statusalternativ med samma färger som säljarnas Google Sheets-ark
export const STATUS_OPTIONS = [
  { label: "Ska kontaktas", className: "bg-yellow-200 text-yellow-950" },
  { label: "Skicka mail", className: "bg-sky-200 text-sky-950" },
  { label: "Påminnelse", className: "bg-orange-200 text-orange-950" },
  { label: "Intresserad", className: "bg-teal-200 text-teal-950" },
  { label: "Inte intresserad", className: "bg-rose-300 text-rose-950" },
  { label: "Inget svar", className: "bg-purple-600 text-white" },
  { label: "Ring senare", className: "bg-blue-600 text-white" },
  { label: "Offert", className: "bg-indigo-200 text-indigo-950" },
  { label: "SÄLJ", className: "bg-emerald-800 text-white" },
];

export const isStatusColumn = (col: ListColumn) => col.name.trim().toLowerCase().includes("status");

// Värden som importerats från arket får rätt färg även om skiftläget skiljer sig
export const statusChipClass = (value: string) =>
  STATUS_OPTIONS.find((o) => o.label.toLowerCase() === value.trim().toLowerCase())?.className ??
  "bg-muted text-foreground";

export const isEmptyRowData = (d: Record<string, string> | null | undefined) =>
  Object.values(d ?? {}).every((v) => !String(v ?? "").trim());

/**
 * Kolumnen som order/offert läggs på: i första hand den som användaren
 * valt själv (role "company"), annars gissning på namnet, annars första kolumnen.
 */
export const findCompanyColumn = (columns: ListColumn[]) =>
  columns.find((c) => c.role === "company") ??
  columns.find((c) => /företag|company|kund|namn/i.test(c.name)) ??
  columns[0];

export const findContactColumn = (columns: ListColumn[]) =>
  columns.find((c) => /kontakt/i.test(c.name));

export const findPhoneColumn = (columns: ListColumn[]) =>
  columns.find((c) => /telefon|phone|tel\b|nummer|mobil/i.test(c.name));

export const findEmailColumn = (columns: ListColumn[]) =>
  columns.find((c) => /e-?post|mail/i.test(c.name));

/** Vilken typ av uppgift en kolumn innehåller, samma ordning som dubblettkollen i databasen */
export const columnKind = (c: ListColumn): "mail" | "telefon" | "företag" | null =>
  /e-?post|mail/i.test(c.name)
    ? "mail"
    : /telefon|phone|tel|nummer|mobil/i.test(c.name)
      ? "telefon"
      : c.role === "company" || /företag|company|kund|namn/i.test(c.name)
        ? "företag"
        : null;
