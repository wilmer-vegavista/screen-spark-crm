/**
 * Creates: a customer and a project. Both go through `GuardedFortnox.write`, so the
 * DatabaseNumber check runs before the first one of every run.
 *
 * Idempotency marker: every record the sync creates carries `{VV <crm uuid>}` in its
 * Comments field — the fortnox-agent's `{AGENT key}` pattern. Before any create, the
 * sync reads the markers of the Fortnox rows that have no link yet; a marker that
 * matches is linked instead of created. Together with the link tables (a linked row is
 * never created again) that is what makes a second "Synka nu" create nothing.
 */
import type { GuardedFortnox } from "./guard.ts";
import { str } from "./numbers.ts";

const MARKER_RE = /\{VV\s+([0-9a-fA-F-]{36})\}/;

export function markerFor(crmId: string): string {
  return `{VV ${crmId}}`;
}

/** The CRM id carried by a Fortnox Comments field, or null. */
export function markerIn(text: string | null | undefined): string | null {
  const m = MARKER_RE.exec(text ?? "");
  return m ? m[1].toLowerCase() : null;
}

export interface NewCustomer {
  /** The CRM row this record is created for; null only for hand-made seed rows (no marker). */
  crmId: string | null;
  /** Comments text when there is no marker; ignored when crmId is set. */
  comments?: string;
  name: string;
  organisationNumber?: string | null;
  email?: string | null;
  emailInvoice?: string | null;
  address1?: string | null;
  zipCode?: string | null;
  city?: string | null;
  vatNumber?: string | null;
  yourReference?: string | null;
}

export interface CreatedCustomer {
  customerNumber: string;
  name: string;
}

const clean = (v: string | null | undefined, max: number): string | undefined => {
  const s = (v ?? "").trim();
  return s ? s.slice(0, max) : undefined;
};

/** Fortnox v3 request body for a new customer. Pure, so tests can check the shape. */
export function customerPayload(c: NewCustomer) {
  return {
    Customer: {
      Name: clean(c.name, 1024) ?? "(namn saknas)",
      Type: "COMPANY",
      OrganisationNumber: clean(c.organisationNumber, 30),
      Email: clean(c.email, 1024),
      EmailInvoice: clean(c.emailInvoice, 1024),
      Address1: clean(c.address1, 1024),
      ZipCode: clean(c.zipCode, 10),
      City: clean(c.city, 1024),
      VATNumber: clean(c.vatNumber, 30),
      YourReference: clean(c.yourReference, 50),
      Comments: c.crmId ? markerFor(c.crmId) : clean(c.comments, 1024),
    },
  };
}

export async function createCustomer(g: GuardedFortnox, c: NewCustomer): Promise<CreatedCustomer> {
  const res = await g.write<{ Customer?: { CustomerNumber?: string | number; Name?: string } }>(
    "POST",
    "/customers",
    customerPayload(c),
  );
  const number = str(res?.Customer?.CustomerNumber);
  if (!number)
    throw new Error(
      `Fortnox created a customer but returned no CustomerNumber: ${JSON.stringify(res)}`,
    );
  return { customerNumber: number, name: str(res?.Customer?.Name) };
}

export interface NewProject {
  /** The CRM row this record is created for; null only for hand-made seed rows (no marker). */
  crmId: string | null;
  comments?: string;
  description: string;
  /** The four-digit code from the screen name, when there is one; otherwise Fortnox numbers it. */
  projectNumber?: string | null;
  startDate?: string | null;
}

export interface CreatedProject {
  projectNumber: string;
  description: string;
}

export function projectPayload(p: NewProject) {
  return {
    Project: {
      ProjectNumber: clean(p.projectNumber, 50),
      Description: clean(p.description, 100) ?? "(namn saknas)",
      Status: "ONGOING",
      StartDate: clean(p.startDate, 10),
      Comments: p.crmId ? markerFor(p.crmId) : clean(p.comments, 1024),
    },
  };
}

export async function createProject(g: GuardedFortnox, p: NewProject): Promise<CreatedProject> {
  const res = await g.write<{
    Project?: { ProjectNumber?: string | number; Description?: string };
  }>("POST", "/projects", projectPayload(p));
  const number = str(res?.Project?.ProjectNumber);
  if (!number)
    throw new Error(
      `Fortnox created a project but returned no ProjectNumber: ${JSON.stringify(res)}`,
    );
  return { projectNumber: number, description: str(res?.Project?.Description) };
}
