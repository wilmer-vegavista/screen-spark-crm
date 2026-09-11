# Fortnox integration — the seam

This folder, the `*fortnox*` migrations and the Postgres schema `fortnox` are Erik's.
Everything else in the repository is Vega Vista's. This file is the contract between the
two, plus how to run the Fortnox side locally.

## The seam

- **Erik writes only here:** `supabase/functions/_fortnox/` (the shared Fortnox layer),
  `supabase/functions/fortnox-*/` (the functions), `supabase/migrations/*fortnox*.sql`,
  schema `fortnox`, `supabase/seed/`, `scripts/fortnox-dev.ps1`, his route files
  (`src/routes/_authenticated/fortnox-koppling.tsx`, `kundreskontra.tsx`, and from round two
  `kassaflode.tsx`) and their nav entries, `src/components/fortnox/`, `src/lib/fortnox/`, `docs/`.
- **Round two's one touch of their files:** the nav line for Kassaflöde in `app-shell.tsx`
  (plus the generated route tree). No edit to `rapport-ekonomi.tsx`, `faktura.tsx` or
  `order-dialog.tsx` this round.
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
- **Round two reads three more columns, never writes them:** `orders.payment_terms` (the first
  number in the text = days to due, default 30) and `orders.vat_exempt` for the order book's
  planned instalments, `products.screen_type` for the category rule. The CRM reads from Erik:
  `fortnox.v_cashflow`, `v_cash_position`, `v_cashflow_items`, `v_cashflow_plan`,
  `v_unmapped_accounts`, and the tables `cashflow_rows`, `account_map`, `revenue_rules`,
  `accounts`, `financial_years` (admins only).
