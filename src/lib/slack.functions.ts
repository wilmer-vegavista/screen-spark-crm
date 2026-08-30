import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

const SLACK_API_URL = "https://slack.com/api";
const CHANNEL = "done-deal";
const BOT_NAME = "NY AFFÄR";
const BOT_ICON_URL =
  "https://vegavista.life/__l5e/assets-v1/84e553e9-9a97-4d14-9217-7e9c5bc1e480/ny-affar-128.png";

type SaleInput = {
  seller: string;
  company: string;
  amount: number;
  screens?: string;
};

async function slackFetch(method: string, body: Record<string, unknown>) {
  const botToken = process.env["SLACK_BOT_TOKEN"];
  if (!botToken) throw new Error("Slack-koppling saknas");
  const res = await fetch(`${SLACK_API_URL}/${method}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${botToken}`,
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
      screens: (input.screens ?? "—").slice(0, 300),
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
        username: BOT_NAME,
        icon_url: BOT_ICON_URL,
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
              { type: "mrkdwn", text: `*Skärm/Produkt:*\n${data.screens}` },
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
