import { createFileRoute, Link, redirect } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { format } from "date-fns";
import { sv } from "date-fns/locale";
import { supabase } from "@/integrations/supabase/client";
import { PageHeader } from "@/components/page-header";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { FileDown, FileSpreadsheet, Link2 } from "lucide-react";
import { toast } from "sonner";
import {
  fetchLedgerHealth,
  fetchLedgerLeftovers,
  fetchLedgerYear,
  installmentLabel,
  type LedgerRow,
  SEK2,
  SOURCE_MISSING,
  SOURCE_MISSING_HINT,
} from "@/lib/fortnox/ledger";
import { generateLedgerPdf } from "@/lib/fortnox/ledger-pdf";
import { downloadXlsx, type XlsxColumn } from "@/lib/fortnox/xlsx";

// Kundreskontra (round one): Filip's ledger tab, inside the CRM, filled from Fortnox.
// One row per Fortnox invoice with his eleven columns, plus Kvar att betala and the
// instalment counter; filters on year, month (by fakturadatum), seller, screen, customer
// and paid state; totals for the filtered set; XLSX and PDF. Admin-only, gated
// server-side like faktura.tsx; the data comes straight from fortnox.v_ledger with the
// admin's own session (row level security says who sees rows). Erik's file.

export const Route = createFileRoute("/_authenticated/kundreskontra")({
  beforeLoad: async () => {
    const { data: u } = await supabase.auth.getUser();
    if (!u.user) throw redirect({ to: "/auth" });
    const { data: roles } = await supabase
      .from("user_roles")
      .select("role")
      .eq("user_id", u.user.id);
    if (!(roles ?? []).some((r) => r.role === "admin")) {
      throw redirect({ to: "/dashboard" });
    }
  },
  component: KundreskontraPage,
});

type PaidFilter = "alla" | "betald" | "obetald" | "forfallen";

const MONTHS = Array.from({ length: 12 }, (_, i) => ({
  value: String(i),
  label: format(new Date(2000, i, 1), "MMMM", { locale: sv }),
}));

const day = (iso: string | null | undefined) => (iso ? iso.slice(0, 10) : "");
const when = (iso: string | null | undefined) =>
  iso ? format(new Date(iso), "yyyy-MM-dd HH:mm") : "–";
const ja = (b: boolean) => (b ? "Ja" : "Nej");

/** Filip's eleven columns, then Kvar att betala, Delfaktura, Makulerad and the Fortnox number. */
const XLSX_COLUMNS: XlsxColumn<LedgerRow>[] = [
  { header: "Säljare", kind: "text", width: 18, value: (r) => r.saljare ?? "" },
  { header: "Projekt", kind: "text", width: 28, value: (r) => r.projekt ?? "" },
  { header: "Kundnamn", kind: "text", width: 30, value: (r) => r.kundnamn ?? "" },
  { header: "Fakturadatum", kind: "date", width: 13, value: (r) => r.fakturadatum },
  { header: "Förfallodatum", kind: "date", width: 13, value: (r) => r.forfallodatum },
  { header: "Belopp ex moms (SEK)", kind: "amount", width: 18, value: (r) => r.belopp_ex_moms },
  { header: "Moms (SEK)", kind: "amount", width: 12, value: (r) => r.moms },
  { header: "Totalt belopp (SEK)", kind: "amount", width: 16, value: (r) => r.totalt },
  { header: "Betald", kind: "boolean", width: 8, value: (r) => r.betald },
  // No source yet (the view's constant true is not a fact): "–", and a note under the rows says why.
  { header: "Såld", kind: "text", width: 8, value: () => SOURCE_MISSING },
  { header: "Inlagd i rapport", kind: "text", width: 14, value: () => SOURCE_MISSING },
  { header: "Kvar att betala (SEK)", kind: "amount", width: 18, value: (r) => r.kvar_att_betala },
  { header: "Delfaktura", kind: "text", width: 16, value: (r) => installmentLabel(r) },
  { header: "Makulerad", kind: "boolean", width: 10, value: (r) => r.cancelled },
  { header: "Fortnox-nr", kind: "text", width: 10, value: (r) => r.document_number },
];

