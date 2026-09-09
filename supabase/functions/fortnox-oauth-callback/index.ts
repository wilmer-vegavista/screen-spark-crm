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

const PAGE = (title: string, body: string, tone: "ok" | "bad") => `<!doctype html>
<html lang="sv">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${title}</title>
<style>
  :root { color-scheme: light dark; }
  body {
    margin: 0; min-height: 100vh; display: grid; place-items: center;
    font: 16px/1.6 system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
    background: #f6f7f9; color: #16181d;
  }
  .card {
    max-width: 32rem; margin: 1.5rem; padding: 2rem 2.25rem;
    background: #fff; border-radius: 12px; border: 1px solid #e3e6ea;
    box-shadow: 0 1px 3px rgba(0,0,0,.06);
  }
  .mark { font-size: 2rem; line-height: 1; margin-bottom: .75rem; }
  h1 { font-size: 1.25rem; margin: 0 0 .75rem; }
  p { margin: 0 0 .75rem; }
  p:last-child { margin-bottom: 0; }
  .muted { color: #5c6370; font-size: .9375rem; }
  .bad h1 { color: #a3341f; }
  @media (prefers-color-scheme: dark) {
    body { background: #14161a; color: #e8eaed; }
    .card { background: #1c1f24; border-color: #2c3037; }
    .muted { color: #9aa1ab; }
    .bad h1 { color: #f0917a; }
  }
</style>
</head>
<body>
  <div class="card ${tone === "bad" ? "bad" : ""}">
    <div class="mark">${tone === "ok" ? "✅" : "⚠️"}</div>
    ${body}
  </div>
</body>
</html>`;

function handler(req: Request): Response {
  const url = new URL(req.url);
  const hasCode = url.searchParams.has("code");
  const error = url.searchParams.get("error");
  const errorDescription = url.searchParams.get("error_description");

  // Never the value — only whether one arrived. An authorization code is a credential.
  console.log(
    `fortnox-oauth-callback: code=${hasCode ? "present" : "absent"} error=${error ?? "none"}`,
  );

  if (error) {
    return new Response(
      PAGE(
        "Kopplingen godkändes inte",
        `<h1>Kopplingen blev inte godkänd</h1>
         <p>Fortnox svarade: <strong>${escapeHtml(errorDescription ?? error)}</strong></p>
         <p class="muted">Ingenting har ändrats. Hör av dig till Erik så tar vi det tillsammans.</p>`,
        "bad",
      ),
      { status: 200, headers: htmlHeaders() },
    );
  }

  if (!hasCode) {
    return new Response(
      PAGE(
        "Fortnox-koppling",
        `<h1>Inget att göra här</h1>
         <p>Den här sidan är slutstationen för Fortnox godkännande-flöde.</p>
         <p class="muted">Kom du hit av misstag kan du bara stänga fönstret.</p>`,
        "ok",
      ),
      { status: 200, headers: htmlHeaders() },
    );
  }

  return new Response(
    PAGE(
      "Kopplingen är godkänd",
      `<h1>Klart — kopplingen är godkänd</h1>
       <p>Du kan stänga det här fönstret.</p>
       <p class="muted">Kopplingen syns nu under era integrationsinställningar i Fortnox,
       och kan stängas av därifrån när ni vill.</p>`,
      "ok",
    ),
    { status: 200, headers: htmlHeaders() },
  );
}

function htmlHeaders(): HeadersInit {
  return {
    "content-type": "text/html; charset=utf-8",
    "cache-control": "no-store",
    // The URL carries an authorization code; keep it out of any referred-to site's logs.
    "referrer-policy": "no-referrer",
  };
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!)
  );
}

Deno.serve({ port: Number(Deno.env.get("PORT") ?? "8003") }, handler);
