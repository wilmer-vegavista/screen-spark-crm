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
    const { error } = await context.supabase
      .from("orders")
      .delete()
      .in("id", data.ids);

    if (error) throw new Error(error.message);
    return { deleted: data.ids.length };
  });
