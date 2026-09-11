# The hosted preview (Erik, WO-124)

A place for Filip and Wilmer to click through the CRM with the Fortnox pages before go-live. It
is **not** their CRM and not part of go-live:

- **Site:** this repo built against Erik's dev Supabase project and deployed as the Cloudflare
  Worker `vega-vista-preview` on Erik's account (`https://vega-vista-preview.<subdomain>.workers.dev`).
- **Data:** a copy of the CRM's own tables, read once from Vega Vista's project and loaded into the
  dev project (`fcxmtlbrwfbbjudjmloh`). Nothing is ever written back.
- **Fortnox:** `fortnox-sync` and `fortnox-ledger-feed` deployed to the dev project; the hourly job
  reads Vega Adscreens AB. Writes stay locked to the test company by `guard.ts` (`WRITE_TENANT`).

Nothing here touches Vega Vista's own Supabase project, their Lovable/Vercel deploys or `main`.

| Script                       | What it does                                                                                                                                  | Run by                                    |
| ---------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------- |
| `copy-crm.mjs`               | `counts` / `plan` / `copy --login <email>[=<name>] …`: production row counts, a schema comparison, and the copy itself                        | the build; again only to refresh the data |
| `supabase-token.ps1`         | puts the Supabase CLI's own token into the process for `copy-crm.mjs` (dot-source it)                                                         | with `copy-crm.mjs`                       |
| `deploy.ps1 [-Ref <ref>]`    | builds with the dev project's public values and deploys the Worker — **the redeploy command**; `-Ref` builds a pushed tip from a clean export | anyone with Erik's CLI logins             |
| `set-fortnox-secrets.ps1`    | the three Fortnox function secrets on the dev project (tenant 1571636)                                                                        | Erik                                      |
| `set-passwords.ps1 -Email …` | a generated password per preview login, printed once to that terminal                                                                         | Erik                                      |

## What holds, and what holds it

- **Vega Vista's project is only read.** `copy-crm.mjs` reaches it through one function,
  `prodSelect()`: a single `SELECT` (no `;`), sent to the Management API's
  `/database/query/read-only` endpoint, which runs it as `supabase_read_only_user` in a read-only
  transaction. Every statement is printed as it is sent. Not `npx supabase db query --linked`:
  that command first POSTs `/cli/login-role`, which creates or refreshes a login role in the
  target database.
- **Every reference holds.** The data is one `SELECT` (one snapshot) and one transaction on dev,
  which re-checks every single-column foreign key in `public` and `fortnox` before it commits.
  `auth.users` is not copied: each production user id the rows point at gets a placeholder in
  dev (no password, banned, a made-up address). The `--login` users keep their production id,
  so what they own stays theirs; their password comes from `set-passwords.ps1`.
- **A login is required.** Sign-up is off on the dev project (`disable_signup`), every CRM table
  needs an authenticated session, and schema `fortnox` is closed to `anon`.
- **Never copied:** `auth.users` (passwords, identities, sessions), `seller_credentials`,
  `fortnox_tokens`, `screen_owners`, storage objects.
- **No credential in a file.** Keys and tokens are fetched from the logged-in CLIs at run time
  and live in process memory; the Fortnox secret goes from Erik's env file straight into the
  dev project's secrets.

## In the preview, on purpose

- User administration (Användare) and the Slack post after a sale answer with an error: the
  Worker has no service-role key and no Slack token, so nothing reaches their Slack and no one
  can create logins from the page.
- "Fortsätt med Google" does not work: Lovable's sign-in broker only exists on Lovable hosting.
- Re-running `copy-crm.mjs copy` replaces the dev project's CRM rows: whatever was typed in the
  preview is gone, passwords survive.
