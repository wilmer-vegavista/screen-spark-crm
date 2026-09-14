import { format } from "date-fns";
import { sv } from "date-fns/locale";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { SEK0 } from "@/lib/fortnox/ledger";
import {
  REVENUE_SOURCE_LABEL,
  type RevenueSource,
  type RevenueSourceState,
} from "@/lib/fortnox/revenue";

/**
 * The selector planerat / fakturerat / betalt plus its one-line caption, rendered inside
 * the revenue report's filter card. The state comes from useRevenueSource (lib/fortnox/revenue).
 * Erik's component (round one).
 */
export function RevenueSourceSwitch({
  state,
  from,
  to,
}: {
  state: RevenueSourceState;
  from: Date;
  to: Date;
}) {
  const inPeriod = state.leftovers.filter((r) => {
    const d = new Date(`${r.fakturadatum.slice(0, 10)}T00:00:00`);
    return d >= from && d <= to;
  });
  const excluded = inPeriod.reduce((s, r) => s + r.belopp_ex_moms, 0);
  const synced = state.syncedAt
    ? format(new Date(state.syncedAt), "d MMM HH:mm", { locale: sv })
    : "–";
  const caption = state.error
    ? `Fortnox-fakturor kunde inte läsas: ${state.error}`
    : state.isLoading
      ? "Hämtar fakturor från Fortnox…"
      : `Fakturadatum styr. Synkad ${synced} · ${state.claudeUsed ? "Claude + regler" : "enbart regler"}` +
        `${state.devFakePayments ? " · DEV: fejkade betalningar" : ""}.` +
        `${inPeriod.length ? ` ${inPeriod.length} okopplade fakturor (${SEK0(excluded)}) i perioden räknas inte – se Kundreskontra.` : ""}`;
  return (
    <div className="space-y-1">
      <Label className="text-xs">Källa</Label>
      <Select value={state.source} onValueChange={(v) => state.setSource(v as RevenueSource)}>
        <SelectTrigger className="w-56">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {(Object.keys(REVENUE_SOURCE_LABEL) as RevenueSource[]).map((s) => (
            <SelectItem key={s} value={s}>
              {REVENUE_SOURCE_LABEL[s]}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      {state.source !== "planerat" && (
        <div className="text-[11px] text-muted-foreground max-w-xs">{caption}</div>
      )}
    </div>
  );
}
