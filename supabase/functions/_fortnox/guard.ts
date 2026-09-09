/**
 * The company guard. In round zero the integration may talk to exactly one Fortnox
 * company: the test company with DatabaseNumber 1848969. Nothing else.
 *
 * Why DatabaseNumber and not the organisation number: a Fortnox test company carries the
 * SAME orgnr as the live company it was created from, so an orgnr check waves a live
 * company through. DatabaseNumber (= the TenantId header) is unique per company.
 *
 * Two checks, in the order they can fail:
 *  1. `assertAllowedTenant` at startup — the tenant id from the environment must be
 *     1848969, or nothing is constructed and no request is sent.
 *  2. `GuardedFortnox.company()` before the first write of every run — GET
 *     /companyinformation must report DatabaseNumber 1848969, or the write is refused.
 * Every write goes through `GuardedFortnox.write`, which is the only code that sets the
 * client's `guardedWritePath` flag.
 *
 * There is deliberately no environment variable that widens this. Going live means
 * changing the constant in a reviewed pull request, with the Vega Vista integration's
 * own client id — not flipping a flag.
 */
import type { FortnoxApi, HttpMethod } from "./client.ts";
import { TenantGuardError } from "./errors.ts";

export const ALLOWED_DATABASE_NUMBER = 1848969;

export interface CompanyInfo {
  name: string;
  organizationNumber: string;
  databaseNumber: number | undefined;
}

interface CompanyInformationResponse {
  CompanyInformation?: {
    CompanyName?: string;
    OrganizationNumber?: string;
    DatabaseNumber?: number | string;
  };
}

/** Startup check: refuses before a single request when the tenant is not the test company. */
export function assertAllowedTenant(tenantId: string | number | undefined): number {
  const n = typeof tenantId === "number" ? tenantId : Number(String(tenantId ?? "").trim());
  if (!Number.isFinite(n) || n <= 0) {
    throw new TenantGuardError(
      "FORTNOX_TENANT_ID is not set to a number, so which company would be written to cannot be determined. Refusing rather than finding out.",
    );
  }
  if (n !== ALLOWED_DATABASE_NUMBER) {
    throw new TenantGuardError(
      `REFUSING to start: FORTNOX_TENANT_ID is ${n}, but round zero may only talk to the Fortnox test company ` +
        `(DatabaseNumber ${ALLOWED_DATABASE_NUMBER}). No request was sent.`,
    );
  }
  return n;
}

export class GuardedFortnox {
  private companyChecked: Promise<CompanyInfo> | null = null;

  constructor(
    private readonly api: FortnoxApi,
    private readonly expected: number = ALLOWED_DATABASE_NUMBER,
  ) {}

  /** Reads pass straight through; the TenantId header already pins the company. */
  get<T>(path: string): Promise<T> {
    return this.api.request<T>("GET", path);
  }

  /** A read whose answer is bytes (the SIE export). Reads only; the write flag is never set. */
  getRaw(path: string): Promise<Uint8Array> {
    return this.api.requestRaw(path);
  }

  /** The connected company, fetched once per run and checked against the constant. */
  company(): Promise<CompanyInfo> {
    this.companyChecked ??= this.fetchAndGuard();
    return this.companyChecked;
  }

  private async fetchAndGuard(): Promise<CompanyInfo> {
    const res = await this.api.request<CompanyInformationResponse>("GET", "/companyinformation");
    const raw = res.CompanyInformation?.DatabaseNumber;
    const info: CompanyInfo = {
      name: res.CompanyInformation?.CompanyName ?? "(unknown)",
      organizationNumber: res.CompanyInformation?.OrganizationNumber ?? "",
      databaseNumber: raw === undefined || raw === null ? undefined : Number(raw),
    };
    if (info.databaseNumber !== this.expected) {
      throw new TenantGuardError(
        `REFUSING to write: connected company is "${info.name}" with DatabaseNumber ` +
          `${info.databaseNumber ?? "unknown"}, not the test company ${this.expected}.`,
      );
    }
    return info;
  }

  /** A write: the company check runs first, every time, and the flag is set here only. */
  async write<T>(method: Exclude<HttpMethod, "GET">, path: string, body: unknown): Promise<T> {
    await this.company();
    return this.api.request<T>(method, path, body, { guardedWritePath: true });
  }
}
