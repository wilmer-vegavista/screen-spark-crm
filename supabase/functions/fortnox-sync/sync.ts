/**
 * The sync: one run = read Fortnox, propose a match for every CRM customer and screen
 * that is not linked yet, link the exact ones, create the ones with no candidate, and
 * list the Fortnox changes since the last run that disagree with a link.
 *
 * Idempotent three ways, checked in this order before any create:
 *   1. the link tables — a linked row is never created again;
 *   2. the {VV <crm id>} marker read back from the Fortnox rows that have no link
 *      (a create whose number never got stored is found here, not repeated);
 *   3. the natural key — a Fortnox customer with the same org number, or a project
 *      whose ProjectNumber is the screen's four-digit code, is linked, not duplicated.
 * A second run with nothing new therefore creates nothing.
 */
import type { SupabaseClient } from "npm:@supabase/supabase-js@2.108.1";
import {
  AUTO_LINK_CONFIDENCE,
  claudeFuzzy,
  createCustomer,
  createProject,
  extractCode,
  type FxCustomer,
  type FxProject,
  getCustomer,
  getProject,
  type GuardedFortnox,
  listCustomers,
  listProjects,
  markerIn,
  nameWithoutCode,
  normalizeName,
  normalizeOrgNumber,
  type Proposal,
  proposeCustomer,
  proposeProject,
  redact,
  similarity,
} from "../_fortnox/mod.ts";

export type Trigger = "manual" | "cron" | "cli";

export interface SyncOptions {
  triggeredBy: Trigger;
  /** Compute and log everything, write nothing — not to the database, not to Fortnox. */
  dryRun?: boolean;
  /** false = proposals only; the rows with no candidate are left for a later run. */
  createMissing?: boolean;
}

export interface SyncDeps {
  db: SupabaseClient;
  fortnox: GuardedFortnox;
  anthropicApiKey?: string;
  anthropicModel?: string;
  now?: () => Date;
  log?: (line: string) => void;
}

export interface SyncSummary {
  runId: number | null;
  status: "ok" | "error";
  dryRun: boolean;
  triggeredBy: Trigger;
  tenantId?: number;
  companyName?: string;
  fortnoxCustomersRead: number;
  fortnoxProjectsRead: number;
  proposalsWritten: number;
  autoLinked: number;
  customersCreated: number;
  projectsCreated: number;
  mismatchesFound: number;
  claudeUsed: boolean;
  error?: string;
  log: string[];
}

// ---------------------------------------------------------------- CRM and link row shapes

export interface CrmCustomerRow {
  id: string;
  company_name: string;
  org_number: string | null;
  email: string | null;
  invoice_email: string | null;
  billing_address: string | null;
  postal_code: string | null;
  city: string | null;
  vat_number: string | null;
  invoice_reference: string | null;
}

export interface CrmScreenRow {
  id: string;
  name: string;
  city: string | null;
  live_date: string | null;
  active: boolean;
}

export interface LinkRow {
  status: "unmatched" | "proposed" | "linked";
  candidate_number: string | null;
  candidate_name: string | null;
  confidence: string;
  method: string;
  reason: string | null;
  proposed_at: string | null;
  linked_at: string | null;
  linked_by: string | null;
  created_in_fortnox_at: string | null;
  mismatch: string | null;
  mismatch_seen_at: string | null;
}

export interface CustomerLinkRow extends LinkRow {
  customer_id: string;
  fortnox_customer_number: string | null;
  fortnox_name: string | null;
  fortnox_org_number: string | null;
}

export interface ProjectLinkRow extends LinkRow {
  product_id: string;
  fortnox_project_number: string | null;
  fortnox_description: string | null;
  crm_code: string | null;
}

/** Everything one run (or one row action) needs to know about both sides. */
export interface SyncContext {
  now: Date;
  companyName: string;
  tenantId: number | undefined;
  crmCustomers: CrmCustomerRow[];
  crmScreens: CrmScreenRow[];
  customerLinks: Map<string, CustomerLinkRow>;
  projectLinks: Map<string, ProjectLinkRow>;
  fxCustomers: FxCustomer[];
  fxProjects: FxProject[];
  /** crm id → Fortnox number, from {VV …} markers on unlinked Fortnox rows. */
  customerMarkers: Map<string, string>;
  projectMarkers: Map<string, string>;
  takenCustomerNumbers: Set<string>;
  takenProjectNumbers: Set<string>;
  customersRead: { rows: number; pages: number };
  projectsRead: { rows: number; pages: number };
}

const MAX_DETAIL_READS = 300;

function must<T>(res: { data: T | null; error: { message: string } | null }, what: string): T {
  if (res.error) throw new Error(`${what}: ${res.error.message}`);
  return res.data as T;
}

