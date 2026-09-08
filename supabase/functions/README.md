# Fortnox integration — the seam

This folder, the `*fortnox*` migrations and the Postgres schema `fortnox` are Erik's.
Everything else in the repository is Vega Vista's. This file is the contract between the
two, plus how to run the Fortnox side locally.

## The seam

- **Erik writes only here:** `supabase/functions/_fortnox/` (the shared Fortnox layer),
  `supabase/functions/fortnox-*/` (the functions), `supabase/migrations/*fortnox*.sql`,
  schema `fortnox`, `supabase/seed/`, `scripts/fortnox-dev.ps1`, his route files
  (`src/routes/_authenticated/fortnox-koppling.tsx`, `kundreskontra.tsx`) and their nav
  entries, `src/components/fortnox/`, `src/lib/fortnox/`, `docs/`.
- **Round one's three touches of their frontend files, all additive:** one import + one JSX
  line in `faktura.tsx` and in `order-dialog.tsx` (the "Fortnox: 8 av 12 fakturerade…" line);
  the bounded edit to `rapport-ekonomi.tsx` (two imports, one hook call, `data` fed from the
  switch, one JSX line, the Abonnemang tab pinned to the plan — listed line by line on the
  meeting page). Nothing of Wilmer's logic is rewritten or reordered.
- **Erik reads, never writes, these CRM tables:** `customers` (id, company_name, org_number,
  vat_number, billing address, invoice e-mail, Peppol id, invoice reference), `products`
  (= the screens: id, name, city, live_date, active), `orders`, `order_items`,
  `order_splits`, `user_roles` (through `public.has_role`). Renaming or dropping any of
  these is a change request, not a commit. The link tables reference `customers.id` and
  `products.id` with `on delete cascade`, so deleting a CRM row also drops its link.
- **The CRM reads from Erik:** `fortnox.v_customer_numbers`, `fortnox.v_project_numbers`,
  `fortnox.health`, and from round one `fortnox.v_ledger` and `fortnox.v_order_invoice_state`.
  Admins only (row level security + `security_invoker` views).
- **Round one reads two more of their tables, never writes them:** `orders` (customer, owner,
  billing frequency / duration / start, total ex VAT) and `order_items` (which screens an order
  covers) — the matcher's four rules rest on them. `profiles` gives the seller's name.
