import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";

const createSchema = z.object({
  full_name: z.string().min(1),
  email: z.string().email(),
  phone: z.string().optional(),
  title: z.string().optional(),
  compensation_type: z.enum(["endast_provision", "med_grundlon"]),
  base_salary: z.number().min(0).optional(),
  default_commission_pct: z.number().min(0).optional(),
});

const updateSchema = z.object({
  user_id: z.string().uuid(),
  full_name: z.string().min(1).optional(),
  email: z.string().email().optional(),
  phone: z.string().optional(),
  title: z.string().optional(),
  compensation_type: z.enum(["endast_provision", "med_grundlon"]).optional(),
  base_salary: z.number().min(0).optional(),
  default_commission_pct: z.number().min(0).optional(),
});

async function checkAdmin(supabase: any, userId: string) {
  const { data } = await supabase.rpc("has_role", {
    _user_id: userId,
    _role: "admin",
  });
  if (!data) throw new Error("Unauthorized: admin only");
}

function generateTempPassword() {
  const uuid = crypto.randomUUID();
  return `${uuid.slice(0, 8)}A1!`;
}

export const createSeller = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(createSchema)
  .handler(async ({ context, data }) => {
    await checkAdmin(context.supabase, context.userId);

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    // 1. Create auth user
    const tempPassword = generateTempPassword();
    const { data: userData, error: userError } = await supabaseAdmin.auth.admin.createUser({
      email: data.email,
      password: tempPassword,
      email_confirm: true,
      user_metadata: { full_name: data.full_name },
    });
    if (userError) throw new Error(userError.message);
    const userId = userData.user.id;

    // 2. Update profile with phone/title
    await supabaseAdmin
      .from("profiles")
      .update({
        full_name: data.full_name,
        phone: data.phone || null,
        title: data.title || null,
      })
      .eq("id", userId);

    // 3. Insert compensation
    const { error: compError } = await supabaseAdmin.from("seller_compensation").insert({
      user_id: userId,
      compensation_type: data.compensation_type,
      base_salary: data.compensation_type === "endast_provision" ? 0 : (data.base_salary ?? 0),
      default_commission_pct: data.default_commission_pct ?? 0,
    });
    if (compError) throw new Error(compError.message);

    return { userId, tempPassword };
  });

export const updateSeller = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(updateSchema)
  .handler(async ({ context, data }) => {
    await checkAdmin(context.supabase, context.userId);

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    // 1. Update auth email if changed
    if (data.email) {
      const { error: emailErr } = await supabaseAdmin.auth.admin.updateUserById(data.user_id, {
        email: data.email,
      });
      if (emailErr) throw new Error(emailErr.message);
    }

    // 2. Update profile
    const profileUpdate: any = {};
    if (data.full_name !== undefined) profileUpdate.full_name = data.full_name;
    if (data.phone !== undefined) profileUpdate.phone = data.phone || null;
    if (data.title !== undefined) profileUpdate.title = data.title || null;
    if (data.email !== undefined) profileUpdate.email = data.email;

    if (Object.keys(profileUpdate).length > 0) {
      const { error } = await supabaseAdmin.from("profiles").update(profileUpdate).eq("id", data.user_id);
      if (error) throw new Error(error.message);
    }

    // 3. Upsert compensation
    if (data.compensation_type !== undefined || data.base_salary !== undefined || data.default_commission_pct !== undefined) {
      const existing = await supabaseAdmin.from("seller_compensation").select("*").eq("user_id", data.user_id).maybeSingle();
      const payload = {
        user_id: data.user_id,
        compensation_type: data.compensation_type ?? existing.data?.compensation_type ?? "med_grundlon",
        base_salary: data.compensation_type === "endast_provision" ? 0 : (data.base_salary ?? existing.data?.base_salary ?? 0),
        default_commission_pct: data.default_commission_pct ?? existing.data?.default_commission_pct ?? 0,
      };
      const { error } = await supabaseAdmin.from("seller_compensation").upsert(payload);
      if (error) throw new Error(error.message);
    }

    return { ok: true };
  });
