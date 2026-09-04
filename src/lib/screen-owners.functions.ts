import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";

async function checkAdmin(supabase: any, userId: string) {
  const { data } = await supabase.rpc("has_role", {
    _user_id: userId,
    _role: "admin",
  });
  if (!data) throw new Error("Unauthorized: admin only");
}

export const listScreenOwnersAdmin = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await checkAdmin(context.supabase, context.userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const [ownersRes, productsRes, credsRes] = await Promise.all([
      supabaseAdmin.from("screen_owners").select("id, user_id, owner_name, created_at"),
      supabaseAdmin.from("products").select("owner_name"),
      supabaseAdmin.from("seller_credentials").select("user_id, initial_password"),
    ]);
    const credMap = new Map(
      (credsRes.data ?? []).map((c) => [c.user_id, c.initial_password] as const),
    );

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

    const owners = (ownersRes.data ?? []).map((o) => {
      const u: any = authByUser.get(o.user_id);
      const lastSignIn = u?.last_sign_in_at ?? null;
      return {
        ...o,
        email: u?.email ?? null,
        full_name: u?.user_metadata?.full_name ?? null,
        last_sign_in_at: lastSignIn,
        invited_at: u?.invited_at ?? null,
        pending_invite: Boolean(u?.invited_at) && !lastSignIn,
        password: credMap.get(o.user_id) ?? null,
      };
    });

    const ownerNames = Array.from(
      new Set((productsRes.data ?? []).map((p) => p.owner_name).filter(Boolean) as string[]),
    ).sort((a, b) => a.localeCompare(b, "sv"));

    return { owners, ownerNames };
  });