export async function loadContext(deps: SyncDeps, log: (s: string) => void): Promise<SyncContext> {
  const now = (deps.now ?? (() => new Date()))();
  const fx = deps.db.schema("fortnox");

  const company = await deps.fortnox.company();
  log(`Fortnox: "${company.name}" (DatabaseNumber ${company.databaseNumber})`);

  const [customers, projects] = await Promise.all([
    listCustomers(deps.fortnox),
    listProjects(deps.fortnox),
  ]);
  log(
    `Fortnox read: ${customers.rows.length} customers (${customers.read.pages} page(s)), ${projects.rows.length} projects (${projects.read.pages} page(s))`,
  );

  const crmCustomers = must(
    await deps.db
      .from("customers")
      .select(
        "id, company_name, org_number, email, invoice_email, billing_address, postal_code, city, vat_number, invoice_reference",
      )
      .order("company_name"),
    "read customers",
  ) as CrmCustomerRow[];
  const crmScreens = must(
    await deps.db.from("products").select("id, name, city, live_date, active").order("name"),
    "read products",
  ) as CrmScreenRow[];
  const customerLinkRows = must(
    await fx.from("customer_links").select("*"),
    "read customer_links",
  ) as CustomerLinkRow[];
  const projectLinkRows = must(
    await fx.from("project_links").select("*"),
    "read project_links",
  ) as ProjectLinkRow[];
  log(
    `CRM: ${crmCustomers.length} customers, ${crmScreens.length} screens; links: ${customerLinkRows.length} + ${projectLinkRows.length}`,
  );

  const customerLinks = new Map(customerLinkRows.map((l) => [l.customer_id, l]));
  const projectLinks = new Map(projectLinkRows.map((l) => [l.product_id, l]));
  const takenCustomerNumbers = new Set(
    customerLinkRows.filter((l) => l.status === "linked").map((l) => l.fortnox_customer_number!),
  );
  const takenProjectNumbers = new Set(
    projectLinkRows.filter((l) => l.status === "linked").map((l) => l.fortnox_project_number!),
  );

  // Markers: only the Fortnox rows nobody is linked to need a detail read.
  const customerMarkers = new Map<string, string>();
  const projectMarkers = new Map<string, string>();
  const markerByCustomer = new Map<string, string>();
  const markerByProject = new Map<string, string>();
  let detailReads = 0;
  for (const c of customers.rows) {
    if (takenCustomerNumbers.has(c.CustomerNumber) || detailReads >= MAX_DETAIL_READS) continue;
    detailReads++;
    const id = markerIn((await getCustomer(deps.fortnox, c.CustomerNumber)).Comments);
    if (id) {
      customerMarkers.set(id, c.CustomerNumber);
      markerByCustomer.set(c.CustomerNumber, id);
    }
  }
  for (const p of projects.rows) {
    if (takenProjectNumbers.has(p.ProjectNumber) || detailReads >= MAX_DETAIL_READS) continue;
    detailReads++;
    const id = markerIn((await getProject(deps.fortnox, p.ProjectNumber)).Comments);
    if (id) {
      projectMarkers.set(id, p.ProjectNumber);
      markerByProject.set(p.ProjectNumber, id);
    }
  }
  if (detailReads >= MAX_DETAIL_READS)
    log(`Marker read-back capped at ${MAX_DETAIL_READS} detail reads this run.`);
  log(
    `Markers read back: ${customerMarkers.size} customer(s), ${projectMarkers.size} project(s) carry {VV …}`,
  );

  return {
    now,
    companyName: company.name,
    tenantId: company.databaseNumber,
    crmCustomers,
    crmScreens,
    customerLinks,
    projectLinks,
    fxCustomers: customers.rows.map((c) => ({
      number: c.CustomerNumber,
      name: c.Name,
      orgNumber: c.OrganisationNumber ?? null,
      markerId: markerByCustomer.get(c.CustomerNumber) ?? null,
    })),
    fxProjects: projects.rows.map((p) => ({
      number: p.ProjectNumber,
      description: p.Description,
      markerId: markerByProject.get(p.ProjectNumber) ?? null,
    })),
    customerMarkers,
    projectMarkers,
    takenCustomerNumbers,
    takenProjectNumbers,
    customersRead: { rows: customers.rows.length, pages: customers.read.pages },
    projectsRead: { rows: projects.rows.length, pages: projects.read.pages },
  };
}

// ---------------------------------------------------------------- the Claude step

