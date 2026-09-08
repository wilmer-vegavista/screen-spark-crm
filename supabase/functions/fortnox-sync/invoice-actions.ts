/**
 * Round one's page actions. All database-only — none of them talks to Fortnox:
 *
 *   invoice_link    Koppla till order…  — the admin picks the order; the sync never overrides it
 *   invoice_ignore  Lämna okopplad      — the row stays out of the leftover list for good
 *   invoice_reset   Ta upp igen         — back to the sync's judgement on the next run
 *   order_candidates                    — the bookings for the picker, with a label
 *   feed_rotate     Skapa (ny) länk     — a new feed token from Vault, shown once as a URL
 *   feed_revoke     Återkalla länk      — the URL stops working
 *   leftovers                           — proposals, unmatched and ignored invoices for the Fakturor tab
 */
import type { SupabaseClient } from "npm:@supabase/supabase-js@2.108.1";
import { type MatchOrder, orderLabel } from "../_fortnox/mod.ts";
import { ActionError } from "./actions.ts";

function must<T>(res: { data: T | null; error: { message: string } | null }, what: string): T {
  if (res.error) throw new Error(`${what}: ${res.error.message}`);
  return res.data as T;
}

export interface OrderCandidate {
  id: string;
  customer_id: string | null;
  company_name: string;
  label: string;
  screens: string[];
  billing_frequency: string | null;
  total_excl_vat: number;
  invoice_start_date: string | null;
}

interface OrderRow {
  id: string;
  customer_id: string | null;
  company_name: string;
  billing_frequency: string | null;
  billing_duration_months: number | null;
  total_excl_vat: number | string;
  invoice_start_date: string | null;
  created_at: string;
}

const toMatchOrder = (o: OrderRow): MatchOrder => ({
  id: o.id,
  customer_id: o.customer_id,
  company_name: o.company_name,
  billing_frequency: o.billing_frequency,
  billing_duration_months: o.billing_duration_months,
  total_excl_vat: Number(o.total_excl_vat) || 0,
  invoice_start_date: o.invoice_start_date,
  created_at: o.created_at,
  product_ids: [],
});

/** Every booking, labelled "Kund · 1 128 kr × 12 månadsvis från 2026-02-01", with its screens. */
export async function orderCandidates(db: SupabaseClient, ids?: string[]): Promise<OrderCandidate[]> {
  let q = db
    .from("orders")
    .select(
      "id, customer_id, company_name, billing_frequency, billing_duration_months, total_excl_vat, invoice_start_date, created_at",
    )
    .eq("order_type", "bokning")
    .order("company_name");
  if (ids) q = q.in("id", ids);
  const orders = must(await q, "read orders") as OrderRow[];
  if (orders.length === 0) return [];
  const items = must(
    await db
      .from("order_items")
      .select("order_id, product_name")
      .in(
        "order_id",
        orders.map((o) => o.id),
      ),
    "read order_items",
  ) as { order_id: string; product_name: string | null }[];
  const screens = new Map<string, string[]>();
  for (const it of items) {
    if (!it.product_name) continue;
    screens.set(it.order_id, [...(screens.get(it.order_id) ?? []), it.product_name]);
  }
  return orders.map((o) => ({
    id: o.id,
    customer_id: o.customer_id,
    company_name: o.company_name,
    label: orderLabel(toMatchOrder(o)),
    screens: screens.get(o.id) ?? [],
    billing_frequency: o.billing_frequency,
    total_excl_vat: Number(o.total_excl_vat) || 0,
    invoice_start_date: o.invoice_start_date,
  }));
}

/** The Fakturor tab: every invoice that is not linked, newest first, with its candidate's label. */
export async function leftovers(db: SupabaseClient) {
  const rows = must(
    await db
      .schema("fortnox")
      .from("v_ledger")
      .select("*")
      .neq("match_status", "linked")
      .order("fakturadatum", { ascending: false })
      .order("document_number", { ascending: false }),
    "read v_ledger",
  ) as Array<Record<string, unknown> & { candidate_order_id: string | null }>;
  const ids = [...new Set(rows.map((r) => r.candidate_order_id).filter((x): x is string => Boolean(x)))];
  const labels = new Map((ids.length ? await orderCandidates(db, ids) : []).map((c) => [c.id, c.label]));
  return rows.map((r) => ({ ...r, candidate_label: r.candidate_order_id ? (labels.get(r.candidate_order_id) ?? null) : null }));
}

