/**
 * The company guard. One constant used to answer two different questions — which company
 * the integration may talk to at all, and which company it may write to — and moving it to
 * Vega Vista's DatabaseNumber to enable reads would have simultaneously authorised writes
 * against their live books: Fortnox grants read and write together as one scope set, so
 * their consent does not restrain us. The constant is split so the two questions have two
 * answers.
 *
 * Why DatabaseNumber and not the organisation number: a Fortnox test company carries the
 * SAME orgnr as the live company it was created from, so an orgnr check waves a live
 * company through. DatabaseNumber (= the TenantId header) is unique per company.
 *
 * Two checks, in the order they can fail:
 *  1. `assertAllowedTenant` at startup — the tenant id from the environment must be in
 *     `READ_TENANTS`, or nothing is constructed and no request is sent.
 *  2. `assertWriteTenant` before every write — GET /settings/company (fetched once per run
 *     by `company()`, which only identifies and never refuses) must report `WRITE_TENANT`'s
 *     DatabaseNumber, or the write is refused. A tenant can be in `READ_TENANTS` and still
 *     fail this check; that is exactly Vega Vista's posture until go-live.
 * Every write goes through `GuardedFortnox.write`, which is the only code that sets the
 * client's `guardedWritePath` flag.
 *
 * There is deliberately no environment variable that widens either constant. Going live
 * means adding Vega Vista's DatabaseNumber to `READ_TENANTS` in a reviewed pull request,
 * with their own client id — not flipping a flag. `WRITE_TENANT` is a scalar, not a list,
 * on purpose: nothing adds a second entry, so "add another" is a visible type change and
 * not a list append.
 */
import type { FortnoxApi, HttpMethod } from "./client.ts";
import { TenantGuardError } from "./errors.ts";

/** DatabaseNumbers the integration may talk to at all. 1848969 is the fortnox-agent's test
 * company; 1571636 is Vega Vista, consented by Filip 10 Sept 2026 — read only, because
 * WRITE_TENANT below still names the test company. */
export const READ_TENANTS: readonly number[] = [1848969, 1571636];

/** The single DatabaseNumber the integration may write to. Never a second entry. */
export const WRITE_TENANT = 1848969;

export interface CompanyInfo {
  name: string;
  organizationNumber: string;
  databaseNumber: number | undefined;
}

/** GET /settings/company. It sits under the `settings` scope, which every consent in this
 * integration carries; /companyinformation needs a scope of its own that Vega Vista's
 * consent (10 Sept 2026) does not include. */
interface CompanySettingsResponse {
  CompanySettings?: {
    Name?: string;
    OrganizationNumber?: string;
    DatabaseNumber?: number | string;
  };
}

/** Startup check: refuses before a single request when the tenant is not in READ_TENANTS. */
export function assertAllowedTenant(tenantId: string | number | undefined): number {
  const n = typeof tenantId === "number" ? tenantId : Number(String(tenantId ?? "").trim());
  if (!Number.isFinite(n) || n <= 0) {
    throw new TenantGuardError(
      "FORTNOX_TENANT_ID is not set to a number, so which company would be written to cannot be determined. Refusing rather than finding out.",
    );
  }
  if (!READ_TENANTS.includes(n)) {
    throw new TenantGuardError(
      `REFUSING to start: FORTNOX_TENANT_ID is ${n}, which is not in READ_TENANTS ` +
        `(${READ_TENANTS.join(", ")}). No request was sent.`,
    );
  }
  return n;
}

export class GuardedFortnox {
  private companyChecked: Promise<CompanyInfo> | null = null;

  constructor(
    private readonly api: FortnoxApi,
    private readonly writeTenant: number = WRITE_TENANT,
  ) {}

  /** Reads pass straight through; the TenantId header already pins the company. */
  get<T>(path: string): Promise<T> {
    return this.api.request<T>("GET", path);
  }

  /** A read whose answer is bytes (the SIE export). Reads only; the write flag is never set. */
  getRaw(path: string): Promise<Uint8Array> {
    return this.api.requestRaw(path);
  }

  /** The connected company, fetched once per run. Identification only — a read-only tenant
   * (Vega Vista) must be able to say who it is without being refused. The refusal lives in
   * `assertWriteTenant`, which every write runs first. */
  company(): Promise<CompanyInfo> {
    this.companyChecked ??= this.fetchCompany();
    return this.companyChecked;
  }

  private async fetchCompany(): Promise<CompanyInfo> {
    const res = await this.api.request<CompanySettingsResponse>("GET", "/settings/company");
    const raw = res.CompanySettings?.DatabaseNumber;
    return {
      name: res.CompanySettings?.Name ?? "(unknown)",
      organizationNumber: res.CompanySettings?.OrganizationNumber ?? "",
      databaseNumber: raw === undefined || raw === null ? undefined : Number(raw),
    };
  }

  /** The write check: the connected company must be `WRITE_TENANT` AND the instance's own
   * write tenant (an override can only narrow, never widen). Memoised through `company()`,
   * so a refused run asks Fortnox once. */
  private async assertWriteTenant(): Promise<CompanyInfo> {
    const info = await this.company();
    if (
      info.databaseNumber !== WRITE_TENANT ||
      info.databaseNumber !== this.writeTenant
    ) {
      throw new TenantGuardError(
        `REFUSING to write: connected company is "${info.name}" with DatabaseNumber ` +
          `${
            info.databaseNumber ?? "unknown"
          }. Writes are locked to the test company ` +
          `${this.writeTenant}; this connection may only read.`,
      );
    }
    return info;
  }

  /** A write: the company check runs first, every time, and the flag is set here only. */
  async write<T>(
    method: Exclude<HttpMethod, "GET">,
    path: string,
    body: unknown,
  ): Promise<T> {
    await this.assertWriteTenant();
    return this.api.request<T>(method, path, body, { guardedWritePath: true });
  }
}
