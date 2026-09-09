import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { toast } from "sonner";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Check, Loader2, Plus, Trash2 } from "lucide-react";
import {
  type AccountMapRow,
  type AccountRow,
  callFortnoxAction,
  type CashflowHealth,
  type CashflowRowDef,
  KR0,
  type RevenueRule,
  RULE_KIND_LABEL,
  type UnmappedAccount,
} from "@/lib/fortnox/cashflow";

/**
 * The two rule tables and the settings behind the grid, editable: the category rule for
 * money in (seller / project / screen type / billing → income row), the account map for
 * money out (account, range or supplier → workbook row), the accounts no rule covers (with
 * their amounts, so nothing vanishes silently), and the VAT period, its payment lag and
 * which accounts are "kassan". A change re-renders the grid without a sync.
 * Erik's component (round two).
 */
export function CashflowRules({
  rules,
  accountMap,
  unmapped,
  accounts,
  rows,
  health,
  onChanged,
}: {
  rules: RevenueRule[];
  accountMap: AccountMapRow[];
  unmapped: UnmappedAccount[];
  accounts: AccountRow[];
  rows: CashflowRowDef[];
  health: CashflowHealth | null;
  onChanged: () => void;
}) {
  const act = useMutation({
    mutationFn: (body: Record<string, unknown>) => callFortnoxAction(body),
    onSuccess: (_r, body) => {
      toast.success(
        String(body.action).includes("delete") ? "Regeln är borttagen" : String(body.action) === "cashflow_setting_set" ? "Inställningen sparad" : "Regeln sparad",
      );
      onChanged();
    },
    onError: (e: Error) => toast.error(e.message),
  });
  const busy = act.isPending;
  const rowLabel = (key: string) => rows.find((r) => r.key === key)?.label ?? key;
  const accountName = (n: number | null) => (n === null ? "" : (accounts.find((a) => a.account === n)?.description ?? ""));

  return (
    <div className="space-y-4">
      <RulesCard rules={rules} rows={rows} rowLabel={rowLabel} busy={busy} act={(b) => act.mutate(b)} />
      <AccountMapCard accountMap={accountMap} rows={rows} rowLabel={rowLabel} accountName={accountName} busy={busy} act={(b) => act.mutate(b)} />
      <Card className="overflow-hidden" data-card="unmapped">
        <div className="px-4 pt-4 pb-2 text-sm font-semibold">Okopplade konton{unmapped.length ? ` (${unmapped.length})` : ""}</div>
        <div className="px-4 pb-2 text-xs text-muted-foreground">
          Konton med bankrörelser eller leverantörsfakturor som ingen regel täcker. De ligger på <b>Övriga kostnader</b> tills de mappas – inget försvinner.
        </div>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Konto</TableHead>
              <TableHead>Namn</TableHead>
              <TableHead className="text-right">Belopp</TableHead>
              <TableHead className="text-right">Poster</TableHead>
              <TableHead>Period</TableHead>
              <TableHead>Källa</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {unmapped.map((u) => (
              <TableRow key={u.account}>
                <TableCell className="font-medium">{u.account}</TableCell>
                <TableCell>{u.description ?? ""}</TableCell>
                <TableCell className="text-right tabular-nums">{KR0(u.amount)}</TableCell>
                <TableCell className="text-right">{u.postings}</TableCell>
                <TableCell className="text-xs whitespace-nowrap">
                  {u.first_date} – {u.last_date}
                </TableCell>
                <TableCell className="text-xs">{u.sources.join(", ")}</TableCell>
              </TableRow>
            ))}
            {unmapped.length === 0 && (
              <TableRow>
                <TableCell colSpan={6} className="text-center text-sm text-muted-foreground py-6">
                  Alla konton med rörelser är kopplade till en rad
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </Card>
      <SettingsCard health={health} busy={busy} act={(b) => act.mutate(b)} />
    </div>
  );
}

function RulesCard({
  rules,
  rows,
  rowLabel,
  busy,
  act,
}: {
  rules: RevenueRule[];
  rows: CashflowRowDef[];
  rowLabel: (k: string) => string;
  busy: boolean;
  act: (b: Record<string, unknown>) => void;
}) {
  const [kind, setKind] = useState<RevenueRule["kind"]>("seller");
  const [value, setValue] = useState("");
  const [rowKey, setRowKey] = useState("egen");
  const [priority, setPriority] = useState("50");
  const incomeRows = rows.filter((r) => r.income && r.kind === "source");
  return (
    <Card className="overflow-hidden" data-card="rules">
      <div className="px-4 pt-4 pb-2 text-sm font-semibold">Kategoriregel – pengar in</div>
      <div className="px-4 pb-2 text-xs text-muted-foreground">
        Vilken intäktsrad en faktura (och en planerad delfaktura) hamnar på. Reglerna prövas i prioritetsordning, första träff gäller. Standardreglerna är
        mina gissningar utifrån arbetsboken: säljaren Alta och skärmar av typen extern → extern försäljning; projekt 2102 → programmatisk; ordrar som
        faktureras löpande (fliken Abonnemang) → abonnemang; allt annat → egen försäljning.
      </div>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead className="w-20">Prio</TableHead>
            <TableHead>Villkor</TableHead>
            <TableHead>Värde</TableHead>
            <TableHead>Rad</TableHead>
            <TableHead>Källa</TableHead>
            <TableHead className="text-right">Åtgärd</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rules.map((r) => (
            <TableRow key={r.id} data-rule={r.id}>
              <TableCell>{r.priority}</TableCell>
              <TableCell>{RULE_KIND_LABEL[r.kind]}</TableCell>
              <TableCell className="font-medium">{r.match_value ?? "—"}</TableCell>
              <TableCell>{rowLabel(r.row_key)}</TableCell>
              <TableCell>
                <Badge variant={r.source === "manual" ? "default" : "secondary"}>{r.source === "manual" ? "ändrad" : "standard"}</Badge>
                {r.note && <div className="text-[11px] text-muted-foreground mt-0.5 max-w-md">{r.note}</div>}
              </TableCell>
              <TableCell className="text-right">
                {r.kind !== "default" && (
                  <Button size="sm" variant="ghost" disabled={busy} title="Ta bort regeln" onClick={() => act({ action: "cashflow_rule_delete", id: r.id })}>
                    <Trash2 className="size-4" />
                  </Button>
                )}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
      <div className="p-4 flex flex-wrap items-end gap-2 border-t bg-muted/20">
        <div className="space-y-1">
          <Label className="text-xs">Villkor</Label>
          <Select value={kind} onValueChange={(v) => setKind(v as RevenueRule["kind"])}>
            <SelectTrigger className="h-8 w-44">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {(["seller", "project", "screen_type", "billing"] as const).map((k) => (
                <SelectItem key={k} value={k}>
                  {RULE_KIND_LABEL[k]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1">
          <Label className="text-xs">Värde</Label>
          <Input className="h-8 w-44" placeholder={kind === "billing" ? "abonnemang / engang" : kind === "project" ? "t.ex. 2102" : kind === "screen_type" ? "egen / extern / digital" : "t.ex. Alta"} value={value} onChange={(e) => setValue(e.target.value)} />
        </div>
        <div className="space-y-1">
          <Label className="text-xs">Rad</Label>
          <Select value={rowKey} onValueChange={setRowKey}>
            <SelectTrigger className="h-8 w-72">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {incomeRows.map((r) => (
                <SelectItem key={r.key} value={r.key}>
                  {r.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1">
          <Label className="text-xs">Prio</Label>
          <Input className="h-8 w-20" value={priority} inputMode="numeric" onChange={(e) => setPriority(e.target.value)} />
        </div>
        <Button size="sm" disabled={busy || !value.trim()} onClick={() => { act({ action: "cashflow_rule_save", kind, matchValue: value.trim(), rowKey, priority: Number(priority) }); setValue(""); }}>
          {busy ? <Loader2 className="size-4 mr-1 animate-spin" /> : <Plus className="size-4 mr-1" />} Lägg till regel
        </Button>
      </div>
    </Card>
  );
}

function AccountMapCard({
  accountMap,
  rows,
  rowLabel,
  accountName,
  busy,
  act,
}: {
  accountMap: AccountMapRow[];
  rows: CashflowRowDef[];
  rowLabel: (k: string) => string;
  accountName: (n: number | null) => string;
  busy: boolean;
  act: (b: Record<string, unknown>) => void;
}) {
  const [shape, setShape] = useState<"account" | "range" | "supplier">("account");
  const [account, setAccount] = useState("");
  const [accountTo, setAccountTo] = useState("");
  const [supplier, setSupplier] = useState("");
  const [rowKey, setRowKey] = useState("ovriga_kostnader");
  const [filter, setFilter] = useState("");
  const outRows = rows.filter((r) => r.kind === "source");
  const q = filter.trim().toLowerCase();
  const visible = accountMap.filter((m) => {
    if (!q) return true;
    return `${m.account ?? ""} ${m.account_to ?? ""} ${m.supplier_match ?? ""} ${rowLabel(m.row_key)} ${m.note ?? ""}`.toLowerCase().includes(q);
  });
  const shapeOf = (m: AccountMapRow) => (m.supplier_match ? "leverantör" : m.account_to ? "intervall" : "konto");
  return (
    <Card className="overflow-hidden" data-card="account-map">
      <div className="px-4 pt-4 pb-2 text-sm font-semibold">Kontomappning – pengar ut</div>
      <div className="px-4 pb-2 text-xs text-muted-foreground">
        Vilken rad en leverantörsfaktura eller bankrörelse hamnar på: en leverantörsregel (nummer eller namn som börjar med …) vinner över ett exakt
        konto, som vinner över det smalaste kontointervallet. Standardmappningen är min läsning av BAS mot arbetsbokens rader – Filips kontoplan
        avgör; ändra här.
      </div>
      <div className="px-4 pb-2">
        <Input className="h-8 w-72" placeholder="Filtrera konto, leverantör, rad…" value={filter} onChange={(e) => setFilter(e.target.value)} />
      </div>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Typ</TableHead>
            <TableHead>Konto / leverantör</TableHead>
            <TableHead>Rad</TableHead>
            <TableHead>Källa</TableHead>
            <TableHead className="text-right">Åtgärd</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {visible.map((m) => (
            <TableRow key={m.id} data-map={m.id}>
              <TableCell className="text-xs">{shapeOf(m)}</TableCell>
              <TableCell>
                <span className="font-medium">
                  {m.supplier_match ?? (m.account_to ? `${m.account}–${m.account_to}` : m.account)}
                </span>
                {!m.supplier_match && !m.account_to && accountName(m.account) && (
                  <span className="text-xs text-muted-foreground ml-2">{accountName(m.account)}</span>
                )}
                {m.note && <div className="text-[11px] text-muted-foreground">{m.note}</div>}
              </TableCell>
              <TableCell>{rowLabel(m.row_key)}</TableCell>
              <TableCell>
                <Badge variant={m.source === "manual" ? "default" : "secondary"}>{m.source === "manual" ? "ändrad" : "standard"}</Badge>
              </TableCell>
              <TableCell className="text-right">
                <Button size="sm" variant="ghost" disabled={busy} title="Ta bort mappningen" onClick={() => act({ action: "account_map_delete", id: m.id })}>
                  <Trash2 className="size-4" />
                </Button>
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
      <div className="p-4 flex flex-wrap items-end gap-2 border-t bg-muted/20">
        <div className="space-y-1">
          <Label className="text-xs">Typ</Label>
          <Select value={shape} onValueChange={(v) => setShape(v as typeof shape)}>
            <SelectTrigger className="h-8 w-36">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="account">Konto</SelectItem>
              <SelectItem value="range">Kontointervall</SelectItem>
              <SelectItem value="supplier">Leverantör</SelectItem>
            </SelectContent>
          </Select>
        </div>
        {shape !== "supplier" ? (
          <>
            <div className="space-y-1">
              <Label className="text-xs">{shape === "range" ? "Från konto" : "Konto"}</Label>
              <Input className="h-8 w-28" placeholder="5010" value={account} inputMode="numeric" onChange={(e) => setAccount(e.target.value)} />
            </div>
            {shape === "range" && (
              <div className="space-y-1">
                <Label className="text-xs">Till konto</Label>
                <Input className="h-8 w-28" placeholder="5019" value={accountTo} inputMode="numeric" onChange={(e) => setAccountTo(e.target.value)} />
              </div>
            )}
          </>
        ) : (
          <div className="space-y-1">
            <Label className="text-xs">Leverantörsnummer eller namn börjar med</Label>
            <Input className="h-8 w-56" placeholder="Google" value={supplier} onChange={(e) => setSupplier(e.target.value)} />
          </div>
        )}
        <div className="space-y-1">
          <Label className="text-xs">Rad</Label>
          <Select value={rowKey} onValueChange={setRowKey}>
            <SelectTrigger className="h-8 w-72">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {outRows.map((r) => (
                <SelectItem key={r.key} value={r.key}>
                  {r.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <Button
          size="sm"
          disabled={busy || (shape === "supplier" ? !supplier.trim() : !account.trim() || (shape === "range" && !accountTo.trim()))}
          onClick={() => {
            act(
              shape === "supplier"
                ? { action: "account_map_save", supplierMatch: supplier.trim(), rowKey }
                : { action: "account_map_save", account: Number(account), accountTo: shape === "range" ? Number(accountTo) : null, rowKey },
            );
            setAccount("");
            setAccountTo("");
            setSupplier("");
          }}
        >
          {busy ? <Loader2 className="size-4 mr-1 animate-spin" /> : <Plus className="size-4 mr-1" />} Lägg till mappning
        </Button>
      </div>
    </Card>
  );
}

function SettingsCard({ health, busy, act }: { health: CashflowHealth | null; busy: boolean; act: (b: Record<string, unknown>) => void }) {
  const [lag, setLag] = useState<string>(String(health?.vat_lag_months ?? 2));
  const [cash, setCash] = useState<string>(health?.cash_accounts ?? "1900-1999");
  return (
    <Card className="p-4 space-y-3" data-card="settings">
      <div className="text-sm font-semibold">Inställningar</div>
      <div className="flex flex-wrap items-end gap-3">
        <div className="space-y-1">
          <Label className="text-xs">Momsperiod (mötesfråga – antaget månad)</Label>
          <Select value={health?.vat_period ?? "monthly"} onValueChange={(v) => act({ action: "cashflow_setting_set", key: "vat_period", value: v })}>
            <SelectTrigger className="h-8 w-44">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="monthly">Varje månad</SelectItem>
              <SelectItem value="quarterly">Varje kvartal</SelectItem>
              <SelectItem value="yearly">Helår</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1">
          <Label className="text-xs">Betalmånad: månader efter periodens slut</Label>
          <div className="flex gap-1">
            <Input className="h-8 w-16" value={lag} inputMode="numeric" onChange={(e) => setLag(e.target.value)} />
            <Button size="sm" variant="outline" className="h-8" disabled={busy} onClick={() => act({ action: "cashflow_setting_set", key: "vat_lag_months", value: lag })}>
              <Check className="size-4" />
            </Button>
          </div>
        </div>
        <div className="space-y-1">
          <Label className="text-xs">Kassakonton (konto eller intervall, kommaseparerat)</Label>
          <div className="flex gap-1">
            <Input className="h-8 w-56" value={cash} onChange={(e) => setCash(e.target.value)} />
            <Button size="sm" variant="outline" className="h-8" disabled={busy} onClick={() => act({ action: "cashflow_setting_set", key: "cash_accounts", value: cash })}>
              <Check className="size-4" />
            </Button>
          </div>
        </div>
      </div>
      <div className="text-xs text-muted-foreground">
        Momsen per period räknas från 26xx-kontona i huvudboken (stängda månader) och från momsraderna i prognosen, och läggs på raden Moms att
        betala i betalmånaden (den 12:e). Arbetsgivaravgifter och skatt som Bron bokar en månad läggs på månaden efter.
      </div>
    </Card>
  );
}
