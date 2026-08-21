import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";

const deleteSchema = z.object({
  ids: z.array(z.string().uuid()).min(1),
});

export const deleteOrders = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(deleteSchema)
  .handler(async ({ context, data }) => {
    // Collect linked deals so salary/reports don't keep counting removed orders
    const { data: rows } = await context.supabase
      .from("orders")
      .select("deal_id")
      .in("id", data.ids);
    const dealIds = Array.from(
      new Set(((rows ?? []) as { deal_id: string | null }[]).map(r => r.deal_id).filter(Boolean) as string[]),
    );

    const { error } = await context.supabase
      .from("orders")
      .delete()
      .in("id", data.ids);

    if (error) throw new Error(error.message);

    if (dealIds.length) {
      await context.supabase.from("deals").delete().in("id", dealIds);
    }

    return { deleted: data.ids.length };
  });

