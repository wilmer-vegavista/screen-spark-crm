import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { PageHeader } from "@/components/page-header";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { Plus, Search, Mail, Phone, Building2, Trash2, X } from "lucide-react";
import { CustomerDetailDialog } from "@/components/customer-detail-dialog";
import { toast } from "sonner";

export const Route = createFileRoute("/_authenticated/kunder")({
  validateSearch: (s: Record<string, unknown>) => ({
    customer: typeof s.customer === "string" ? s.customer : undefined,
  }),
  component: Kunder,
});

function Kunder() {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const { customer: customerParam } = Route.useSearch();
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<any | null>(null);
  const [q, setQ] = useState("");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [selectMode, setSelectMode] = useState(false);

  const { data } = useQuery({
    queryKey: ["customers"],
    queryFn: async () => {
      const { data } = await supabase.from("customers").select("*").order("company_name");
      return data ?? [];
    },
  });

  useEffect(() => {
    if (!customerParam || !data) return;
    const found = data.find((c: any) => c.id === customerParam);
    if (found) {
      setEditing(found);
      setOpen(true);
      navigate({ to: "/kunder", search: {} as any, replace: true });
    }
  }, [customerParam, data, navigate]);

  const filtered = (data ?? []).filter(c =>
    !q || c.company_name.toLowerCase().includes(q.toLowerCase()) || (c.contact_name?.toLowerCase().includes(q.toLowerCase()))
  );

  const toggleOne = (id: string) => {
    const next = new Set(selected);
    next.has(id) ? next.delete(id) : next.add(id);
    setSelected(next);
  };

  const toggleAll = () => {
    if (selected.size === filtered.length) setSelected(new Set());
    else setSelected(new Set(filtered.map(c => c.id)));
  };

  const bulkDelete = async () => {
    if (!selected.size) return;
    if (!confirm(`Ta bort ${selected.size} kund(er)? Detta kan inte ångras.`)) return;
    const { error } = await supabase.from("customers").delete().in("id", [...selected]);
    if (error) return toast.error(error.message);
    toast.success(`${selected.size} kund(er) borttagna`);
    setSelected(new Set());
    setSelectMode(false);
    qc.invalidateQueries({ queryKey: ["customers"] });
  };

  return (
    <>
      <PageHeader
        title="Kunder"
        description="Alla bolag i CRM:t"
        actions={
          <div className="flex items-center gap-2">
            {selectMode ? (
              <>
                <span className="text-sm text-muted-foreground">{selected.size} valda</span>
                <Button size="sm" variant="destructive" onClick={bulkDelete} disabled={!selected.size}>
                  <Trash2 className="size-4 mr-1" /> Ta bort
                </Button>
                <Button size="sm" variant="ghost" onClick={() => { setSelectMode(false); setSelected(new Set()); }}>
                  <X className="size-4 mr-1" /> Avbryt
                </Button>
              </>
            ) : (
              <>
                <Button size="sm" variant="outline" onClick={() => setSelectMode(true)}>Markera flera</Button>
                <Button onClick={() => { setEditing(null); setOpen(true); }}><Plus className="size-4 mr-1" /> Ny kund</Button>
              </>
            )}
          </div>
        }
      />
      <div className="p-6 space-y-4">
        <div className="flex items-center gap-3">
          <div className="relative max-w-sm flex-1">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 size-4 text-muted-foreground" />
            <Input placeholder="Sök kund eller kontakt..." value={q} onChange={e => setQ(e.target.value)} className="pl-8" />
          </div>
          {selectMode && (
            <Button size="sm" variant="ghost" onClick={toggleAll}>
              {selected.size === filtered.length ? "Avmarkera alla" : "Markera alla"}
            </Button>
          )}
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
          {filtered.map(c => {
            const isSelected = selected.has(c.id);
            return (
              <Card
                key={c.id}
                className={`p-4 cursor-pointer hover:border-primary/50 transition-colors ${isSelected ? "border-primary bg-primary/5" : ""}`}
                onClick={() => {
                  if (selectMode) toggleOne(c.id);
                  else { setEditing(c); setOpen(true); }
                }}
              >
                <div className="flex items-start gap-3">
                  {selectMode && (
                    <Checkbox
                      checked={isSelected}
                      onCheckedChange={() => toggleOne(c.id)}
                      onClick={(e) => e.stopPropagation()}
                      className="mt-1"
                    />
                  )}
                  <div className="size-9 rounded-md bg-accent flex items-center justify-center shrink-0">
                    <Building2 className="size-4" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="font-medium truncate">{c.company_name}</div>
                    {c.contact_name && <div className="text-sm text-muted-foreground truncate">{c.contact_name}</div>}
                    <div className="mt-2 space-y-1">
                      {c.email && <div className="flex items-center gap-1.5 text-xs text-muted-foreground"><Mail className="size-3" /> {c.email}</div>}
                      {c.phone && <div className="flex items-center gap-1.5 text-xs text-muted-foreground"><Phone className="size-3" /> {c.phone}</div>}
                    </div>
                  </div>
                </div>
              </Card>
            );
          })}
          {filtered.length === 0 && <p className="text-sm text-muted-foreground col-span-full text-center py-8">Inga kunder ännu</p>}
        </div>
      </div>
      <CustomerDetailDialog open={open} onOpenChange={setOpen} customer={editing} />
    </>
  );
}
