/**
 * The match proposer's rules. Pure functions: CRM row + Fortnox pool in, a proposal with
 * a reason out. The reasons are Swedish because the admin page shows them as they are.
 *
 * Order of rules, strongest first:
 *   marker  — the Fortnox row carries {VV <this CRM id>}: the sync created it earlier.
 *   orgnr   — same organisation number (customers).            exact
 *   code    — same four-digit code, in the name or as the
 *             Fortnox ProjectNumber (screens).                  exact
 *   name    — same name after normalisation.                    high
 *   fuzzy   — bigram similarity of the normalised names.        medium ≥ 0.85, low ≥ 0.60
 *   none    — no candidate: the sync will create it in Fortnox.
 * Only `exact` is linked automatically; everything else waits for an admin.
 * When ANTHROPIC_API_KEY is set, rows that end at fuzzy/none get one Claude call each
 * (fuzzy-claude.ts) that may raise or lower the proposal; the page says which.
 */

export type Confidence = "exact" | "high" | "medium" | "low" | "none";
export type Method = "orgnr" | "name" | "code" | "fuzzy" | "marker" | "manual" | "created" | "none";

export interface Proposal {
  candidateNumber: string | null;
  candidateName: string | null;
  confidence: Confidence;
  method: Method;
  reason: string;
  /** Similarity for fuzzy proposals, 0–1. */
  score?: number;
}

export interface CrmCustomer {
  id: string;
  company_name: string;
  org_number: string | null;
}

export interface CrmScreen {
  id: string;
  name: string;
}

export interface FxCustomer {
  number: string;
  name: string;
  orgNumber: string | null;
  /** CRM id from a {VV …} marker in Comments, when known. */
  markerId?: string | null;
}

export interface FxProject {
  number: string;
  description: string;
  markerId?: string | null;
}

export const AUTO_LINK_CONFIDENCE: Confidence = "exact";

/** Digits only; a 12-digit number with the 16 prefix becomes the 10-digit form. */
export function normalizeOrgNumber(raw: string | null | undefined): string {
  let digits = (raw ?? "").replace(/\D/g, "");
  if (digits.length === 12 && digits.startsWith("16")) digits = digits.slice(2);
  return digits;
}

export function formatOrgNumber(raw: string | null | undefined): string {
  const d = normalizeOrgNumber(raw);
  return d.length === 10 ? `${d.slice(0, 6)}-${d.slice(6)}` : (raw ?? "");
}

const LEGAL_FORMS = new Set([
  "ab",
  "aktiebolag",
  "publ",
  "hb",
  "kb",
  "ek",
  "för",
  "ekonomisk",
  "förening",
  "ideell",
  "stiftelse",
  "filial",
  "sweden",
  "sverige",
]);

