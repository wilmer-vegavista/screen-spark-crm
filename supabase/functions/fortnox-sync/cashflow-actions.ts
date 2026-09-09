/**
 * Round two's page actions — the cash-flow page's edits. All database-only, none touches
 * Fortnox; every row written carries who (admin:<uuid>) and when.
 *
 *   cashflow_plan_set_row     { rowKey, amount }         the row's monthly amount (source manual); amount null → back to the sync's prefill
 *   cashflow_plan_set_month   { rowKey, month, amount }  one month's own figure; amount null → clears the override
 *   cashflow_opening_set      { fyFrom, amount }         manual "Kassa årets ingång" for a fiscal year (null → the ledger's)
 *   cashflow_rule_save        { id?, kind, matchValue, rowKey, priority, note? }
 *   cashflow_rule_delete      { id }
 *   account_map_save          { id?, account?, accountTo?, supplierMatch?, rowKey, note? }
 *   account_map_delete        { id }
 *   cashflow_setting_set      { key: vat_period | vat_lag_months | cash_accounts, value }
 *
 * A change re-renders the page without a sync: the views compute from the tables.
 */
import type { SupabaseClient } from "npm:@supabase/supabase-js@2.108.1";
import { ActionError } from "./actions.ts";

function must<T>(res: { data: T | null; error: { message: string } | null }, what: string): T {
  if (res.error) throw new Error(`${what}: ${res.error.message}`);
  return res.data as T;
}

const rowKeyOf = (v: unknown): string => {
  const s = String(v ?? "").trim();
  if (!/^[a-z_]{2,40}$/.test(s)) throw new ActionError(400, "rowKey saknas");
  return s;
};
const amountOf = (v: unknown, what = "amount"): number | null => {
  if (v === null || v === undefined || v === "") return null;
  const n = typeof v === "number" ? v : Number(String(v).replace(/\s/g, "").replace(",", "."));
  if (!Number.isFinite(n)) throw new ActionError(400, `${what} är inte ett tal`);
  return Math.round(n * 100) / 100;
};
const monthOf = (v: unknown): string => {
  const s = String(v ?? "").trim().slice(0, 10);
  if (!/^\d{4}-\d{2}-01$/.test(s)) throw new ActionError(400, "month måste vara månadens första dag (YYYY-MM-01)");
  return s;
};
const idOf = (v: unknown): number => {
  const n = Number(v);
  if (!Number.isInteger(n) || n <= 0) throw new ActionError(400, "id saknas");
  return n;
};

async function assertPlanRow(db: SupabaseClient, rowKey: string, allowOpening = false) {
  const row = must(
    await db.schema("fortnox").from("cashflow_rows").select("key, plan_enabled, label").eq("key", rowKey).maybeSingle(),
    "read cashflow_rows",
  ) as { key: string; plan_enabled: boolean; label: string } | null;
  if (!row) throw new ActionError(404, `Raden ${rowKey} finns inte`);
  if (!row.plan_enabled && !(allowOpening && rowKey === "kassa_arets_ingang"))
    throw new ActionError(400, `Raden "${row.label}" har ingen plan – den fylls från Fortnox`);
  return row;
}

export async function planSetRow(db: SupabaseClient, body: Record<string, unknown>, adminId: string) {
  const rowKey = rowKeyOf(body.rowKey);
  const row = await assertPlanRow(db, rowKey);
  const amount = amountOf(body.amount);
  const fx = db.schema("fortnox");
  if (amount === null) {
    must(await fx.from("cashflow_plan").delete().eq("row_key", rowKey), "delete cashflow_plan");
    return { ok: true, rowKey, label: row.label, amount: null, cleared: true };
  }
  must(
    await fx.from("cashflow_plan").upsert(
      { row_key: rowKey, amount, source: "manual", basis: "ändrad på sidan", updated_by: `admin:${adminId}`, updated_at: new Date().toISOString() },
      { onConflict: "row_key" },
    ),
    "write cashflow_plan",
  );
  return { ok: true, rowKey, label: row.label, amount };
}

