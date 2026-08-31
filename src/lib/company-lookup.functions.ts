import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";
import { normalizeOrgNumber } from "@/lib/orgnr";

export type CompanyLookupResult =
  | {
      ok: true;
      name: string | null;
      street: string | null;
      postalCode: string | null;
      city: string | null;
    }
  | { ok: false; error: string };

const USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36";

const STREET_KEYS = [
  "streetaddress",
  "addressline",
  "address1",
  "postadress",
  "gatuadress",
  "street",
];
const ZIP_KEYS = ["postalcode", "zipcode", "postcode", "postnummer", "zip"];
const CITY_KEYS = ["addresslocality", "postplace", "postalarea", "postort", "city", "town"];

const ZIP_RE = /^\s*(\d{3})\s?(\d{2})\s*$/;

type Address = { street: string | null; postalCode: string | null; city: string | null };

const cleanZip = (v: string): string | null => {
  const m = ZIP_RE.exec(v);
  return m ? `${m[1]} ${m[2]}` : null;
};

const pickString = (obj: Record<string, unknown>, keys: string[]): string | null => {
  for (const [k, v] of Object.entries(obj)) {
    if (typeof v === "string" && v.trim() && keys.includes(k.toLowerCase())) return v.trim();
  }
  return null;
};

/** Walk any JSON structure and collect objects that look like a postal address. */
function findAddresses(node: unknown, out: Address[], depth = 0): void {
  if (depth > 25 || node == null) return;
  if (Array.isArray(node)) {
    for (const item of node) findAddresses(item, out, depth + 1);
    return;
  }
  if (typeof node !== "object") return;
  const obj = node as Record<string, unknown>;
  const zipRaw = pickString(obj, ZIP_KEYS);
  const zip = zipRaw ? cleanZip(zipRaw) : null;
  if (zip) {
    out.push({
      street: pickString(obj, STREET_KEYS),
      postalCode: zip,
      city: pickString(obj, CITY_KEYS),
    });
  }
  for (const v of Object.values(obj)) findAddresses(v, out, depth + 1);
}

/** Pull every JSON blob we can find out of the page (JSON-LD, __NEXT_DATA__, inline state). */
function extractJsonBlobs(html: string): unknown[] {
  const blobs: unknown[] = [];
  const scriptRe = /<script[^>]*>([\s\S]*?)<\/script>/gi;
  let m: RegExpExecArray | null;
  while ((m = scriptRe.exec(html))) {
    const body = m[1].trim();
    if (!body) continue;
    const candidates = [body];
    // window.__NUXT__= / window.__INITIAL_STATE__= style payloads
    const assign = /=\s*(\{[\s\S]*\})\s*;?\s*$/.exec(body);
    if (assign) candidates.push(assign[1]);
    for (const c of candidates) {
      if (!c.startsWith("{") && !c.startsWith("[")) continue;
      try {
        blobs.push(JSON.parse(c));
        break;
      } catch {
        // not valid JSON – ignore
      }
    }
  }
  // Vue/Nuxt style: address data serialised into HTML attributes (:data="{...}")
  const attrRe = /(?::data|data-props|:company)="(\{[\s\S]*?\})"/gi;
  while ((m = attrRe.exec(html))) {
    try {
      blobs.push(JSON.parse(m[1].replace(/&quot;/g, '"').replace(/&amp;/g, "&")));
    } catch {
      // ignore
    }
  }
  return blobs;
}

function extractCompanyName(html: string, blobs: unknown[]): string | null {
  for (const blob of blobs) {
    if (blob && typeof blob === "object" && !Array.isArray(blob)) {
      const obj = blob as Record<string, unknown>;
      const type = obj["@type"];
      if (
        (type === "Organization" || type === "Corporation" || type === "LocalBusiness") &&
        typeof obj.name === "string" &&
        obj.name.trim()
      ) {
        return obj.name.trim();
      }
    }
  }
  const title = /<title[^>]*>([^<]+)<\/title>/i.exec(html)?.[1];
  if (title) {
    const name = title.split(/[|–-]/)[0].trim();
    if (name && !/allabolag/i.test(name)) return name;
  }
  return null;
}

/** Last resort: look for "Gatan 1, 123 45 Stad" patterns in the visible text. */
function fallbackAddressFromText(html: string): Address | null {
  const text = html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, "\n")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&");
  const re =
    /([A-ZÅÄÖ][A-Za-zÅÄÖåäöé.\- ]{2,50}\d+[A-Za-z]?)[,\s]+(\d{3})\s?(\d{2})\s+([A-ZÅÄÖ][A-Za-zÅÄÖåäöé\- ]{1,40})/;
  const m = re.exec(text);
  if (m) {
    return { street: m[1].trim(), postalCode: `${m[2]} ${m[3]}`, city: m[4].trim() };
  }
  const zipOnly = /(\d{3})\s?(\d{2})\s+([A-ZÅÄÖ][A-Za-zÅÄÖåäöé\- ]{1,40})/.exec(text);
  if (zipOnly) {
    return { street: null, postalCode: `${zipOnly[1]} ${zipOnly[2]}`, city: zipOnly[3].trim() };
  }
  return null;
}

function parseCompanyPage(html: string): { address: Address | null; name: string | null } {
  const blobs = extractJsonBlobs(html);
  const found: Address[] = [];
  for (const blob of blobs) findAddresses(blob, found);
  // Prefer the most complete address (street + zip + city)
  found.sort(
    (a, b) => (b.street ? 1 : 0) + (b.city ? 1 : 0) - ((a.street ? 1 : 0) + (a.city ? 1 : 0)),
  );
  const address = found[0] ?? fallbackAddressFromText(html);
  return { address, name: extractCompanyName(html, blobs) };
}

export const lookupCompanyAddress = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(z.object({ orgNumber: z.string().min(1).max(20) }))
  .handler(async ({ data }): Promise<CompanyLookupResult> => {
    const digits = normalizeOrgNumber(data.orgNumber);
    if (digits.length !== 10) {
      return { ok: false, error: "Ogiltigt organisationsnummer (10 siffror krävs)" };
    }

    const urls = [
      `https://www.allabolag.se/${digits}`,
      `https://www.allabolag.se/company/${digits}`,
    ];

    let lastError = "Företaget hittades inte på allabolag.se";
    for (const url of urls) {
      let html: string;
      try {
        const res = await fetch(url, {
          headers: {
            "User-Agent": USER_AGENT,
            Accept: "text/html,application/xhtml+xml",
            "Accept-Language": "sv-SE,sv;q=0.9",
          },
          redirect: "follow",
          signal: AbortSignal.timeout(10_000),
        });
        if (!res.ok) {
          lastError =
            res.status === 404
              ? "Företaget hittades inte på allabolag.se"
              : `allabolag.se svarade med fel (${res.status})`;
          continue;
        }
        html = await res.text();
      } catch (e) {
        console.error("allabolag.se lookup failed", url, e);
        lastError = "Kunde inte nå allabolag.se";
        continue;
      }

      const { address, name } = parseCompanyPage(html);
      if (address?.postalCode) {
        return {
          ok: true,
          name,
          street: address.street,
          postalCode: address.postalCode,
          city: address.city,
        };
      }
      lastError = "Kunde inte tolka adressen från allabolag.se";
    }

    return { ok: false, error: lastError };
  });
