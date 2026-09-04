import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import type { Json } from "@/integrations/supabase/types";
import { PageHeader } from "@/components/page-header";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Plus, FileSpreadsheet, Trash2, Link2, AlertTriangle } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { ListImportDialog } from "@/components/list-import-dialog";
import { useCurrentUser } from "@/lib/hooks/use-current-user";
import { newColumnId, type ListColumn } from "@/lib/sheet-import";
import { toast } from "sonner";

export const Route = createFileRoute("/_authenticated/listor")({
  component: Listor,
});

const DEFAULT_COLUMNS = ["Företag", "Kontaktperson", "Telefon", "E-post", "Status", "Anteckningar"];

type AdminDup = {
  list_id: string;
  row_id: string;
  match_type: string;
  match_value: string;
  other_party: string;
  source: string;
};

const dupTypeLabel = (t: string) =>
  t === "telefon" ? "Telefonnummer" : t === "mail" ? "Mejladress" : "Företag";

const dupSourceLabel = (s: string) =>
  s === "bokning" ? "bokad order" : s === "offert" ? "offert" : "kundlista";

function Listor() {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const { user, isAdmin } = useCurrentUser();
  const [importOpen, setImportOpen] = useState(false);
  const [dupDialogList, setDupDialogList] = useState<{ id: string; name: string } | null>(null);

  const { data: lists } = useQuery({
    queryKey: ["customer-lists"],
    queryFn: async () => {
      const { data } = await supabase
        .from("customer_lists")
        .select("*")
        .order("updated_at", { ascending: false });
      return data ?? [];
    },
  });

  const { data: rowCounts } = useQuery({
    queryKey: ["customer-lists-row-counts"],
    queryFn: async () => {
      const { data } = await supabase.from("customer_list_rows").select("list_id, data");
      const m = new Map<string, number>();
      (data ?? []).forEach((r) => {
        // Tomma utfyllnadsrader räknas inte
        const filled = Object.values((r.data ?? {}) as Record<string, string>).some((v) =>
          String(v ?? "").trim(),
        );
        if (filled) m.set(r.list_id, (m.get(r.list_id) ?? 0) + 1);
      });
      return m;
    },
  });

  const { data: profiles } = useQuery({
    queryKey: ["profiles-all"],
    queryFn: async () => {
      const { data } = await supabase.from("profiles").select("id, full_name, email");
      return data ?? [];
    },
    enabled: isAdmin,
  });

  // Admin: dubbletter per lista (uppgifter som även finns hos en annan säljare)
  const { data: adminDups } = useQuery({
    queryKey: ["all-list-duplicates"],
    queryFn: async () => {
      const { data } = await supabase.rpc("get_all_list_duplicates");
      const m = new Map<string, AdminDup[]>();
      ((data ?? []) as AdminDup[]).forEach((d) => {
        const arr = m.get(d.list_id) ?? [];
        arr.push(d);
        m.set(d.list_id, arr);
      });
      return m;
    },
    enabled: isAdmin,
  });

  // Fullständigt radinnehåll för dubblettdialogen
  const dialogDups = adminDups?.get(dupDialogList?.id ?? "") ?? [];
  const { data: dupRows } = useQuery({
    queryKey: ["dup-dialog-rows", dupDialogList?.id],
    queryFn: async () => {
      const ids = [...new Set(dialogDups.map((d) => d.row_id))];
      if (ids.length === 0) return new Map<string, Record<string, string>>();
      const { data } = await supabase.from("customer_list_rows").select("id, data").in("id", ids);
      return new Map((data ?? []).map((r) => [r.id, (r.data ?? {}) as Record<string, string>]));
    },
    enabled: !!dupDialogList,
  });

  const dialogColumns = ((lists ?? []).find((l) => l.id === dupDialogList?.id)?.columns ??
    []) as unknown as ListColumn[];

  const dupsByRow = (() => {
    const m = new Map<string, AdminDup[]>();
    dialogDups.forEach((d) => {
      const arr = m.get(d.row_id) ?? [];
      arr.push(d);
      m.set(d.row_id, arr);
    });
    return m;
  })();

  const ownerName = (id: string) => {
    const p = (profiles ?? []).find((p) => p.id === id);
    return p?.full_name || p?.email || "Okänd";
  };

  const createEmpty = async () => {
    if (!user) return;
    const columns = DEFAULT_COLUMNS.map((name) => ({ id: newColumnId(), name }));
    const { data, error } = await supabase
      .from("customer_lists")
      .insert({ name: "Ny kundlista", owner_id: user.id, columns: columns as unknown as Json })
      .select()
      .single();
    if (error) return toast.error(error.message);
    // Starta med ett gäng tomma rader så det känns som ett kalkylark direkt
    await supabase
      .from("customer_list_rows")
      .insert(Array.from({ length: 20 }, (_, i) => ({ list_id: data.id, position: i, data: {} })));
    qc.invalidateQueries({ queryKey: ["customer-lists"] });
    navigate({ to: "/listor/$listId", params: { listId: data.id } });
  };

  const deleteList = async (e: React.MouseEvent, id: string, name: string) => {
    e.stopPropagation();
    if (!confirm(`Ta bort listan "${name}" och alla dess rader? Detta kan inte ångras.`)) return;
    const { error } = await supabase.from("customer_lists").delete().eq("id", id);
    if (error) return toast.error(error.message);
    toast.success("Listan borttagen");
    qc.invalidateQueries({ queryKey: ["customer-lists"] });
  };

  return (
    <>
      <PageHeader
        title="Listor"
        description="Dina egna kundlistor – precis som ditt kalkylark"
        actions={
          <div className="flex items-center gap-2">
            <Button size="sm" variant="outline" onClick={createEmpty}>
              <Plus className="size-4 mr-1" /> Ny tom lista
            </Button>
            <Button size="sm" onClick={() => setImportOpen(true)}>
              <FileSpreadsheet className="size-4 mr-1" /> Importera från Google Sheets
            </Button>
          </div>
        }
      />
      <div className="p-6">
        {(lists ?? []).length === 0 ? (
          <div className="border border-dashed rounded-lg p-12 text-center space-y-3">
            <FileSpreadsheet className="size-10 mx-auto text-muted-foreground" />
            <div className="font-medium">Inga listor ännu</div>
            <p className="text-sm text-muted-foreground max-w-md mx-auto">
              Importera ditt kalkylark från Google Sheets så får du en likadan lista här i CRM:et –
              med samma kolumner och rader.
            </p>
            <Button onClick={() => setImportOpen(true)}>
              <FileSpreadsheet className="size-4 mr-1" /> Importera från Google Sheets
            </Button>
          </div>
        ) : (
          <div className="border rounded-md overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-muted/50">
                <tr className="text-left">
                  <th className="p-2">Lista</th>
                  {isAdmin && <th className="p-2 hidden sm:table-cell">Ägare</th>}
                  <th className="p-2 text-right hidden sm:table-cell">Rader</th>
                  {isAdmin && <th className="p-2 text-right">Dubbletter</th>}
                  <th className="p-2 hidden md:table-cell">Uppdaterad</th>
                  <th className="p-2 w-10" />
                </tr>
              </thead>
              <tbody>
                {(lists ?? []).map((l) => (
                  <tr
                    key={l.id}
                    className="border-t cursor-pointer hover:bg-accent/40 transition-colors"
                    onClick={() => navigate({ to: "/listor/$listId", params: { listId: l.id } })}
                  >
                    <td className="p-2">
                      <div className="flex items-center gap-2.5">
                        <div className="size-8 rounded-md bg-accent flex items-center justify-center shrink-0">
                          <FileSpreadsheet className="size-4" />
                        </div>
                        <div>
                          <div className="font-medium">{l.name}</div>
                          {l.source_url && (
                            <div className="text-xs text-muted-foreground flex items-center gap-1">
                              <Link2 className="size-3" /> Kopplad till Google Sheets
                            </div>
                          )}
                        </div>
                      </div>
                    </td>
                    {isAdmin && (
                      <td className="p-2 hidden sm:table-cell">
                        <Badge variant="outline" className="font-normal">
                          {ownerName(l.owner_id)}
                        </Badge>
                      </td>
                    )}
                    <td className="p-2 text-right hidden sm:table-cell">
                      {rowCounts?.get(l.id) ?? 0}
                    </td>
                    {isAdmin && (
                      <td className="p-2 text-right">
                        {(adminDups?.get(l.id)?.length ?? 0) > 0 ? (
                          <button
                            className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-amber-100 text-amber-800 text-xs font-medium hover:bg-amber-200 transition-colors"
                            onClick={(e) => {
                              e.stopPropagation();
                              setDupDialogList({ id: l.id, name: l.name });
                            }}
                            title="Visa dubbletter i denna lista"
                          >
                            <AlertTriangle className="size-3" />
                            {adminDups?.get(l.id)?.length}
                          </button>
                        ) : (
                          <span className="text-muted-foreground text-xs">0</span>
                        )}
                      </td>
                    )}
                    <td className="p-2 hidden md:table-cell text-muted-foreground">
                      {new Date(l.updated_at).toLocaleDateString("sv-SE")}
                    </td>
                    <td className="p-2">
                      <Button
                        size="icon"
                        variant="ghost"
                        className="size-7 text-muted-foreground hover:text-destructive"
                        onClick={(e) => deleteList(e, l.id, l.name)}
                      >
                        <Trash2 className="size-3.5" />
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
      <ListImportDialog
        open={importOpen}
        onOpenChange={setImportOpen}
        onCreated={(listId) => navigate({ to: "/listor/$listId", params: { listId } })}
      />
      <Dialog open={!!dupDialogList} onOpenChange={(o) => !o && setDupDialogList(null)}>
        <DialogContent className="sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <AlertTriangle className="size-4 text-amber-500" />
              Dubbletter i &quot;{dupDialogList?.name}&quot;
            </DialogTitle>
            <DialogDescription>
              Uppgifter i listan som även finns hos en annan säljare – i deras kundlista eller på en
              registrerad order/offert.
            </DialogDescription>
          </DialogHeader>
          <div className="max-h-[28rem] overflow-y-auto space-y-3">
            {[...dupsByRow.entries()].map(([rowId, rowDups]) => {
              const rowData = dupRows?.get(rowId) ?? {};
              const fields = dialogColumns
                .map((c) => ({ name: c.name, value: (rowData[c.id] ?? "").trim() }))
                .filter((f) => f.value);
              return (
                <div key={rowId} className="border rounded-md overflow-hidden">
                  <div className="px-3 py-2 space-y-0.5">
                    {fields.length > 0 ? (
                      fields.map((f, i) => (
                        <div key={i} className="text-sm flex gap-2">
                          <span className="text-xs text-muted-foreground uppercase tracking-wide w-32 shrink-0 pt-0.5">
                            {f.name}
                          </span>
                          <span className="min-w-0 break-words">{f.value}</span>
                        </div>
                      ))
                    ) : (
                      <div className="text-sm text-muted-foreground">Radens innehåll laddas…</div>
                    )}
                  </div>
                  <div className="px-3 py-2 bg-amber-50 border-t space-y-1">
                    {rowDups.map((d, i) => (
                      <div key={i} className="text-xs text-amber-900">
                        <AlertTriangle className="size-3 inline mr-1 text-amber-500" />
                        {dupTypeLabel(d.match_type)}{" "}
                        <span className="font-medium">{d.match_value}</span> finns även hos{" "}
                        <span className="font-medium">{d.other_party}</span> (
                        {dupSourceLabel(d.source)})
                      </div>
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