async function maybeClaude(
  deps: SyncDeps,
  kind: "customer" | "screen",
  crmName: string,
  crmExtra: string | undefined,
  rules: Proposal,
  pool: Array<{ number: string; name: string; extra?: string }>,
  log: (s: string) => void,
): Promise<{ proposal: Proposal; used: boolean }> {
  if (!deps.anthropicApiKey) return { proposal: rules, used: false };
  if (rules.confidence === "exact" || rules.confidence === "high" || rules.confidence === "medium")
    return { proposal: rules, used: false };
  const norm = kind === "customer" ? normalizeName(crmName) : nameWithoutCode(crmName);
  const candidates = pool
    .map((c) => ({
      ...c,
      score: similarity(
        norm,
        kind === "customer" ? normalizeName(c.name) : nameWithoutCode(c.name),
      ),
    }))
    .sort((a, b) => b.score - a.score)
    .slice(0, 8)
    .filter((c) => c.score > 0.2);
  if (candidates.length === 0) return { proposal: rules, used: false };
  try {
    const verdict = await claudeFuzzy(
      {
        kind,
        crmName,
        crmExtra,
        candidates: candidates.map(({ number, name, extra }) => ({ number, name, extra })),
      },
      { apiKey: deps.anthropicApiKey, model: deps.anthropicModel },
    );
    const rank = { none: 0, low: 1, medium: 2, high: 3, exact: 4 } as const;
    if (verdict.candidateNumber && rank[verdict.confidence] > rank[rules.confidence]) {
      const c = candidates.find((x) => x.number === verdict.candidateNumber)!;
      return {
        used: true,
        proposal: {
          candidateNumber: c.number,
          candidateName: c.name,
          confidence: verdict.confidence,
          method: "fuzzy",
          reason: verdict.reason,
        },
      };
    }
    if (!verdict.candidateNumber && rules.candidateNumber) {
      // Claude disagrees with a low rules match: keep the rules' candidate but say so.
      return { used: true, proposal: { ...rules, reason: `${rules.reason} · ${verdict.reason}` } };
    }
    return {
      used: true,
      proposal: rules.candidateNumber
        ? rules
        : { ...rules, reason: `${rules.reason} · ${verdict.reason}` },
    };
  } catch (e) {
    log(`Claude call failed for "${crmName}": ${redact((e as Error).message)} — rules result kept`);
    return { proposal: rules, used: false };
  }
}

// ---------------------------------------------------------------- link writes

type Fx = ReturnType<SupabaseClient["schema"]>;

async function writeCustomerLink(fx: Fx, row: Partial<CustomerLinkRow> & { customer_id: string }) {
  must(
    await fx.from("customer_links").upsert(row, { onConflict: "customer_id" }),
    `write customer_links ${row.customer_id}`,
  );
}

async function writeProjectLink(fx: Fx, row: Partial<ProjectLinkRow> & { product_id: string }) {
  must(
    await fx.from("project_links").upsert(row, { onConflict: "product_id" }),
    `write project_links ${row.product_id}`,
  );
}

export function customerLinkFor(
  crm: CrmCustomerRow,
  fxRow: FxCustomer,
  method: string,
  reason: string,
  linkedBy: string,
  now: Date,
  created = false,
): Partial<CustomerLinkRow> & { customer_id: string } {
  return {
    customer_id: crm.id,
    status: "linked",
    fortnox_customer_number: fxRow.number,
    fortnox_name: fxRow.name,
    fortnox_org_number: fxRow.orgNumber,
    candidate_number: fxRow.number,
    candidate_name: fxRow.name,
    confidence: "exact",
    method,
    reason,
    proposed_at: now.toISOString(),
    linked_at: now.toISOString(),
    linked_by: linkedBy,
    created_in_fortnox_at: created ? now.toISOString() : null,
    mismatch: null,
    mismatch_seen_at: null,
  };
}

export function projectLinkFor(
  crm: CrmScreenRow,
  fxRow: FxProject,
  method: string,
  reason: string,
  linkedBy: string,
  now: Date,
  created = false,
): Partial<ProjectLinkRow> & { product_id: string } {
  return {
    product_id: crm.id,
    status: "linked",
    fortnox_project_number: fxRow.number,
    fortnox_description: fxRow.description,
    crm_code: extractCode(crm.name),
    candidate_number: fxRow.number,
    candidate_name: fxRow.description,
    confidence: "exact",
    method,
    reason,
    proposed_at: now.toISOString(),
    linked_at: now.toISOString(),
    linked_by: linkedBy,
    created_in_fortnox_at: created ? now.toISOString() : null,
    mismatch: null,
    mismatch_seen_at: null,
  };
}

// ---------------------------------------------------------------- creates with read-back

export type CreateOutcome =
  | { kind: "linked"; method: string; number: string }
  | { kind: "created"; number: string }
  | { kind: "failed"; error: string };

