import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";

const RowSchema = z.object({
  seller_id: z.string().uuid(),
  product_id: z.string().uuid(),
  product_name: z.string().min(1).max(200),
  customer_name: z.string().min(1).max(200),
  invoice_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  amount: z.number().positive().max(100_000_000),
});

const InputSchema = z.object({
  rows: z.array(RowSchema).min(1).max(2000),
});

export const importOrders = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: unknown) => InputSchema.parse(data))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;

    // admin gate
    const { data: isAdmin } = await supabase.rpc("has_role", {
      _user_id: userId,
      _role: "admin",
    });
    if (!isAdmin) throw new Error("Forbidden");

    let created = 0;
    const errors: string[] = [];

    for (const r of data.rows) {
      try {
        const { data: customer, error: cErr } = await supabase
          .from("customers")
          .insert({ company_name: r.customer_name, owner_id: r.seller_id, created_by: userId })
          .select("id")
          .single();
        if (cErr || !customer) throw new Error(cErr?.message || "customer insert failed");

        const { data: deal, error: dErr } = await supabase
          .from("deals")
          .insert({
            title: `${r.customer_name} - ${r.product_name}`,
            customer_id: customer.id,
            owner_id: r.seller_id,
            created_by: userId,
            value: r.amount,
            stage: "vunnen",
            won_at: r.invoice_date,
            product_id: r.product_id,
          })
          .select("id")
          .single();
        if (dErr || !deal) throw new Error(dErr?.message || "deal insert failed");

        const { data: order, error: oErr } = await supabase
          .from("orders")
          .insert({
            order_type: "bokning",
            status: "vunnen",
            customer_id: customer.id,
            company_name: r.customer_name,
            total_excl_vat: r.amount,
            owner_id: r.seller_id,
            created_by: userId,
            deal_id: deal.id,
            invoice_start_date: r.invoice_date,
            billing_frequency: "engang",
            billing_duration_months: 1,
          })
          .select("id")
          .single();
        if (oErr || !order) throw new Error(oErr?.message || "order insert failed");

        const { error: iErr } = await supabase.from("order_items").insert({
          order_id: order.id,
          product_id: r.product_id,
          product_name: r.product_name,
          weeks: 1,
          unit_price: r.amount,
          commission_pct: 10,
          commission_amount: r.amount * 0.1,
          position: 0,
        });
        if (iErr) throw new Error(iErr.message);

        created++;
      } catch (e: any) {
        errors.push(`${r.customer_name} (${r.invoice_date}): ${e.message || e}`);
      }
    }

    return { created, errors };
  });
