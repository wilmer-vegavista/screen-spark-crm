/**
 * Reads: company information, customers, projects, articles. All list reads walk every
 * page (paging.ts) and throw rather than return a truncated list.
 *
 * Fortnox list endpoints return summaries; `Comments` (where the {VV <id>} marker lives)
 * is only on the full record, so there is a per-number GET for that.
 *
 * `lastmodified` is Fortnox's incremental parameter: "all records since this timestamp",
 * format `YYYY-MM-DD HH:mm`, interpreted in Swedish local time. The cursor is widened by
 * ten minutes so a clock or timezone wobble cannot hide a change; re-reading a row that
 * did not change is harmless.
 */
import type { GuardedFortnox } from "./guard.ts";
import { getAllWithMeta, type CollectionRead } from "./paging.ts";
import { str } from "./numbers.ts";

export interface CustomerSummary {
  CustomerNumber: string;
  Name: string;
  OrganisationNumber?: string;
  Email?: string;
  Address1?: string;
  ZipCode?: string;
  City?: string;
  Phone?: string;
}

export interface CustomerDetail extends CustomerSummary {
  Comments?: string;
  Active?: boolean;
  Type?: string;
  VATNumber?: string;
  EmailInvoice?: string;
  YourReference?: string;
}

export interface ProjectSummary {
  ProjectNumber: string;
  Description: string;
  Status?: string;
  StartDate?: string;
  EndDate?: string;
  ProjectLeader?: string;
}

export interface ProjectDetail extends ProjectSummary {
  Comments?: string;
  ContactPerson?: string;
}

export interface ArticleSummary {
  ArticleNumber: string;
  Description: string;
  Active?: boolean;
  SalesPrice?: number | string;
  Unit?: string;
}

/** `YYYY-MM-DD HH:mm` in Europe/Stockholm, as Fortnox's lastmodified expects. */
export function formatLastmodified(d: Date): string {
  const parts = new Intl.DateTimeFormat("sv-SE", {
    timeZone: "Europe/Stockholm",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(d);
  const p = (t: string) => parts.find((x) => x.type === t)?.value ?? "";
  return `${p("year")}-${p("month")}-${p("day")} ${p("hour")}:${p("minute")}`;
}

const LASTMODIFIED_OVERLAP_MS = 10 * 60 * 1000;

function sincePath(base: string, since: Date | undefined): { path: string; filtered: boolean } {
  if (!since) return { path: base, filtered: false };
  const widened = new Date(since.getTime() - LASTMODIFIED_OVERLAP_MS);
  return {
    path: `${base}?lastmodified=${encodeURIComponent(formatLastmodified(widened))}`,
    filtered: true,
  };
}

export interface ListResult<T> {
  rows: T[];
  read: CollectionRead;
}

/** All customers (or those changed since `since`). Numbers are strings, as Fortnox sends them. */
export async function listCustomers(
  g: GuardedFortnox,
  since?: Date,
): Promise<ListResult<CustomerSummary>> {
  const { path, filtered } = sincePath("/customers", since);
  const { rows, read } = await getAllWithMeta<CustomerSummary>(g, path, "Customers", {
    exactTotal: !filtered,
  });
  return { rows: rows.map(normalizeCustomer), read };
}

export async function getCustomer(
  g: GuardedFortnox,
  customerNumber: string,
): Promise<CustomerDetail> {
  const res = await g.get<{ Customer?: CustomerDetail }>(
    `/customers/${encodeURIComponent(customerNumber)}`,
  );
  if (!res?.Customer)
    throw new Error(`GET /customers/${customerNumber} returned no Customer object.`);
  return normalizeCustomer(res.Customer) as CustomerDetail;
}

export async function listProjects(
  g: GuardedFortnox,
  since?: Date,
): Promise<ListResult<ProjectSummary>> {
  const { path, filtered } = sincePath("/projects", since);
  const { rows, read } = await getAllWithMeta<ProjectSummary>(g, path, "Projects", {
    exactTotal: !filtered,
  });
  return { rows: rows.map(normalizeProject), read };
}

export async function getProject(g: GuardedFortnox, projectNumber: string): Promise<ProjectDetail> {
  const res = await g.get<{ Project?: ProjectDetail }>(
    `/projects/${encodeURIComponent(projectNumber)}`,
  );
  if (!res?.Project) throw new Error(`GET /projects/${projectNumber} returned no Project object.`);
  return normalizeProject(res.Project) as ProjectDetail;
}

export async function listArticles(g: GuardedFortnox): Promise<ListResult<ArticleSummary>> {
  const { rows, read } = await getAllWithMeta<ArticleSummary>(g, "/articles", "Articles", {
    exactTotal: true,
  });
  return {
    rows: rows.map((a) => ({
      ...a,
      ArticleNumber: str(a.ArticleNumber),
      Description: str(a.Description),
    })),
    read,
  };
}

function normalizeCustomer<T extends CustomerSummary>(c: T): T {
  return { ...c, CustomerNumber: str(c.CustomerNumber), Name: str(c.Name) };
}

function normalizeProject<T extends ProjectSummary>(p: T): T {
  return { ...p, ProjectNumber: str(p.ProjectNumber), Description: str(p.Description) };
}