export async function planSetMonth(db: SupabaseClient, body: Record<string, unknown>, adminId: string) {
  const rowKey = rowKeyOf(body.rowKey);
  const row = await assertPlanRow(db, rowKey);
  const month = monthOf(body.month);
  const amount = amountOf(body.amount);
  const fx = db.schema("fortnox");
  if (amount === null) {
    must(await fx.from("cashflow_plan_months").delete().eq("row_key", rowKey).eq("month", month), "delete cashflow_plan_months");
    return { ok: true, rowKey, label: row.label, month, amount: null, cleared: true };
  }
  must(
    await fx.from("cashflow_plan_months").upsert(
      { row_key: rowKey, month, amount, note: String(body.note ?? "").slice(0, 200) || null, updated_by: `admin:${adminId}`, updated_at: new Date().toISOString() },
      { onConflict: "row_key,month" },
    ),
    "write cashflow_plan_months",
  );
  return { ok: true, rowKey, label: row.label, month, amount };
}

/** Manual "Kassa årets ingång": stored as the opening row's override at the fiscal year's first day. */
export async function openingSet(db: SupabaseClient, body: Record<string, unknown>, adminId: string) {
  const fyFrom = String(body.fyFrom ?? "").slice(0, 10);
  const fx = db.schema("fortnox");
  const fy = must(await fx.from("financial_years").select("id").eq("from_date", fyFrom).maybeSingle(), "read financial_years") as { id: number } | null;
  if (!fy) throw new ActionError(404, `Inget räkenskapsår börjar ${fyFrom}`);
  const amount = amountOf(body.amount);
  if (amount === null) {
    must(await fx.from("cashflow_plan_months").delete().eq("row_key", "kassa_arets_ingang").eq("month", fyFrom), "delete opening override");
    return { ok: true, fyFrom, amount: null, cleared: true };
  }
  must(
    await fx.from("cashflow_plan_months").upsert(
      { row_key: "kassa_arets_ingang", month: fyFrom, amount, note: "manuell ingående kassa", updated_by: `admin:${adminId}`, updated_at: new Date().toISOString() },
      { onConflict: "row_key,month" },
    ),
    "write opening override",
  );
  return { ok: true, fyFrom, amount };
}

const RULE_KINDS = new Set(["seller", "project", "screen_type", "billing", "default"]);

export async function ruleSave(db: SupabaseClient, body: Record<string, unknown>, adminId: string) {
  const kind = String(body.kind ?? "").trim();
  if (!RULE_KINDS.has(kind)) throw new ActionError(400, "kind måste vara seller, project, screen_type, billing eller default");
  const matchValue = kind === "default" ? null : String(body.matchValue ?? "").trim().slice(0, 100);
  if (kind !== "default" && !matchValue) throw new ActionError(400, "matchValue saknas");
  const rowKey = rowKeyOf(body.rowKey);
  const fx = db.schema("fortnox");
  const row = must(await fx.from("cashflow_rows").select("key, income").eq("key", rowKey).maybeSingle(), "read cashflow_rows") as { key: string; income: boolean } | null;
  if (!row || !row.income) throw new ActionError(400, "En kategoriregel måste peka på en intäktsrad");
  const priority = Number(body.priority ?? 50);
  if (!Number.isInteger(priority) || priority < 1 || priority > 999) throw new ActionError(400, "priority måste vara 1–999");
  const payload = {
    kind,
    match_value: matchValue,
    row_key: rowKey,
    priority,
    source: "manual",
    note: String(body.note ?? "").slice(0, 300) || null,
    updated_by: `admin:${adminId}`,
    updated_at: new Date().toISOString(),
  };
  if (body.id !== undefined && body.id !== null && body.id !== "") {
    const id = idOf(body.id);
    must(await fx.from("revenue_rules").update(payload).eq("id", id), "update revenue_rules");
    return { ok: true, id };
  }
  const inserted = must(await fx.from("revenue_rules").insert(payload).select("id").single(), "insert revenue_rules") as { id: number };
  return { ok: true, id: inserted.id };
}

export async function ruleDelete(db: SupabaseClient, body: Record<string, unknown>) {
  const id = idOf(body.id);
  const fx = db.schema("fortnox");
  const row = must(await fx.from("revenue_rules").select("id, kind").eq("id", id).maybeSingle(), "read revenue_rules") as { id: number; kind: string } | null;
  if (!row) throw new ActionError(404, "Regeln finns inte");
  if (row.kind === "default") throw new ActionError(400, "Standardregeln kan ändras men inte tas bort");
  must(await fx.from("revenue_rules").delete().eq("id", id), "delete revenue_rules");
  return { ok: true, id };
}