export const inviteScreenOwner = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(
    z.object({
      email: z.string().email(),
      owner_name: z.string().min(1),
      full_name: z.string().optional(),
      redirect_to: z.string().url().optional(),
      // "password": admin sätter lösenordet direkt (som för säljare).
      // "email" skickar inbjudningsmejl via Supabase, "link" skapar bara en länk
      // som admin kopierar och skickar själv (påverkas inte av mejlgränsen)
      mode: z.enum(["password", "email", "link"]).default("password"),
      password: z.string().min(6).optional(),
    }),
  )
  .handler(async ({ context, data }) => {
    await checkAdmin(context.supabase, context.userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const finishSetup = async (userId: string) => {
      // handle_new_user-triggern gav kontot saljare-rollen; skärmägare ska inte ha någon CRM-roll
      await supabaseAdmin.from("user_roles").delete().eq("user_id", userId);
      const { error: mapErr } = await supabaseAdmin
        .from("screen_owners")
        .insert({ user_id: userId, owner_name: data.owner_name });
      if (mapErr) throw new Error(mapErr.message);
    };

    const generateInviteLink = async () => {
      const { data: linkData, error: linkErr } = await supabaseAdmin.auth.admin.generateLink({
        type: "invite",
        email: data.email,
        options: {
          data: { full_name: data.full_name || data.owner_name },
          redirectTo: data.redirect_to,
        },
      });
      if (linkErr) throw new Error(linkErr.message);
      return { userId: linkData.user.id, actionLink: linkData.properties.action_link };
    };

    if (data.mode === "password") {
      if (!data.password || data.password.length < 6) {
        throw new Error("Lösenord (minst 6 tecken) krävs");
      }
      const { data: userData, error: userError } = await supabaseAdmin.auth.admin.createUser({
        email: data.email,
        password: data.password,
        email_confirm: true,
        user_metadata: { full_name: data.full_name || data.owner_name },
      });
      if (userError) {
        const msg = (userError.message || "").toLowerCase();
        if (msg.includes("already")) throw new Error("E-postadressen har redan ett konto");
        throw new Error(userError.message);
      }
      const userId = userData.user.id;
      await finishSetup(userId);
      // Spara lösenordet så admin kan se det igen (samma tabell som för säljare)
      await supabaseAdmin
        .from("seller_credentials")
        .upsert({ user_id: userId, initial_password: data.password });
      return { userId, actionLink: null, emailSent: false };
    }

    if (data.mode === "link") {
      const { userId, actionLink } = await generateInviteLink();
      await finishSetup(userId);
      return { userId, actionLink, emailSent: false };
    }

    const { data: inviteData, error: inviteErr } = await supabaseAdmin.auth.admin.inviteUserByEmail(
      data.email,
      {
        data: { full_name: data.full_name || data.owner_name },
        redirectTo: data.redirect_to,
      },
    );
    if (inviteErr) {
      const msg = (inviteErr.message || "").toLowerCase();
      if (msg.includes("already") && msg.includes("registered")) {
        throw new Error("E-postadressen har redan ett konto");
      }
      // Supabases inbyggda mejltjänst har låg timgräns — skapa länken utan mejl istället
      if (msg.includes("rate limit")) {
        const { userId, actionLink } = await generateInviteLink();
        await finishSetup(userId);
        return { userId, actionLink, emailSent: false, rateLimited: true };
      }
      throw new Error(inviteErr.message);
    }
    const userId = inviteData.user.id;
    await finishSetup(userId);
    return { userId, actionLink: null, emailSent: true };
  });

export const resendScreenOwnerInvite = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(z.object({ email: z.string().email(), redirect_to: z.string().url().optional() }))
  .handler(async ({ context, data }) => {
    await checkAdmin(context.supabase, context.userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { error } = await supabaseAdmin.auth.admin.inviteUserByEmail(data.email, {
      redirectTo: data.redirect_to,
    });
    if (error) {
      const msg = (error.message || "").toLowerCase();
      if (msg.includes("rate limit")) {
        throw new Error("Mejlgränsen är nådd — använd länk-knappen och skicka länken själv");
      }
      // Redan aktiverat konto: skicka återställningslänk istället
      if (msg.includes("already") && msg.includes("registered")) {
        const { error: linkErr } = await supabaseAdmin.auth.admin.generateLink({
          type: "recovery",
          email: data.email,
          options: { redirectTo: data.redirect_to },
        });
        if (linkErr) throw new Error(linkErr.message);
        return { ok: true, resent: "recovery" as const };
      }
      throw new Error(error.message);
    }
    return { ok: true, resent: "invite" as const };
  });

export const getScreenOwnerLoginLink = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(
    z.object({ user_id: z.string().uuid(), redirect_to: z.string().url().optional() }),
  )
  .handler(async ({ context, data }) => {
    await checkAdmin(context.supabase, context.userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    // Säkerhetsspärr: bara för skärmägarkonton
    const { data: mapping } = await supabaseAdmin
      .from("screen_owners")
      .select("id")
      .eq("user_id", data.user_id)
      .maybeSingle();
    if (!mapping) throw new Error("Användaren är inte en skärmägare");

    const { data: userRes, error: userErr } = await supabaseAdmin.auth.admin.getUserById(
      data.user_id,
    );
    if (userErr || !userRes.user?.email) throw new Error("Kunde inte hämta användaren");

    // Bekräfta e-posten så att en återställningslänk kan skapas även för
    // konton som ännu inte accepterat sin inbjudan
    if (!userRes.user.email_confirmed_at) {
      await supabaseAdmin.auth.admin.updateUserById(data.user_id, { email_confirm: true });
    }

    const { data: linkData, error: linkErr } = await supabaseAdmin.auth.admin.generateLink({
      type: "recovery",
      email: userRes.user.email,
      options: { redirectTo: data.redirect_to },
    });
    if (linkErr) throw new Error(linkErr.message);

    return { actionLink: linkData.properties.action_link, email: userRes.user.email };
  });

export const updateScreenOwnerEmail = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(z.object({ user_id: z.string().uuid(), email: z.string().email() }))
  .handler(async ({ context, data }) => {
    await checkAdmin(context.supabase, context.userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { error } = await supabaseAdmin.auth.admin.updateUserById(data.user_id, {
      email: data.email,
      email_confirm: true,
    });
    if (error) throw new Error(error.message);
    await supabaseAdmin.from("profiles").update({ email: data.email }).eq("id", data.user_id);
    return { ok: true };
  });

export const removeScreenOwner = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(z.object({ user_id: z.string().uuid() }))
  .handler(async ({ context, data }) => {
    await checkAdmin(context.supabase, context.userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    // Skärmägarkonton finns bara för portalen — ta bort hela kontot.
    // Säkerhetsspärr: rör aldrig konton som inte är mappade som skärmägare.
    const { data: mapping } = await supabaseAdmin
      .from("screen_owners")
      .select("id")
      .eq("user_id", data.user_id)
      .maybeSingle();
    if (!mapping) throw new Error("Användaren är inte en skärmägare");

    const { error } = await supabaseAdmin.auth.admin.deleteUser(data.user_id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });
