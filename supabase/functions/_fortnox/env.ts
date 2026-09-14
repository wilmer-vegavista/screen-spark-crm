/**
 * Fortnox options from the environment, with the tenant guard applied before anything is
 * constructed. Values are read, never printed: the only thing about them that ever
 * appears in output is the tenant id, which is a company number, not a secret.
 *
 * Locally the variables come from the fortnox-agent's env file passed by path
 * (`deno run --env-file=...`) with FORTNOX_TENANT_ID overridden to 1848969 in the
 * process environment; deployed, they come from Supabase secrets.
 */
import { FortnoxCcClient, type FortnoxCcOptions } from "./client.ts";
import { assertAllowedTenant, GuardedFortnox } from "./guard.ts";

export type EnvReader = (name: string) => string | undefined;

export const denoEnv: EnvReader = (name) => Deno.env.get(name);

export function ccOptionsFromEnv(env: EnvReader = denoEnv): FortnoxCcOptions {
  const clientId = env("FORTNOX_CLIENT_ID");
  const clientSecret = env("FORTNOX_CLIENT_SECRET");
  const tenantId = env("FORTNOX_TENANT_ID");
  // The guard first: a wrong tenant refuses before a missing secret is even reported.
  const tenant = assertAllowedTenant(tenantId);
  if (!clientId || !clientSecret) {
    throw new Error("FORTNOX_CLIENT_ID / FORTNOX_CLIENT_SECRET missing in the environment.");
  }
  return { clientId, clientSecret, tenantId: String(tenant) };
}

/** True when the Fortnox credentials are present (the function answers plainly when not). */
export function hasFortnoxCredentials(env: EnvReader = denoEnv): boolean {
  return Boolean(
    env("FORTNOX_CLIENT_ID") && env("FORTNOX_CLIENT_SECRET") && env("FORTNOX_TENANT_ID"),
  );
}

/** A guarded client from the environment: the only constructor the functions use. */
export function guardedFortnoxFromEnv(
  env: EnvReader = denoEnv,
  fetchFn?: typeof fetch,
): GuardedFortnox {
  const opts = ccOptionsFromEnv(env);
  return new GuardedFortnox(new FortnoxCcClient({ ...opts, fetchFn }));
}