- **Fortnox is read-only for the sync.** The only code that creates, books, credits or cancels
  an invoice sits in `supabase/seed/fortnox-invoice-writes.ts`, runs only from the seed, and only
  into test company 1848969 through the guard. The functions folder has no invoice-writing code.
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
| `health` (view) | One row: last run, last ok, last error, mismatch count, linked / proposed / unlinked counts; round one appends the invoice counters of the last run, the ledger's totals (linked / proposed / unmatched / ignored / paid / overdue / cancelled), the first and last invoice date, when invoices were last synced, when the feed link was rotated, and whether dev fake payments are on | One `select *` for the page and for a future status light |
| `v_customer_numbers`, `v_project_numbers` (views) | Every CRM row with its Fortnox number or pending proposal | What the CRM reads when it needs the number; `security_invoker` so the admin-only policies apply |
| **Round one** | | |
| `invoices` | One row per Fortnox customer invoice (DocumentNumber is the key): customer and project number, invoice / due / final-pay date, amount ex VAT (`Net`), VAT, total, **balance**, currency, booked / sent / cancelled / credit flags, `credit_invoice_reference`, `invoice_type`, terms, our / your / order / external reference, `lastmodified_seen_at`, then the match: `order_id`, `candidate_order_id`, `match_status`, `match_confidence`, `match_method`, `match_reason`, `matched_by`, `matched_at`, `synced_at` | Fortnox owns every figure and the paid state ("betald" = balance is zero); the CRM never writes an invoice. Net/VAT come from the full record (the list has only Total), so each new or changed invoice costs one detail GET. `balance` is read with `requiredNum`: missing or malformed fails the run, never reads as paid. `lastmodified_seen_at` exists because Fortnox exposes lastmodified only as a filter. `invoice_type` tells the meeting whether the instalments are hand-made or `AGREEMENTINVOICE` (Fortnox's avtal module). `credit_invoice_reference` sits on the ORIGINAL and names its credit note — that is how the credit note finds the same order |
| `invoices.match_*` | `match_status`: unmatched · proposed · linked · **ignored** (an admin's "Lämna okopplad"); `match_confidence`: exact = all four rules, high = customer + project + amount, medium = customer + project, low = customer, none; `match_method`: rules · manual · none; `matched_by`: `sync` or `admin:<uuid>` | An admin's row (`admin:…`) is never re-judged by a later run, and a standing sync link is kept — only proposals and unmatched rows take a fresh verdict. Same proposal-with-a-reason pattern as the link tables |
| `ledger_snapshot` | `v_ledger` frozen per year as JSON rows, with a stamp and the run that wrote it | The Google Sheet feed serves this, so a sheet polling every few minutes reads one indexed row; refreshed by every successful sync, or by the feed itself when a year is missing or older than six hours |
| `settings` (grows) | `invoices_cursor` (start of the last successful invoice read), `feed_token_rotated_at`, `dev_fake_payments` (dev only) | The cursor is separate from `sync_runs` so a run that never reached invoices (round zero's) does not count as a read; settings became admin-readable so `health` can show them — nothing secret lives here |
| `v_ledger` (view) | Filip's eleven columns per invoice — Säljare · Projekt · Kundnamn · Fakturadatum · Förfallodatum · Belopp ex moms · Moms · Totalt · Betald · Såld · Inlagd i rapport — plus Kvar att betala, förfallen, cancelled / credit flags, the Fortnox numbers, the match columns, `installment_no` / `installments_planned` / `installments_invoiced`, the planned instalment amount | Säljare = the order's owner, else Fortnox "Vår referens"; Projekt = the CRM screen via `project_links`, else "Fortnox-projekt N"; Kundnamn = the CRM customer via `customer_links`, else Fortnox's name. Såld and Inlagd i rapport are constants (true): nothing in the workbook reads Såld, and "Inlagd i rapport" was the hand step this feed replaces. The counter counts non-cancelled, non-credit invoices on the order by date; `installments_planned` is the CRM's plan (`fortnox.installments_planned`, the SQL twin of `buildInvoiceSchedule`) |
| `v_order_invoice_state` (view) | Per order with ≥ 1 matched invoice: invoices matched / paid / overdue / open, credit notes, next due date, last invoice date, sums, planned count and amount | "Fortnox: 8 av 12 fakturerade · 7 betalda · 1 förfallen (förfaller …)" on the order card; absent rows mean "no matched invoice yet", so their planned counter stays |
| `verify_feed_token` / `rotate_feed_token` / `revoke_feed_token` (functions) | The Google Sheet feed's token, in Vault | Generated inside the database like the cron token; rotate returns it exactly once (the page shows it in a dialog); Google Sheets sends no headers, so the token in the URL path is the whole authentication |

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

## The invoice matcher (round one) — four rules, tolerances stated

An invoice links to an order by itself only when all four hold: (1) its CustomerNumber is
linked to the order's customer; (2) its Project is linked to one of the order's screens;
(3) its amount ex VAT equals one instalment of the order's plan — total / count as
`buildInvoiceSchedule` computes it — within **1,00 kr or 0,5 %**, whichever is larger;
(4) its invoice date lies inside the billing window, **14 days before** the first planned
date to **31 days after** the last. Fewer → a proposal with a reason for an admin (high /
medium / low as above). No customer link → unmatched. Two orders passing all four → a
proposal, never a link. A credit note goes to the same order as the invoice it credits.
Cancelled invoices are matched (so the row says where they belonged) but excluded from every
count, sum, the leftover list and the feed. The constants live at the top of
`_fortnox/invoice-matcher.ts`; the tolerances are guesses until Filip's real invoices say
otherwise.

## The Google Sheet feed (round one)

`GET https://<ref>.supabase.co/functions/v1/fortnox-ledger-feed/<token>[?year=2026&sep=,]`
answers Filip's eleven columns as CSV (UTF-8 with BOM, CRLF, ISO dates, dot decimals,
TRUE/FALSE; `sep=;` gives the Swedish-Excel shape). The token is a 64-hex secret created in
Vault by `rotate_feed_token` on the admin's "Skapa länk" and shown once; wrong or revoked →
403 with no detail; the token is never logged. The feed serves `ledger_snapshot`, refreshed
by every sync, and asks for 15 minutes of caching. Paste `=IMPORTDATA("…")` in **A2** of the
Kundreskontra tab: row 1 is the blank spacer, the header lands on row 2 and data on row 3,
exactly today's layout, so the Budget pivot and the cash-flow tab's row references keep
their places.

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
deno test supabase/functions/                # the Fortnox layer, mocked fetch (89 tests)
./scripts/fortnox-dev.ps1 refuse             # the guard refusing tenant 1030384, zero requests
./scripts/fortnox-dev.ps1 probe              # company name, DatabaseNumber, counts, financial years, invoices
./scripts/fortnox-dev.ps1 seed -Fortnox      # synthetic customers/screens/orders + a few hand-made rows in Fortnox
./scripts/fortnox-dev.ps1 sync               # round zero: links + creates (run it once before the invoices)
./scripts/fortnox-dev.ps1 seed -Invoices -FakePayments   # round one: a year of invoices in the test company
./scripts/fortnox-dev.ps1 sync -Dry          # one run, prints what it would do
./scripts/fortnox-dev.ps1 sync               # one run for real (invoices included)
./scripts/fortnox-dev.ps1 serve              # fortnox-sync on http://localhost:8000          (terminal 1)
./scripts/fortnox-dev.ps1 feed               # fortnox-ledger-feed on http://localhost:8001   (optional)
./scripts/fortnox-dev.ps1 crm                # the CRM against the dev project                (terminal 2)
```

Then open http://localhost:8080, log in as `admin@vegavista.test` with the password the
seed printed, and go to **Fortnox-koppling** and **Kundreskontra** under Admin. Every Supabase
CLI command in the script carries `--project-ref fcxmtlbrwfbbjudjmloh`; the committed
`supabase/config.toml` names Vega Vista's production project and is never the target.

`-FakePayments` exists because the fortnox-agent's integration lacks the `payment` scope, so
the test company refuses `POST /invoicepayments`: the seed then lists the "paid" invoices in
`fortnox.settings.dev_fake_payments` and the sync stores them with balance 0 **in the dev
project's table only**. The health row, the ledger page and the Fortnox-koppling page all say
so. The key never exists on their project, so the live sync never takes that path.

## Deploying (dev project now; their project at go-live)

```powershell
npx supabase db push --project-ref <ref>
npx supabase functions deploy fortnox-sync --project-ref <ref> --no-verify-jwt --use-api
npx supabase functions deploy fortnox-ledger-feed --project-ref <ref> --no-verify-jwt --use-api
```

- `--no-verify-jwt`: the function verifies the caller itself (admin session, or the cron
  token; for the feed, the token in the URL), so the gateway's anon-key check is not needed
  and would block the cron job and Google Sheets alike.
- **First invoice read on a big live company:** run `./scripts/fortnox-dev.ps1 sync` from a
  machine once (one detail GET per invoice, a year ≈ 1–2 minutes) rather than "Synka nu";
  after that the hourly runs read only what changed.
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
_fortnox/invoices.ts, invoice-matcher.ts, ledger-csv.ts, ledger-snapshot.ts   round one: invoices, the four-rule matcher, the feed's CSV and snapshot
fortnox-sync/       index.ts (HTTP entry), sync.ts (the run), actions.ts (page actions), cli.ts
fortnox-sync/invoices-step.ts, invoice-actions.ts   round one: the invoice step of a run; Fakturor / feed actions
fortnox-ledger-feed/   round one: the Google Sheet feed (feed.ts handler + tests, index.ts entry)
../seed/seed.ts     the synthetic set (--fortnox, --invoices, --fake-payments)
../seed/fortnox-invoice-writes.ts   the ONLY invoice writes in the repo — seed only, test company only
../../scripts/fortnox-dev.ps1   the local launcher
../../docs/fortnox-integration.md   the meeting page (Swedish): built, assumed, questions
../../src/routes/_authenticated/kundreskontra.tsx   the ledger page
../../src/components/fortnox/   order-invoice-state.tsx (the order-card line), revenue-source.tsx (the report's switch)
../../src/lib/fortnox/          ledger.ts (typed reads of the views), revenue.ts (the switch's data), ledger-pdf.ts, xlsx.ts
```