export async function accountMapSave(db: SupabaseClient, body: Record<string, unknown>, adminId: string) {
  const rowKey = rowKeyOf(body.rowKey);
  const fx = db.schema("fortnox");
  const row = must(await fx.from("cashflow_rows").select("key, kind").eq("key", rowKey).maybeSingle(), "read cashflow_rows") as { key: string; kind: string } | null;
  if (!row || row.kind !== "source") throw new ActionError(400, "Kontomappningen måste peka på en rad som fylls (inte en summa)");
  const supplierMatch = String(body.supplierMatch ?? "").trim().slice(0, 100) || null;
  const account = body.account === undefined || body.account === null || body.account === "" ? null : Number(body.account);
  const accountTo = body.accountTo === undefined || body.accountTo === null || body.accountTo === "" ? null : Number(body.accountTo);
  if (supplierMatch && account !== null) throw new ActionError(400, "Ange antingen ett konto eller en leverantör, inte båda");
  if (!supplierMatch && (account === null || !Number.isInteger(account) || account < 1000 || account > 9999))
    throw new ActionError(400, "Kontot måste vara ett fyrsiffrigt BAS-konto");
  if (accountTo !== null && (!Number.isInteger(accountTo) || account === null || accountTo < account || accountTo > 9999))
    throw new ActionError(400, "Till-kontot måste vara större än eller lika med från-kontot");
  const payload = {
    account,
    account_to: accountTo,
    supplier_match: supplierMatch,
    row_key: rowKey,
    source: "manual",
    note: String(body.note ?? "").slice(0, 300) || null,
    updated_by: `admin:${adminId}`,
    updated_at: new Date().toISOString(),
  };
  if (body.id !== undefined && body.id !== null && body.id !== "") {
    const id = idOf(body.id);
    must(await fx.from("account_map").update(payload).eq("id", id), "update account_map");
    return { ok: true, id };
  }
  const { data, error } = await fx.from("account_map").insert(payload).select("id").single();
  if (error) {
    if (/account_map_(account|supplier)_uniq/.test(error.message)) throw new ActionError(409, "Det finns redan en regel för det kontot / den leverantören – ändra den i stället");
    throw new Error(`insert account_map: ${error.message}`);
  }
  return { ok: true, id: (data as { id: number }).id };
}

export async function accountMapDelete(db: SupabaseClient, body: Record<string, unknown>) {
  const id = idOf(body.id);
  must(await db.schema("fortnox").from("account_map").delete().eq("id", id), "delete account_map");
  return { ok: true, id };
}

const SETTINGS: Record<string, { key: string; check: (v: string) => string | null }> = {
  vat_period: {
    key: "cashflow_vat_period",
    check: (v) => (["monthly", "quarterly", "yearly"].includes(v) ? null : "vat_period måste vara monthly, quarterly eller yearly"),
  },
  vat_lag_months: {
    key: "cashflow_vat_lag_months",
    check: (v) => (/^[0-9]$|^1[0-2]$/.test(v) ? null : "vat_lag_months måste vara 0–12"),
  },
  cash_accounts: {
    key: "cashflow_cash_accounts",
    check: (v) => (/^\s*\d{4}(\s*-\s*\d{4})?(\s*,\s*\d{4}(\s*-\s*\d{4})?)*\s*$/.test(v) ? null : "cash_accounts skrivs som 1930 eller 1900-1999, kommaseparerat"),
  },
};

export async function settingSet(db: SupabaseClient, body: Record<string, unknown>) {
  const name = String(body.key ?? "").trim();
  const def = SETTINGS[name];
  if (!def) throw new ActionError(400, "key måste vara vat_period, vat_lag_months eller cash_accounts");
  const value = String(body.value ?? "").trim();
  const bad = def.check(value);
  if (bad) throw new ActionError(400, bad);
  must(await db.schema("fortnox").from("settings").upsert({ key: def.key, value }, { onConflict: "key" }), `write ${def.key}`);
  return { ok: true, key: name, value };
}