/** One CRM customer: marker → org number → create. Writes the link unless dryRun. */
export async function ensureCustomerInFortnox(
  deps: SyncDeps,
  ctx: SyncContext,
  crm: CrmCustomerRow,
  linkedBy: string,
  dryRun: boolean,
  log: (s: string) => void,
): Promise<CreateOutcome> {
  const fx = deps.db.schema("fortnox");
  const byMarker = ctx.customerMarkers.get(crm.id.toLowerCase());
  const markerRow = byMarker ? ctx.fxCustomers.find((c) => c.number === byMarker) : undefined;
  if (markerRow && !ctx.takenCustomerNumbers.has(markerRow.number)) {
    const reason = `Fortnox-kunden bär markören {VV ${crm.id}} – skapad av synken tidigare`;
    log(`  ${crm.company_name}: found by marker → customer ${markerRow.number} (no create)`);
    if (!dryRun)
      await writeCustomerLink(
        fx,
        customerLinkFor(crm, markerRow, "marker", reason, linkedBy, ctx.now),
      );
    ctx.takenCustomerNumbers.add(markerRow.number);
    return { kind: "linked", method: "marker", number: markerRow.number };
  }
  const org = normalizeOrgNumber(crm.org_number);
  const byOrg =
    org.length === 10
      ? ctx.fxCustomers.find(
          (c) => normalizeOrgNumber(c.orgNumber) === org && !ctx.takenCustomerNumbers.has(c.number),
        )
      : undefined;
  if (byOrg) {
    const reason = `Samma organisationsnummer – fanns redan i Fortnox när synken skulle skapa`;
    log(`  ${crm.company_name}: found by org number → customer ${byOrg.number} (no create)`);
    if (!dryRun)
      await writeCustomerLink(fx, customerLinkFor(crm, byOrg, "orgnr", reason, linkedBy, ctx.now));
    ctx.takenCustomerNumbers.add(byOrg.number);
    return { kind: "linked", method: "orgnr", number: byOrg.number };
  }
  if (dryRun) {
    log(`  ${crm.company_name}: WOULD create in Fortnox (dry run)`);
    return { kind: "created", number: "(dry-run)" };
  }
  try {
    const created = await createCustomer(deps.fortnox, {
      crmId: crm.id,
      name: crm.company_name,
      organisationNumber: crm.org_number,
      email: crm.email,
      emailInvoice: crm.invoice_email,
      address1: crm.billing_address,
      zipCode: crm.postal_code,
      city: crm.city,
      vatNumber: crm.vat_number,
      yourReference: crm.invoice_reference,
    });
    const fxRow: FxCustomer = {
      number: created.customerNumber,
      name: created.name || crm.company_name,
      orgNumber: crm.org_number,
      markerId: crm.id,
    };
    ctx.fxCustomers.push(fxRow);
    ctx.takenCustomerNumbers.add(fxRow.number);
    ctx.customerMarkers.set(crm.id.toLowerCase(), fxRow.number);
    await writeCustomerLink(
      fx,
      customerLinkFor(
        crm,
        fxRow,
        "created",
        `Skapad i Fortnox av synken som kund ${fxRow.number}`,
        linkedBy,
        ctx.now,
        true,
      ),
    );
    log(`  ${crm.company_name}: CREATED in Fortnox as customer ${fxRow.number}`);
    return { kind: "created", number: fxRow.number };
  } catch (e) {
    const msg = redact((e as Error).message);
    log(`  ${crm.company_name}: create FAILED — ${msg}`);
    await writeCustomerLink(fx, {
      customer_id: crm.id,
      status: "unmatched",
      reason: `Kunde inte skapa i Fortnox: ${msg}`.slice(0, 500),
    });
    return { kind: "failed", error: msg };
  }
}

