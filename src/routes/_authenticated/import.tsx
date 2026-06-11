import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { supabase } from "@/integrations/supabase/client";
import { useCurrentUser } from "@/lib/hooks/use-current-user";
import { PageHeader } from "@/components/page-header";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import { Upload, Wand2, CheckCircle2, AlertCircle } from "lucide-react";
import { importOrders } from "@/lib/import-orders.functions";

export const Route = createFileRoute("/_authenticated/import")({
  component: ImportPage,
});

type ParsedRow = {
  raw: string[];
  seller: string;
  project: string;
  customer: string;
  date: string;
  amount: number;
  seller_id?: string;
  product_id?: string;
  product_name?: string;
  error?: string;
};

const fmt = (n: number) =>
  new Intl.NumberFormat("sv-SE", { style: "currency", currency: "SEK", maximumFractionDigits: 0 }).format(n || 0);

function normalizeAmount(s: string): number {
  if (!s) return 0;
  const cleaned = s.replace(/\s|\u00a0|kr/gi, "").replace(",", ".");
  const n = parseFloat(cleaned);
  return isNaN(n) ? 0 : n;
}

function normalizeDate(s: string): string {
  const t = s.trim();
  // accept YYYY-MM-DD or DD/MM/YYYY or DD-MM-YYYY
  const m1 = t.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (m1) return t;
  const m2 = t.match(/^(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{4})$/);
  if (m2) return `${m2[3]}-${m2[2].padStart(2, "0")}-${m2[1].padStart(2, "0")}`;
  // excel serial? skip
  return "";
}

function parseInput(text: string): ParsedRow[] {
  const lines = text.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
  const rows: ParsedRow[] = [];
  for (const line of lines) {
    const parts = line.includes("\t") ? line.split("\t") : line.split(/[;,]/);
    if (parts.length < 4) continue;
    // try to detect header row
    const first = parts[0].trim().toLowerCase();
    if (first === "säljare" || first === "saljare" || first === "seller") continue;

    // Heuristic columns: Säljare | Projekt | Kund | Fakturadatum | (Förfallodatum) | Belopp
    const seller = parts[0]?.trim() || "";
    const project = parts[1]?.trim() || "";
    const customer = parts[2]?.trim() || "";
    const date = normalizeDate(parts[3] || "");
    // Find amount: prefer column 5 (Belopp ex moms), fallback to last numeric
    let amount = normalizeAmount(parts[5] || "");
    if (!amount) amount = normalizeAmount(parts[4] || "");
    if (!amount) {
      for (let i = parts.length - 1; i >= 4; i--) {
        const a = normalizeAmount(parts[i]);
        if (a) { amount = a; break; }
      }
    }
    rows.push({ raw: parts, seller, project, customer, date, amount });
  }
  return rows;
}

