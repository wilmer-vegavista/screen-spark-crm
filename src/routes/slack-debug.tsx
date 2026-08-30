// TEMPORARY diagnostics page for the Slack connection — remove once debugging is done.
// Requires login; runs the server-side Slack diagnostics and shows the raw result.
import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { runSlackDiagnostics } from "@/lib/slack-debug.functions";

export const Route = createFileRoute("/slack-debug")({
  ssr: false,
  component: SlackDebugPage,
});

function SlackDebugPage() {
  const [result, setResult] = useState<unknown>(null);
  const [posting, setPosting] = useState(false);

  const run = async (post: boolean) => {
    setPosting(true);
    try {
      const r = await runSlackDiagnostics({ data: { post } });
      setResult(r);
    } catch (e) {
      setResult({ callError: e instanceof Error ? e.message : String(e) });
    } finally {
      setPosting(false);
    }
  };

  useEffect(() => {
    void run(false);
  }, []);

  return (
    <div style={{ padding: 24, fontFamily: "monospace" }}>
      <h1 style={{ fontSize: 18, fontWeight: 600 }}>Slack-diagnos (tillfällig sida)</h1>
      <button
        onClick={() => void run(true)}
        disabled={posting}
        style={{ margin: "12px 0", padding: "8px 16px", border: "1px solid #888", borderRadius: 6 }}
      >
        {posting ? "Kör..." : "Skicka testmeddelande till #done-deal"}
      </button>
      <pre id="slack-diag" style={{ whiteSpace: "pre-wrap", background: "#1112", padding: 12 }}>
        {result ? JSON.stringify(result, null, 2) : "Kör diagnos..."}
      </pre>
    </div>
  );
}
