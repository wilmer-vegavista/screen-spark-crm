import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";

const createSchema = z.object({
  full_name: z.string().min(1),
  email: z.string().email(),
  phone: z.string().optional(),
  title: z.string().optional(),
  role: z.enum(["saljare", "admin"]).default("saljare"),
  compensation_type: z.enum(["endast_provision", "med_grundlon"]),
  base_salary: z.number().min(0).optional(),
  default_commission_pct: z.number().min(0).optional(),
  credential_mode: z.enum(["invite", "password"]).default("password"),
  password: z.string().min(6).optional(),
});

const updateSchema = z.object({
  user_id: z.string().uuid(),
  full_name: z.string().min(1).optional(),
  email: z.string().email().optional(),
  phone: z.string().optional(),
  title: z.string().optional(),
  role: z.enum(["saljare", "admin"]).optional(),
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

    let userId: string;
    let storedPassword: string | null = null;
    let invited = false;

    if (data.credential_mode === "invite") {
      // Send invitation email via Supabase auth (user sets own password)
      const { data: inviteData, error: inviteErr } =
        await supabaseAdmin.auth.admin.inviteUserByEmail(data.email, {
          data: { full_name: data.full_name },
        });
      if (inviteErr) throw new Error(inviteErr.message);
      userId = inviteData.user.id;
      invited = true;
    } else {
      const password = data.password && data.password.length >= 6 ? data.password : generateTempPassword();
      const { data: userData, error: userError } = await supabaseAdmin.auth.admin.createUser({
        email: data.email,
        password,
        email_confirm: true,
        user_metadata: { full_name: data.full_name },
      });
      if (userError) throw new Error(userError.message);
      userId = userData.user.id;
      storedPassword = password;

      // Spara lösenordet så admin kan se det igen
      const { error: credErr } = await supabaseAdmin.from("seller_credentials").upsert({
        user_id: userId,
        initial_password: password,
      });
      if (credErr) throw new Error(credErr.message);
    }

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

    // 4. If admin selected, grant admin role (trigger already gave them 'saljare')
    if (data.role === "admin") {
      const { error: roleErr } = await supabaseAdmin
        .from("user_roles")
        .upsert({ user_id: userId, role: "admin" }, { onConflict: "user_id,role" });
      if (roleErr) throw new Error(roleErr.message);
    }

    return { userId, password: storedPassword, invited };
  });

export const resendSellerInvite = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(z.object({ email: z.string().email() }))
  .handler(async ({ context, data }) => {
    await checkAdmin(context.supabase, context.userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { error } = await supabaseAdmin.auth.admin.inviteUserByEmail(data.email);
    if (error) {
      const msg = (error.message || "").toLowerCase();
      // If user already exists, fall back to a password recovery / magic link instead of failing
      if (msg.includes("already") && msg.includes("registered")) {
        const { error: linkErr } = await supabaseAdmin.auth.admin.generateLink({
          type: "recovery",
          email: data.email,
        });
        if (linkErr) throw new Error(linkErr.message);
        return { ok: true, resent: "recovery" as const };
      }
      throw new Error(error.message);
    }
    return { ok: true, resent: "invite" as const };
  });

export const listSellersAdmin = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await checkAdmin(context.supabase, context.userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const [profilesRes, rolesRes, compsRes, credsRes] = await Promise.all([
      supabaseAdmin.from("profiles").select("id, full_name, email, phone, title"),
      supabaseAdmin.from("user_roles").select("user_id, role"),
      supabaseAdmin.from("seller_compensation").select("*"),
      supabaseAdmin.from("seller_credentials").select("user_id, initial_password"),
    ]);

    const authUsers: any[] = [];
    let page = 1;
    while (true) {
      const { data, error } = await supabaseAdmin.auth.admin.listUsers({ page, perPage: 200 });
      if (error) throw new Error(error.message);
      authUsers.push(...data.users);
      if (data.users.length < 200) break;
      page++;
    }
    const authByUser = new Map(authUsers.map((u: any) => [u.id, u]));

    const rolesByUser = new Map<string, string[]>();
    (rolesRes.data ?? []).forEach((r: any) => {
      const arr = rolesByUser.get(r.user_id) ?? [];
      arr.push(r.role);
      rolesByUser.set(r.user_id, arr);
    });
    const compMap = new Map((compsRes.data ?? []).map((c: any) => [c.user_id, c]));
    const credMap = new Map((credsRes.data ?? []).map((c: any) => [c.user_id, c.initial_password]));

    return (profilesRes.data ?? [])
      .filter((p: any) => {
        const rs = rolesByUser.get(p.id) ?? [];
        return rs.includes("saljare") || rs.includes("admin");
      })
      .map((p: any) => {
        const c: any = compMap.get(p.id);
        const rs = rolesByUser.get(p.id) ?? [];
        const u: any = authByUser.get(p.id);
        const lastSignIn = u?.last_sign_in_at ?? null;
        const invitedAt = u?.invited_at ?? null;
        const hasPassword = Boolean(lastSignIn) || Boolean(credMap.get(p.id));
        const pendingInvite = Boolean(invitedAt) && !lastSignIn;
        return {
          ...p,
          role: rs.includes("admin") ? "admin" : "saljare",
          compensation_type: c?.compensation_type ?? "med_grundlon",
          base_salary: Number(c?.base_salary ?? 0),
          default_commission_pct: Number(c?.default_commission_pct ?? 0),
          password: credMap.get(p.id) ?? null,
          last_sign_in_at: lastSignIn,
          invited_at: invitedAt,
          has_password: hasPassword,
          pending_invite: pendingInvite,
        };
      });
  });

export const setSellerPassword = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(z.object({ user_id: z.string().uuid(), password: z.string().min(6) }))
  .handler(async ({ context, data }) => {
    await checkAdmin(context.supabase, context.userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { error: updErr } = await supabaseAdmin.auth.admin.updateUserById(data.user_id, {
      password: data.password,
    });
    if (updErr) throw new Error(updErr.message);
    const { error: credErr } = await supabaseAdmin.from("seller_credentials").upsert({
      user_id: data.user_id,
      initial_password: data.password,
    });
    if (credErr) throw new Error(credErr.message);
    return { ok: true };
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

    // 4. Sync role
    if (data.role !== undefined) {
      if (data.role === "admin") {
        const { error } = await supabaseAdmin
          .from("user_roles")
          .upsert({ user_id: data.user_id, role: "admin" }, { onConflict: "user_id,role" });
        if (error) throw new Error(error.message);
      } else {
        // Demote: remove admin row, keep saljare
        const { error } = await supabaseAdmin
          .from("user_roles")
          .delete()
          .eq("user_id", data.user_id)
          .eq("role", "admin");
        if (error) throw new Error(error.message);
      }
    }

    return { ok: true };
  });
