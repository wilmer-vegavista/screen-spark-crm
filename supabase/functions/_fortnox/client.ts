/**
 * Fortnox API v3 over the client-credentials (service account) flow. Ported from the
 * fortnox-agent's `src/fortnox/cc-client.ts` (live there since 2026-08-06) to plain web
 * APIs so it runs in a Supabase edge function and under `deno test` alike.
 *
 * What it does: mints an access token with client id + secret and the `TenantId` header
 * (the header is what selects the company), caches it in memory, re-mints on expiry,
 * retries exactly once on 401, backs off once on 429 honouring Retry-After (capped at 30 s).
 *
 * What it refuses: any non-GET request that does not carry `guardedWritePath` — the flag
 * only `GuardedFortnox` in guard.ts sets, after the company check. There is no other way
 * to write through this client.
 */
import { FortnoxApiError, TenantGuardError } from "./errors.ts";
import { redact } from "./redact.ts";

export const FORTNOX_API_BASE = "https://api.fortnox.se/3";
export const FORTNOX_TOKEN_URL = "https://apps.fortnox.se/oauth-v1/token";

export type HttpMethod = "GET" | "POST" | "PUT";

export interface RequestOpts {
  /** Set only by GuardedFortnox.write after the DatabaseNumber check. */
  guardedWritePath?: boolean;
}

/** The narrow contract the read layer, the guard and the tests depend on. */
export interface FortnoxApi {
  request<T>(method: HttpMethod, path: string, body?: unknown, opts?: RequestOpts): Promise<T>;
  // Round two: a GET whose answer is bytes, not JSON — the SIE export. Fortnox refuses the
  // Accept header that describes the payload (application/octet-stream → 400 "Invalid
  // response type"), so this sends the wildcard Accept (verified live in the fortnox-agent,
  // 2026-08-06).
  requestRaw(path: string): Promise<Uint8Array>;
}

export interface FortnoxCcOptions {
  clientId: string;
  clientSecret: string;
  /** Fortnox DatabaseNumber of the target company, as a string for the header. */
  tenantId: string;
  fetchFn?: typeof fetch;
  now?: () => number;
  /** Injected in tests so a 429 back-off does not really wait. */
  sleep?: (ms: number) => Promise<void>;
}

interface TokenResponse {
  access_token?: string;
  expires_in?: number;
}

const decode = (bytes: Uint8Array): string => new TextDecoder().decode(bytes);

/** Fortnox's error envelope, in either casing it uses. */
interface ErrorEnvelope {
  ErrorInformation?: { Code?: number; code?: number; Message?: string; message?: string };
}

export class FortnoxCcClient implements FortnoxApi {
  private readonly fetchFn: typeof fetch;
  private readonly now: () => number;
  private readonly sleep: (ms: number) => Promise<void>;
  private token: { value: string; expiresAt: number } | null = null;
  private minting: Promise<{ value: string; expiresAt: number }> | null = null;

