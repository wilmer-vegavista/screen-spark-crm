# Fortnox integration — the seam

This folder, the `*fortnox*` migrations and the Postgres schema `fortnox` are Erik's.
Everything else in the repository is Vega Vista's. This file is the contract between the
two, plus how to run the Fortnox side locally.

## The seam

- **Erik writes only here:** `supabase/functions/_fortnox/` (the shared Fortnox layer),
  `supabase/functions/fortnox-*/` (the functions), `supabase/migrations/*fortnox*.sql`,
  schema `fortnox`, `supabase/seed/`, `scripts/fortnox-dev.ps1`, one route file
  (`src/routes/_authenticated/fortnox-koppling.tsx`) and its nav entry, `docs/`.
- **Erik reads, never writes, these CRM tables:** `customers` (id, company_name, org_number,
  vat_number, billing address, invoice e-mail, Peppol id, invoice reference), `products`
  (= the screens: id, name, city, live_date, active), `orders`, `order_items`,
  `order_splits`, `user_roles` (through `public.has_role`). Renaming or dropping any of
  these is a change request, not a commit. The link tables reference `customers.id` and
  `products.id` with `on delete cascade`, so deleting a CRM row also drops its link.
- **The CRM reads from Erik:** `fortnox.v_customer_numbers`, `fortnox.v_project_numbers`,
  `fortnox.health`. Admins only (row level security + `security_invoker` views).
- **The one touch of `public`:** the unused `public.fortnox_tokens` table is dropped by the
  foundation migration. The three `orders.fortnox_*` columns are left as they are.
- **Secrets:** Fortnox client id, client secret and tenant id live in Supabase secrets on the
  project — never in this repository, never in a log. The frontend never sees anything
  Fortnox-shaped; it calls the function with the user's session and the function checks the
  admin role again server-side.
- **Source of truth:** Fortnox owns the numbers (CustomerNumber, ProjectNumber) and paid
  status. The CRM originates customers and screens; the sync carries them to Fortnox.

## What is in the schema, and why

| Object | What | Why this shape |
|---|---|---|
| `sync_runs` | One row per run: trigger (manual / cron / cli), status, counts, error, a short log, the `lastmodified` cursor | `health` needs "when did it last run, how did it go" without parsing logs; the cursor is the previous ok run's start, so a failed run re-reads the same window |
| `customer_links` | CRM customer → Fortnox customer number, plus the proposal that led there (candidate, confidence, method, reason), who linked it, mismatch text | The proposal and the link are the same row on purpose: the page shows one line per customer, and the row's existence is the create guard |
| `project_links` | Same for screens (`products`) → Fortnox projects, plus `crm_code` (the four-digit code from the screen name) | The code becomes the Fortnox ProjectNumber when the sync creates the project — same codes in both systems, which is package A's whole point |
| `settings` | Non-secret key/value (`sync_url`) | The hourly job must know the function URL per project; absent = the job does nothing, so an unconfigured project is inert |
| `health` (view) | One row: last run, last ok, last error, mismatch count, linked / proposed / unlinked counts | One `select *` for the page and for a future status light |
| `v_customer_numbers`, `v_project_numbers` (views) | Every CRM row with its Fortnox number or pending proposal | What the CRM reads when it needs the number; `security_invoker` so the admin-only policies apply |

Column vocabulary on the link tables:

- `status`: `unmatched` (no candidate → the sync creates it) · `proposed` (candidate with a
  reason → waits for an admin) · `linked` (number set).
