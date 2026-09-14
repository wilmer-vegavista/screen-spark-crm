import { createFileRoute, redirect } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { PageHeader } from "@/components/page-header";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import {
  AlertTriangle,
  Check,
  Copy,
  EyeOff,
  Link2,
  Loader2,
  Plus,
  RefreshCw,
  RotateCcw,
  Search,
  Sheet,
} from "lucide-react";
import { format } from "date-fns";
import { toast } from "sonner";

// Fortnox-koppling: every customer and screen with its proposed Fortnox match and a
// reason, per row confirm · link to another · create in Fortnox, and "Synka nu".
// The page is a thin client: every read and write goes through the fortnox-sync
// function with the admin's session, and the function checks the admin role again
// server-side. Nothing Fortnox-shaped is reachable from the browser.
// Locally: VITE_FORTNOX_FUNCTIONS_URL points at the function run by scripts/fortnox-dev.ps1 serve.
//
// Round one adds the tab Fakturor (invoices no rule could match to an order: Bekräfta ·
// Koppla till order… · Lämna okopplad) and the Google Sheet section (the feed URL Filip
// pastes once; shown once, regenerable, revocable).

export const Route = createFileRoute("/_authenticated/fortnox-koppling")({
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
  component: FortnoxKopplingPage,
});

const FUNCTIONS_BASE: string =
  import.meta.env.VITE_FORTNOX_FUNCTIONS_URL || `${import.meta.env.VITE_SUPABASE_URL}/functions/v1`;