/** One CRM screen: marker → code as ProjectNumber → create (with the code as ProjectNumber). */
export async function ensureProjectInFortnox(
  deps: SyncDeps,
  ctx: SyncContext,
  crm: CrmScreenRow,
  linkedBy: string,
  dryRun: boolean,
  log: (s: string) => void,
): Promise<CreateOutcome> {
  const fx = deps.db.schema("fortnox");
  const code = extractCode(crm.name);
  const byMarker = ctx.projectMarkers.get(crm.id.toLowerCase());
  const markerRow = byMarker ? ctx.fxProjects.find((p) => p.number === byMarker) : undefined;
  if (markerRow && !ctx.takenProjectNumbers.has(markerRow.number)) {
    const reason = `Fortnox-projektet bär markören {VV ${crm.id}} – skapat av synken tidigare`;
    log(`  ${crm.name}: found by marker → project ${markerRow.number} (no create)`);
    if (!dryRun)
      await writeProjectLink(
        fx,
        projectLinkFor(crm, markerRow, "marker", reason, linkedBy, ctx.now),
      );
    ctx.takenProjectNumbers.add(markerRow.number);
    return { kind: "linked", method: "marker", number: markerRow.number };
  }
  const byCode = code
    ? ctx.fxProjects.find((p) => p.number === code && !ctx.takenProjectNumbers.has(p.number))
    : undefined;
  if (byCode) {
    const reason = `Projektnummer ${code} fanns redan i Fortnox när synken skulle skapa`;
    log(`  ${crm.name}: found by code → project ${byCode.number} (no create)`);
    if (!dryRun)
      await writeProjectLink(fx, projectLinkFor(crm, byCode, "code", reason, linkedBy, ctx.now));
    ctx.takenProjectNumbers.add(byCode.number);
    return { kind: "linked", method: "code", number: byCode.number };
  }
  if (dryRun) {
    log(
      `  ${crm.name}: WOULD create in Fortnox as project ${code ?? "(Fortnox numbers it)"} (dry run)`,
    );
    return { kind: "created", number: "(dry-run)" };
  }
  try {
    const created = await createProject(deps.fortnox, {
      crmId: crm.id,
      description: crm.name,
      projectNumber: code,
      startDate: crm.live_date,
    });
    const fxRow: FxProject = {
      number: created.projectNumber,
      description: created.description || crm.name,
      markerId: crm.id,
    };
    ctx.fxProjects.push(fxRow);
    ctx.takenProjectNumbers.add(fxRow.number);
    ctx.projectMarkers.set(crm.id.toLowerCase(), fxRow.number);
    await writeProjectLink(
      fx,
      projectLinkFor(
        crm,
        fxRow,
        "created",
        `Skapat i Fortnox av synken som projekt ${fxRow.number}`,
        linkedBy,
        ctx.now,
        true,
      ),
    );
    log(`  ${crm.name}: CREATED in Fortnox as project ${fxRow.number}`);
    return { kind: "created", number: fxRow.number };
  } catch (e) {
    const msg = redact((e as Error).message);
    log(`  ${crm.name}: create FAILED — ${msg}`);
    await writeProjectLink(fx, {
      product_id: crm.id,
      status: "unmatched",
      crm_code: code,
      reason: `Kunde inte skapa i Fortnox: ${msg}`.slice(0, 500),
    });
    return { kind: "failed", error: msg };
  }
}

// ---------------------------------------------------------------- the run

