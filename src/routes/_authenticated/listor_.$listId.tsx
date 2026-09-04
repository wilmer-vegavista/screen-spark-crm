import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import type { Json } from "@/integrations/supabase/types";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu";
import {
  ArrowLeft,
  Plus,
  Search,
  Trash2,
  Loader2,
  RefreshCw,
  Pencil,
  ChevronDown,
  ExternalLink,
  Download,
} from "lucide-react";
import { toast } from "sonner";
import {
  fetchSheetCsv,
  rowsToListData,
  newColumnId,
  exportListToCsv,
  type ListColumn,
} from "@/lib/sheet-import";

export const Route = createFileRoute("/_authenticated/listor_/$listId")({
  component: ListSida,
});

type ListRow = { id: string; list_id: string; position: number; data: Record<string, string> };

function ListSida() {
  const { listId } = Route.useParams();
  const qc = useQueryClient();
  const navigate = useNavigate();
  const [q, setQ] = useState("");
  const [syncing, setSyncing] = useState(false);

  const { data: list } = useQuery({
    queryKey: ["customer-list", listId],
    queryFn: async () => {
      const { data } = await supabase
        .from("customer_lists")
        .select("*")
        .eq("id", listId)
        .maybeSingle();
      return data;
    },
  });

  const { data: rows } = useQuery({
    queryKey: ["customer-list-rows", listId],
    queryFn: async () => {
      const { data } = await supabase
        .from("customer_list_rows")
        .select("*")
        .eq("list_id", listId)
        .order("position");
      return (data ?? []) as unknown as ListRow[];
    },
  });

  const columns = useMemo(() => (list?.columns ?? []) as unknown as ListColumn[], [list]);

  const filtered = useMemo(() => {
    if (!q.trim()) return rows ?? [];
    const needle = q.toLowerCase();
    return (rows ?? []).filter((r) =>
      Object.values(r.data ?? {}).some((v) =>
        String(v ?? "")
          .toLowerCase()
          .includes(needle),
      ),
    );
  }, [rows, q]);

  const saveColumns = async (next: ListColumn[]) => {
    const { error } = await supabase
      .from("customer_lists")
      .update({ columns: next as unknown as Json })
      .eq("id", listId);
    if (error) return toast.error(error.message);
    qc.invalidateQueries({ queryKey: ["customer-list", listId] });
  };

  const renameList = async () => {
    const name = prompt("Nytt namn på listan:", list?.name ?? "");
    if (!name?.trim() || name.trim() === list?.name) return;
    const { error } = await supabase
      .from("customer_lists")
      .update({ name: name.trim() })
      .eq("id", listId);
    if (error) return toast.error(error.message);
    qc.invalidateQueries({ queryKey: ["customer-list", listId] });
    qc.invalidateQueries({ queryKey: ["customer-lists"] });
  };

  const addColumn = async () => {
    const name = prompt("Namn på ny kolumn:");
    if (!name?.trim()) return;
    await saveColumns([...columns, { id: newColumnId(), name: name.trim() }]);
  };

  const renameColumn = async (col: ListColumn) => {
    const name = prompt("Nytt kolumnnamn:", col.name);
    if (!name?.trim() || name.trim() === col.name) return;
    await saveColumns(columns.map((c) => (c.id === col.id ? { ...c, name: name.trim() } : c)));
  };

  const deleteColumn = async (col: ListColumn) => {
    if (!confirm(`Ta bort kolumnen "${col.name}"? Innehållet i kolumnen försvinner.`)) return;
    await saveColumns(columns.filter((c) => c.id !== col.id));
  };

  const saveCell = async (row: ListRow, colId: string, value: string) => {
    if ((row.data?.[colId] ?? "") === value) return;
    const data = { ...(row.data ?? {}), [colId]: value };
    const { error } = await supabase
      .from("customer_list_rows")
      .update({ data: data as unknown as Json })
      .eq("id", row.id);
    if (error) return toast.error(error.message);
    qc.setQueryData(["customer-list-rows", listId], (old: ListRow[] | undefined) =>
      (old ?? []).map((r) => (r.id === row.id ? { ...r, data } : r)),
    );
  };

  const addRow = async () => {
    const position = (rows ?? []).reduce((m, r) => Math.max(m, r.position), -1) + 1;
    const { error } = await supabase
      .from("customer_list_rows")
      .insert({ list_id: listId, position, data: {} });
    if (error) return toast.error(error.message);
    qc.invalidateQueries({ queryKey: ["customer-list-rows", listId] });
  };

  const deleteRow = async (row: ListRow) => {
    const { error } = await supabase.from("customer_list_rows").delete().eq("id", row.id);
    if (error) return toast.error(error.message);
    qc.setQueryData(["customer-list-rows", listId], (old: ListRow[] | undefined) =>
      (old ?? []).filter((r) => r.id !== row.id),
    );
  };

  // Hämtar om hela listan från det kopplade Google-arket och ersätter innehållet
  const syncFromSheet = async () => {
    if (!list?.source_url) return;
    if (
      !confirm(
        "Hämta om listan från Google Sheets? Innehållet här ersätts med det som står i arket.",
      )
    )
      return;
    setSyncing(true);
    try {
      const raw = await fetchSheetCsv(list.source_url);
      const { columns: newCols, rows: newRows } = rowsToListData(raw, true);
      // Behåll kolumn-id:n för kolumner med samma rubrik så inget refereras fel
      const mapped = newCols.map((nc) => {
        const existing = columns.find((c) => c.name.toLowerCase() === nc.name.toLowerCase());
        return existing ? { ...nc, id: existing.id } : nc;
      });
      const remapped = newRows.map((r) => {
        const obj: Record<string, string> = {};
        newCols.forEach((nc, i) => {
          obj[mapped[i].id] = r[nc.id] ?? "";
        });
        return obj;
      });
      const { error: delErr } = await supabase
        .from("customer_list_rows")
        .delete()
        .eq("list_id", listId);
      if (delErr) throw delErr;
      const { error: colErr } = await supabase
        .from("customer_lists")
        .update({ columns: mapped as unknown as Json })
        .eq("id", listId);
      if (colErr) throw colErr;
      for (let i = 0; i < remapped.length; i += 500) {
        const chunk = remapped
          .slice(i, i + 500)
          .map((data, j) => ({ list_id: listId, position: i + j, data: data as unknown as Json }));
        const { error: insErr } = await supabase.from("customer_list_rows").insert(chunk);
        if (insErr) throw insErr;
      }
      toast.success(`Listan uppdaterad – ${remapped.length} rader hämtade från arket`);
      qc.invalidateQueries({ queryKey: ["customer-list", listId] });
      qc.invalidateQueries({ queryKey: ["customer-list-rows", listId] });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Kunde inte hämta arket");
    } finally {
      setSyncing(false);
    }
  };

  const exportCsv = () => {
    if (!list) return;
    exportListToCsv(
      list.name,
      columns,
      (rows ?? []).map((r) => r.data ?? {}),
    );
    toast.success("Listan exporterad som CSV");
  };

  const deleteList = async () => {
    if (!list) return;
    if (!confirm(`Ta bort listan "${list.name}" och alla dess rader? Detta kan inte ångras.`))
      return;
    const { error } = await supabase.from("customer_lists").delete().eq("id", listId);
    if (error) return toast.error(error.message);
    toast.success("Listan borttagen");
    qc.invalidateQueries({ queryKey: ["customer-lists"] });
    navigate({ to: "/listor" });
  };

  if (list === null) {
    return (
      <div className="p-8 text-center text-muted-foreground">
        Listan hittades inte.{" "}
        <Link to="/listor" className="underline">
          Tillbaka till listor
        </Link>
      </div>
    );
  }

  return (
    <>
      <div className="flex items-start justify-between gap-4 px-6 py-5 border-b border-border/70">
        <div className="flex items-center gap-3 min-w-0">
          <Button asChild size="icon" variant="ghost" className="shrink-0">
            <Link to="/listor">
              <ArrowLeft className="size-4" />
            </Link>
          </Button>
          <div className="min-w-0">
            <button
              className="text-xl font-semibold tracking-tight truncate flex items-center gap-2 hover:opacity-80"
              style={{ fontFamily: "var(--font-display)" }}
              onClick={renameList}
              title="Klicka för att byta namn"
            >
              {list?.name ?? "…"} <Pencil className="size-3.5 text-muted-foreground shrink-0" />
            </button>
            <p className="text-xs text-muted-foreground mt-0.5">
              {(rows ?? []).length} rader • {columns.length} kolumner
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          {list?.source_url && (
            <>
              <Button size="sm" variant="outline" asChild>
                <a href={list.source_url} target="_blank" rel="noreferrer">
                  <ExternalLink className="size-3.5 mr-1" /> Öppna arket
                </a>
              </Button>
              <Button size="sm" variant="outline" onClick={syncFromSheet} disabled={syncing}>
                {syncing ? (
                  <Loader2 className="size-3.5 mr-1 animate-spin" />
                ) : (
                  <RefreshCw className="size-3.5 mr-1" />
                )}
                Hämta från Google Sheets
              </Button>
            </>
          )}
          <Button size="sm" variant="outline" onClick={exportCsv} disabled={!(rows ?? []).length}>
            <Download className="size-3.5 mr-1" /> Exportera
          </Button>
          <Button size="sm" onClick={addRow}>
            <Plus className="size-4 mr-1" /> Ny rad
          </Button>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button size="icon" variant="ghost">
                <ChevronDown className="size-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onClick={addColumn}>
                <Plus className="size-4 mr-2" /> Lägg till kolumn
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem
                onClick={deleteList}
                className="text-destructive focus:text-destructive"
              >
                <Trash2 className="size-4 mr-2" /> Ta bort listan
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>

      <div className="p-6 space-y-4">
        <div className="relative max-w-sm">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 size-4 text-muted-foreground" />
          <Input
            placeholder="Sök i listan..."
            value={q}
            onChange={(e) => setQ(e.target.value)}
            className="pl-8"
          />
        </div>

        <div className="border rounded-md overflow-auto max-h-[calc(100vh-16rem)]">
          <table className="text-sm border-collapse min-w-full">
            <thead className="sticky top-0 z-10">
              <tr>
                <th className="bg-muted text-muted-foreground font-normal text-xs w-10 min-w-10 border border-border/70 p-0" />
                {columns.map((col) => (
                  <th
                    key={col.id}
                    className="bg-muted border border-border/70 p-0 min-w-40 text-left"
                  >
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <button className="w-full px-2.5 py-1.5 text-left font-semibold text-xs uppercase tracking-wide hover:bg-accent/60 flex items-center justify-between gap-1">
                          <span className="truncate">{col.name}</span>
                          <ChevronDown className="size-3 text-muted-foreground shrink-0" />
                        </button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="start">
                        <DropdownMenuItem onClick={() => renameColumn(col)}>
                          <Pencil className="size-4 mr-2" /> Byt namn
                        </DropdownMenuItem>
                        <DropdownMenuItem
                          onClick={() => deleteColumn(col)}
                          className="text-destructive focus:text-destructive"
                        >
                          <Trash2 className="size-4 mr-2" /> Ta bort kolumn
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </th>
                ))}
                <th className="bg-muted border border-border/70 w-10 min-w-10 p-0">
                  <button
                    className="w-full h-full px-2 py-1.5 hover:bg-accent/60"
                    onClick={addColumn}
                    title="Lägg till kolumn"
                  >
                    <Plus className="size-3.5 mx-auto text-muted-foreground" />
                  </button>
                </th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((row, idx) => (
                <tr key={row.id} className="group">
                  <td className="bg-muted/60 text-muted-foreground text-xs text-center border border-border/70 select-none">
                    {idx + 1}
                  </td>
                  {columns.map((col) => (
                    <td key={col.id} className="border border-border/70 p-0">
                      <input
                        className="w-full px-2.5 py-1.5 bg-transparent outline-none focus:bg-primary/5 focus:ring-1 focus:ring-primary/50 focus:relative"
                        defaultValue={row.data?.[col.id] ?? ""}
                        onBlur={(e) => saveCell(row, col.id, e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === "Enter") (e.target as HTMLInputElement).blur();
                        }}
                      />
                    </td>
                  ))}
                  <td className="border border-border/70 p-0 text-center">
                    <button
                      className="opacity-0 group-hover:opacity-100 p-1.5 text-muted-foreground hover:text-destructive transition-opacity"
                      onClick={() => deleteRow(row)}
                      title="Ta bort rad"
                    >
                      <Trash2 className="size-3.5" />
                    </button>
                  </td>
                </tr>
              ))}
              {filtered.length === 0 && (
                <tr>
                  <td
                    colSpan={columns.length + 2}
                    className="p-8 text-center text-sm text-muted-foreground border border-border/70"
                  >
                    {q
                      ? "Inga rader matchar sökningen"
                      : 'Listan är tom – klicka på "Ny rad" för att börja'}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        <Button size="sm" variant="outline" onClick={addRow}>
          <Plus className="size-4 mr-1" /> Ny rad
        </Button>
      </div>
    </>
  );
}
