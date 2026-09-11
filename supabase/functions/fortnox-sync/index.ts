/**
 * fortnox-sync — the one HTTP entry point for the Fortnox integration (round zero).
 *
 * Callers:
 *   - the Fortnox-koppling page, with the admin's Supabase JWT (checked here, server-side:
 *     a valid session AND the admin role, via public.has_role);
 *   - the hourly pg_cron job, with the x-fortnox-cron-token header (a random token that
 *     lives in Supabase Vault, verified by fortnox.verify_cron_token). Cron may only sync.
 *
 * Body: { action: "status" | "sync" | "propose" | "confirm" | "link" | "create" | "candidates", ... }
 * Round one adds: "order_candidates" | "invoice_link" | "invoice_ignore" | "invoice_reset" |
 * "feed_rotate" | "feed_revoke" — database-only, none of them touches Fortnox.
 * Round two adds the cash-flow page's edits: "cashflow_plan_set_row" | "cashflow_plan_set_month" |
 * "cashflow_opening_set" | "cashflow_rule_save" | "cashflow_rule_delete" | "account_map_save" |
 * "account_map_delete" | "cashflow_setting_set" — database-only too.
 *
 * Runs unchanged in two places: deployed as a Supabase edge function, and locally with
 * `deno run --env-file=<fortnox-agent .env> index.ts` (scripts/fortnox-dev.ps1 serve),
 * which is how round zero reaches Fortnox before any secret is set on a project.
 *
 * Without Fortnox credentials in the environment the function answers plainly
 * (503, fortnox-not-configured) and writes no run — so an hourly cron on a project
 * without secrets is inert, not noisy.
 */
import { createClient } from "npm:@supabase/supabase-js@2.108.1";
import {
  guardedFortnoxFromEnv,
  hasFortnoxCredentials,
  redact,
  TenantGuardError,
  writesEnabled,
} from "../_fortnox/mod.ts";
import { runSync, type SyncDeps } from "./sync.ts";
import {
  ActionError,
  candidates,
  confirm,
  createOne,
  type Kind,
  linkTo,
  status,
} from "./actions.ts";
import {
  feedRevoke,
  feedRotate,
  invoiceIgnore,
  invoiceLink,
  invoiceReset,
  orderCandidates,
} from "./invoice-actions.ts";
import {
  accountMapDelete,
  accountMapSave,
  openingSet,
  planSetMonth,
  planSetRow,
  ruleDelete,
  ruleSave,
  settingSet,
} from "./cashflow-actions.ts";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-fortnox-cron-token",
  "Access-Control-Allow-Methods": "POST, GET, OPTIONS",
};

const json = (statusCode: number, body: unknown) =>
  new Response(JSON.stringify(body), {
    status: statusCode,
    headers: { ...CORS, "content-type": "application/json" },
  });

type Actor = { kind: "cron" } | { kind: "admin"; userId: string };

function env(name: string): string {
  const v = Deno.env.get(name);
  if (!v) throw new Error(`${name} is not set`);
  return v;
}

const kindOf = (v: unknown): Kind => {
  if (v === "customer" || v === "screen") return v;
  throw new ActionError(400, 'kind måste vara "customer" eller "screen"');
};
const idOf = (v: unknown): string => {
  if (typeof v === "string" && /^[0-9a-f-]{36}$/i.test(v)) return v;
  throw new ActionError(400, "id saknas eller är inte ett uuid");
};