function ImportPage() {
  const { isAdmin } = useCurrentUser();
  const qc = useQueryClient();
  const runImport = useServerFn(importOrders);
  const [text, setText] = useState("");
  const [parsed, setParsed] = useState<ParsedRow[] | null>(null);
  const [importing, setImporting] = useState(false);

  const { data: refs } = useQuery({
    queryKey: ["import-refs"],
    queryFn: async () => {
      const [sellers, products] = await Promise.all([
        supabase.from("profiles").select("id, full_name, email"),
        supabase.from("products").select("id, name"),
      ]);
      return {
        sellers: sellers.data || [],
        products: products.data || [],
      };
    },
  });

  const matched = useMemo<ParsedRow[]>(() => {
    if (!parsed || !refs) return [];
    return parsed.map(r => {
      const m: ParsedRow = { ...r };
      const sellerKey = r.seller.toLowerCase();
      const seller = refs.sellers.find(s => {
        const name = (s.full_name || s.email || "").toLowerCase();
        return name === sellerKey || name.startsWith(sellerKey + " ") || name.split(" ")[0] === sellerKey;
      });
      m.seller_id = seller?.id;

      const projKey = r.project.toLowerCase();
      const product = refs.products.find(p => {
        const n = p.name.toLowerCase();
        return n === projKey || projKey.startsWith(n) || n.startsWith(projKey.split(" - ")[0] || projKey);
      });
      m.product_id = product?.id;
      m.product_name = product?.name || r.project;

      if (!r.date) m.error = "Ogiltigt datum";
      else if (!r.amount) m.error = "Ogiltigt belopp";
      else if (!seller) m.error = "Okänd säljare";
      else if (!product) m.error = "Okänd produkt";
      return m;
    });
  }, [parsed, refs]);

  const validRows = matched.filter(r => !r.error);
  const invalidRows = matched.filter(r => r.error);
  const totalAmount = validRows.reduce((s, r) => s + r.amount, 0);

  const handleParse = () => {
    const rows = parseInput(text);
    if (!rows.length) {
      toast.error("Hittade inga rader");
      return;
    }
    setParsed(rows);
  };

  const handleFile = async (file: File) => {
    const txt = await file.text();
    setText(txt);
    setParsed(parseInput(txt));
  };

  const handleImport = async () => {
    if (!validRows.length) return;
    setImporting(true);
    try {
      const result = await runImport({
        data: {
          rows: validRows.map(r => ({
            seller_id: r.seller_id!,
            product_id: r.product_id!,
            product_name: r.product_name!,
            customer_name: r.customer,
            invoice_date: r.date,
            amount: r.amount,
          })),
        },
      });
      if (result.errors.length) {
        toast.warning(`${result.created} importerade, ${result.errors.length} fel`);
        console.error(result.errors);
      } else {
        toast.success(`${result.created} ordrar skapade`);
      }
      setParsed(null);
      setText("");
      qc.invalidateQueries();
    } catch (e: any) {
      toast.error(`Import misslyckades: ${e.message || e}`);
    } finally {
      setImporting(false);
    }
  };

  if (!isAdmin) {
    return (
      <>
        <PageHeader title="Importera order" description="Endast admin har åtkomst" />
        <div className="p-6">
          <Card className="p-6 text-sm text-muted-foreground">Du behöver admin-rättigheter.</Card>
        </div>
      </>
    );
  }

  return (
    <>
      <PageHeader title="Importera order" description="Klistra in eller ladda upp orderdata för att skapa affärer automatiskt" />
      <div className="p-6 space-y-4">
        <Card className="p-4 space-y-3">
          <div className="flex items-center justify-between">
            <div>
              <div className="text-sm font-medium">Klistra in TSV / CSV</div>
              <div className="text-xs text-muted-foreground">
                Kolumner: Säljare · Projekt · Kund · Fakturadatum · (Förfallodatum) · Belopp ex moms
              </div>
            </div>
            <div className="flex gap-2">
              <label className="inline-flex">
                <input
                  type="file"
                  accept=".csv,.tsv,.txt"
                  className="hidden"
                  onChange={(e) => e.target.files?.[0] && handleFile(e.target.files[0])}
                />
                <Button asChild variant="outline" size="sm">
                  <span><Upload className="size-4 mr-1.5" />Ladda upp fil</span>
                </Button>
              </label>
              <Button size="sm" onClick={handleParse}>
                <Wand2 className="size-4 mr-1.5" />Tolka data
              </Button>
            </div>
          </div>
          <Textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder={`Wilmer\t1101 - Stenungstorg\tLiberalerna Stenungsund\t2026-01-07\t2026-02-07\t20000\nDavid\t1102 - Meta / Google\tCleverApps\t2026-01-06\t2026-02-06\t13535`}
            rows={8}
            className="font-mono text-xs"
          />
        </Card>

        {matched.length > 0 && (
          <Card className="p-4 space-y-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3 text-sm">
                <Badge variant="secondary" className="gap-1">
                  <CheckCircle2 className="size-3" />{validRows.length} klara
                </Badge>
                {invalidRows.length > 0 && (
                  <Badge variant="destructive" className="gap-1">
                    <AlertCircle className="size-3" />{invalidRows.length} fel
                  </Badge>
                )}
                <span className="text-muted-foreground">Totalt {fmt(totalAmount)}</span>
              </div>
              <Button onClick={handleImport} disabled={importing || !validRows.length}>
                {importing ? "Importerar..." : `Importera ${validRows.length} ordrar`}
              </Button>
            </div>
            <div className="border rounded-md overflow-hidden">
              <div className="max-h-[500px] overflow-auto">
                <table className="w-full text-xs">
                  <thead className="bg-muted sticky top-0">
                    <tr>
                      <th className="text-left p-2">Säljare</th>
                      <th className="text-left p-2">Produkt</th>
                      <th className="text-left p-2">Kund</th>
                      <th className="text-left p-2">Datum</th>
                      <th className="text-right p-2">Belopp</th>
                      <th className="text-left p-2">Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {matched.map((r, i) => (
                      <tr key={i} className={r.error ? "bg-destructive/5" : ""}>
                        <td className="p-2">{r.seller}{r.seller_id && <span className="text-success ml-1">✓</span>}</td>
                        <td className="p-2">{r.project}{r.product_id && <span className="text-success ml-1">✓</span>}</td>
                        <td className="p-2 truncate max-w-[200px]">{r.customer}</td>
                        <td className="p-2 font-mono">{r.date || "—"}</td>
                        <td className="p-2 text-right font-mono">{r.amount ? fmt(r.amount) : "—"}</td>
                        <td className="p-2">
                          {r.error ? (
                            <span className="text-destructive">{r.error}</span>
                          ) : (
                            <span className="text-muted-foreground">OK</span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </Card>
        )}
      </div>
    </>
  );
}