function distinct(values: (string | null)[]): string[] {
  return [...new Set(values.filter((v): v is string => Boolean(v)))].sort((a, b) =>
    a.localeCompare(b, "sv"),
  );
}

function KundreskontraPage() {
  const now = new Date();
  const [year, setYear] = useState(now.getFullYear());
  const [month, setMonth] = useState<string>("alla");
  const [seller, setSeller] = useState<string>("alla");
  const [screen, setScreen] = useState<string>("alla");
  const [customer, setCustomer] = useState<string>("alla");
  const [paid, setPaid] = useState<PaidFilter>("alla");
  const [tab, setTab] = useState("reskontra");

  const rows = useQuery({
    queryKey: ["fortnox-ledger", year],
    queryFn: () => fetchLedgerYear(year),
  });
  const leftovers = useQuery({
    queryKey: ["fortnox-ledger-leftovers"],
    queryFn: fetchLedgerLeftovers,
  });
  const health = useQuery({ queryKey: ["fortnox-ledger-health"], queryFn: fetchLedgerHealth });

  const all = useMemo(() => rows.data ?? [], [rows.data]);
  const sellers = useMemo(() => distinct(all.map((r) => r.saljare)), [all]);
  const screens = useMemo(() => distinct(all.map((r) => r.projekt)), [all]);
  const customers = useMemo(() => distinct(all.map((r) => r.kundnamn)), [all]);

  const filtered = useMemo(
    () =>
      all.filter((r) => {
        if (
          month !== "alla" &&
          new Date(`${day(r.fakturadatum)}T00:00:00`).getMonth() !== Number(month)
        )
          return false;
        if (seller !== "alla" && r.saljare !== seller) return false;
        if (screen !== "alla" && r.projekt !== screen) return false;
        if (customer !== "alla" && r.kundnamn !== customer) return false;
        if (paid === "betald" && (!r.betald || r.cancelled)) return false;
        if (paid === "obetald" && (r.betald || r.cancelled)) return false;
        if (paid === "forfallen" && !r.forfallen) return false;
        return true;
      }),
    [all, month, seller, screen, customer, paid],
  );

  const live = filtered.filter((r) => !r.cancelled);
  const totals = {
    count: live.length,
    paid: live.filter((r) => r.betald).length,
    overdue: live.filter((r) => r.forfallen).length,
    belopp: live.reduce((s, r) => s + r.belopp_ex_moms, 0),
    moms: live.reduce((s, r) => s + r.moms, 0),
    totalt: live.reduce((s, r) => s + r.totalt, 0),
    kvar: live.reduce((s, r) => s + r.kvar_att_betala, 0),
  };

  const filterLabel = [
    `År ${year}`,
    month === "alla" ? "alla månader" : MONTHS[Number(month)].label,
    seller === "alla" ? "alla säljare" : `säljare ${seller}`,
    screen === "alla" ? "alla skärmar" : screen,
    customer === "alla" ? "alla kunder" : customer,
    paid === "alla"
      ? "betalda och obetalda"
      : paid === "betald"
        ? "endast betalda"
        : paid === "obetald"
          ? "endast obetalda"
          : "endast förfallna",
  ].join(" · ");

  const h = health.data;
  const syncedLabel = h
    ? `Senast synkad från Fortnox: ${when(h.invoices_synced_at)} · Otydliga namn: ${h.last_run_claude_used ? "Claude + regler" : "enbart regler"}`
    : "Synkstatus okänd";

  const years = Array.from({ length: 5 }, (_, i) => now.getFullYear() - 3 + i);

  const downloadXlsxFile = () => {
    try {
      downloadXlsx(
        `kundreskontra-${year}${month === "alla" ? "" : `-${String(Number(month) + 1).padStart(2, "0")}`}.xlsx`,
        filtered,
        XLSX_COLUMNS,
        "Kundreskontra",
        [`Såld och Inlagd i rapport: ${SOURCE_MISSING} = ${SOURCE_MISSING_HINT}`],
      );
    } catch (e) {
      toast.error((e as Error).message);
    }
  };

  return (
    <>
      <PageHeader
        title="Kundreskontra"
        description="Filips reskontra, fylld från Fortnox: en rad per faktura, betald enligt Fortnox, delfaktura räknad från Fortnox."
        actions={
          <>
            <Button variant="outline" onClick={downloadXlsxFile} disabled={filtered.length === 0}>
              <FileSpreadsheet className="size-4 mr-1" /> Ladda ner XLSX
            </Button>
            <Button
              variant="outline"
              disabled={filtered.length === 0}
              onClick={() =>
                generateLedgerPdf({
                  title: `Kundreskontra ${year}`,
                  filterLabel,
                  syncedLabel,
                  rows: filtered,
                })
              }
            >
              <FileDown className="size-4 mr-1" /> Ladda ner PDF
            </Button>
          </>
        }
      />
      <div className="p-6 space-y-4">
        {h?.dev_fake_payments && (
          <Card className="p-3 text-xs text-destructive">
            DEV: betalningar är fejkade i dev-projektets tabell (testbolagets integration saknar
            rättigheten payment). Inget av detta finns i Fortnox.
          </Card>
        )}
        <Tabs value={tab} onValueChange={setTab}>
          <TabsList>
            <TabsTrigger value="reskontra">
              Reskontra{" "}
              <Badge variant="secondary" className="ml-1">
                {all.filter((r) => !r.cancelled).length}
              </Badge>
            </TabsTrigger>
            <TabsTrigger value="okopplade">
              Okopplade{" "}
              <Badge variant="secondary" className="ml-1">
                {(leftovers.data ?? []).length}
              </Badge>
            </TabsTrigger>
          </TabsList>

          <TabsContent value="reskontra" className="space-y-4 pt-4">
            <Card className="p-4 flex flex-wrap items-end gap-3">
              <Filter
                label="År"
                value={String(year)}
                onChange={(v) => setYear(Number(v))}
                width="w-24"
                options={years.map((y) => ({ value: String(y), label: String(y) }))}
              />
              <Filter
                label="Månad (fakturadatum)"
                value={month}
                onChange={setMonth}
                width="w-44"
                options={[{ value: "alla", label: "Alla månader" }, ...MONTHS]}
              />
              <Filter
                label="Säljare"
                value={seller}
                onChange={setSeller}
                width="w-44"
                options={[
                  { value: "alla", label: "Alla säljare" },
                  ...sellers.map((s) => ({ value: s, label: s })),
                ]}
              />
              <Filter
                label="Skärm"
                value={screen}
                onChange={setScreen}
                width="w-56"
                options={[
                  { value: "alla", label: "Alla skärmar" },
                  ...screens.map((s) => ({ value: s, label: s })),
                ]}
              />
              <Filter
                label="Kund"
                value={customer}
                onChange={setCustomer}
                width="w-56"
                options={[
                  { value: "alla", label: "Alla kunder" },
                  ...customers.map((c) => ({ value: c, label: c })),
                ]}
              />
              <Filter
                label="Betald"
                value={paid}
                onChange={(v) => setPaid(v as PaidFilter)}
                width="w-36"
                options={[
                  { value: "alla", label: "Alla" },
                  { value: "betald", label: "Betald" },
                  { value: "obetald", label: "Obetald" },
                  { value: "forfallen", label: "Förfallen" },
                ]}
              />
            </Card>

            <div className="grid gap-3 sm:grid-cols-4">
              <Stat
                label="Fakturor"
                value={`${totals.count}`}
                sub={`${totals.paid} betalda · ${totals.overdue} förfallna`}
              />
              <Stat
                label="Belopp ex moms"
                value={`${SEK2(totals.belopp)} kr`}
                sub={`moms ${SEK2(totals.moms)} kr`}
              />
              <Stat label="Totalt" value={`${SEK2(totals.totalt)} kr`} />
              <Stat label="Kvar att betala" value={`${SEK2(totals.kvar)} kr`} />
            </div>

            <Card className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Säljare</TableHead>
                    <TableHead>Projekt</TableHead>
                    <TableHead>Kundnamn</TableHead>
                    <TableHead>Fakturadatum</TableHead>
                    <TableHead>Förfallodatum</TableHead>
                    <TableHead className="text-right">Belopp ex moms</TableHead>
                    <TableHead className="text-right">Moms</TableHead>
                    <TableHead className="text-right">Totalt</TableHead>
                    <TableHead>Betald</TableHead>
                    <TableHead title={SOURCE_MISSING_HINT}>Såld</TableHead>
                    <TableHead title={SOURCE_MISSING_HINT}>Inlagd i rapport</TableHead>
                    <TableHead className="text-right">Kvar att betala</TableHead>
                    <TableHead>Delfaktura</TableHead>
                    <TableHead>Fortnox-nr</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {rows.isLoading && (
                    <TableRow>
                      <TableCell colSpan={14} className="text-sm text-muted-foreground">
                        Hämtar…
                      </TableCell>
                    </TableRow>
                  )}
                  {rows.error && (
                    <TableRow>
                      <TableCell colSpan={14} className="text-sm text-destructive">
                        Kunde inte läsa reskontran: {(rows.error as Error).message}
                      </TableCell>
                    </TableRow>
                  )}
                  {!rows.isLoading && filtered.length === 0 && (
                    <TableRow>
                      <TableCell
                        colSpan={14}
                        className="text-center text-sm text-muted-foreground py-8"
                      >
                        Inga fakturor för det här urvalet
                        {all.length === 0 ? " – kör Synka nu på Fortnox-koppling först" : ""}
                      </TableCell>
                    </TableRow>
                  )}
                  {filtered.map((r) => (
                    <TableRow
                      key={r.document_number}
                      className={
                        r.cancelled
                          ? "text-muted-foreground line-through"
                          : r.forfallen
                            ? "bg-destructive/5"
                            : ""
                      }
                    >
                      <TableCell>
                        {r.saljare ?? <span className="text-muted-foreground">—</span>}
                      </TableCell>
                      <TableCell>
                        {r.projekt ?? <span className="text-muted-foreground">—</span>}
                      </TableCell>
                      <TableCell>
                        <span className="font-medium">
                          {r.kundnamn ?? r.fortnox_customer_name ?? "—"}
                        </span>
                        {r.match_status !== "linked" && !r.cancelled && (
                          <Badge variant="outline" className="ml-2 no-underline">
                            okopplad
                          </Badge>
                        )}
                        {r.credit && (
                          <Badge variant="secondary" className="ml-2">
                            kredit
                          </Badge>
                        )}
                      </TableCell>
                      <TableCell className="whitespace-nowrap">{day(r.fakturadatum)}</TableCell>
                      <TableCell className="whitespace-nowrap">
                        {day(r.forfallodatum) || "—"}
                      </TableCell>
                      <TableCell className="text-right">{SEK2(r.belopp_ex_moms)}</TableCell>
                      <TableCell className="text-right">{SEK2(r.moms)}</TableCell>
                      <TableCell className="text-right">{SEK2(r.totalt)}</TableCell>
                      <TableCell>
                        {r.cancelled ? (
                          <Badge variant="outline">Makulerad</Badge>
                        ) : r.betald ? (
                          <Badge>Ja</Badge>
                        ) : r.forfallen ? (
                          <Badge variant="destructive">Nej – förfallen</Badge>
                        ) : (
                          <Badge variant="secondary">Nej</Badge>
                        )}
                      </TableCell>
                      <TableCell title={SOURCE_MISSING_HINT} data-source-missing="sald">
                        {SOURCE_MISSING}
                      </TableCell>
                      <TableCell title={SOURCE_MISSING_HINT} data-source-missing="inlagd">
                        {SOURCE_MISSING}
                      </TableCell>
                      <TableCell className="text-right">
                        {r.cancelled ? "—" : SEK2(r.kvar_att_betala)}
                      </TableCell>
                      <TableCell
                        className="whitespace-nowrap"
                        title={
                          r.planned_installment_amount != null
                            ? `Planerat: ${r.installments_planned} × ${SEK2(r.planned_installment_amount)} kr`
                            : undefined
                        }
                      >
                        {installmentLabel(r) || <span className="text-muted-foreground">—</span>}
                      </TableCell>
                      <TableCell className="text-muted-foreground">{r.document_number}</TableCell>
                    </TableRow>
                  ))}
                  {live.length > 0 && (
                    <TableRow className="bg-muted/40 font-semibold">
                      <TableCell colSpan={5}>
                        Totalt ({totals.count} fakturor, {totals.paid} betalda)
                      </TableCell>
                      <TableCell className="text-right">{SEK2(totals.belopp)}</TableCell>
                      <TableCell className="text-right">{SEK2(totals.moms)}</TableCell>
                      <TableCell className="text-right">{SEK2(totals.totalt)}</TableCell>
                      <TableCell colSpan={3} />
                      <TableCell className="text-right">{SEK2(totals.kvar)}</TableCell>
                      <TableCell colSpan={2} />
                    </TableRow>
                  )}
                </TableBody>
              </Table>
            </Card>
            <div className="text-xs text-muted-foreground">
              {syncedLabel}. Betald = saldo noll i Fortnox. Såld och Inlagd i rapport visar{" "}
              {SOURCE_MISSING}: {SOURCE_MISSING_HINT}. Makulerade fakturor visas överstrukna och
              räknas inte i summorna.
            </div>
          </TabsContent>

          <TabsContent value="okopplade" className="space-y-4 pt-4">
            <Card className="p-4 text-sm flex flex-wrap items-center gap-3">
              <span>
                Fakturor i Fortnox som inte har kunnat kopplas till en order av sig själva. Koppla
                eller lämna dem på
              </span>
              <Button asChild size="sm" variant="outline">
                <Link to="/fortnox-koppling">
                  <Link2 className="size-4 mr-1" /> Fortnox-koppling, fliken Fakturor
                </Link>
              </Button>
            </Card>
            <Card className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Fortnox-nr</TableHead>
                    <TableHead>Fakturadatum</TableHead>
                    <TableHead>Kund (Fortnox)</TableHead>
                    <TableHead>Projekt</TableHead>
                    <TableHead className="text-right">Belopp ex moms</TableHead>
                    <TableHead>Betald</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Anledning</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {(leftovers.data ?? []).map((r) => (
                    <TableRow key={r.document_number}>
                      <TableCell>{r.document_number}</TableCell>
                      <TableCell className="whitespace-nowrap">{day(r.fakturadatum)}</TableCell>
                      <TableCell className="font-medium">
                        {r.kundnamn ?? r.fortnox_customer_name ?? "—"}
                      </TableCell>
                      <TableCell>{r.projekt ?? "—"}</TableCell>
                      <TableCell className="text-right">{SEK2(r.belopp_ex_moms)}</TableCell>
                      <TableCell>{ja(r.betald)}</TableCell>
                      <TableCell>
                        <Badge variant={r.match_status === "proposed" ? "secondary" : "outline"}>
                          {r.match_status === "proposed"
                            ? "Förslag"
                            : r.match_status === "ignored"
                              ? "Lämnad okopplad"
                              : "Okopplad"}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-xs text-muted-foreground max-w-md">
                        {r.match_reason}
                      </TableCell>
                    </TableRow>
                  ))}
                  {(leftovers.data ?? []).length === 0 && (
                    <TableRow>
                      <TableCell
                        colSpan={8}
                        className="text-center text-sm text-muted-foreground py-8"
                      >
                        Alla fakturor i Fortnox är kopplade till en order
                      </TableCell>
                    </TableRow>
                  )}
                </TableBody>
              </Table>
            </Card>
          </TabsContent>
        </Tabs>
      </div>
    </>
  );
}

function Filter({
  label,
  value,
  onChange,
  options,
  width,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  options: { value: string; label: string }[];
  width: string;
}) {
  return (
    <div className="space-y-1">
      <Label className="text-xs">{label}</Label>
      <Select value={value} onValueChange={onChange}>
        <SelectTrigger className={width}>
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {options.map((o) => (
            <SelectItem key={o.value} value={o.value}>
              {o.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}

function Stat({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <Card className="p-4">
      <div className="text-xs uppercase tracking-wider text-muted-foreground">{label}</div>
      <div className="mt-1 text-2xl font-semibold tracking-tight">{value}</div>
      {sub && <div className="text-xs text-muted-foreground mt-1">{sub}</div>}
    </Card>
  );
}
