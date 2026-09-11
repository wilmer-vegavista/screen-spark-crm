/**
 * The pagination walk, ported from the fortnox-agent's `reads.ts`.
 *
 * Fortnox serves 100 rows per page unless asked for more (documented maximum 500) and
 * reports the true total in MetaInformation. A single unpaginated GET silently truncates,
 * and for a matcher a truncated customer list means confident, wrong "no candidate"
 * proposals — which is exactly how a duplicate customer gets created. So the walk
 * requires complete metadata on every page, checks that each page is the one asked for,
 * checks the row count against the reported total, and throws rather than return a
 * list it cannot prove complete.
 */
import { FortnoxReadError } from "./errors.ts";

/** Anything that can GET a Fortnox path — the guarded client, or a fake in tests. */
export interface Getter {
  get<T>(path: string): Promise<T>;
}

interface MetaInformation {
  "@CurrentPage"?: number;
  "@TotalPages"?: number;
  "@TotalResources"?: number;
}

type Collection = Record<string, unknown> & { MetaInformation?: MetaInformation };

export const MAX_PAGE_LIMIT = 500;

export interface WalkOptions {
  /** Page size to request, 1–500. Default 500: fewer request boundaries for a mutation to hide in. */
  limit?: number;
  /** Ceiling on pages, so an inconsistent page count fails a run instead of hanging it. */
  maxPages?: number;
  /**
   * Refuse a read whose row count differs from @TotalResources in EITHER direction.
   * Right for an unfiltered list; wrong for a filtered one, where Fortnox over-reports
   * the total (a short read is always refused, filtered or not).
   */
  exactTotal?: boolean;
}

export interface CollectionRead {
  endpoint: string;
  pages: number;
  reportedTotal: number | null;
  rowsRead: number;
}

export async function getAllWithMeta<T>(
  api: Getter,
  path: string,
  collectionKey: string,
  options: WalkOptions = {},
): Promise<{ rows: T[]; read: CollectionRead }> {
  const limit = options.limit ?? MAX_PAGE_LIMIT;
  const maxPages = options.maxPages ?? 200;
  if (!Number.isInteger(limit) || limit < 1 || limit > MAX_PAGE_LIMIT) {
    throw new FortnoxReadError(
      `Page limit ${limit} is outside Fortnox's documented 1–${MAX_PAGE_LIMIT} range. Refusing to send it.`,
    );
  }
  const out: T[] = [];
  let page = 1;
  let totalPages = 1;
  let expectedTotal: number | undefined;
  do {
    const sep = path.includes("?") ? "&" : "?";
    const res = (await api.get<Collection>(`${path}${sep}page=${page}&limit=${limit}`)) ?? {};

    const rows = res[collectionKey];
    if (rows === undefined) {
      throw new FortnoxReadError(
        `${path} returned no "${collectionKey}" collection (keys: ${Object.keys(res).join(", ") || "none"}). ` +
          'An empty result here is indistinguishable from "the company has no such records", so this is an error rather than [].',
      );
    }
    if (!Array.isArray(rows)) {
      throw new FortnoxReadError(`${path}: "${collectionKey}" is ${typeof rows}, not an array.`);
    }
    out.push(...(rows as T[]));

    const meta = res.MetaInformation;
    const missing = (["@TotalPages", "@TotalResources", "@CurrentPage"] as const).filter(
      (k) => meta?.[k] === undefined,
    );
    if (missing.length) {
      throw new FortnoxReadError(
        `${path} page ${page} carries incomplete pagination metadata (missing ${missing.join(", ")}). ` +
          "Refusing to guess whether the list is complete.",
      );
    }
    if (meta!["@CurrentPage"] !== page) {
      throw new FortnoxReadError(
        `${path}: asked for page ${page}, got page ${meta!["@CurrentPage"]}. The walk did not advance, ` +
          "so the collection is being re-served or shifted.",
      );
    }
    totalPages = meta!["@TotalPages"]!;
    expectedTotal ??= meta!["@TotalResources"];
    page += 1;
  } while (page <= totalPages && page <= maxPages);

  if (totalPages > maxPages) {
    throw new FortnoxReadError(
      `${path} reports ${totalPages} pages, above the ${maxPages}-page ceiling. Refusing to read a partial collection.`,
    );
  }
  if (expectedTotal !== undefined && out.length < expectedTotal) {
    throw new FortnoxReadError(
      `${path} reported ${expectedTotal} resources but only ${out.length} were read. A short read looks like missing data downstream, not like a failure.`,
    );
  }
  if (options.exactTotal && expectedTotal !== undefined && out.length !== expectedTotal) {
    throw new FortnoxReadError(
      `${path} reported ${expectedTotal} resources but ${out.length} were read. On an unfiltered endpoint an over-read means duplicated or shifted pages.`,
    );
  }
  return {
    rows: out,
    read: {
      endpoint: path,
      pages: page - 1,
      reportedTotal: expectedTotal ?? null,
      rowsRead: out.length,
    },
  };
}

export async function getAll<T>(
  api: Getter,
  path: string,
  collectionKey: string,
  options: WalkOptions = {},
): Promise<T[]> {
  return (await getAllWithMeta<T>(api, path, collectionKey, options)).rows;
}
