import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import type { Json } from "@/integrations/supabase/types";
import { PageHeader } from "@/components/page-header";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Plus, FileSpreadsheet, Trash2, Link2 } from "lucide-react";
import { ListImportDialog } from "@/components/list-import-dialog";
import { useCurrentUser } from "@/lib/hooks/use-current-user";
import { newColumnId } from "@/lib/sheet-import";
import { toast } from "sonner";

export const Route = createFileRoute("/_authenticated/listor")({
  component: Listor,
});

const DEFAULT_COLUMNS = ["Företag", "Kontaktperson", "Telefon", "E-post", "Status", "Anteckningar"];

function Listor() {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const { user, isAdmin } = useCurrentUser();
  const [importOpen, setImportOpen] = useState(false);

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
      const { data } = await supabase.from("customer_list_rows").select("list_id");
      const m = new Map<string, number>();
      (data ?? []).forEach((r) => m.set(r.list_id, (m.get(r.list_id) ?? 0) + 1));
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
    </>
  );
}
