import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { format } from "date-fns";
import { toast } from "sonner";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Check, Loader2, Plus, RotateCcw, X } from "lucide-react";
import { callFortnoxAction, type CashPosition, KR0, monthLong, type PlanRow } from "@/lib/fortnox/cashflow";

/**
 * The recurring plan, Filip's typed constants: one amount per row (prefilled by the sync
 * from the last three closed months, marked "från bokföringen"), editable per row, with a
 * month's own figure when it differs; and Kassa årets ingång with its manual override.
 * Every edit goes through fortnox-sync with the admin's session and says who and when.
 * Erik's component (round two).
 */
export function CashflowPlan({
  plan,
  months,
  position,
  onChanged,
}: {
  plan: PlanRow[];
  months: string[];
  position: CashPosition | undefined;
  onChanged: () => void;
}) {
  const [editing, setEditing] = useState<string | null>(null);
  const [amount, setAmount] = useState("");
  const [overrideRow, setOverrideRow] = useState<string | null>(null);
  const [overrideMonth, setOverrideMonth] = useState<string>("");
  const [overrideAmount, setOverrideAmount] = useState("");
  const [openingInput, setOpeningInput] = useState("");

  const act = useMutation({
    mutationFn: (body: Record<string, unknown>) => callFortnoxAction<{ ok: boolean; label?: string; cleared?: boolean }>(body),
    onSuccess: (r, body) => {
      toast.success(
        body.action === "cashflow_plan_set_row"
          ? r.cleared
            ? `${r.label}: planen är borttagen – synken fyller på från bokföringen igen`
            : `${r.label}: planen sparad`
          : body.action === "cashflow_plan_set_month"
            ? r.cleared
              ? `${r.label}: månadens egen siffra borttagen`
              : `${r.label}: månadens egen siffra sparad`
            : r.cleared
              ? "Ingående kassa läses från huvudboken igen"
              : "Ingående kassa sparad",
      );
      setEditing(null);
      setOverrideRow(null);
      setOverrideAmount("");
      setOpeningInput("");
      onChanged();
    },
    onError: (e: Error) => toast.error(e.message),
  });
  const busy = act.isPending;
  const when = (iso: string | null | undefined) => (iso ? format(new Date(iso), "yyyy-MM-dd HH:mm") : "");

  const rows = plan.filter((p) => p.plan_enabled);
  const opening = plan.find((p) => p.row_key === "kassa_arets_ingang");
  const openingOverride = position ? opening?.months.find((m) => m.month === position.fy_from) : undefined;

  return (
    <div className="space-y-4">
      <Card className="p-4 text-sm text-muted-foreground">
        Planen är det Filip skriver in för hand i arbetsboken: ett belopp per rad och månad framåt. Synken fyller den från
        bokföringen (snittet av de tre senaste stängda månaderna, avrundat till 100 kr) och rör aldrig en rad som ändrats här.
        I prognosmånader är planen golvet – kända fakturor och orderboken höjer siffran. En månad kan få en egen siffra.
      </Card>

      <Card className="p-4 space-y-2">
        <div className="font-medium text-sm">Kassa årets ingång{position ? ` · räkenskapsåret ${position.fy_from.slice(0, 7)} – ${position.fy_to.slice(0, 7)}` : ""}</div>
        <div className="text-sm">
          Huvudboken: <b>{KR0(position?.opening_ledger ?? 0)} kr</b>{" "}
          <span className="text-muted-foreground">
            (
            {position?.opening_ledger_source === "ib"
              ? "ingående balans på kassakontona"
              : position?.opening_ledger_source === "previous_ub"
                ? "föregående räkenskapsårs utgående balans – året är inte stängt i Fortnox"
                : "ingen balans läst ännu"}
            )
          </span>
          {openingOverride && (
            <>
              {" "}
              · Manuellt: <b>{KR0(openingOverride.amount)} kr</b>{" "}
              <span className="text-muted-foreground">
                ({openingOverride.updated_by_name ?? "admin"} {when(openingOverride.updated_at)})
              </span>
              <Button
                size="sm"
                variant="ghost"
                className="ml-1 h-7"
                disabled={busy || !position}
                onClick={() => act.mutate({ action: "cashflow_opening_set", fyFrom: position?.fy_from, amount: null })}
              >
                <RotateCcw className="size-3 mr-1" /> läs från huvudboken
              </Button>
            </>
          )}
        </div>
        <div className="flex items-center gap-2">
          <Input
            className="w-40 h-8"
            placeholder="Manuell ingående kassa"
            value={openingInput}
            onChange={(e) => setOpeningInput(e.target.value)}
            inputMode="decimal"
          />
          <Button
            size="sm"
            disabled={busy || !position || !openingInput.trim()}
            onClick={() => act.mutate({ action: "cashflow_opening_set", fyFrom: position?.fy_from, amount: openingInput })}
          >
            <Check className="size-4 mr-1" /> Spara
          </Button>
        </div>
      </Card>

      <Card className="overflow-hidden">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Rad</TableHead>
              <TableHead className="text-right">Belopp per månad</TableHead>
              <TableHead>Källa</TableHead>
              <TableHead>Ändrad</TableHead>
              <TableHead>Månader med egen siffra</TableHead>
              <TableHead className="text-right">Åtgärd</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((p) => (
              <TableRow key={p.row_key} data-row={p.row_key}>
                <TableCell className="font-medium whitespace-nowrap">{p.label}</TableCell>
                <TableCell className="text-right tabular-nums">
                  {editing === p.row_key ? (
                    <Input
                      autoFocus
                      className="w-32 h-8 ml-auto text-right"
                      value={amount}
                      inputMode="decimal"
                      onChange={(e) => setAmount(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") act.mutate({ action: "cashflow_plan_set_row", rowKey: p.row_key, amount });
                        if (e.key === "Escape") setEditing(null);
                      }}
                    />
                  ) : p.amount === null ? (
                    <span className="text-muted-foreground">–</span>
                  ) : (
                    KR0(p.amount)
                  )}
                </TableCell>
                <TableCell>
                  {p.source === "manual" ? (
                    <Badge>ändrad på sidan</Badge>
                  ) : p.source === "ledger" ? (
                    <Badge variant="secondary" title={p.basis ?? ""}>
                      från bokföringen
                    </Badge>
                  ) : (
                    <span className="text-xs text-muted-foreground">ingen plan</span>
                  )}
                  {p.basis && p.source === "ledger" && <div className="text-[11px] text-muted-foreground mt-0.5">{p.basis}</div>}
                </TableCell>
                <TableCell className="text-xs text-muted-foreground whitespace-nowrap">
                  {p.updated_at ? `${p.updated_by_name ?? (p.source === "ledger" ? "synken" : "admin")} · ${when(p.updated_at)}` : ""}
                </TableCell>
                <TableCell>
                  <div className="flex flex-wrap gap-1 items-center">
                    {p.months.map((m) => (
                      <Badge key={m.month} variant="outline" className="font-normal gap-1" title={`${m.updated_by_name ?? "admin"} ${when(m.updated_at)}${m.note ? ` · ${m.note}` : ""}`}>
                        {monthLong(m.month)}: {KR0(m.amount)}
                        <button
                          type="button"
                          className="ml-1 text-muted-foreground hover:text-destructive"
                          disabled={busy}
                          title="Ta bort månadens egen siffra"
                          onClick={() => act.mutate({ action: "cashflow_plan_set_month", rowKey: p.row_key, month: m.month, amount: null })}
                        >
                          <X className="size-3" />
                        </button>
                      </Badge>
                    ))}
                    {overrideRow === p.row_key ? (
                      <div className="flex items-center gap-1">
                        <Select value={overrideMonth} onValueChange={setOverrideMonth}>
                          <SelectTrigger className="h-8 w-40">
                            <SelectValue placeholder="Månad" />
                          </SelectTrigger>
                          <SelectContent>
                            {months.map((m) => (
                              <SelectItem key={m} value={m}>
                                {monthLong(m)}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                        <Input className="w-28 h-8" placeholder="Belopp" value={overrideAmount} inputMode="decimal" onChange={(e) => setOverrideAmount(e.target.value)} />
                        <Button
                          size="sm"
                          className="h-8"
                          disabled={busy || !overrideMonth || !overrideAmount.trim()}
                          onClick={() => act.mutate({ action: "cashflow_plan_set_month", rowKey: p.row_key, month: overrideMonth, amount: overrideAmount })}
                        >
                          {busy ? <Loader2 className="size-4 animate-spin" /> : <Check className="size-4" />}
                        </Button>
                        <Button size="sm" variant="ghost" className="h-8" onClick={() => setOverrideRow(null)}>
                          <X className="size-4" />
                        </Button>
                      </div>
                    ) : (
                      <Button size="sm" variant="ghost" className="h-7 text-xs" disabled={busy} onClick={() => { setOverrideRow(p.row_key); setOverrideMonth(months[0] ?? ""); setOverrideAmount(""); }}>
                        <Plus className="size-3 mr-1" /> månad
                      </Button>
                    )}
                  </div>
                </TableCell>
                <TableCell className="text-right">
                  {editing === p.row_key ? (
                    <div className="flex gap-1 justify-end">
                      <Button size="sm" disabled={busy || !amount.trim()} onClick={() => act.mutate({ action: "cashflow_plan_set_row", rowKey: p.row_key, amount })}>
                        {busy ? <Loader2 className="size-4 animate-spin" /> : <Check className="size-4 mr-1" />} Spara
                      </Button>
                      <Button size="sm" variant="outline" onClick={() => setEditing(null)}>
                        Avbryt
                      </Button>
                    </div>
                  ) : (
                    <div className="flex gap-1 justify-end">
                      <Button size="sm" variant="outline" disabled={busy} onClick={() => { setEditing(p.row_key); setAmount(p.amount === null ? "" : String(Math.round(p.amount))); }}>
                        Ändra belopp
                      </Button>
                      {p.source === "manual" && (
                        <Button size="sm" variant="ghost" disabled={busy} title="Ta bort din siffra – synken fyller på från bokföringen igen" onClick={() => act.mutate({ action: "cashflow_plan_set_row", rowKey: p.row_key, amount: null })}>
                          <RotateCcw className="size-4" />
                        </Button>
                      )}
                    </div>
                  )}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </Card>
    </div>
  );
}
