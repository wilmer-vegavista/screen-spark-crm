import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { PageHeader } from "@/components/page-header";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Plus, Search, Mail, Phone, Building2 } from "lucide-react";
import { CustomerDialog } from "@/components/customer-dialog";

export const Route = createFileRoute("/_authenticated/kunder")({
  component: Kunder,
});

function Kunder() {
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<any | null>(null);
  const [q, setQ] = useState("");

  const { data } = useQuery({
    queryKey: ["customers"],
    queryFn: async () => {
      const { data } = await supabase.from("customers").select("*").order("company_name");
      return data ?? [];
    },
  });

  const filtered = (data ?? []).filter(c =>
    !q || c.company_name.toLowerCase().includes(q.toLowerCase()) || (c.contact_name?.toLowerCase().includes(q.toLowerCase()))
  );

  return (
    <>
      <PageHeader
        title="Kunder"
        description="Alla bolag i CRM:t"
        actions={<Button onClick={() => { setEditing(null); setOpen(true); }}><Plus className="size-4 mr-1" /> Ny kund</Button>}
      />
      <div className="p-6 space-y-4">
        <div className="relative max-w-sm">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 size-4 text-muted-foreground" />
          <Input placeholder="Sök kund eller kontakt..." value={q} onChange={e => setQ(e.target.value)} className="pl-8" />
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
          {filtered.map(c => (
            <Card key={c.id} className="p-4 cursor-pointer hover:border-primary/50 transition-colors" onClick={() => { setEditing(c); setOpen(true); }}>
              <div className="flex items-start gap-3">
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
          ))}
          {filtered.length === 0 && <p className="text-sm text-muted-foreground col-span-full text-center py-8">Inga kunder ännu</p>}
        </div>
      </div>
      <CustomerDialog open={open} onOpenChange={setOpen} customer={editing} />
    </>
  );
}