const docOf = (v: unknown): string => {
  const s = String(v ?? "").trim();
  if (!s) throw new ActionError(400, "documentNumber saknas");
  return s;
};

async function readInvoice(db: SupabaseClient, documentNumber: string) {
  const row = must(
    await db
      .schema("fortnox")
      .from("invoices")
      .select("document_number, match_status, matched_by, order_id, customer_name, amount_excl_vat, invoice_date")
      .eq("document_number", documentNumber)
      .maybeSingle(),
    "read invoice",
  ) as { document_number: string; match_status: string; matched_by: string | null; order_id: string | null } | null;
  if (!row) throw new ActionError(404, `Faktura ${documentNumber} finns inte i CRM:ets kundreskontra ännu – kör synken först`);
  return row;
}

/** Koppla till order…: the admin's word; a later sync leaves it alone. */
export async function invoiceLink(db: SupabaseClient, documentNumber: unknown, orderId: unknown, adminId: string) {
  const no = docOf(documentNumber);
  const oid = String(orderId ?? "").trim();
  if (!/^[0-9a-f-]{36}$/i.test(oid)) throw new ActionError(400, "orderId saknas eller är inte ett uuid");
  await readInvoice(db, no);
  const [order] = await orderCandidates(db, [oid]);
  if (!order) throw new ActionError(404, "Ordern finns inte i CRM:et (eller är en offert)");
  const now = new Date().toISOString();
  must(
    await db
      .schema("fortnox")
      .from("invoices")
      .update({
        order_id: oid,
        candidate_order_id: oid,
        match_status: "linked",
        match_confidence: "exact",
        match_method: "manual",
        match_reason: `Kopplad för hand av admin till ordern ${order.label}`,
        matched_by: `admin:${adminId}`,
        matched_at: now,
      })
      .eq("document_number", no),
    "write invoice link",
  );
  return { ok: true, documentNumber: no, orderId: oid, label: order.label };
}

/** Lämna okopplad: out of the leftover list, never re-proposed. */
export async function invoiceIgnore(db: SupabaseClient, documentNumber: unknown, adminId: string) {
  const no = docOf(documentNumber);
  await readInvoice(db, no);
  must(
    await db
      .schema("fortnox")
      .from("invoices")
      .update({
        order_id: null,
        match_status: "ignored",
        match_confidence: "none",
        match_method: "manual",
        match_reason: "Lämnad okopplad av admin – hör inte till någon order i CRM:et",
        matched_by: `admin:${adminId}`,
        matched_at: new Date().toISOString(),
      })
      .eq("document_number", no),
    "write invoice ignore",
  );
  return { ok: true, documentNumber: no };
}

/** Ta upp igen: hand the row back to the sync (re-judged on the next run). */
export async function invoiceReset(db: SupabaseClient, documentNumber: unknown) {
  const no = docOf(documentNumber);
  await readInvoice(db, no);
  must(
    await db
      .schema("fortnox")
      .from("invoices")
      .update({
        order_id: null,
        candidate_order_id: null,
        match_status: "unmatched",
        match_confidence: "none",
        match_method: "none",
        match_reason: "Återställd av admin – bedöms om vid nästa synk",
        matched_by: null,
        matched_at: null,
      })
      .eq("document_number", no),
    "write invoice reset",
  );
  return { ok: true, documentNumber: no };
}

/** Skapa (ny) länk: the token leaves the database exactly here, inside the URL, once. */
export async function feedRotate(db: SupabaseClient, feedBase: string) {
  const { data, error } = await db.schema("fortnox").rpc("rotate_feed_token");
  if (error) throw new Error(`rotate_feed_token: ${error.message}`);
  const token = String(data ?? "");
  if (token.length < 32) throw new Error("rotate_feed_token returned no token");
  return {
    ok: true,
    url: `${feedBase}/${token}`,
    formula: `=IMPORTDATA("${feedBase}/${token}")`,
    rotatedAt: new Date().toISOString(),
  };
}

/** Återkalla länk. */
export async function feedRevoke(db: SupabaseClient) {
  const { error } = await db.schema("fortnox").rpc("revoke_feed_token");
  if (error) throw new Error(`revoke_feed_token: ${error.message}`);
  return { ok: true };
}
