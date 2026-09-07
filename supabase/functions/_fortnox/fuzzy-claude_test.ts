import { assertEquals } from "jsr:@std/assert@1";
import { claudeFuzzy, parseVerdict } from "./fuzzy-claude.ts";
import { json, mockFetch } from "./_test_helpers.ts";

const candidates = [
  { number: "10", name: "Stenungsund" },
  { number: "11", name: "Storknallen" },
];

Deno.test("parses a clean JSON verdict", () => {
  const v = parseVerdict(
    '{"number":"10","confidence":"medium","reason":"Samma plats, annan stavning"}',
    candidates,
  );
  assertEquals(v, {
    candidateNumber: "10",
    confidence: "medium",
    reason: "Claude: Samma plats, annan stavning",
  });
});

Deno.test("a number that is not among the candidates becomes none", () => {
  const v = parseVerdict('{"number":"99","confidence":"medium","reason":"x"}', candidates);
  assertEquals(v.candidateNumber, null);
  assertEquals(v.confidence, "none");
});

Deno.test(
  "an exact or unknown confidence is capped to none; prose around JSON is tolerated",
  () => {
    const v = parseVerdict(
      'Här är mitt svar:\n```json\n{"number":"11","confidence":"exact","reason":"y"}\n```',
      candidates,
    );
    assertEquals(v.confidence, "none");
    assertEquals(parseVerdict("no json here", candidates).confidence, "none");
  },
);

Deno.test("calls the Messages API with the key header and returns the verdict", async () => {
  const f = mockFetch([
    [
      "POST",
      "api.anthropic.com/v1/messages",
      () =>
        json(200, {
          content: [
            { type: "text", text: '{"number":"10","confidence":"low","reason":"Troligen samma"}' },
          ],
        }),
    ],
  ]);
  const v = await claudeFuzzy(
    { kind: "screen", crmName: "Stenungstorg", candidates },
    { apiKey: "sk-ant-test", fetchFn: f.fetch },
  );
  assertEquals(v, { candidateNumber: "10", confidence: "low", reason: "Claude: Troligen samma" });
  const call = f.calls[0];
  assertEquals(call.headers["x-api-key"], "sk-ant-test");
  assertEquals(call.headers["anthropic-version"], "2023-06-01");
  const body = JSON.parse(call.body!);
  assertEquals(body.messages[0].role, "user");
  assertEquals(body.temperature, 0);
});