export async function handle(req: Request): Promise<Response> {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  try {
    const url = env("SUPABASE_URL");
    const db = createClient(url, env("SUPABASE_SERVICE_ROLE_KEY"), {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const body: Record<string, unknown> =
      req.method === "POST"
        ? await req.json().catch(() => ({}))
        : Object.fromEntries(new URL(req.url).searchParams);

    // ---- who is calling
    let actor: Actor;
    const cronToken = req.headers.get("x-fortnox-cron-token");
    if (cronToken) {
      const { data, error } = await db
        .schema("fortnox")
        .rpc("verify_cron_token", { p_token: cronToken });
      if (error || data !== true) return json(401, { error: "Ogiltig cron-token" });
      actor = { kind: "cron" };
    } else {
      const token = (req.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "").trim();
      if (!token) return json(401, { error: "Ingen inloggning skickades med" });
      const anon = createClient(url, env("SUPABASE_ANON_KEY"), {
        auth: { persistSession: false, autoRefreshToken: false },
      });
      const { data: userRes, error: userErr } = await anon.auth.getUser(token);
      if (userErr || !userRes?.user) return json(401, { error: "Inloggningen är inte giltig" });
      const { data: isAdmin, error: roleErr } = await db.rpc("has_role", {
        _user_id: userRes.user.id,
        _role: "admin",
      });
      if (roleErr) throw new Error(`has_role: ${roleErr.message}`);
      if (isAdmin !== true)
        return json(403, { error: "Endast administratörer kan använda Fortnox-kopplingen" });
      actor = { kind: "admin", userId: userRes.user.id };
    }

    const action = actor.kind === "cron" ? "sync" : String(body.action ?? "status");
    const fortnoxConfigured = hasFortnoxCredentials();
    const claudeConfigured = Boolean(Deno.env.get("ANTHROPIC_API_KEY"));
    const lines: string[] = [];
    const log = (s: string) => {
      lines.push(s);
      console.log(s);
    };
    const deps = (): SyncDeps => {
      if (!fortnoxConfigured)
        throw new ActionError(
          503,
          "Fortnox-uppgifter är inte konfigurerade i den här miljön (fortnox-not-configured)",
        );
      return {
        db,
        fortnox: guardedFortnoxFromEnv(),
        anthropicApiKey: Deno.env.get("ANTHROPIC_API_KEY") || undefined,
        anthropicModel: Deno.env.get("ANTHROPIC_MODEL") || undefined,
        log,
      };
    };

    // Asked of Fortnox once per status read (one GET /settings/company), next to the database
    // reads: no credentials, a tenant the startup guard refuses, or a failed read all answer
    // false, and the page still renders.
    const writesCheck = (): Promise<boolean> => {
      if (!fortnoxConfigured) return Promise.resolve(false);
      try {
        return writesEnabled(guardedFortnoxFromEnv());
      } catch {
        return Promise.resolve(false);
      }
    };

    switch (action) {
      case "status": {
        const [writes, s] = await Promise.all([
          writesCheck(),
          status(db, { fortnoxConfigured, claudeConfigured, functionUrl: null }),
        ]);
        // writesEnabled: the connected company is WRITE_TENANT; false turns "Skapa i Fortnox" off on the page.
        return json(200, { ...s, writesEnabled: writes });
      }
      case "sync": {
        if (!fortnoxConfigured) {
          console.log(`sync skipped (${actor.kind}): fortnox-not-configured`);
          return json(503, {
            ok: false,
            skipped: "fortnox-not-configured",
            message: "Fortnox-uppgifter är inte konfigurerade i den här miljön",
          });
        }
        const summary = await runSync(deps(), {
          triggeredBy: actor.kind === "cron" ? "cron" : "manual",
          dryRun: body.dryRun === true,
        });
        return json(summary.status === "ok" ? 200 : 500, summary);
      }
      case "propose": {
        const summary = await runSync(deps(), {
          triggeredBy: "manual",
          createMissing: false,
          dryRun: body.dryRun === true,
        });
        return json(summary.status === "ok" ? 200 : 500, summary);
      }
      case "confirm":
        return json(
          200,
          await confirm(
            deps(),
            kindOf(body.kind),
            idOf(body.id),
            (actor as { userId: string }).userId,
          ),
        );
      case "link":
        if (typeof body.number !== "string" || !body.number.trim())
          throw new ActionError(400, "number saknas");
        return json(
          200,
          await linkTo(
            deps(),
            kindOf(body.kind),
            idOf(body.id),
            body.number.trim(),
            (actor as { userId: string }).userId,
            "manual",
          ),
        );
      case "create":
        return json(200, {
          ...(await createOne(
            deps(),
            kindOf(body.kind),
            idOf(body.id),
            (actor as { userId: string }).userId,
            log,
          )),
          log: lines,
        });
      case "candidates":
        return json(200, await candidates(deps().fortnox));
      // ---- round one (database only; Fortnox credentials not needed)
      case "order_candidates":
        return json(200, { orders: await orderCandidates(db) });
      case "invoice_link":
        return json(
          200,
          await invoiceLink(db, body.documentNumber, body.orderId, (actor as { userId: string }).userId),
        );
      case "invoice_ignore":
        return json(200, await invoiceIgnore(db, body.documentNumber, (actor as { userId: string }).userId));
      case "invoice_reset":
        return json(200, await invoiceReset(db, body.documentNumber));
      case "feed_rotate":
        return json(200, await feedRotate(db, `${url}/functions/v1/fortnox-ledger-feed`));
      case "feed_revoke":
        return json(200, await feedRevoke(db));
      // ---- round two (database only)
      case "cashflow_plan_set_row":
        return json(200, await planSetRow(db, body, (actor as { userId: string }).userId));
      case "cashflow_plan_set_month":
        return json(200, await planSetMonth(db, body, (actor as { userId: string }).userId));
      case "cashflow_opening_set":
        return json(200, await openingSet(db, body, (actor as { userId: string }).userId));
      case "cashflow_rule_save":
        return json(200, await ruleSave(db, body, (actor as { userId: string }).userId));
      case "cashflow_rule_delete":
        return json(200, await ruleDelete(db, body));
      case "account_map_save":
        return json(200, await accountMapSave(db, body, (actor as { userId: string }).userId));
      case "account_map_delete":
        return json(200, await accountMapDelete(db, body));
      case "cashflow_setting_set":
        return json(200, await settingSet(db, body));
      default:
        return json(400, { error: `Okänd action: ${action}` });
    }
  } catch (e) {
    const err = e as Error;
    if (err instanceof ActionError) return json(err.status, { error: err.message });
    if (err instanceof TenantGuardError) return json(403, { error: err.message });
    console.error(redact(err.stack ?? err.message));
    return json(500, { error: redact(err.message ?? String(err)) });
  }
}

// Locally the port follows PORT (default 8000) so two checkouts can serve side by side; deployed, the runtime ignores it.
Deno.serve({ port: Number(Deno.env.get("PORT") ?? 8000) }, handle);