async function callFortnox<T>(body: Record<string, unknown>): Promise<T> {
  const { data } = await supabase.auth.getSession();
  if (!data.session) throw new Error("Inte inloggad");
  const res = await fetch(`${FUNCTIONS_BASE}/fortnox-sync`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${data.session.access_token}`,
      apikey: import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY ?? "",
    },
    body: JSON.stringify(body),
  });
  const json = (await res.json().catch(() => ({}))) as { error?: string; message?: string };
  if (!res.ok)
    throw new Error(json.error ?? json.message ?? `Fortnox-funktionen svarade ${res.status}`);
  return json as T;
}

type LinkStatus = "unmatched" | "proposed" | "linked";

interface CustomerRow {
  customer_id: string;
  company_name: string;
  org_number: string | null;
  status: LinkStatus;
  fortnox_customer_number: string | null;
  fortnox_name: string | null;
  candidate_number: string | null;
  candidate_name: string | null;
  confidence: string;
  method: string;
  reason: string | null;
  proposed_at: string | null;
  linked_at: string | null;
  linked_by: string | null;
  mismatch: string | null;
}

interface ScreenRow {
  product_id: string;
  name: string;
  city: string | null;
  active: boolean;
  status: LinkStatus;
  fortnox_project_number: string | null;
  fortnox_description: string | null;
  crm_code: string | null;
  candidate_number: string | null;
  candidate_name: string | null;
  confidence: string;
  method: string;
  reason: string | null;
  proposed_at: string | null;
  linked_at: string | null;
  linked_by: string | null;
  mismatch: string | null;
}

interface Health {
  last_run_at: string | null;
  last_run_status: string | null;
  last_run_trigger: string | null;
  last_run_created: number | null;
  last_ok_at: string | null;
  last_error_at: string | null;
  last_error: string | null;
  mismatch_count: number;
  customers_linked: number;
  customers_proposed: number;
  customers_unlinked: number;
  projects_linked: number;
  projects_proposed: number;
  projects_unlinked: number;
  // round one
  invoices_total: number;
  invoices_linked: number;
  invoices_proposed: number;
  invoices_unmatched: number;
  invoices_ignored: number;
  invoices_paid: number;
  invoices_overdue: number;
  invoices_synced_at: string | null;
  feed_rotated_at: string | null;
  dev_fake_payments: boolean;
}

interface RunRow {
  id: number;
  started_at: string;
  finished_at: string | null;
  triggered_by: string;
  status: string;
  company_name: string | null;
  proposals_written: number;
  auto_linked: number;
  customers_created: number;
  projects_created: number;
  mismatches_found: number;
  invoices_read: number;
  invoices_matched: number;
  invoices_proposed: number;
  invoices_unmatched: number;
  error: string | null;
}

/** A leftover invoice (fortnox.v_ledger row, not linked), as the status action returns it. */
interface InvoiceRow {
  document_number: string;
  fakturadatum: string;
  forfallodatum: string | null;
  kundnamn: string | null;
  fortnox_customer_name: string | null;
  customer_number: string;
  projekt: string | null;
  project_number: string | null;
  belopp_ex_moms: number | string;
  betald: boolean;
  forfallen: boolean;
  credit: boolean;
  match_status: "unmatched" | "proposed" | "ignored";
  match_confidence: string;
  match_reason: string | null;
  candidate_order_id: string | null;
  candidate_label: string | null;
  customer_id: string | null;
}

interface StatusResponse {
  health: Health;
  customers: CustomerRow[];
  screens: ScreenRow[];
  runs: RunRow[];
  invoices: InvoiceRow[];
  fortnoxConfigured: boolean;
  claudeConfigured: boolean;
}

interface SyncSummary {
  status: "ok" | "error";
  proposalsWritten: number;
  autoLinked: number;
  customersCreated: number;
  projectsCreated: number;
  mismatchesFound: number;
  claudeUsed: boolean;
  invoicesRead: number;
  invoicesMatched: number;
  invoicesProposed: number;
  invoicesUnmatched: number;
  error?: string;
}

interface OrderCandidate {
  id: string;
  customer_id: string | null;
  company_name: string;
  label: string;
  screens: string[];
}

const SEK2 = (n: number | string) =>
  new Intl.NumberFormat("sv-SE", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(Number(n) || 0);

interface Candidates {
  customers: { number: string; name: string; orgNumber: string | null }[];
  projects: { number: string; description: string }[];
}

const CONFIDENCE_LABEL: Record<string, string> = {
  exact: "Exakt",
  high: "Hög",
  medium: "Medel",
  low: "Låg",
  none: "–",
};
const METHOD_LABEL: Record<string, string> = {
  orgnr: "org.nr",
  name: "namn",
  code: "kod",
  fuzzy: "likhet",
  marker: "markör",
  manual: "manuell",
  created: "skapad",
  none: "",
};
const STATUS_LABEL: Record<LinkStatus, string> = {
  linked: "Kopplad",
  proposed: "Förslag",
  unmatched: "Saknas i Fortnox",
};

const when = (iso: string | null | undefined) =>
  iso ? format(new Date(iso), "yyyy-MM-dd HH:mm") : "–";

function StatusBadge({ status }: { status: LinkStatus }) {
  const variant = status === "linked" ? "default" : status === "proposed" ? "secondary" : "outline";
  return <Badge variant={variant}>{STATUS_LABEL[status]}</Badge>;
}

function FortnoxKopplingPage() {
  const qc = useQueryClient();
  const [tab, setTab] = useState("kunder");
  const [picker, setPicker] = useState<{
    kind: "customer" | "screen";
    id: string;
    label: string;
  } | null>(null);
  const [invoicePicker, setInvoicePicker] = useState<InvoiceRow | null>(null);

  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ["fortnox-status"],
    queryFn: () => callFortnox<StatusResponse>({ action: "status" }),
  });

  const invalidate = () => qc.invalidateQueries({ queryKey: ["fortnox-status"] });

  const sync = useMutation({
    mutationFn: (mode: "sync" | "propose") => callFortnox<SyncSummary>({ action: mode }),
    onSuccess: (s, mode) => {
      if (s.status !== "ok") {
        toast.error(`Synken misslyckades: ${s.error ?? "okänt fel"}`);
      } else if (mode === "propose") {
        toast.success(
          `Förslag klara: ${s.proposalsWritten} förslag, ${s.autoLinked} kopplade automatiskt (${s.claudeUsed ? "Claude" : "regler"})`,
        );
      } else {
        toast.success(
          `Synk klar: ${s.customersCreated} kunder + ${s.projectsCreated} skärmar skapade i Fortnox, ${s.autoLinked} kopplade, ${s.mismatchesFound} avvikelser · fakturor: ${s.invoicesRead} lästa, ${s.invoicesMatched} kopplade, ${s.invoicesProposed} förslag, ${s.invoicesUnmatched} okopplade`,
        );
      }
      invalidate();
      qc.invalidateQueries({ queryKey: ["fortnox-ledger"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const invoiceAction = useMutation({
    mutationFn: (body: Record<string, unknown>) => callFortnox<{ ok: boolean; label?: string }>(body),
    onSuccess: (r, body) => {
      toast.success(
        body.action === "invoice_link"
          ? `Fakturan kopplad till ${r.label ?? "ordern"}`
          : body.action === "invoice_ignore"
            ? "Fakturan lämnas okopplad"
            : "Fakturan bedöms om vid nästa synk",
      );
      setInvoicePicker(null);
      invalidate();
      qc.invalidateQueries({ queryKey: ["fortnox-ledger"] });
      qc.invalidateQueries({ queryKey: ["fortnox-ledger-leftovers"] });
      qc.invalidateQueries({ queryKey: ["fortnox-order-invoice-state"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const rowAction = useMutation({
    mutationFn: (body: Record<string, unknown>) =>
      callFortnox<{ ok: boolean; number?: string; outcome?: "linked" | "created" }>(body),
    onSuccess: (r, body) => {
      const verb =
        body.action === "create"
          ? r.outcome === "linked"
            ? "Fanns redan i Fortnox – kopplad till"
            : "Skapad i Fortnox som"
          : "Kopplad till";
      toast.success(`${verb} ${r.number ?? ""}`.trim());
      setPicker(null);
      invalidate();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const busy = sync.isPending || rowAction.isPending || invoiceAction.isPending;

  return (
    <>
      <PageHeader
        title="Fortnox-koppling"
        description="Varje kund och skärm med sitt föreslagna Fortnox-nummer och varför. Bekräfta, koppla om eller skapa – och synka."
        actions={
          <>
            <Button
              variant="outline"
              onClick={() => sync.mutate("propose")}
              disabled={busy || !data?.fortnoxConfigured}
            >
              {sync.isPending && sync.variables === "propose" ? (
                <Loader2 className="size-4 mr-1 animate-spin" />
              ) : (
                <Search className="size-4 mr-1" />
              )}
              Föreslå kopplingar
            </Button>
            <Button onClick={() => sync.mutate("sync")} disabled={busy || !data?.fortnoxConfigured}>
              {sync.isPending && sync.variables === "sync" ? (
                <Loader2 className="size-4 mr-1 animate-spin" />
              ) : (
                <RefreshCw className="size-4 mr-1" />
              )}
              Synka nu
            </Button>
          </>
        }
      />
      <div className="p-6 space-y-4">
        {error && (
          <Card className="p-4 text-sm text-destructive">
            Kunde inte nå Fortnox-funktionen: {(error as Error).message}{" "}
            <Button size="sm" variant="outline" className="ml-2" onClick={() => refetch()}>
              Försök igen
            </Button>
          </Card>
        )}
        {isLoading && (
          <Card className="p-8 text-center text-sm text-muted-foreground">Hämtar…</Card>
        )}
        {data && (
          <>
            <HealthCard data={data} />
            <Tabs value={tab} onValueChange={setTab}>
              <TabsList>
                <TabsTrigger value="kunder">
                  Kunder{" "}
                  <Badge variant="secondary" className="ml-1">
                    {data.customers.length}
                  </Badge>
                </TabsTrigger>
                <TabsTrigger value="skarmar">
                  Skärmar{" "}
                  <Badge variant="secondary" className="ml-1">
                    {data.screens.length}
                  </Badge>
                </TabsTrigger>
                <TabsTrigger value="avvikelser">
                  Avvikelser{" "}
                  <Badge variant="secondary" className="ml-1">
                    {data.health.mismatch_count}
                  </Badge>
                </TabsTrigger>
                <TabsTrigger value="fakturor">
                  Fakturor{" "}
                  <Badge variant="secondary" className="ml-1">
                    {data.invoices.filter((i) => i.match_status !== "ignored").length}
                  </Badge>
                </TabsTrigger>
                <TabsTrigger value="korningar">Körningar</TabsTrigger>
              </TabsList>

              <TabsContent value="fakturor" className="pt-4 space-y-4">
                <Card className="p-4 text-sm text-muted-foreground">
                  Fakturor i Fortnox som ingen regel kunde koppla till en order: fel belopp, ett projekt som inte är en
                  skärm i CRM:et, en kund utan koppling. <b>Bekräfta</b> tar förslaget, <b>Koppla till order…</b> låter dig
                  välja, <b>Lämna okopplad</b> tar bort raden från listan för gott. Synken skriver aldrig över det du
                  valt. Kopplade fakturor ser du på sidan Kundreskontra.
                </Card>
                <Card className="overflow-hidden">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Faktura</TableHead>
                        <TableHead>Kund i Fortnox</TableHead>
                        <TableHead>Projekt</TableHead>
                        <TableHead className="text-right">Belopp ex moms</TableHead>
                        <TableHead>Status</TableHead>
                        <TableHead>Förslag</TableHead>
                        <TableHead>Anledning</TableHead>
                        <TableHead className="text-right">Åtgärd</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {data.invoices.map((i) => (
                        <TableRow key={i.document_number} className={i.match_status === "ignored" ? "text-muted-foreground" : ""}>
                          <TableCell>
                            <div className="font-medium">#{i.document_number}</div>
                            <div className="text-xs text-muted-foreground">
                              {i.fakturadatum.slice(0, 10)}
                              {i.betald ? " · betald" : i.forfallen ? " · förfallen" : " · obetald"}
                              {i.credit ? " · kredit" : ""}
                            </div>
                          </TableCell>
                          <TableCell>
                            <div className="font-medium">{i.kundnamn ?? i.fortnox_customer_name ?? "—"}</div>
                            <div className="text-xs text-muted-foreground">kundnr {i.customer_number}</div>
                          </TableCell>
                          <TableCell className="text-sm">{i.projekt ?? "—"}</TableCell>
                          <TableCell className="text-right">{SEK2(i.belopp_ex_moms)}</TableCell>
                          <TableCell>
                            <Badge variant={i.match_status === "proposed" ? "secondary" : "outline"}>
                              {i.match_status === "proposed"
                                ? `Förslag (${CONFIDENCE_LABEL[i.match_confidence] ?? i.match_confidence})`
                                : i.match_status === "ignored"
                                  ? "Lämnad okopplad"
                                  : "Ingen kandidat"}
                            </Badge>
                          </TableCell>
                          <TableCell className="text-sm max-w-xs">{i.candidate_label ?? <span className="text-muted-foreground">—</span>}</TableCell>
                          <TableCell className="text-xs text-muted-foreground max-w-md">{i.match_reason}</TableCell>
                          <TableCell className="text-right">
                            <div className="flex gap-1 justify-end">
                              {i.match_status === "proposed" && i.candidate_order_id && (
                                <Button
                                  size="sm"
                                  disabled={busy}
                                  onClick={() =>
                                    invoiceAction.mutate({
                                      action: "invoice_link",
                                      documentNumber: i.document_number,
                                      orderId: i.candidate_order_id,
                                    })
                                  }
                                >
                                  <Check className="size-4 mr-1" /> Bekräfta
                                </Button>
                              )}
                              {i.match_status !== "ignored" && (
                                <>
                                  <Button size="sm" variant="outline" disabled={busy} onClick={() => setInvoicePicker(i)}>
                                    <Link2 className="size-4 mr-1" /> Koppla till order…
                                  </Button>
                                  <Button
                                    size="sm"
                                    variant="outline"
                                    disabled={busy}
                                    onClick={() =>
                                      invoiceAction.mutate({ action: "invoice_ignore", documentNumber: i.document_number })
                                    }
                                  >
                                    <EyeOff className="size-4 mr-1" /> Lämna okopplad
                                  </Button>
                                </>
                              )}
                              {i.match_status === "ignored" && (
                                <Button
                                  size="sm"
                                  variant="outline"
                                  disabled={busy}
                                  onClick={() =>
                                    invoiceAction.mutate({ action: "invoice_reset", documentNumber: i.document_number })
                                  }
                                >
                                  <RotateCcw className="size-4 mr-1" /> Ta upp igen
                                </Button>
                              )}
                            </div>
                          </TableCell>
                        </TableRow>
                      ))}
                      {data.invoices.length === 0 && (
                        <TableRow>
                          <TableCell colSpan={8} className="text-center text-sm text-muted-foreground py-8">
                            {data.health.invoices_total === 0
                              ? "Inga fakturor lästa ännu – kör Synka nu"
                              : "Alla fakturor i Fortnox är kopplade till en order"}
                          </TableCell>
                        </TableRow>
                      )}
                    </TableBody>
                  </Table>
                </Card>
                <GoogleSheetCard health={data.health} busy={busy} onChanged={invalidate} />
              </TabsContent>

              <TabsContent value="kunder" className="pt-4">
                <Card className="overflow-hidden">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Kund i CRM</TableHead>
                        <TableHead>Status</TableHead>
                        <TableHead>Fortnox-kund</TableHead>
                        <TableHead>Säkerhet</TableHead>
                        <TableHead>Anledning</TableHead>
                        <TableHead className="text-right">Åtgärd</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {data.customers.map((c) => (
                        <TableRow key={c.customer_id}>
                          <TableCell>
                            <div className="font-medium">{c.company_name}</div>
                            <div className="text-xs text-muted-foreground">
                              {c.org_number || "org.nr saknas"}
                            </div>
                          </TableCell>
                          <TableCell>
                            <StatusBadge status={c.status} />
                            {c.mismatch && (
                              <AlertTriangle className="size-4 inline ml-1 text-destructive" />
                            )}
                          </TableCell>
                          <TableCell>
                            <FortnoxCell
                              number={c.fortnox_customer_number}
                              name={c.fortnox_name}
                              candidate={c.candidate_number}
                              candidateName={c.candidate_name}
                            />
                          </TableCell>
                          <TableCell>
                            <ConfidenceCell confidence={c.confidence} method={c.method} />
                          </TableCell>
                          <TableCell className="text-xs text-muted-foreground max-w-md">
                            {c.reason ??
                              (c.proposed_at ? "" : "Inget förslag ännu – kör Föreslå kopplingar")}
                          </TableCell>
                          <TableCell className="text-right">
                            <RowActions
                              status={c.status}
                              busy={busy}
                              onConfirm={() =>
                                rowAction.mutate({
                                  action: "confirm",
                                  kind: "customer",
                                  id: c.customer_id,
                                })
                              }
                              onPick={() =>
                                setPicker({
                                  kind: "customer",
                                  id: c.customer_id,
                                  label: c.company_name,
                                })
                              }
                              onCreate={() =>
                                rowAction.mutate({
                                  action: "create",
                                  kind: "customer",
                                  id: c.customer_id,
                                })
                              }
                              disabled={!data.fortnoxConfigured}
                            />
                          </TableCell>
                        </TableRow>
                      ))}
                      {data.customers.length === 0 && (
                        <TableRow>
                          <TableCell
                            colSpan={6}
                            className="text-center text-sm text-muted-foreground py-8"
                          >
                            Inga kunder i CRM:et
                          </TableCell>
                        </TableRow>
                      )}
                    </TableBody>
                  </Table>
                </Card>
              </TabsContent>

              <TabsContent value="skarmar" className="pt-4">
                <Card className="overflow-hidden">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Skärm i CRM</TableHead>
                        <TableHead>Status</TableHead>
                        <TableHead>Fortnox-projekt</TableHead>
                        <TableHead>Säkerhet</TableHead>
                        <TableHead>Anledning</TableHead>
                        <TableHead className="text-right">Åtgärd</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {data.screens.map((s) => (
                        <TableRow key={s.product_id}>
                          <TableCell>
                            <div className="font-medium">{s.name}</div>
                            <div className="text-xs text-muted-foreground">
                              {s.crm_code ? `kod ${s.crm_code}` : "ingen fyrsiffrig kod i namnet"}
                              {s.city ? ` · ${s.city}` : ""}
                            </div>
                          </TableCell>
                          <TableCell>
                            <StatusBadge status={s.status} />
                            {s.mismatch && (
                              <AlertTriangle className="size-4 inline ml-1 text-destructive" />
                            )}
                          </TableCell>
                          <TableCell>
                            <FortnoxCell
                              number={s.fortnox_project_number}
                              name={s.fortnox_description}
                              candidate={s.candidate_number}
                              candidateName={s.candidate_name}
                            />
                          </TableCell>
                          <TableCell>
                            <ConfidenceCell confidence={s.confidence} method={s.method} />
                          </TableCell>
                          <TableCell className="text-xs text-muted-foreground max-w-md">
                            {s.reason ??
                              (s.proposed_at ? "" : "Inget förslag ännu – kör Föreslå kopplingar")}
                          </TableCell>
                          <TableCell className="text-right">
                            <RowActions
                              status={s.status}
                              busy={busy}
                              onConfirm={() =>
                                rowAction.mutate({
                                  action: "confirm",
                                  kind: "screen",
                                  id: s.product_id,
                                })
                              }
                              onPick={() =>
                                setPicker({ kind: "screen", id: s.product_id, label: s.name })
                              }
                              onCreate={() =>
                                rowAction.mutate({
                                  action: "create",
                                  kind: "screen",
                                  id: s.product_id,
                                })
                              }
                              disabled={!data.fortnoxConfigured}
                            />
                          </TableCell>
                        </TableRow>
                      ))}
                      {data.screens.length === 0 && (
                        <TableRow>
                          <TableCell
                            colSpan={6}
                            className="text-center text-sm text-muted-foreground py-8"
                          >
                            Inga skärmar i CRM:et
                          </TableCell>
                        </TableRow>
                      )}
                    </TableBody>
                  </Table>
                </Card>
              </TabsContent>

              <TabsContent value="avvikelser" className="pt-4">
                <Card className="overflow-hidden">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Rad</TableHead>
                        <TableHead>Fortnox-nummer</TableHead>
                        <TableHead>Vad skiljer</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {data.customers
                        .filter((c) => c.mismatch)
                        .map((c) => (
                          <TableRow key={c.customer_id}>
                            <TableCell>Kund: {c.company_name}</TableCell>
                            <TableCell>{c.fortnox_customer_number}</TableCell>
                            <TableCell className="text-sm">{c.mismatch}</TableCell>
                          </TableRow>
                        ))}
                      {data.screens
                        .filter((s) => s.mismatch)
                        .map((s) => (
                          <TableRow key={s.product_id}>
                            <TableCell>Skärm: {s.name}</TableCell>
                            <TableCell>{s.fortnox_project_number}</TableCell>
                            <TableCell className="text-sm">{s.mismatch}</TableCell>
                          </TableRow>
                        ))}
                      {data.health.mismatch_count === 0 && (
                        <TableRow>
                          <TableCell
                            colSpan={3}
                            className="text-center text-sm text-muted-foreground py-8"
                          >
                            Inga avvikelser – Fortnox och CRM:et är överens om alla kopplade rader
                          </TableCell>
                        </TableRow>
                      )}
                    </TableBody>
                  </Table>
                </Card>
              </TabsContent>

              <TabsContent value="korningar" className="pt-4">
                <Card className="overflow-hidden">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Startad</TableHead>
                        <TableHead>Av</TableHead>
                        <TableHead>Status</TableHead>
                        <TableHead>Förslag</TableHead>
                        <TableHead>Kopplade</TableHead>
                        <TableHead>Skapade</TableHead>
                        <TableHead>Avvikelser</TableHead>
                        <TableHead>Fakturor</TableHead>
                        <TableHead>Fel</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {data.runs.map((r) => (
                        <TableRow key={r.id}>
                          <TableCell>{when(r.started_at)}</TableCell>
                          <TableCell>
                            {r.triggered_by === "cron"
                              ? "timjobb"
                              : r.triggered_by === "cli"
                                ? "kommandorad"
                                : "Synka nu"}
                          </TableCell>
                          <TableCell>
                            <Badge
                              variant={
                                r.status === "ok"
                                  ? "default"
                                  : r.status === "error"
                                    ? "destructive"
                                    : "secondary"
                              }
                            >
                              {r.status}
                            </Badge>
                          </TableCell>
                          <TableCell>{r.proposals_written}</TableCell>
                          <TableCell>{r.auto_linked}</TableCell>
                          <TableCell>
                            {r.customers_created} kunder · {r.projects_created} skärmar
                          </TableCell>
                          <TableCell>{r.mismatches_found}</TableCell>
                          <TableCell className="text-xs whitespace-nowrap">
                            {r.invoices_read} lästa · {r.invoices_matched} kopplade · {r.invoices_proposed} förslag ·{" "}
                            {r.invoices_unmatched} okopplade
                          </TableCell>
                          <TableCell className="text-xs text-destructive max-w-md">
                            {r.error}
                          </TableCell>
                        </TableRow>
                      ))}
                      {data.runs.length === 0 && (
                        <TableRow>
                          <TableCell
                            colSpan={9}
                            className="text-center text-sm text-muted-foreground py-8"
                          >
                            Ingen körning ännu
                          </TableCell>
                        </TableRow>
                      )}
                    </TableBody>
                  </Table>
                </Card>
              </TabsContent>
            </Tabs>
          </>
        )}
      </div>

      {picker && (
        <PickerDialog
          picker={picker}
          onClose={() => setPicker(null)}
          busy={rowAction.isPending}
          onLink={(number) =>
            rowAction.mutate({ action: "link", kind: picker.kind, id: picker.id, number })
          }
        />
      )}
      {invoicePicker && (
        <InvoiceOrderPicker
          invoice={invoicePicker}
          onClose={() => setInvoicePicker(null)}
          busy={invoiceAction.isPending}
          onLink={(orderId) =>
            invoiceAction.mutate({ action: "invoice_link", documentNumber: invoicePicker.document_number, orderId })
          }
        />
      )}
    </>
  );
}

/** Koppla till order…: the bookings, the invoice's own customer first, with a text filter. */
function InvoiceOrderPicker({
  invoice,
  onClose,
  onLink,
  busy,
}: {
  invoice: InvoiceRow;
  onClose: () => void;
  onLink: (orderId: string) => void;
  busy: boolean;
}) {
  const [orderId, setOrderId] = useState<string>(invoice.candidate_order_id ?? "");
  const [filter, setFilter] = useState("");
  const { data, isLoading, error } = useQuery({
    queryKey: ["fortnox-order-candidates"],
    queryFn: () => callFortnox<{ orders: OrderCandidate[] }>({ action: "order_candidates" }),
  });
  const q = filter.trim().toLowerCase();
  const options = (data?.orders ?? [])
    .filter((o) => !q || `${o.label} ${o.screens.join(" ")}`.toLowerCase().includes(q))
    .sort((a, b) => {
      const am = a.customer_id && a.customer_id === invoice.customer_id ? 0 : 1;
      const bm = b.customer_id && b.customer_id === invoice.customer_id ? 0 : 1;
      return am - bm || a.label.localeCompare(b.label, "sv");
    });
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>
            Koppla faktura #{invoice.document_number} ({invoice.fakturadatum.slice(0, 10)}, {SEK2(invoice.belopp_ex_moms)} kr) till order…
          </DialogTitle>
        </DialogHeader>
        <div className="text-xs text-muted-foreground">
          {invoice.kundnamn ?? invoice.fortnox_customer_name} · {invoice.projekt ?? "inget projekt"} · {invoice.match_reason}
        </div>
        <Input placeholder="Sök kund, skärm eller belopp…" value={filter} onChange={(e) => setFilter(e.target.value)} />
        {isLoading && <div className="text-sm text-muted-foreground">Hämtar ordrar…</div>}
        {error && <div className="text-sm text-destructive">{(error as Error).message}</div>}
        {data && (
          <Select value={orderId} onValueChange={setOrderId}>
            <SelectTrigger>
              <SelectValue placeholder="Välj order" />
            </SelectTrigger>
            <SelectContent>
              {options.map((o) => (
                <SelectItem key={o.id} value={o.id}>
                  {o.customer_id && o.customer_id === invoice.customer_id ? "★ " : ""}
                  {o.label}
                  {o.screens.length ? ` · ${o.screens.join(", ")}` : ""}
                </SelectItem>
              ))}
              {options.length === 0 && (
                <SelectItem value="__none" disabled>
                  Inga bokningar matchar sökningen
                </SelectItem>
              )}
            </SelectContent>
          </Select>
        )}
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={busy}>
            Avbryt
          </Button>
          <Button onClick={() => orderId && onLink(orderId)} disabled={busy || !orderId}>
            {busy ? <Loader2 className="size-4 mr-1 animate-spin" /> : <Link2 className="size-4 mr-1" />} Koppla
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** The Google Sheet section: create / rotate / revoke the feed URL; the URL is shown exactly once. */
function GoogleSheetCard({ health, busy, onChanged }: { health: Health; busy: boolean; onChanged: () => void }) {
  const [shown, setShown] = useState<{ url: string; formula: string } | null>(null);
  const rotate = useMutation({
    mutationFn: () => callFortnox<{ url: string; formula: string }>({ action: "feed_rotate" }),
    onSuccess: (r) => {
      setShown({ url: r.url, formula: r.formula });
      onChanged();
    },
    onError: (e: Error) => toast.error(e.message),
  });
  const revoke = useMutation({
    mutationFn: () => callFortnox<{ ok: boolean }>({ action: "feed_revoke" }),
    onSuccess: () => {
      setShown(null);
      toast.success("Länken är återkallad – den gamla adressen svarar 403 från och med nu");
      onChanged();
    },
    onError: (e: Error) => toast.error(e.message),
  });
  const copy = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      toast.success("Kopierat");
    } catch {
      toast.error("Kunde inte kopiera – markera texten och kopiera för hand");
    }
  };
  const has = Boolean(health.feed_rotated_at);
  return (
    <Card className="p-4 space-y-3 text-sm">
      <div className="flex items-center gap-2 font-medium">
        <Sheet className="size-4" /> Google Sheet – kundreskontran som länk
      </div>
      <p className="text-muted-foreground">
        En adress som ger reskontran som CSV med Filips elva kolumner, uppdaterad varje timme av synken. Klistras in en
        gång i Google Sheets; pivoten på fliken Budget läser sedan som förut. Adressen är själva nyckeln: den visas bara
        här, en gång, och kan alltid bytas ut eller återkallas.
        {has ? ` Nuvarande länk skapad ${when(health.feed_rotated_at)}.` : " Ingen länk finns ännu."}
      </p>
      <div className="flex flex-wrap gap-2">
        <Button size="sm" onClick={() => rotate.mutate()} disabled={busy || rotate.isPending}>
          {rotate.isPending ? <Loader2 className="size-4 mr-1 animate-spin" /> : <RefreshCw className="size-4 mr-1" />}
          {has ? "Skapa ny länk (den gamla slutar gälla)" : "Skapa länk"}
        </Button>
        {has && (
          <Button size="sm" variant="outline" onClick={() => revoke.mutate()} disabled={busy || revoke.isPending}>
            <EyeOff className="size-4 mr-1" /> Återkalla länk
          </Button>
        )}
      </div>
      {shown && (
        <div className="rounded-md border p-3 space-y-2 bg-muted/30">
          <div className="text-xs font-medium">Visas bara nu – kopiera direkt.</div>
          <div className="flex gap-2 items-center">
            <code className="text-xs break-all flex-1">{shown.url}</code>
            <Button size="sm" variant="outline" onClick={() => copy(shown.url)}>
              <Copy className="size-4" />
            </Button>
          </div>
          <div className="text-xs text-muted-foreground">
            1. Öppna fliken <b>Kundreskontra</b> i Google Sheets. 2. Klistra in formeln nedan i cell <b>A2</b> (rad 1 är
            tom idag, rubrikerna står på rad 2, så pivoten på Budget och rad-referenserna behåller sina platser). Töm
            först raderna nedanför, annars skriver formeln inte över dem.
          </div>
          <div className="flex gap-2 items-center">
            <code className="text-xs break-all flex-1">{shown.formula}</code>
            <Button size="sm" variant="outline" onClick={() => copy(shown.formula)}>
              <Copy className="size-4" />
            </Button>
          </div>
          <div className="text-xs text-muted-foreground">
            Lägg till <code>?year=2025</code> före slutet för ett annat år, eller <code>?sep=;</code> för att öppna filen i svensk Excel.
          </div>
        </div>
      )}
    </Card>
  );
}

function HealthCard({ data }: { data: StatusResponse }) {
  const h = data.health;
  const statusText = !h.last_run_at
    ? "Ingen synk har körts ännu"
    : `Senaste synk ${when(h.last_run_at)} (${h.last_run_trigger === "cron" ? "timjobb" : h.last_run_trigger === "cli" ? "kommandorad" : "Synka nu"}) – ${h.last_run_status}`;
  return (
    <Card className="p-4 grid gap-3 md:grid-cols-4 text-sm">
      <div className="md:col-span-2">
        <div className="font-medium">{statusText}</div>
        <div className="text-xs text-muted-foreground mt-1">
          {h.last_error ? `Senaste fel ${when(h.last_error_at)}: ${h.last_error}` : "Inga fel"}
        </div>
        <div className="text-xs text-muted-foreground mt-1">
          Fortnox:{" "}
          {data.fortnoxConfigured
            ? (data.runs.find((r) => r.company_name)?.company_name
              ? `ansluten till ${data.runs.find((r) => r.company_name)!.company_name} (senaste körningen)`
              : "ansluten – ingen körning ännu")
            : "inga uppgifter i den här miljön – synk avstängd"}{" "}
          · Otydliga namn: {data.claudeConfigured ? "Claude + regler" : "enbart regler"}
        </div>
      </div>
      <div>
        <div className="text-xs text-muted-foreground">Kunder</div>
        <div>
          {h.customers_linked} kopplade · {h.customers_proposed} förslag · {h.customers_unlinked}{" "}
          utan koppling
        </div>
      </div>
      <div>
        <div className="text-xs text-muted-foreground">Skärmar</div>
        <div>
          {h.projects_linked} kopplade · {h.projects_proposed} förslag · {h.projects_unlinked} utan
          koppling
        </div>
        <div className="text-xs text-muted-foreground mt-1">
          {h.mismatch_count} avvikelser mot Fortnox
        </div>
        <div className="text-xs text-muted-foreground mt-1">
          Fakturor: {h.invoices_linked} kopplade · {h.invoices_proposed} förslag · {h.invoices_unmatched} okopplade ·{" "}
          {h.invoices_paid} betalda · {h.invoices_overdue} förfallna
          {h.dev_fake_payments ? " · DEV: fejkade betalningar" : ""}
        </div>
      </div>
    </Card>
  );
}

function FortnoxCell({
  number,
  name,
  candidate,
  candidateName,
}: {
  number: string | null;
  name: string | null;
  candidate: string | null;
  candidateName: string | null;
}) {
  if (number) {
    return (
      <div>
        <div className="font-medium">{number}</div>
        <div className="text-xs text-muted-foreground">{name}</div>
      </div>
    );
  }
  if (candidate) {
    return (
      <div>
        <div className="font-medium text-muted-foreground">Förslag: {candidate}</div>
        <div className="text-xs text-muted-foreground">{candidateName}</div>
      </div>
    );
  }
  return <span className="text-xs text-muted-foreground">Ingen kandidat – skapas vid synk</span>;
}

function ConfidenceCell({ confidence, method }: { confidence: string; method: string }) {
  if (confidence === "none") return <span className="text-xs text-muted-foreground">–</span>;
  return (
    <div>
      <Badge variant={confidence === "exact" ? "default" : "outline"}>
        {CONFIDENCE_LABEL[confidence] ?? confidence}
      </Badge>
      <div className="text-xs text-muted-foreground mt-1">{METHOD_LABEL[method] ?? method}</div>
    </div>
  );
}

function RowActions({
  status,
  busy,
  disabled,
  onConfirm,
  onPick,
  onCreate,
}: {
  status: LinkStatus;
  busy: boolean;
  disabled: boolean;
  onConfirm: () => void;
  onPick: () => void;
  onCreate: () => void;
}) {
  return (
    <div className="flex gap-1 justify-end">
      {status === "proposed" && (
        <Button size="sm" onClick={onConfirm} disabled={busy || disabled}>
          <Check className="size-4 mr-1" /> Bekräfta
        </Button>
      )}
      <Button size="sm" variant="outline" onClick={onPick} disabled={busy || disabled}>
        <Link2 className="size-4 mr-1" /> {status === "linked" ? "Koppla om" : "Koppla till…"}
      </Button>
      {status !== "linked" && (
        <Button size="sm" variant="outline" onClick={onCreate} disabled={busy || disabled}>
          <Plus className="size-4 mr-1" /> Skapa i Fortnox
        </Button>
      )}
    </div>
  );
}

function PickerDialog({
  picker,
  onClose,
  onLink,
  busy,
}: {
  picker: { kind: "customer" | "screen"; id: string; label: string };
  onClose: () => void;
  onLink: (number: string) => void;
  busy: boolean;
}) {
  const [number, setNumber] = useState<string>("");
  const { data, isLoading, error } = useQuery({
    queryKey: ["fortnox-candidates"],
    queryFn: () => callFortnox<Candidates>({ action: "candidates" }),
  });
  const options =
    picker.kind === "customer"
      ? (data?.customers ?? []).map((c) => ({
          number: c.number,
          label: `${c.number} – ${c.name}${c.orgNumber ? ` (${c.orgNumber})` : ""}`,
        }))
      : (data?.projects ?? []).map((p) => ({
          number: p.number,
          label: `${p.number} – ${p.description}`,
        }));
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Koppla {picker.label} till…</DialogTitle>
        </DialogHeader>
        {isLoading && <div className="text-sm text-muted-foreground">Hämtar från Fortnox…</div>}
        {error && <div className="text-sm text-destructive">{(error as Error).message}</div>}
        {data && (
          <Select value={number} onValueChange={setNumber}>
            <SelectTrigger>
              <SelectValue
                placeholder={
                  picker.kind === "customer" ? "Välj Fortnox-kund" : "Välj Fortnox-projekt"
                }
              />
            </SelectTrigger>
            <SelectContent>
              {options.map((o) => (
                <SelectItem key={o.number} value={o.number}>
                  {o.label}
                </SelectItem>
              ))}
              {options.length === 0 && (
                <SelectItem value="__none" disabled>
                  Inget finns i Fortnox ännu
                </SelectItem>
              )}
            </SelectContent>
          </Select>
        )}
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={busy}>
            Avbryt
          </Button>
          <Button onClick={() => number && onLink(number)} disabled={busy || !number}>
            {busy ? (
              <Loader2 className="size-4 mr-1 animate-spin" />
            ) : (
              <Link2 className="size-4 mr-1" />
            )}{" "}
            Koppla
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
