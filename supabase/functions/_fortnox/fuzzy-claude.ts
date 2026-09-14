/**
 * One Claude call per unresolved row. Used only when ANTHROPIC_API_KEY is set; the
 * rules in matcher.ts decide everything otherwise, and the page says which was used.
 *
 * The call sees the CRM name (and org number / code, when there is one) and the
 * handful of most similar Fortnox rows, and answers with one candidate or none plus a
 * one-line Swedish reason. Its verdict can only land at medium, low or none: an exact
 * link is never granted by a language model, only by an org number, a code or an admin.
 *
 * Model: the Claude API's Messages endpoint; the id is overridable with ANTHROPIC_MODEL.
 */
import type { Confidence } from "./matcher.ts";
import { redact } from "./redact.ts";

export const DEFAULT_MODEL = "claude-sonnet-5";
const ANTHROPIC_URL = "https://api.anthropic.com/v1/messages";

export interface FuzzyCandidate {
  number: string;
  name: string;
  extra?: string;
}

export interface FuzzyInput {
  kind: "customer" | "screen";
  crmName: string;
  crmExtra?: string;
  candidates: FuzzyCandidate[];
}

export interface FuzzyVerdict {
  candidateNumber: string | null;
  confidence: Extract<Confidence, "medium" | "low" | "none">;
  reason: string;
}

export interface FuzzyOptions {
  apiKey: string;
  model?: string;
  fetchFn?: typeof fetch;
}

const SYSTEM = [
  "Du hjälper till att koppla poster i ett svenskt CRM till poster i Fortnox.",
  "Du får ett CRM-namn och några kandidater från Fortnox. Avgör om någon kandidat är SAMMA företag",
  "respektive SAMMA reklamskärm/plats, trots olika stavning, förkortningar eller bolagsform.",
  'Svara med enbart JSON: {"number": "<kandidatens nummer>" eller null, "confidence": "medium"|"low"|"none", "reason": "<en kort mening på svenska>"}.',
  '"medium" = du är ganska säker, "low" = möjligt men osäkert, "none" = ingen kandidat är samma.',
].join(" ");

function userPrompt(input: FuzzyInput): string {
  const what = input.kind === "customer" ? "Kund" : "Skärm";
  const lines = [
    `${what} i CRM: "${input.crmName}"${input.crmExtra ? ` (${input.crmExtra})` : ""}`,
    "Kandidater i Fortnox:",
    ...input.candidates.map(
      (c) => `- nummer ${c.number}: "${c.name}"${c.extra ? ` (${c.extra})` : ""}`,
    ),
  ];
  return lines.join("\n");
}

interface MessagesResponse {
  content?: Array<{ type: string; text?: string }>;
}

export async function claudeFuzzy(input: FuzzyInput, opts: FuzzyOptions): Promise<FuzzyVerdict> {
  if (input.candidates.length === 0) {
    return { candidateNumber: null, confidence: "none", reason: "Inga kandidater att bedöma" };
  }
  const fetchFn = opts.fetchFn ?? fetch;
  const res = await fetchFn(ANTHROPIC_URL, {
    method: "POST",
    headers: {
      "x-api-key": opts.apiKey,
      "anthropic-version": "2023-06-01",
      "content-type": "application/json",
    },
    body: JSON.stringify({
      model: opts.model ?? DEFAULT_MODEL,
      max_tokens: 200,
      temperature: 0,
      system: SYSTEM,
      messages: [{ role: "user", content: userPrompt(input) }],
    }),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`Claude ${res.status}: ${redact(text).slice(0, 300)}`);
  const body = JSON.parse(text) as MessagesResponse;
  const answer = body.content?.find((c) => c.type === "text")?.text ?? "";
  return parseVerdict(answer, input.candidates);
}

/** Tolerant of a code fence or prose around the JSON; anything unparseable is "none". */
export function parseVerdict(answer: string, candidates: FuzzyCandidate[]): FuzzyVerdict {
  const m = /\{[\s\S]*\}/.exec(answer);
  if (!m)
    return { candidateNumber: null, confidence: "none", reason: "Claude gav inget tolkbart svar" };
  try {
    const j = JSON.parse(m[0]) as {
      number?: string | number | null;
      confidence?: string;
      reason?: string;
    };
    const number = j.number === null || j.number === undefined ? null : String(j.number);
    const known = number !== null && candidates.some((c) => c.number === number);
    const confidence =
      known && (j.confidence === "medium" || j.confidence === "low") ? j.confidence : "none";
    const reason =
      (j.reason ?? "").toString().slice(0, 200) ||
      (known ? "Claude bedömde kandidaten som samma" : "Claude fann ingen kandidat");
    return {
      candidateNumber: confidence === "none" ? null : number,
      confidence,
      reason: `Claude: ${reason}`,
    };
  } catch {
    return { candidateNumber: null, confidence: "none", reason: "Claude gav inget tolkbart svar" };
  }
}