- **Fortnox is read-only for the sync, round two included.** The only code that creates a
  supplier, a supplier invoice, a voucher or activates an account sits in
  `supabase/seed/fortnox-cashflow-writes.ts`, runs only from the seed, and only into test
  company 1848969 through the guard. The functions folder has no ledger-writing code.
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
| **Round two** | | |
| `financial_years` | Fortnox's own years: id, from, to, accounting method | Every dated ledger read takes an explicit id (voucher numbers restart each year; a `fromdate` outside the year is a hard error), and the grid runs on the fiscal year, not the calendar year (the test company runs May–April) |
| `ledger_postings` | One row per voucher row (SIE #TRANS): financial year, series, number, row number, date, account, debit, credit, `amount` (SIE sign, debit positive), the voucher text, registration date | **The SIE route:** one `GET /sie/4?financialyear=` per year gives every voucher with every row, the chart and the balances in one file, versus one GET per voucher (a live year is hundreds to thousands). A year is replaced whole on each read (`replace_ledger_year`, one transaction) — the file IS the ledger, so there is no per-row cursor to keep. `debit`/`credit` are the same figure split, for readability |
| `account_balances` | Per year and account: balance brought forward and carried forward (SIE #IB 0 / #UB 0) | "Kassa årets ingång" is the cash accounts' opening balance; a year not closed in Fortnox has #IB 0, so the previous year's #UB stands in (`v_cash_position.opening_ledger_source` says which) |
| `accounts` | The chart (SIE #KONTO): number → name | The account-map page shows names; only accounts the SIE carries |
| `suppliers` | Fortnox supplier register: number, name, org number, active, `predefined_account` | The default cost account per supplier is the map's best hint; Bron registers the invoices against these |
| `supplier_invoices` | One row per Fortnox supplier invoice (GivenNumber is the key): supplier, invoice / due / final-pay date, total, VAT, **balance**, booked / cancelled / credit, `account` (the cost row with the largest amount), `cost_rows` (every cost row), the booking voucher (`Vouchers[]` — the header fields stay null on a booked invoice, verified live), `lastmodified_seen_at` | Total, VAT and Balance through `requiredNum`. "Paid" = balance zero and a final pay date = the month the money left. The list lacks the cost rows and the VAT, so each new or changed invoice costs one detail GET. Never `filter=unpaid` on this endpoint: it means unpaid-and-overdue and drops early-paid rows (fortnox-agent evidence) |
| `cashflow_rows` | Filip's `Kassaflödesrapport` tab, row for row: key, label (verbatim, trailing spaces trimmed), section, kind, `position` (= the workbook row number), `income`, `vat_bearing`, `plan_enabled` | The grid is the workbook's grid; the VAT formulas read exactly the rows the workbook's do (`income` for Utgående moms; `vat_bearing` = rows 24, 25, 29–35, 37–41 for Ingående moms — not 23, 26, 27, 28, 36); `plan_enabled` = the rows Filip types by hand |
| `account_map` | BAS account (`account`), account range (`account`..`account_to`) or supplier (`supplier_match` = a SupplierNumber or a name prefix) → workbook row; `source` default / manual; who, when | Three shapes because the three SaaS rows share one BAS account (6540) and are told apart by supplier, while most costs follow the account. Resolution: supplier > exact account > narrowest range (`map_row`). The defaults are the builder's reading of BAS against the rows — Filip's chart decides; the page edits them |
| `revenue_rules` | Priority-ordered rules: seller prefix / project number or screen code / screen type / billing shape (`abonnemang` = monthly, quarterly or half-yearly, what Rapport ekonomi's Abonnemang tab counts) / default → income row | Rule 4 of the order, stored, not coded: Alta and screens of type `extern` → extern försäljning; project 2102 → programmatisk; subscriptions → abonnemang; else egen. First match wins, so a subscription sold by Alta is extern (stated precedence). `revenue_row()` is the one evaluator, used for paid invoices, open invoices and planned instalments alike |
| `cashflow_plan` | One amount per plan-enabled row: `source` ledger (the sync's prefill: the last three closed months' average, rounded to 100 kr, `basis` says which months) or manual (edited on the page), who, when | Two tables rather than row × month: the workbook has one figure per row that Filip repeats, and a month's own figure is the exception. **A manual row is never overwritten by a sync** (`prefill_cashflow_plan` updates `where source = 'ledger'` only) — the bar's "a plan edit a later sync overwrites" |
| `cashflow_plan_months` | (row, month) → amount, note, who, when | The per-month override; also holds the manual "Kassa årets ingång" (row `kassa_arets_ingang` at the fiscal year's first day) for a year the ledger is not closed for |
| `settings` (grows) | `cashflow_vat_period` (monthly \| quarterly \| yearly, default monthly — a meeting question), `cashflow_vat_lag_months` (2: the 12th of the second month after the period), `cashflow_cash_accounts` (`1900-1999`: which accounts are "kassan"), `ledger_cursor`, `ledger_synced_at`, `ledger_years_read`, `dev_fake_supplier_payments` (dev only) | Non-secret, admin-readable; the page edits the first three through the function |
| `v_ledger_vouchers` (view) | Every voucher with its bank net and a class: customer_receipt (a 15xx credit against the bank) · supplier_payment (a 2440 debit) · payroll (a 70xx–73xx debit) · tax_payment (only 27xx / 1630 counters) · vat_settlement (only 26xx / 1650 counters) · other · none | The three special classes are how Bron's postings land on the right rows without a map: the payroll voucher's bank leg IS the net salary (Löner), the tax payment IS Arbetsgivaravgifter & skatt, the VAT settlement IS Moms att betala. On a customer receipt or a supplier payment only the receivable / payable leg is left to the invoice tables, which know the pay date and the category; every other leg on such a voucher (öresavrundning, a bank charge, a cash discount) goes through the map like an ordinary voucher's, so nothing on it is dropped |
| `v_cashflow_items` (view) | Every leaf figure: bucket (actual · forecast_invoiced · forecast_planned · liability), source, reference, month, date, row, amount, a Swedish label | The page's hover lists a cell's makeup from here; the grid is its aggregate. Actual money in = customer invoices paid that month (Fortnox's final pay date) by the category rule, net + VAT; actual money out = supplier invoices paid that month (net by the map, VAT to Ingående moms) + the special classes + every other bank voucher leg by leg through the map (264x → Ingående moms; income rows get credit − debit), the legs of a receipt / payment voucher the invoice tables do not carry included. Forecast: open customer / supplier invoices on their due month (overdue → the current month), the order book's remaining instalments on planned invoice date + payment terms (rendered lighter), the 27xx booked this month as next month's liability — **less whatever the row has already paid that month**, so a booked liability can only raise the row above the payment, never add to it (the same arithmetic Moms att betala carries in `v_cashflow`, put on the item so a cell and its hover show the same money). Several payroll runs in one month are consumed in date order |
| `v_cashflow` (view) | One row per fed row × month per fiscal year: actual, forecast_invoiced, forecast_planned, liability (what is *left* to pay of it, not what was booked), plan (month override → row amount), `month_kind` (closed · current · ahead) and **value** | The value rule, stated once: closed = actual only; ahead = greatest(plan, known + planned); current = actual + known + planned + the plan's remainder. VAT rows: real VAT in closed months, 25 % of the contributing rows' forecast part otherwise — the workbook's own formula. Moms att betala ahead: each VAT period's net (26xx postings for closed / current months, the VAT rows for months ahead) placed in its payment month. Sum rows and the cash rows are computed by the page from these, exactly as the workbook's SUBTOTALs |
| `v_cash_position` (view) | Per fiscal year and month: opening cash (override → #IB → previous #UB), the workbook's income and outflow totals, the computed month-end cash, the ledger's bank in / out and its month-end balance | The ledger's own 19xx balance beside the computed one is how a drift becomes visible on closed months (the sandbox shows 13 500 from the fortnox-agent's test vouchers) |
| `v_unmapped_accounts` (view) | Accounts with bank-driven postings or supplier-invoice cost rows no rule covers, with amount, count, period, source | Listed on the page so nothing vanishes; until mapped they sit on Övriga kostnader |
| `v_cashflow_plan` (view) | The plan with the editor's name and the month overrides as JSON | The Plan tab in one read |
| `replace_ledger_year`, `prefill_cashflow_plan`, `planned_instalments`, `map_row`, `revenue_row`, `is_cash_account` (functions) | One transaction per year; the plan's prefill; the order book's remaining instalments (the SQL twins of `buildInvoiceSchedule` minus matched invoices); the two rule evaluators; the cash-account test | Kept in SQL so the page, the PDF and the sync agree on one definition |
| `sync_runs` (grows) | `supplier_invoices_read`, `postings_read`, `ledger_synced_to` | `health` shows the ledger's picture without parsing logs |

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

`_fortnox/guard.ts`: one constant used to be two questions — which company the integration may
talk to at all, and which company it may write to. Moving it to Vega Vista's DatabaseNumber to
enable reads would have simultaneously authorised writes against their live books, since
Fortnox grants read and write together as one scope set. So it is two constants:

- `READ_TENANTS` — DatabaseNumbers the integration may talk to at all. Today just **1848969**
  (Erik's test company). The tenant id from the environment is checked against this list before
  a client is constructed (a number not in the list refuses with zero requests sent).
- `WRITE_TENANT` — the single DatabaseNumber the integration may write to: **1848969**, and
  nothing else, ever, by design (a scalar, not a list). `/3/companyinformation` is checked
  against it before the first write of every run, so a tenant can be in `READ_TENANTS` and
  still have every write refused.

Every write goes through `GuardedFortnox.write`; the general client refuses any non-GET without
it. No environment variable widens either constant: going live means adding Vega Vista's
DatabaseNumber to `READ_TENANTS` in a reviewed pull request, with their own integration and
client id — `WRITE_TENANT` does not move.

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
An invoice that is not linked yet is judged again by every run, also when Fortnox did not
change it — so a customer or screen linked today lifts yesterday's invoices at the next sync
(database only; an admin's choice is never re-judged). Cancelled invoices are matched (so the row says where they belonged) but excluded from every
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

## The cash-flow grid (round two) — how a cell decides

The page (`src/routes/_authenticated/kassaflode.tsx`) is Filip's `Kassaflödesrapport` tab: his
rows in his order, the "(Inför) start" column, the fiscal year's twelve months and Summa.

- **Closed month** — actuals only, from the general ledger. Money in = customer invoices
  Fortnox marks paid that month, by the category rule (net on the category row, VAT on
  Utgående moms). Money out = supplier invoices paid that month by the account map (net on
  the row, VAT on Ingående moms), plus every other bank movement in the ledger: a payroll
  voucher's bank leg is Löner, a tax payment's is Arbetsgivaravgifter & skatt, a VAT
  settlement's is Moms att betala, and any other voucher goes leg by leg through the map.
  A closed month never shows a forecast.
- **Month ahead** — the plan is the floor; known invoices (customer by due date, supplier by
  due date) and the order book's planned instalments (planned invoice date + the order's
  payment terms; lighter on the page) raise it: value = greatest(plan, known + planned).
  Arbetsgivaravgifter & skatt carries the 27xx booked the month before; Moms att betala
  carries the VAT period's net in its payment month (period and lag are settings).
- **Current month** — actual to date + known invoices due + planned + the plan's remainder,
  and the column says "hittills + prognos".
- **VAT rows** — real VAT in closed months; in forecast months 25 % of the contributing rows,
  exactly as the workbook's formulas (`income` rows for Utgående moms, `vat_bearing` rows for
  Ingående moms).
- **The cash rows** — computed by the page as the workbook does: row 6 of month one is the
  start column's Kassa (månadsslutet) (= Kassa årets ingång); Summa = SUBTOTAL(10:17);
  Summa kontanta medel = row 6 + SUM(10:17); Summa utbetalningar = SUM(23:42) + SUM(47:51);
  Kassa (månadsslutet) = row 19 − row 53; the Summa column follows the workbook's R formulas
  (R6 = P6, R19 = R6 + SUM(R10:R17), R55 = R19 − R53). Under each closed month's Kassa
  (månadsslutet) stands the ledger's own bank balance, in red when it differs.
- **The PDF** — one landscape page, the same grid; forecast cells italic, cells with planned
  money marked `*`, sum rows bold — distinguishable without colour.

Every edit on the page (plan, month override, opening cash, category rules, account map,
settings) is an action of `fortnox-sync` with the admin's session, stamped `admin:<uuid>`
and shown with a name; a change re-renders the page without a sync.

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
deno test supabase/functions/                # the Fortnox layer, mocked fetch (102 tests)
./scripts/fortnox-dev.ps1 refuse             # the guard refusing tenant 1030384, zero requests
./scripts/fortnox-dev.ps1 probe              # company name, DatabaseNumber, counts, financial years, invoices
./scripts/fortnox-dev.ps1 seed -Fortnox      # synthetic customers/screens/orders + a few hand-made rows in Fortnox
./scripts/fortnox-dev.ps1 sync               # round zero: links + creates (run it once before the invoices)
./scripts/fortnox-dev.ps1 seed -Invoices -FakePayments   # round one: a year of invoices in the test company
./scripts/fortnox-dev.ps1 sync -Dry          # one run, prints what it would do
./scripts/fortnox-dev.ps1 sync               # one run for real (invoices and the ledger included)
./scripts/fortnox-dev.ps1 seed -Cashflow     # round two: suppliers, a year of supplier invoices, salary / tax / VAT / bank vouchers
./scripts/fortnox-dev.ps1 sync -FullLedger   # re-read the previous financial year's SIE too (after a seed into it)
./scripts/fortnox-dev.ps1 serve              # fortnox-sync on http://localhost:8000 (set PORT for another)   (terminal 1)
./scripts/fortnox-dev.ps1 feed               # fortnox-ledger-feed on http://localhost:8001   (optional)
./scripts/fortnox-dev.ps1 crm                # the CRM against the dev project (VITE_FORTNOX_FUNCTIONS_URL to override)  (terminal 2)
```

Then open http://localhost:8080, log in as `admin@vegavista.test` with the password the
seed printed, and go to **Fortnox-koppling**, **Kundreskontra** and **Kassaflöde** under Admin.
Every Supabase CLI command in the script carries `--project-ref fcxmtlbrwfbbjudjmloh`; the
committed `supabase/config.toml` names Vega Vista's production project and is never the target.

`-FakePayments` exists because the fortnox-agent's integration lacks the `payment` scope, so
the test company refuses `POST /invoicepayments`: the seed then lists the "paid" invoices in
`fortnox.settings.dev_fake_payments` and the sync stores them with balance 0 **in the dev
project's table only**. The health row, the ledger page and the Fortnox-koppling page all say
so. The key never exists on their project, so the live sync never takes that path.

Round two's seed does the same for supplier invoices (`dev_fake_supplier_payments`, refused
for the same scope) and books the bank vouchers itself (2440/1930 and 1930/1510) so the ledger
and the fake-payment tables agree — the entries carry the voucher's date, and the sync applies
them to every named row on each run. Two more disclosed writes into the test company: the
accounts the seed posts to are activated (`PUT /accounts/{n}?financialyear=` — a Fortnox chart
has every BAS account, few are active), and the opening cash is two vouchers on 1930 against
2091 on the previous fiscal year's first day (a real company has it as an opening balance).

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
  after that the hourly runs read only what changed. The same holds for the first supplier
  invoice read (one detail GET each); the SIE export is one request per financial year and
  is re-read whole for the current year every run (a live year's file is a few megabytes at
  most).
- **Statement timeout:** the page reads the views through PostgREST with the admin's session,
  which caps a query at a few seconds. The views are set-based for that reason
  (`20260909120100_fortnox_cashflow_perf.sql`, corrected in `20260909130000_fortnox_cashflow_fix.sql`);
  on the dev project's 1 292 postings each answers in under 100 ms — measured again after the
  correction: `v_cashflow` 76 ms, `v_cashflow_items` 42 ms, `v_cash_position` 66 ms. If a live
  ledger ever grows past what that allows, the fix is a
  materialised snapshot refreshed by the sync, like the feed's.
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
_fortnox/ledger.ts  round two: the SIE export (CP437 → postings, balances, chart), suppliers, supplier invoices, voucher headers, financial-year clamping
fortnox-sync/       index.ts (HTTP entry), sync.ts (the run), actions.ts (page actions), cli.ts
fortnox-sync/invoices-step.ts, invoice-actions.ts   round one: the invoice step of a run; Fakturor / feed actions
fortnox-sync/ledger-step.ts, cashflow-actions.ts    round two: the ledger step of a run; the cash-flow page's edits
fortnox-ledger-feed/   round one: the Google Sheet feed (feed.ts handler + tests, index.ts entry)
../seed/seed.ts     the synthetic set (--fortnox, --invoices, --fake-payments, --cashflow)
../seed/fortnox-invoice-writes.ts   the ONLY invoice writes in the repo — seed only, test company only
../seed/fortnox-cashflow-writes.ts, seed-cashflow.ts   round two: the ONLY supplier / supplier-invoice / voucher / account writes — seed only, test company only
../../scripts/fortnox-dev.ps1   the local launcher
../../docs/fortnox-integration.md   the meeting page (Swedish): built, assumed, questions
../../src/routes/_authenticated/kundreskontra.tsx   the ledger page
../../src/routes/_authenticated/kassaflode.tsx      round two: the cash-flow page
../../src/components/fortnox/   order-invoice-state.tsx (the order-card line), revenue-source.tsx (the report's switch), cashflow-grid.tsx, cashflow-plan.tsx, cashflow-rules.tsx
../../src/lib/fortnox/          ledger.ts (typed reads of the views), revenue.ts (the switch's data), ledger-pdf.ts, xlsx.ts, cashflow.ts (the grid as the workbook computes it), cashflow-pdf.ts
```