/** Lower-case, punctuation to spaces, legal-form words dropped, whitespace collapsed. */
export function normalizeName(raw: string | null | undefined): string {
  return (raw ?? "")
    .toLowerCase()
    .replace(/[.,&/\\()[\]{}\-_'"´`:;!?+*|~<>]/g, " ")
    .split(/\s+/)
    .filter((w) => w && !LEGAL_FORMS.has(w))
    .join(" ")
    .trim();
}

const CODE_RE = /(?<![\d-])(\d{4})(?![\d-])/;

/**
 * The first four-digit group that is not part of a longer number: "1101 - Stenungstorg" → "1101",
 * "stor2104" → "2104", "556677-8899" (an org number) → null.
 */
export function extractCode(text: string | null | undefined): string | null {
  const m = CODE_RE.exec(text ?? "");
  return m ? m[1] : null;
}

/** The name with its four-digit code and separators removed, for comparing labels. */
export function nameWithoutCode(text: string | null | undefined): string {
  return normalizeName((text ?? "").replace(CODE_RE, " "));
}

function bigrams(s: string): Map<string, number> {
  const out = new Map<string, number>();
  const t = s.replace(/\s+/g, " ");
  for (let i = 0; i < t.length - 1; i++) {
    const b = t.slice(i, i + 2);
    out.set(b, (out.get(b) ?? 0) + 1);
  }
  return out;
}

/** Sørensen–Dice similarity of two strings' bigrams, 0–1. */
export function similarity(a: string, b: string): number {
  if (!a || !b) return 0;
  if (a === b) return 1;
  const ba = bigrams(a);
  const bb = bigrams(b);
  let shared = 0;
  let total = 0;
  for (const [g, n] of ba) {
    total += n;
    shared += Math.min(n, bb.get(g) ?? 0);
  }
  for (const n of bb.values()) total += n;
  return total === 0 ? 0 : (2 * shared) / total;
}

const FUZZY_MEDIUM = 0.85;
const FUZZY_LOW = 0.6;
const pct = (x: number) => `${Math.round(x * 100)} %`;

function fuzzyPick<T extends { number: string }>(
  crmName: string,
  pool: T[],
  label: (t: T) => string,
  taken: Set<string>,
): { best: T; score: number } | null {
  let best: T | null = null;
  let bestScore = 0;
  for (const cand of pool) {
    if (taken.has(cand.number)) continue;
    const s = similarity(crmName, label(cand));
    if (s > bestScore) {
      bestScore = s;
      best = cand;
    }
  }
  return best && bestScore >= FUZZY_LOW ? { best, score: bestScore } : null;
}

export const NO_CANDIDATE_REASON = "Ingen kandidat i Fortnox – skapas vid nästa synk";

export function proposeCustomer(
  crm: CrmCustomer,
  pool: FxCustomer[],
  taken: Set<string> = new Set(),
): Proposal {
  const free = pool.filter((c) => !taken.has(c.number));

  const marked = free.find((c) => c.markerId && c.markerId === crm.id.toLowerCase());
  if (marked) {
    return {
      candidateNumber: marked.number,
      candidateName: marked.name,
      confidence: "exact",
      method: "marker",
      reason: `Fortnox-kunden bär markören {VV ${crm.id}} – skapad av synken tidigare`,
    };
  }

  const org = normalizeOrgNumber(crm.org_number);
  if (org.length === 10) {
    const hit = free.find((c) => normalizeOrgNumber(c.orgNumber) === org);
    if (hit) {
      return {
        candidateNumber: hit.number,
        candidateName: hit.name,
        confidence: "exact",
        method: "orgnr",
        reason: `Samma organisationsnummer (${formatOrgNumber(org)})`,
      };
    }
  }

  const name = normalizeName(crm.company_name);
  if (name) {
    const hit = free.find((c) => normalizeName(c.name) === name);
    if (hit) {
      return {
        candidateNumber: hit.number,
        candidateName: hit.name,
        confidence: "high",
        method: "name",
        reason: `Samma namn efter normalisering ("${name}")`,
      };
    }
    const fuzzy = fuzzyPick(name, free, (c) => normalizeName(c.name), taken);
    if (fuzzy) {
      return {
        candidateNumber: fuzzy.best.number,
        candidateName: fuzzy.best.name,
        confidence: fuzzy.score >= FUZZY_MEDIUM ? "medium" : "low",
        method: "fuzzy",
        reason: `Liknande namn (${pct(fuzzy.score)}): "${fuzzy.best.name}"`,
        score: fuzzy.score,
      };
    }
  }

  return {
    candidateNumber: null,
    candidateName: null,
    confidence: "none",
    method: "none",
    reason: NO_CANDIDATE_REASON,
  };
}

export function proposeProject(
  crm: CrmScreen,
  pool: FxProject[],
  taken: Set<string> = new Set(),
): Proposal {
  const free = pool.filter((p) => !taken.has(p.number));

  const marked = free.find((p) => p.markerId && p.markerId === crm.id.toLowerCase());
  if (marked) {
    return {
      candidateNumber: marked.number,
      candidateName: marked.description,
      confidence: "exact",
      method: "marker",
      reason: `Fortnox-projektet bär markören {VV ${crm.id}} – skapat av synken tidigare`,
    };
  }

  const code = extractCode(crm.name);
  if (code) {
    const hit = free.find((p) => p.number === code || extractCode(p.description) === code);
    if (hit) {
      return {
        candidateNumber: hit.number,
        candidateName: hit.description,
        confidence: "exact",
        method: "code",
        reason: `Samma fyrsiffriga kod ${code} (${hit.number === code ? "Fortnox projektnummer" : "i projektnamnet"})`,
      };
    }
  }

  const label = nameWithoutCode(crm.name);
  if (label) {
    const hit = free.find((p) => nameWithoutCode(p.description) === label);
    if (hit) {
      return {
        candidateNumber: hit.number,
        candidateName: hit.description,
        confidence: "high",
        method: "name",
        reason: `Samma namn efter normalisering ("${label}")`,
      };
    }
    const fuzzy = fuzzyPick(label, free, (p) => nameWithoutCode(p.description), taken);
    if (fuzzy) {
      return {
        candidateNumber: fuzzy.best.number,
        candidateName: fuzzy.best.description,
        confidence: fuzzy.score >= FUZZY_MEDIUM ? "medium" : "low",
        method: "fuzzy",
        reason: `Liknande namn (${pct(fuzzy.score)}): "${fuzzy.best.description}"`,
        score: fuzzy.score,
      };
    }
  }

  return {
    candidateNumber: null,
    candidateName: null,
    confidence: "none",
    method: "none",
    reason: NO_CANDIDATE_REASON,
  };
}
