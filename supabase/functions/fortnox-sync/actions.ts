/**
 * The admin page's row actions and its read: status (health + every customer and screen
 * with its proposal), confirm the proposal, link to another Fortnox row, create this one
 * in Fortnox now, and the candidate lists for the picker. Every write to Fortnox goes
 * through the same read-back-then-create path as the sync.
 */
import type { SupabaseClient } from "npm:@supabase/supabase-js@2.108.1";
import {
  extractCode,
  getCustomer,
  getProject,
  type GuardedFortnox,
  listCustomers,
  listProjects,
} from "../_fortnox/mod.ts";
import {
  type CrmCustomerRow,
  type CrmScreenRow,
  customerLinkFor,
  ensureCustomerInFortnox,
  ensureProjectInFortnox,
  loadContext,
  projectLinkFor,
  type SyncDeps,
} from "./sync.ts";

export type Kind = "customer" | "screen";

export class ActionError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = "ActionError";
  }
}

function must<T>(res: { data: T | null; error: { message: string } | null }, what: string): T {
  if (res.error) throw new Error(`${what}: ${res.error.message}`);
  return res.data as T;
}

export async function status(
  db: SupabaseClient,
  flags: { fortnoxConfigured: boolean; claudeConfigured: boolean; functionUrl: string | null },
) {
  const fx = db.schema("fortnox");
  const [health, customers, screens, runs] = await Promise.all([
    fx.from("health").select("*").single(),
    fx.from("v_customer_numbers").select("*").order("company_name"),
    fx.from("v_project_numbers").select("*").order("name"),
    fx
      .from("sync_runs")
      .select(
        "id, started_at, finished_at, triggered_by, status, tenant_id, company_name, proposals_written, auto_linked, customers_created, projects_created, mismatches_found, error",
      )
      .order("started_at", { ascending: false })
      .limit(5),
  ]);
  return {
    health: must(health, "health"),
    customers: must(customers, "v_customer_numbers"),
    screens: must(screens, "v_project_numbers"),
    runs: must(runs, "sync_runs"),
    ...flags,
  };
}

export async function candidates(fortnox: GuardedFortnox) {
  const [c, p] = await Promise.all([listCustomers(fortnox), listProjects(fortnox)]);
  return {
    customers: c.rows.map((x) => ({
      number: x.CustomerNumber,
      name: x.Name,
      orgNumber: x.OrganisationNumber ?? null,
    })),
    projects: p.rows.map((x) => ({ number: x.ProjectNumber, description: x.Description })),
  };
}

async function crmCustomer(db: SupabaseClient, id: string): Promise<CrmCustomerRow> {
  const row = must(
    await db
      .from("customers")
      .select(
        "id, company_name, org_number, email, invoice_email, billing_address, postal_code, city, vat_number, invoice_reference",
      )
      .eq("id", id)
      .maybeSingle(),
    "read customer",
  ) as CrmCustomerRow | null;
  if (!row) throw new ActionError(404, "Kunden finns inte i CRM:et");
  return row;
}

async function crmScreen(db: SupabaseClient, id: string): Promise<CrmScreenRow> {
  const row = must(
    await db
      .from("products")
      .select("id, name, city, live_date, active")
      .eq("id", id)
      .maybeSingle(),
    "read product",
  ) as CrmScreenRow | null;
  if (!row) throw new ActionError(404, "Skärmen finns inte i CRM:et");
  return row;
}

async function assertCustomerNumberFree(db: SupabaseClient, number: string, exceptId: string) {
  const other = must(
    await db
      .schema("fortnox")
      .from("customer_links")
      .select("customer_id")
      .eq("fortnox_customer_number", number)
      .neq("customer_id", exceptId)
      .maybeSingle(),
    "check number",
  ) as { customer_id: string } | null;
  if (other)
    throw new ActionError(409, `Fortnox-kund ${number} är redan kopplad till en annan CRM-kund`);
}

async function assertProjectNumberFree(db: SupabaseClient, number: string, exceptId: string) {
  const other = must(
    await db
      .schema("fortnox")
      .from("project_links")
      .select("product_id")
      .eq("fortnox_project_number", number)
      .neq("product_id", exceptId)
      .maybeSingle(),
    "check number",
  ) as { product_id: string } | null;
  if (other)
    throw new ActionError(409, `Fortnox-projekt ${number} är redan kopplat till en annan skärm`);
}