  constructor(private readonly opts: FortnoxCcOptions) {
    this.fetchFn = opts.fetchFn ?? fetch;
    this.now = opts.now ?? Date.now;
    this.sleep = opts.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms)));
  }

  get tenantId(): string {
    return this.opts.tenantId;
  }

  private async accessToken(): Promise<string> {
    if (this.token && this.token.expiresAt > this.now()) return this.token.value;
    // Serialize concurrent mints so a burst of parallel reads does not hammer the
    // token endpoint with identical requests.
    this.minting ??= this.mint().then(
      (t) => {
        this.token = t;
        this.minting = null;
        return t;
      },
      (e) => {
        this.minting = null;
        throw e;
      },
    );
    return (await this.minting).value;
  }

  private async mint(): Promise<{ value: string; expiresAt: number }> {
    const basic = btoa(`${this.opts.clientId}:${this.opts.clientSecret}`);
    const res = await this.fetchFn(FORTNOX_TOKEN_URL, {
      method: "POST",
      headers: {
        Authorization: `Basic ${basic}`,
        TenantId: this.opts.tenantId,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: "grant_type=client_credentials",
    });
    const text = await res.text();
    if (!res.ok) {
      // The body can echo the request; never let it reach a log with the secret in it.
      throw new FortnoxApiError(
        res.status,
        undefined,
        `Fortnox token endpoint ${res.status} for tenant ${this.opts.tenantId}: ${redact(text)}`,
      );
    }
    const json = JSON.parse(text) as TokenResponse;
    if (!json.access_token) {
      throw new FortnoxApiError(res.status, undefined, "Fortnox returned no access_token.");
    }
    // Expire 60 s early so a token cannot lapse mid-request.
    return {
      value: json.access_token,
      expiresAt: this.now() + ((json.expires_in ?? 3600) - 60) * 1000,
    };
  }

  async request<T>(
    method: HttpMethod,
    path: string,
    body?: unknown,
    opts?: RequestOpts,
  ): Promise<T> {
    if (method !== "GET" && !opts?.guardedWritePath) {
      throw new TenantGuardError(
        `REFUSING ${method} ${path}: writes must go through GuardedFortnox.write, where the ` +
          "DatabaseNumber check runs first. The general request path has no way around it.",
      );
    }
    const attempt = async (): Promise<Response> => {
      const token = await this.accessToken();
      return this.fetchFn(`${FORTNOX_API_BASE}${path}`, {
        method,
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: "application/json",
          ...(body !== undefined ? { "Content-Type": "application/json" } : {}),
        },
        ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
      });
    };

    let res = await attempt();
    if (res.status === 401) {
      // Token rejected mid-run (revoked consent, clock skew). Drop the cache and try
      // exactly once more: a stale token self-heals, a real authorization failure surfaces.
      this.token = null;
      res = await attempt();
    }
    if (res.status === 429) {
      const raw = Number(res.headers.get("retry-after") ?? "5");
      const wait = Math.min(Number.isFinite(raw) && raw > 0 ? raw : 5, 30);
      await this.sleep(wait * 1000);
      res = await attempt();
    }

    const bytes = new Uint8Array(await res.arrayBuffer());
    if (!res.ok) {
      const text = decode(bytes);
      let code: number | undefined;
      let message = `${method} ${path} → ${res.status}`;
      try {
        const err = (JSON.parse(text) as ErrorEnvelope).ErrorInformation;
        code = err?.Code ?? err?.code;
        message += `: ${err?.Message ?? err?.message ?? text}`;
      } catch {
        message += `: ${text.slice(0, 300)}`;
      }
      throw new FortnoxApiError(res.status, code, redact(message));
    }

    if (!bytes.length) return undefined as T;
    const text = decode(bytes);
    try {
      return JSON.parse(text) as T;
    } catch {
      return text as unknown as T;
    }
  }

  async requestRaw(path: string): Promise<Uint8Array> {
    const attempt = async (): Promise<Response> => {
      const token = await this.accessToken();
      return this.fetchFn(`${FORTNOX_API_BASE}${path}`, {
        method: "GET",
        headers: { Authorization: `Bearer ${token}`, Accept: "*/*" },
      });
    };
    let res = await attempt();
    if (res.status === 401) {
      this.token = null;
      res = await attempt();
    }
    if (res.status === 429) {
      const raw = Number(res.headers.get("retry-after") ?? "5");
      const wait = Math.min(Number.isFinite(raw) && raw > 0 ? raw : 5, 30);
      await this.sleep(wait * 1000);
      res = await attempt();
    }
    const bytes = new Uint8Array(await res.arrayBuffer());
    if (!res.ok) {
      const text = decode(bytes);
      let code: number | undefined;
      let message = `GET ${path} → ${res.status}`;
      try {
        const err = (JSON.parse(text) as ErrorEnvelope).ErrorInformation;
        code = err?.Code ?? err?.code;
        message += `: ${err?.Message ?? err?.message ?? text}`;
      } catch {
        message += `: ${text.slice(0, 300)}`;
      }
      throw new FortnoxApiError(res.status, code, redact(message));
    }
    return bytes;
  }
}