export async function runSync(deps: SyncDeps, opts: SyncOptions): Promise<SyncSummary> {
  const dryRun = opts.dryRun === true;
  const createMissing = opts.createMissing !== false;
  const lines: string[] = [];
  const log = (s: string) => {
    lines.push(s);
    deps.log?.(s);
  };
  const fx = deps.db.schema("fortnox");
  const summary: SyncSummary = {
    runId: null,
    status: "ok",
    dryRun,
    triggeredBy: opts.triggeredBy,
    fortnoxCustomersRead: 0,
    fortnoxProjectsRead: 0,
    proposalsWritten: 0,
    autoLinked: 0,
    customersCreated: 0,
    projectsCreated: 0,
    mismatchesFound: 0,
    claudeUsed: false,
    log: lines,
  };

  // The cursor: the previous successful run's start. Changes since then are the mismatch set.
  const prev = must(
    await fx
      .from("sync_runs")
      .select("started_at")
      .eq("status", "ok")
      .order("started_at", { ascending: false })
      .limit(1)
      .maybeSingle(),
    "read last run",
  ) as { started_at: string } | null;
  const cursor = prev?.started_at ? new Date(prev.started_at) : null;

  if (!dryRun) {
    const row = must(
      await fx
        .from("sync_runs")
        .insert({
          triggered_by: opts.triggeredBy,
          lastmodified_cursor: cursor?.toISOString() ?? null,
        })
        .select("id")
        .single(),
      "open sync_runs",
    ) as { id: number };
    summary.runId = row.id;
  }
  log(
    `Sync run ${summary.runId ?? "(dry run)"} started by ${opts.triggeredBy}${cursor ? `, changes since ${cursor.toISOString()}` : ", first run (no cursor)"}`,
  );

  // Rows linked or created in this run are not mismatch candidates in the same run.
  const linkedThisRun = new Set<string>();

  try {
    const ctx = await loadContext(deps, log);
    summary.tenantId = ctx.tenantId;
    summary.companyName = ctx.companyName;
    summary.fortnoxCustomersRead = ctx.customersRead.rows;
    summary.fortnoxProjectsRead = ctx.projectsRead.rows;
    if (!dryRun) {
      must(
        await fx
          .from("sync_runs")
          .update({ tenant_id: ctx.tenantId, company_name: ctx.companyName })
          .eq("id", summary.runId),
        "update run",
      );
    }

    // ---- proposals for every customer and screen that is not linked
    log("Proposals:");
    for (const crm of ctx.crmCustomers) {
      const existing = ctx.customerLinks.get(crm.id);
      if (existing?.status === "linked") continue;
      const rules = proposeCustomer(crm, ctx.fxCustomers, ctx.takenCustomerNumbers);
      const { proposal, used } = await maybeClaude(
        deps,
        "customer",
        crm.company_name,
        crm.org_number ? `org.nr ${crm.org_number}` : undefined,
        rules,
        ctx.fxCustomers
          .filter((c) => !ctx.takenCustomerNumbers.has(c.number))
          .map((c) => ({
            number: c.number,
            name: c.name,
            extra: c.orgNumber ? `org.nr ${c.orgNumber}` : undefined,
          })),
        log,
      );
      summary.claudeUsed ||= used;
      if (proposal.confidence === AUTO_LINK_CONFIDENCE && proposal.candidateNumber) {
        const fxRow = ctx.fxCustomers.find((c) => c.number === proposal.candidateNumber)!;
        log(
          `  ${crm.company_name} → customer ${fxRow.number} "${fxRow.name}" [${proposal.method}, auto-linked] ${proposal.reason}`,
        );
        if (!dryRun)
          await writeCustomerLink(
            fx,
            customerLinkFor(crm, fxRow, proposal.method, proposal.reason, "auto", ctx.now),
          );
        ctx.takenCustomerNumbers.add(fxRow.number);
        ctx.customerLinks.set(crm.id, {
          ...(existing ?? ({} as CustomerLinkRow)),
          customer_id: crm.id,
          status: "linked",
          fortnox_customer_number: fxRow.number,
        } as CustomerLinkRow);
        linkedThisRun.add(crm.id);
        summary.autoLinked++;
      } else {
        log(
          `  ${crm.company_name} → ${proposal.candidateNumber ? `candidate ${proposal.candidateNumber} "${proposal.candidateName}" [${proposal.confidence}/${proposal.method}]` : "no candidate"} ${proposal.reason}`,
        );
        const status = proposal.candidateNumber ? "proposed" : "unmatched";
        if (!dryRun) {
          await writeCustomerLink(fx, {
            customer_id: crm.id,
            status,
            fortnox_customer_number: null,
            fortnox_name: null,
            fortnox_org_number: null,
            candidate_number: proposal.candidateNumber,
            candidate_name: proposal.candidateName,
            confidence: proposal.confidence,
            method: proposal.method,
            reason: proposal.reason,
            proposed_at: ctx.now.toISOString(),
            linked_at: null,
            linked_by: null,
          });
        }
        ctx.customerLinks.set(crm.id, {
          ...(existing ?? ({} as CustomerLinkRow)),
          customer_id: crm.id,
          status,
          candidate_number: proposal.candidateNumber,
        } as CustomerLinkRow);
        summary.proposalsWritten++;
      }
    }
    for (const crm of ctx.crmScreens) {
      const existing = ctx.projectLinks.get(crm.id);
      if (existing?.status === "linked") continue;
      const rules = proposeProject(crm, ctx.fxProjects, ctx.takenProjectNumbers);
      const { proposal, used } = await maybeClaude(
        deps,
        "screen",
        crm.name,
        crm.city ? `ort ${crm.city}` : undefined,
        rules,
        ctx.fxProjects
          .filter((p) => !ctx.takenProjectNumbers.has(p.number))
          .map((p) => ({ number: p.number, name: p.description })),
        log,
      );
      summary.claudeUsed ||= used;
      if (proposal.confidence === AUTO_LINK_CONFIDENCE && proposal.candidateNumber) {
        const fxRow = ctx.fxProjects.find((p) => p.number === proposal.candidateNumber)!;
        log(
          `  ${crm.name} → project ${fxRow.number} "${fxRow.description}" [${proposal.method}, auto-linked] ${proposal.reason}`,
        );
        if (!dryRun)
          await writeProjectLink(
            fx,
            projectLinkFor(crm, fxRow, proposal.method, proposal.reason, "auto", ctx.now),
          );
        ctx.takenProjectNumbers.add(fxRow.number);
        ctx.projectLinks.set(crm.id, {
          ...(existing ?? ({} as ProjectLinkRow)),
          product_id: crm.id,
          status: "linked",
          fortnox_project_number: fxRow.number,
        } as ProjectLinkRow);
        linkedThisRun.add(crm.id);
        summary.autoLinked++;
      } else {
        log(
          `  ${crm.name} → ${proposal.candidateNumber ? `candidate ${proposal.candidateNumber} "${proposal.candidateName}" [${proposal.confidence}/${proposal.method}]` : "no candidate"} ${proposal.reason}`,
        );
        const status = proposal.candidateNumber ? "proposed" : "unmatched";
        if (!dryRun) {
          await writeProjectLink(fx, {
            product_id: crm.id,
            status,
            fortnox_project_number: null,
            fortnox_description: null,
            crm_code: extractCode(crm.name),
            candidate_number: proposal.candidateNumber,
            candidate_name: proposal.candidateName,
            confidence: proposal.confidence,
            method: proposal.method,
            reason: proposal.reason,
            proposed_at: ctx.now.toISOString(),
            linked_at: null,
            linked_by: null,
          });
        }
        ctx.projectLinks.set(crm.id, {
          ...(existing ?? ({} as ProjectLinkRow)),
          product_id: crm.id,
          status,
          candidate_number: proposal.candidateNumber,
        } as ProjectLinkRow);
        summary.proposalsWritten++;
      }
    }

    // ---- create the ones with no candidate
    if (createMissing) {
      log(dryRun ? "Creates (dry run — nothing is written):" : "Creates:");
      for (const crm of ctx.crmCustomers) {
        if (ctx.customerLinks.get(crm.id)?.status !== "unmatched") continue;
        const outcome = await ensureCustomerInFortnox(deps, ctx, crm, "sync", dryRun, log);
        if (outcome.kind === "created") summary.customersCreated++;
        if (outcome.kind === "linked") summary.autoLinked++;
        if (outcome.kind !== "failed") linkedThisRun.add(crm.id);
      }
      for (const crm of ctx.crmScreens) {
        if (ctx.projectLinks.get(crm.id)?.status !== "unmatched") continue;
        const outcome = await ensureProjectInFortnox(deps, ctx, crm, "sync", dryRun, log);
        if (outcome.kind === "created") summary.projectsCreated++;
        if (outcome.kind === "linked") summary.autoLinked++;
        if (outcome.kind !== "failed") linkedThisRun.add(crm.id);
      }
      if (summary.customersCreated + summary.projectsCreated === 0) log("  nothing to create");
    }

    // ---- mismatches: Fortnox rows changed since the cursor whose link no longer holds
    summary.mismatchesFound = await findMismatches(deps, ctx, cursor, dryRun, linkedThisRun, log);

    if (!dryRun) {
      must(
        await fx
          .from("sync_runs")
          .update({
            status: "ok",
            finished_at: new Date().toISOString(),
            fortnox_customers_read: summary.fortnoxCustomersRead,
            fortnox_projects_read: summary.fortnoxProjectsRead,
            proposals_written: summary.proposalsWritten,
            auto_linked: summary.autoLinked,
            customers_created: summary.customersCreated,
            projects_created: summary.projectsCreated,
            mismatches_found: summary.mismatchesFound,
            log: lines.slice(0, 200),
          })
          .eq("id", summary.runId),
        "close run",
      );
    }
    log(
      `Done: ${summary.proposalsWritten} proposals, ${summary.autoLinked} auto-linked, ${summary.customersCreated} customers + ${summary.projectsCreated} projects created, ${summary.mismatchesFound} mismatches${summary.claudeUsed ? ", Claude used for the fuzzy rest" : ", rules only"}`,
    );
  } catch (e) {
    const msg = redact((e as Error).message ?? String(e));
    summary.status = "error";
    summary.error = msg;
    log(`FAILED: ${msg}`);
    if (!dryRun && summary.runId !== null) {
      await fx
        .from("sync_runs")
        .update({
          status: "error",
          error: msg.slice(0, 2000),
          finished_at: new Date().toISOString(),
          log: lines.slice(0, 200),
        })
        .eq("id", summary.runId);
    }
  }
  return summary;
}

