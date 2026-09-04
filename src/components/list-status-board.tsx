import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { supabase } from "@/integrations/supabase/client";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Search, FileSpreadsheet } from "lucide-react";
import type { ListColumn } from "@/lib/sheet-import";
import {
  STATUS_OPTIONS,
  isStatusColumn,
  statusChipClass,
  findCompanyColumn,
  findContactColumn,
  findPhoneColumn,
} from "@/lib/list-status";
import { cn } from "@/lib/utils";

interface Entry {
  rowId: string;
  listId: string;
  listName: string;
  company: string;
  contact: string;
  phone: string;
  status: string;
}

/** Alla kunder som markerats med en status i säljarens kundlistor, filtrerbart per status */
export function ListStatusBoard() {
  const navigate = useNavigate();
  const [filter, setFilter] = useState("all");
  const [q, setQ] = useState("");

  const { data: lists } = useQuery({
    queryKey: ["customer-lists"],
    queryFn: async () => {
      const { data } = await supabase.from("customer_lists").select("*");
      return data ?? [];
    },
  });

  const { data: rows } = useQuery({
    queryKey: ["customer-list-rows-all"],
    queryFn: async () => {
      const { data } = await supabase.from("customer_list_rows").select("id, list_id, data");
      return data ?? [];
    },
  });

  const entries = useMemo(() => {
    const out: Entry[] = [];
    (lists ?? []).forEach((l) => {
      const columns = (l.columns ?? []) as unknown as ListColumn[];
      const statusCol = columns.find(isStatusColumn);
      if (!statusCol) return;
      const companyCol = findCompanyColumn(columns);
      const contactCol = findContactColumn(columns);
      const phoneCol = findPhoneColumn(columns);
      (rows ?? [])
        .filter((r) => r.list_id === l.id)
        .forEach((r) => {
          const d = (r.data ?? {}) as Record<string, string>;
          const status = (d[statusCol.id] ?? "").trim();
          if (!status) return;
          out.push({
            rowId: r.id,
            listId: l.id,
            listName: l.name,
            company: (d[companyCol?.id ?? ""] ?? "").trim(),
            contact: (d[contactCol?.id ?? ""] ?? "").trim(),
            phone: (d[phoneCol?.id ?? ""] ?? "").trim(),
            status,
          });
        });
    });
    return out;
  }, [lists, rows]);

  const countFor = (label: string) =>
    entries.filter((e) => e.status.toLowerCase() === label.toLowerCase()).length;

  const filtered = entries.filter((e) => {
    if (filter !== "all" && e.status.toLowerCase() !== filter.toLowerCase()) return false;
    if (!q.trim()) return true;
    const needle = q.toLowerCase();
    return [e.company, e.contact, e.phone, e.listName].some((v) =>
      v.toLowerCase().includes(needle),
    );
  });

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2 flex-wrap">
        <button
          onClick={() => setFilter("all")}
          className={cn(
            "px-3 py-1 rounded-full text-xs font-medium border transition-all",
            filter === "all"
              ? "bg-foreground text-background border-foreground"
              : "bg-background text-muted-foreground hover:text-foreground",
          )}
        >
          Alla ({entries.length})
        </button>
        {STATUS_OPTIONS.map((o) => {
          const active = filter.toLowerCase() === o.label.toLowerCase();
          const count = countFor(o.label);
          return (
            <button
              key={o.label}
              onClick={() => setFilter(active ? "all" : o.label)}
              className={cn(
                "px-3 py-1 rounded-full text-xs font-medium transition-all",
                o.className,
                active ? "ring-2 ring-foreground/60 ring-offset-1" : "opacity-80 hover:opacity-100",
              )}
            >
              {o.label} ({count})
            </button>
          );
        })}
      </div>

      <div className="relative max-w-sm">
        <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 size-4 text-muted-foreground" />
        <Input
          placeholder="Sök företag, kontakt eller telefon..."
          value={q}
          onChange={(e) => setQ(e.target.value)}
          className="pl-8"
        />
      </div>

      {filtered.length === 0 ? (
        <Card>
          <div className="p-8 text-sm text-muted-foreground text-center">
            {entries.length === 0
              ? "Inga kunder har fått en status i dina listor ännu. Öppna en lista och sätt status i statuskolumnen."
              : "Inga kunder matchar filtret"}
          </div>
        </Card>
      ) : (
        <div className="border rounded-md overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-muted/50">
              <tr className="text-left">
                <th className="p-2">Företag</th>
                <th className="p-2 hidden md:table-cell">Kontakt</th>
                <th className="p-2 hidden sm:table-cell">Telefon</th>
                <th className="p-2">Status</th>
                <th className="p-2 hidden sm:table-cell">Lista</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((e) => (
                <tr
                  key={e.rowId}
                  className="border-t cursor-pointer hover:bg-accent/40 transition-colors"
                  onClick={() => navigate({ to: "/listor/$listId", params: { listId: e.listId } })}
                >
                  <td className="p-2 font-medium">{e.company || "—"}</td>
                  <td className="p-2 hidden md:table-cell text-muted-foreground">
                    {e.contact || "—"}
                  </td>
                  <td className="p-2 hidden sm:table-cell text-muted-foreground">
                    {e.phone || "—"}
                  </td>
                  <td className="p-2">
                    <span
                      className={`px-2.5 py-0.5 rounded-full text-xs font-medium whitespace-nowrap ${statusChipClass(e.status)}`}
                    >
                      {e.status}
                    </span>
                  </td>
                  <td className="p-2 hidden sm:table-cell">
                    <span className="text-xs text-muted-foreground flex items-center gap-1">
                      <FileSpreadsheet className="size-3" /> {e.listName}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
