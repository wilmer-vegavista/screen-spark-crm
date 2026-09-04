import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import type { Json } from "@/integrations/supabase/types";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { Loader2, Link2, ClipboardPaste, FileUp } from "lucide-react";
import { toast } from "sonner";
import { fetchSheetCsv, parseCsv, parsePasted, rowsToListData } from "@/lib/sheet-import";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreated: (listId: string) => void;
}

export function ListImportDialog({ open, onOpenChange, onCreated }: Props) {
  const qc = useQueryClient();
  const [name, setName] = useState("");
  const [sheetUrl, setSheetUrl] = useState("");
  const [pasted, setPasted] = useState("");
  const [firstRowIsHeader, setFirstRowIsHeader] = useState(true);
  const [raw, setRaw] = useState<string[][] | null>(null);
  const [sourceUrl, setSourceUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);

  const reset = () => {
    setName("");
    setSheetUrl("");
    setPasted("");
    setRaw(null);
    setSourceUrl(null);
    setFirstRowIsHeader(true);
    setLoading(false);
    setSaving(false);
  };

  const loadFromUrl = async () => {
    setLoading(true);
    try {
      const rows = await fetchSheetCsv(sheetUrl);
      setRaw(rows);
      setSourceUrl(sheetUrl.trim());
      if (!name) setName("Min kundlista");
      toast.success(`Hämtade ${rows.length} rader från arket`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Kunde inte hämta arket");
    } finally {
      setLoading(false);
    }
  };

  const loadFromPaste = () => {
    const rows = parsePasted(pasted);
    if (rows.length === 0)
      return toast.error(
        "Ingen data hittades. Kopiera cellerna i Google Sheets och klistra in här.",
      );
    setRaw(rows);
    setSourceUrl(null);
    if (!name) setName("Min kundlista");
  };

  const loadFromFile = async (file: File) => {
    const text = await file.text();
    const rows = parseCsv(text, text.includes("\t") && !text.includes(",") ? "\t" : ",");
    if (rows.length === 0) return toast.error("Filen verkar vara tom");
    setRaw(rows);
    setSourceUrl(null);
    if (!name) setName(file.name.replace(/\.(csv|tsv|txt)$/i, ""));
  };

  const doImport = async () => {
    if (!raw) return;
    if (!name.trim()) return toast.error("Ge listan ett namn");
    setSaving(true);
    try {
      const { columns, rows } = rowsToListData(raw, firstRowIsHeader);
      const { data: userRes } = await supabase.auth.getUser();
      const { data: list, error } = await supabase
        .from("customer_lists")
        .insert({
          name: name.trim(),
          owner_id: userRes.user!.id,
          source_url: sourceUrl,
          columns: columns as unknown as Json,
        })
        .select()
        .single();
      if (error) throw error;
      // Radinserts i omgångar så stora ark inte slår i request-gränsen
      for (let i = 0; i < rows.length; i += 500) {
        const chunk = rows
          .slice(i, i + 500)
          .map((data, j) => ({ list_id: list.id, position: i + j, data: data as unknown as Json }));
        const { error: rowErr } = await supabase.from("customer_list_rows").insert(chunk);
        if (rowErr) throw rowErr;
      }
      toast.success(`Listan "${name.trim()}" skapades med ${rows.length} rader`);
      qc.invalidateQueries({ queryKey: ["customer-lists"] });
      reset();
      onOpenChange(false);
      onCreated(list.id);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Importen misslyckades");
    } finally {
      setSaving(false);
    }
  };

  const preview = raw ? rowsToListData(raw, firstRowIsHeader) : null;

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        if (!o) reset();
        onOpenChange(o);
      }}
    >
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Importera kundlista</DialogTitle>
          <DialogDescription>
            Hämta din lista från Google Sheets. Kolumnerna blir exakt samma som i ditt ark.
          </DialogDescription>
        </DialogHeader>

        {!raw ? (
          <Tabs defaultValue="url">
            <TabsList className="grid w-full grid-cols-3">
              <TabsTrigger value="url">
                <Link2 className="size-3.5 mr-1" /> Google Sheets-länk
              </TabsTrigger>
              <TabsTrigger value="paste">
                <ClipboardPaste className="size-3.5 mr-1" /> Klistra in
              </TabsTrigger>
              <TabsTrigger value="file">
                <FileUp className="size-3.5 mr-1" /> CSV-fil
              </TabsTrigger>
            </TabsList>

            <TabsContent value="url" className="space-y-3 pt-2">
              <div className="space-y-1.5">
                <Label>Länk till ditt Google Sheet</Label>
                <Input
                  placeholder="https://docs.google.com/spreadsheets/d/..."
                  value={sheetUrl}
                  onChange={(e) => setSheetUrl(e.target.value)}
                />
                <p className="text-xs text-muted-foreground">
                  Arket måste vara delat: öppna det i Google Sheets →{" "}
                  <span className="font-medium">Dela</span> →{" "}
                  <span className="font-medium">Alla som har länken</span> → Läsare. Klistra sedan
                  in länken här.
                </p>
              </div>
              <Button onClick={loadFromUrl} disabled={!sheetUrl.trim() || loading}>
                {loading && <Loader2 className="size-4 mr-1 animate-spin" />} Hämta arket
              </Button>
            </TabsContent>

            <TabsContent value="paste" className="space-y-3 pt-2">
              <div className="space-y-1.5">
                <Label>Klistra in celler från arket</Label>
                <Textarea
                  rows={8}
                  placeholder={
                    "Markera cellerna i Google Sheets (inkl. rubrikraden), kopiera (Ctrl+C) och klistra in här (Ctrl+V)"
                  }
                  value={pasted}
                  onChange={(e) => setPasted(e.target.value)}
                />
              </div>
              <Button onClick={loadFromPaste} disabled={!pasted.trim()}>
                Läs in
              </Button>
            </TabsContent>

            <TabsContent value="file" className="space-y-3 pt-2">
              <div className="space-y-1.5">
                <Label>Ladda upp CSV-fil</Label>
                <Input
                  type="file"
                  accept=".csv,.tsv,.txt"
                  onChange={(e) => {
                    const f = e.target.files?.[0];
                    if (f) loadFromFile(f);
                  }}
                />
                <p className="text-xs text-muted-foreground">
                  I Google Sheets: Arkiv → Ladda ned → Kommaavgränsade värden (.csv)
                </p>
              </div>
            </TabsContent>
          </Tabs>
        ) : (
          <div className="space-y-4">
            <div className="space-y-1.5">
              <Label>Listans namn</Label>
              <Input
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="T.ex. Mina kunder 2026"
              />
            </div>
            <label className="flex items-center gap-2 text-sm cursor-pointer">
              <Checkbox
                checked={firstRowIsHeader}
                onCheckedChange={(v) => setFirstRowIsHeader(v === true)}
              />
              Första raden är rubriker
            </label>
            {preview && (
              <div className="border rounded-md overflow-auto max-h-64">
                <table className="w-full text-xs">
                  <thead className="bg-muted/60 sticky top-0">
                    <tr>
                      {preview.columns.map((c) => (
                        <th
                          key={c.id}
                          className="p-2 text-left font-semibold whitespace-nowrap border-r last:border-r-0"
                        >
                          {c.name}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {preview.rows.slice(0, 8).map((r, i) => (
                      <tr key={i} className="border-t">
                        {preview.columns.map((c) => (
                          <td
                            key={c.id}
                            className="p-2 whitespace-nowrap border-r last:border-r-0 max-w-48 truncate"
                          >
                            {r[c.id]}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            <div className="flex items-center justify-between">
              <span className="text-sm text-muted-foreground">
                {preview?.rows.length ?? 0} rader • {preview?.columns.length ?? 0} kolumner
              </span>
              <div className="flex gap-2">
                <Button
                  variant="ghost"
                  onClick={() => {
                    setRaw(null);
                    setSourceUrl(null);
                  }}
                >
                  Tillbaka
                </Button>
                <Button onClick={doImport} disabled={saving || !preview?.rows.length}>
                  {saving && <Loader2 className="size-4 mr-1 animate-spin" />} Importera
                </Button>
              </div>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