// ---------------------------------------------------------------- mismatches

/**
 * A mismatch is a link whose basis no longer holds on the Fortnox side: the org number
 * an orgnr-link rests on changed, the code a code-link rests on is gone from the
 * project, the name a name/fuzzy/manual/created link rests on changed — or the Fortnox
 * row disappeared. Only rows changed in Fortnox since the cursor are re-judged (the
 * `lastmodified` read); on a first run without a cursor every earlier link is judged.
 * Rows linked in this very run are skipped: their names may differ by design (a code
 * match between "1101 - Stenungstorg" and "Stenungsund" is the point, not a problem).
 */
async function findMismatches(
  deps: SyncDeps,
  ctx: SyncContext,
  cursor: Date | null,
  dryRun: boolean,
  skip: Set<string>,
  log: (s: string) => void,
): Promise<number> {
  const fx = deps.db.schema("fortnox");
  let found = 0;
  const seen = ctx.now.toISOString();

  const changedCustomers = cursor ? (await listCustomers(deps.fortnox, cursor)).rows : [];
  const changedProjects = cursor ? (await listProjects(deps.fortnox, cursor)).rows : [];
  const changedCustomerNumbers = new Set(changedCustomers.map((c) => c.CustomerNumber));
  const changedProjectNumbers = new Set(changedProjects.map((p) => p.ProjectNumber));
  if (cursor)
    log(
      `Changed in Fortnox since ${cursor.toISOString()}: ${changedCustomers.length} customer(s), ${changedProjects.length} project(s)`,
    );

  const crmCustomerById = new Map(ctx.crmCustomers.map((c) => [c.id, c]));
  for (const link of ctx.customerLinks.values()) {
    if (link.status !== "linked" || !link.fortnox_customer_number || skip.has(link.customer_id))
      continue;
    const crm = crmCustomerById.get(link.customer_id);
    const fxRow = ctx.fxCustomers.find((c) => c.number === link.fortnox_customer_number);
    let mismatch: string | null = null;
    if (!fxRow) mismatch = `Kundnummer ${link.fortnox_customer_number} finns inte längre i Fortnox`;
    else if (crm && (!cursor || changedCustomerNumbers.has(fxRow.number))) {
      const parts: string[] = [];
      const fo = normalizeOrgNumber(fxRow.orgNumber);
      const co = normalizeOrgNumber(crm.org_number);
      if (link.method === "orgnr") {
        if (fo !== co)
          parts.push(
            `org.nr i Fortnox ${fxRow.orgNumber ?? "saknas"}, i CRM ${crm.org_number ?? "saknas"} – kopplingen byggde på org.nr`,
          );
      } else {
        if (normalizeName(fxRow.name) !== normalizeName(crm.company_name))
          parts.push(`namn i Fortnox "${fxRow.name}", i CRM "${crm.company_name}"`);
        if (fo && co && fo !== co)
          parts.push(`org.nr i Fortnox ${fxRow.orgNumber}, i CRM ${crm.org_number}`);
      }
      mismatch = parts.length ? parts.join("; ") : null;
    } else {
      continue; // not changed since the cursor: leave the stored verdict alone
    }
    if (mismatch) {
      found++;
      log(`  mismatch (customer ${link.fortnox_customer_number}): ${mismatch}`);
    }
    if (!dryRun && (mismatch ?? null) !== (link.mismatch ?? null)) {
      await fx
        .from("customer_links")
        .update({
          mismatch,
          mismatch_seen_at: mismatch ? seen : null,
          fortnox_name: fxRow?.name ?? link.fortnox_name,
          fortnox_org_number: fxRow?.orgNumber ?? link.fortnox_org_number,
        })
        .eq("customer_id", link.customer_id);
    }
  }

  const crmScreenById = new Map(ctx.crmScreens.map((s) => [s.id, s]));
  for (const link of ctx.projectLinks.values()) {
    if (link.status !== "linked" || !link.fortnox_project_number || skip.has(link.product_id))
      continue;
    const crm = crmScreenById.get(link.product_id);
    const fxRow = ctx.fxProjects.find((p) => p.number === link.fortnox_project_number);
    let mismatch: string | null = null;
    if (!fxRow) mismatch = `Projekt ${link.fortnox_project_number} finns inte längre i Fortnox`;
    else if (crm && (!cursor || changedProjectNumbers.has(fxRow.number))) {
      const parts: string[] = [];
      const code = extractCode(crm.name);
      const codeHolds =
        Boolean(code) && (fxRow.number === code || extractCode(fxRow.description) === code);
      if (link.method === "code" || link.method === "created") {
        if (!codeHolds)
          parts.push(
            `koden ${code ?? "(ingen)"} finns inte längre på Fortnox-projektet ${fxRow.number} – kopplingen byggde på koden`,
          );
      } else if (nameWithoutCode(fxRow.description) !== nameWithoutCode(crm.name)) {
        parts.push(`namn i Fortnox "${fxRow.description}", i CRM "${crm.name}"`);
      }
      mismatch = parts.length ? parts.join("; ") : null;
    } else {
      continue;
    }
    if (mismatch) {
      found++;
      log(`  mismatch (project ${link.fortnox_project_number}): ${mismatch}`);
    }
    if (!dryRun && (mismatch ?? null) !== (link.mismatch ?? null)) {
      await fx
        .from("project_links")
        .update({
          mismatch,
          mismatch_seen_at: mismatch ? seen : null,
          fortnox_description: fxRow?.description ?? link.fortnox_description,
        })
        .eq("product_id", link.product_id);
    }
  }
  return found;
}