- `confidence`: `exact` (org number, four-digit code, or the `{VV <id>}` marker) · `high`
  (same name after normalisation) · `medium` / `low` (similarity, or Claude's verdict) · `none`.
  **Only `exact` is linked automatically.** Everything else waits for a person.
- `method`: `orgnr` · `code` · `name` · `fuzzy` · `marker` · `manual` (admin picked) · `created`.
- `mismatch`: null when Fortnox and the CRM agree; otherwise what disagrees, found on the
  incremental (`lastmodified`) read. A mismatch means the basis of the link no longer holds
  — the org number an orgnr-link rested on changed, the code left the project, the name a
  name-link rested on changed — or the Fortnox row is gone.

## The guard

`_fortnox/guard.ts`: the integration may talk to exactly one Fortnox company, DatabaseNumber
**1848969** (Erik's test company). The tenant id from the environment is checked before a
client is constructed (any other number refuses with zero requests sent), and
`/3/companyinformation` is checked before the first write of every run. Every write goes
through `GuardedFortnox.write`; the general client refuses any non-GET without it. No
environment variable widens this: going live is a reviewed change of the constant, with
Vega Vista's own integration and client id.

Why DatabaseNumber and not the organisation number: a Fortnox test company carries the same
orgnr as the live company it was created from.

## Idempotency — why a second "Synka nu" creates nothing

Before any create, in this order: (1) the link table — a linked row is never created again;
(2) the `{VV <crm id>}` marker in the Fortnox row's Comments, read back from every Fortnox row
that has no link (a create whose number never got stored is found here); (3) the natural key
— a Fortnox customer with the same org number, or a project whose ProjectNumber is the
screen's code, is linked instead of duplicated.

## Running it locally (round zero)

Round zero runs on a sandbox pair: Fortnox test company 1848969 and the dev Supabase project
`fcxmtlbrwfbbjudjmloh` (Erik's own, free plan). Nothing touches Vega Vista's project or
Fortnox. Requirements: Deno 2, Node 22+, the Supabase CLI logged in (`npx supabase login`),
and the fortnox-agent repo's env file on this machine (set `FORTNOX_ENV_FILE` if it is not
at the default path). No key, token or password is written to any file: Supabase keys are
fetched from the CLI at run time, Fortnox credentials are passed to Deno by path.

```powershell
deno test supabase/functions/                # the Fortnox layer, mocked fetch
./scripts/fortnox-dev.ps1 refuse             # the guard refusing tenant 1030384, zero requests
./scripts/fortnox-dev.ps1 probe              # company name, DatabaseNumber, counts
./scripts/fortnox-dev.ps1 seed -Fortnox      # synthetic customers/screens/orders + a few hand-made rows in Fortnox
./scripts/fortnox-dev.ps1 sync -Dry          # one run, prints what it would do
./scripts/fortnox-dev.ps1 sync               # one run for real
./scripts/fortnox-dev.ps1 serve              # the function on http://localhost:8000  (terminal 1)
./scripts/fortnox-dev.ps1 crm                # the CRM against the dev project        (terminal 2)
```

Then open http://localhost:8080, log in as `admin@vegavista.test` with the password the
seed printed, and go to **Fortnox-koppling** under Admin. Every Supabase CLI command in the
script carries `--project-ref fcxmtlbrwfbbjudjmloh`; the committed `supabase/config.toml`
names Vega Vista's production project and is never the target.

## Deploying (dev project now; their project at go-live)

```powershell
npx supabase db push --project-ref <ref>
npx supabase functions deploy fortnox-sync --project-ref <ref> --no-verify-jwt --use-api
```

- `--no-verify-jwt`: the function verifies the caller itself (admin session, or the cron
  token), so the gateway's anon-key check is not needed and would block the cron job.
- The `fortnox` schema must be exposed to the API (Dashboard → Settings → API → Exposed
  schemas, add `fortnox`; or `supabase config push` with `[api] schemas`). On the dev project
  this was done with `config push`.
- Fortnox secrets on the project (go-live only, with Vega Vista's own integration):
  `FORTNOX_CLIENT_ID`, `FORTNOX_CLIENT_SECRET`, `FORTNOX_TENANT_ID` — and the guard constant
  changed to their DatabaseNumber in a reviewed PR. Optional: `ANTHROPIC_API_KEY`.
- The hourly job: the cron migration installs pg_cron and pg_net, generates a random token
  into Vault and schedules `fortnox.run_sync('cron')`. It does nothing until
  `fortnox.settings.sync_url` holds the function URL:
  `insert into fortnox.settings (key, value) values ('sync_url', 'https://<ref>.supabase.co/functions/v1/fortnox-sync');`
  Until Fortnox secrets are set, the function answers `503 fortnox-not-configured` and writes
  no run, so the schedule is inert, not noisy.

## Files

```
_fortnox/           the shared layer (client, guard, paging, reads, writes, matcher, Claude step) + tests
_fortnox/probe.ts   the guard probe
fortnox-sync/       index.ts (HTTP entry), sync.ts (the run), actions.ts (page actions), cli.ts
../seed/seed.ts     the synthetic set
../../scripts/fortnox-dev.ps1   the local launcher
../../docs/fortnox-integration.md   the meeting page (Swedish): built, assumed, questions
```
