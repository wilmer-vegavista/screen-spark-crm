/**
 * fortnox-oauth-callback — where Fortnox sends the browser after the customer's system
 * administrator clicks "Godkänn & aktivera". Registered as the integration's redirect URI
 * in Vega Vista's own developer portal:
 *
 *   https://llpribdacnlejtefnvtm.supabase.co/functions/v1/fortnox-oauth-callback
 *
 * Deployed with --no-verify-jwt, the same reason as fortnox-ledger-feed: the browser
 * arrives with no Supabase headers, so JWT verification would 401 before the handler runs.
 *
 * WHY PLAIN TEXT AND NOT A STYLED PAGE (verified against the live project 2026-09-09):
 * Supabase's gateway refuses to let a function on *.supabase.co serve renderable HTML. A
 * `text/html` response comes back rewritten to `Content-Type: text/plain` with
 * `X-Content-Type-Options: nosniff` and `Content-Security-Policy: default-src 'none';
 * sandbox` bolted on, so the browser shows the markup as source instead of rendering it.
 * The first version of this file was an HTML card and looked exactly that bad. Plain text
 * is what the platform will actually serve, so plain text is what this writes -- with an
 * explicit charset, which the gateway does preserve, or the å/ä/ö arrive as mojibake.
 *
 * What it deliberately does NOT do: exchange the authorization code for a token. For a
 * service-account integration Fortnox records the consent at approval, and the exchange
 * would need the client secret, which belongs to Vega Vista and is not held here. If the
 * code turns out to be required, it is still in the browser's address bar and the consent
 * can be re-run — nothing is lost by not consuming it.
 *
 * Nothing is stored. The code is never logged, never displayed and never leaves the
 * request: a one-line log records only WHETHER a code or an error arrived, so a failed
 * consent can be told apart from one that never reached this point.
 */

const OK = `Klart — kopplingen är godkänd.

Du kan stänga det här fönstret.

Kopplingen syns nu under era integrationsinställningar i Fortnox,
och kan stängas av därifrån när ni vill.
`;

const IDLE = `Inget att göra här.

Den här adressen är slutstationen för Fortnox godkännande-flöde.
Kom du hit av misstag kan du bara stänga fönstret.
`;

const failed = (reason: string) => `Kopplingen blev inte godkänd.

Fortnox svarade: ${reason}

Ingenting har ändrats. Hör av dig till Erik så tar vi det tillsammans.
`;

function handler(req: Request): Response {
  const url = new URL(req.url);
  const hasCode = url.searchParams.has("code");
  const error = url.searchParams.get("error");
  const errorDescription = url.searchParams.get("error_description");

  // Never the value — only whether one arrived. An authorization code is a credential.
  console.log(
    `fortnox-oauth-callback: code=${hasCode ? "present" : "absent"} error=${error ?? "none"}`,
  );

  const body = error ? failed(errorDescription ?? error) : hasCode ? OK : IDLE;

  return new Response(body, {
    status: 200,
    headers: {
      "content-type": "text/plain; charset=utf-8",
      "cache-control": "no-store",
      // The URL carries an authorization code; keep it out of any onward referrer.
      "referrer-policy": "no-referrer",
    },
  });
}

Deno.serve({ port: Number(Deno.env.get("PORT") ?? "8003") }, handler);