/** Link a CRM row to a given Fortnox number after checking it exists there. `manual` = the admin picked it. */
export async function linkTo(
  deps: SyncDeps,
  kind: Kind,
  id: string,
  number: string,
  adminId: string,
  method: "manual" | "confirm",
) {
  const fx = deps.db.schema("fortnox");
  const now = new Date();
  const linkedBy = `admin:${adminId}`;
  if (kind === "customer") {
    const crm = await crmCustomer(deps.db, id);
    await assertCustomerNumberFree(deps.db, number, id);
    let detail;
    try {
      detail = await getCustomer(deps.fortnox, number);
    } catch {
      throw new ActionError(404, `Fortnox-kund ${number} hittades inte i testbolaget`);
    }
    const existing = must(
      await fx.from("customer_links").select("reason, method").eq("customer_id", id).maybeSingle(),
      "read link",
    ) as { reason: string | null; method: string } | null;
    const reason =
      method === "confirm"
        ? `Bekräftad av admin: ${existing?.reason ?? ""}`.trim()
        : `Kopplad för hand av admin till kund ${number}`;
    const row = customerLinkFor(
      crm,
      { number, name: detail.Name, orgNumber: detail.OrganisationNumber ?? null },
      method === "confirm" ? (existing?.method ?? "manual") : "manual",
      reason,
      linkedBy,
      now,
    );
    must(await fx.from("customer_links").upsert(row, { onConflict: "customer_id" }), "write link");
    return { ok: true, kind, id, number, name: detail.Name };
  }
  const crm = await crmScreen(deps.db, id);
  await assertProjectNumberFree(deps.db, number, id);
  let detail;
  try {
    detail = await getProject(deps.fortnox, number);
  } catch {
    throw new ActionError(404, `Fortnox-projekt ${number} hittades inte i testbolaget`);
  }
  const existing = must(
    await fx.from("project_links").select("reason, method").eq("product_id", id).maybeSingle(),
    "read link",
  ) as { reason: string | null; method: string } | null;
  const reason =
    method === "confirm"
      ? `Bekräftad av admin: ${existing?.reason ?? ""}`.trim()
      : `Kopplad för hand av admin till projekt ${number}`;
  const row = projectLinkFor(
    crm,
    { number, description: detail.Description },
    method === "confirm" ? (existing?.method ?? "manual") : "manual",
    reason,
    linkedBy,
    now,
  );
  must(await fx.from("project_links").upsert(row, { onConflict: "product_id" }), "write link");
  return { ok: true, kind, id, number, name: detail.Description };
}

/** Confirm the stored proposal: the candidate becomes the link. */
export async function confirm(deps: SyncDeps, kind: Kind, id: string, adminId: string) {
  const fx = deps.db.schema("fortnox");
  const table = kind === "customer" ? "customer_links" : "project_links";
  const key = kind === "customer" ? "customer_id" : "product_id";
  const link = must(
    await fx.from(table).select("status, candidate_number").eq(key, id).maybeSingle(),
    "read link",
  ) as { status: string; candidate_number: string | null } | null;
  if (!link?.candidate_number)
    throw new ActionError(400, "Det finns inget förslag att bekräfta – kör synken först");
  if (link.status === "linked") throw new ActionError(409, "Raden är redan kopplad");
  return linkTo(deps, kind, id, link.candidate_number, adminId, "confirm");
}

/** Create this one row in Fortnox now, through the same read-back as the sync. */
export async function createOne(
  deps: SyncDeps,
  kind: Kind,
  id: string,
  adminId: string,
  log: (s: string) => void,
) {
  const ctx = await loadContext(deps, log);
  const linkedBy = `admin:${adminId}`;
  if (kind === "customer") {
    const crm = await crmCustomer(deps.db, id);
    if (ctx.customerLinks.get(id)?.status === "linked")
      throw new ActionError(409, "Kunden är redan kopplad");
    const outcome = await ensureCustomerInFortnox(deps, ctx, crm, linkedBy, false, log);
    if (outcome.kind === "failed") throw new ActionError(502, outcome.error);
    return {
      ok: true,
      kind,
      id,
      outcome: outcome.kind,
      number: outcome.number,
      method: outcome.kind === "linked" ? outcome.method : "created",
    };
  }
  const crm = await crmScreen(deps.db, id);
  if (ctx.projectLinks.get(id)?.status === "linked")
    throw new ActionError(409, "Skärmen är redan kopplad");
  const outcome = await ensureProjectInFortnox(deps, ctx, crm, linkedBy, false, log);
  if (outcome.kind === "failed") throw new ActionError(502, outcome.error);
  return {
    ok: true,
    kind,
    id,
    code: extractCode(crm.name),
    outcome: outcome.kind,
    number: outcome.number,
    method: outcome.kind === "linked" ? outcome.method : "created",
  };
}
