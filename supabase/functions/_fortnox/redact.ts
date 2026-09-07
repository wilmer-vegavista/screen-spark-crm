/**
 * The one redactor for every Fortnox error path. Ported from the fortnox-agent.
 *
 * A Fortnox error body can echo the request — including the Basic auth header or the
 * client secret as a form field. Nothing that came back from Fortnox reaches a log, a
 * sync_runs row or a thrown error without passing through here.
 */
const PATTERNS: Array<[RegExp, string]> = [
  // Authorization headers echoed back in an error body.
  [/(Basic|Bearer)\s+[A-Za-z0-9._~+/=-]+/gi, "$1 [REDACTED]"],
  // JSON or query-string credential fields.
  [
    /("?(?:client_secret|clientSecret|client_id|clientId|access_token|accessToken|refresh_token|refreshToken|api_key|apiKey|authorization)"?\s*[:=]\s*"?)(?!Bearer\b|Basic\b|\[REDACTED\])[^",\s&}]+/gi,
    "$1[REDACTED]",
  ],
  // Anthropic-style keys, in case the fuzzy matcher's error text ever carries one.
  [/\bsk-ant-[A-Za-z0-9._-]{16,}/g, "sk-ant-[REDACTED]"],
];

export function redact(s: string): string {
  let out = s;
  for (const [pattern, replacement] of PATTERNS) out = out.replace(pattern, replacement);
  return out;
}
