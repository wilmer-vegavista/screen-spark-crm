import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

const GATEWAY_URL = "https://connector-gateway.lovable.dev/slack/api";
const CHANNEL = "done-deal";

type SaleInput = {
  seller: string;
  company: string;
  amount: number;
  orderType?: string;
};

async function slackFetch(method: string, body: Record<string, unknown>) {
  const lovableKey = process.env["LOVABLE_API_KEY"];
  const slackKey = process.env["SLACK_API_KEY"];
  if (!lovableKey || !slackKey) throw new Error("Slack-koppling saknas");
  const res = await fetch(`${GATEWAY_URL}/${method}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${lovableKey}`,
      "X-Connection-Api-Key": slackKey,
      "Content-Type": "application/json; charset=utf-8",
    },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`Slack ${method} misslyckades [${res.status}]: ${text}`);
  const data = JSON.parse(text);
  if (!data.ok) throw new Error(`Slack ${method} fel: ${data.error}`);
  return data;
}

export const postSaleToSlack = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: SaleInput) => {
    if (!input || typeof input.company !== "string" || typeof input.seller !== "string") {
      throw new Error("Ogiltig indata");
    }
    return {
      seller: input.seller.slice(0, 120),
      company: input.company.slice(0, 200),
      amount: Number(input.amount) || 0,
      orderType: (input.orderType ?? "bokning").slice(0, 40),
    };
  })
  .handler(async ({ data }) => {
    const amount = new Intl.NumberFormat("sv-SE", {
      style: "currency",
      currency: "SEK",
      maximumFractionDigits: 0,
    }).format(data.amount);

    try {
      await slackFetch("chat.postMessage", {
        channel: CHANNEL,
        text: `🎉 DONE DEAL! ${data.seller} sålde till ${data.company} för ${amount}`,
        blocks: [
          {
            type: "header",
            text: { type: "plain_text", text: "🎉 DONE DEAL!", emoji: true },
          },
          {
            type: "section",
            fields: [
              { type: "mrkdwn", text: `*Säljare:*\n${data.seller}` },
              { type: "mrkdwn", text: `*Kund:*\n${data.company}` },
              { type: "mrkdwn", text: `*Belopp:*\n${amount}` },
              { type: "mrkdwn", text: `*Typ:*\n${data.orderType}` },
            ],
          },
        ],
      });
      return { ok: true as const };
    } catch (e) {
      console.error("Slack-post misslyckades", e);
      return { ok: false as const, error: e instanceof Error ? e.message : "Okänt fel" };
    }
  });
