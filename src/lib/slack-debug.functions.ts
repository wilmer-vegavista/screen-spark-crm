// TEMPORARY diagnostics for the Slack connection — remove once debugging is done.
// Requires a logged-in user (same auth middleware as the real Slack function).
import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

type DebugInput = { post: boolean };

export const runSlackDiagnostics = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: DebugInput) => ({ post: Boolean(input?.post) }))
  .handler(async ({ data }) => {
    const token = process.env["SLACK_BOT_TOKEN"];
    const env = token
      ? { present: true, prefix: token.slice(0, 5), length: token.length }
      : { present: false };
    const legacyEnv = {
      LOVABLE_API_KEY: Boolean(process.env["LOVABLE_API_KEY"]),
      SLACK_API_KEY: Boolean(process.env["SLACK_API_KEY"]),
    };

    let authTest: unknown = null;
    let postTest: unknown = null;
    if (token) {
      try {
        const res = await fetch("https://slack.com/api/auth.test", {
          method: "POST",
          headers: { Authorization: `Bearer ${token}` },
        });
        authTest = await res.json();
      } catch (e) {
        authTest = { fetchError: e instanceof Error ? e.message : String(e) };
      }
      if (data.post) {
        try {
          const res = await fetch("https://slack.com/api/chat.postMessage", {
            method: "POST",
            headers: {
              Authorization: `Bearer ${token}`,
              "Content-Type": "application/json; charset=utf-8",
            },
            body: JSON.stringify({
              channel: "done-deal",
              text: "🔧 Testmeddelande från felsökning av Slack-kopplingen – kan ignoreras",
            }),
          });
          postTest = await res.json();
        } catch (e) {
          postTest = { fetchError: e instanceof Error ? e.message : String(e) };
        }
      }
    }

    return { env, legacyEnv, authTest, postTest, at: new Date().toISOString() };
  });
