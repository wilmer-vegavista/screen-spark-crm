import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { PageHeader } from "@/components/page-header";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from "@/components/ui/select";
import { Plus, Trash2, UserPlus, AlertTriangle } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { useCurrentUser } from "@/lib/hooks/use-current-user";

export const Route = createFileRoute("/_authenticated/leads")({
  component: Leads,
  head: () => ({
    meta: [
      { title: "Leads – Vega Vista CRM" },
      { name: "description", content: "Gemensam leadslista i kalkylarksformat med återkoppling och dubblettvarningar." },
      { property: "og:title", content: "Leads – Vega Vista CRM" },
      { property: "og:description", content: "Gemensam leadslista i kalkylarksformat med återkoppling och dubblettvarningar." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
});

type Lead = {
  id: string;
  company_name: string;
  contact_name: string | null;
  phone: string | null;
  email: string | null;
  comment: string | null;
  status: string;
  followup_date: string | null;
  customer_id: string | null;
  owner_id: string | null;
  created_by: string | null;
  created_at: string;
};

const norm = (v?: string | null) => (v ?? "").toLowerCase().replace(/[\s\-()+]/g, "").trim();

const STATUS: Record<string, { label: string; cls: string }> = {
  ny: { label: "Ny", cls: "bg-muted text-muted-foreground" },
  pagaende: { label: "Pågående", cls: "bg-primary/10 text-primary" },
  affar: { label: "Affär", cls: "bg-emerald-500/10 text-emerald-600" },
  forlorad: { label: "Förlorad", cls: "bg-destructive/10 text-destructive" },
};

function Leads() {
  const qc = useQueryClient();
  const { user, isAdmin } = useCurrentUser();
  const [search, setSearch] = useState("");
  const [sellerFilter, setSellerFilter] = useState("alla");
  const seenRef = useRef<Set<string>>(new Set());

  const { data: leads } = useQuery({
    queryKey: ["leads"],
    queryFn: async () => {
      const { data, error } = await supabase.from("leads").select("*").order("created_at", { ascending: false });
      if (error) throw error;
      return (data ?? []) as Lead[];
    },
  });

  const { data: profiles } = useQuery({
    queryKey: ["profiles-basic"],
    queryFn: async () => {
      const { data } = await supabase.from("profiles").select("id, full_name, email");
      return data ?? [];
    },
  });

  const nameOf = (id?: string | null) => {
    if (!id) return "–";
    const p = (profiles ?? []).find(p => p.id === id);
    return p?.full_name || p?.email || "Okänd";
  };

  // Notis när någon annan lägger in ett lead som matchar ett av mina
  useEffect(() => {
    const ch = supabase
      .channel("leads-dupes")
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "leads" }, payload => {
        const row = payload.new as Lead;
        if (!user || row.created_by === user.id) return;
        if (seenRef.current.has(row.id)) return;
        seenRef.current.add(row.id);
        const mine = (qc.getQueryData(["leads"]) as Lead[] | undefined) ?? [];
        const clash = mine.find(
          l =>
            (l.owner_id === user.id || l.created_by === user.id) &&
            ((norm(l.company_name) && norm(l.company_name) === norm(row.company_name)) ||
              (norm(l.phone) && norm(l.phone) === norm(row.phone)) ||
              (norm(l.email) && norm(l.email) === norm(row.email))),
        );
        qc.invalidateQueries({ queryKey: ["leads"] });
        if (clash) {
          toast.warning(`${nameOf(row.created_by)} har lagt en aktivitet på ${row.company_name}`, {
            description: "Ni har samma lead – stäm av innan ni ringer.",
            duration: 12000,
          });
        }
      })
      .subscribe();
    return () => {
      supabase.removeChannel(ch);
    };
  }, [user?.id, profiles]);

  const duplicateKeys = useMemo(() => {
    const counts = new Map<string, number>();
    for (const l of leads ?? []) {
      for (const k of [norm(l.company_name), norm(l.phone), norm(l.email)].filter(Boolean)) {
        counts.set(k, (counts.get(k) ?? 0) + 1);
      }
    }
    return counts;
  }, [leads]);

  const isDuplicate = (l: Lead) =>
    [norm(l.company_name), norm(l.phone), norm(l.email)].filter(Boolean).some(k => (duplicateKeys.get(k) ?? 0) > 1);

  const sellers = useMemo(() => {
    const ids = new Set<string>();
    (leads ?? []).forEach(l => l.owner_id && ids.add(l.owner_id));
    return [...ids];
  }, [leads]);

  const rows = (leads ?? []).filter(l => {
    if (sellerFilter !== "alla" && l.owner_id !== sellerFilter) return false;
    if (!search.trim()) return true;
    const q = search.toLowerCase();
    return [l.company_name, l.contact_name, l.phone, l.email, l.comment].some(v => (v ?? "").toLowerCase().includes(q));
  });

  const canEdit = (l: Lead) => isAdmin || l.owner_id === user?.id || l.created_by === user?.id;

  const addRow = async () => {
    if (!user) return;
    const { error } = await supabase.from("leads").insert({
      company_name: "Nytt lead",
      owner_id: user.id,
      created_by: user.id,
    });
    if (error) return toast.error(error.message);
    qc.invalidateQueries({ queryKey: ["leads"] });
  };

  const patch = async (l: Lead, values: Partial<Lead>) => {
    const { error } = await supabase.from("leads").update(values as any).eq("id", l.id);
    if (error) return toast.error(error.message);

    // Dubblettkoll mot andra säljares leads
    const cmp = { ...l, ...values } as Lead;
    const clash = (leads ?? []).find(
      o =>
        o.id !== l.id &&
        o.created_by !== user?.id &&
        ((norm(o.company_name) && norm(o.company_name) === norm(cmp.company_name)) ||
          (norm(o.phone) && norm(o.phone) === norm(cmp.phone)) ||
          (norm(o.email) && norm(o.email) === norm(cmp.email))),
    );
    if (clash) {
      toast.warning(`${nameOf(clash.owner_id ?? clash.created_by)} har redan en aktivitet på ${clash.company_name}`, {
        duration: 10000,
      });
    }

    // Återkoppling → aktivitet
    if (values.followup_date && values.followup_date !== l.followup_date) {
      const due = new Date(`${values.followup_date}T09:00:00`);
      await supabase.from("activities").insert({
        title: `Återkoppling: ${cmp.company_name}`,
        type: "paminnelse" as any,
        description: [cmp.contact_name, cmp.phone, cmp.comment].filter(Boolean).join(" · ") || null,
        due_at: due.toISOString(),
        assigned_to: l.owner_id ?? user?.id,
        created_by: user?.id,
      });
      qc.invalidateQueries({ queryKey: ["activities"] });
      toast.success("Återkoppling inlagd under Aktiviteter");
    }
    qc.invalidateQueries({ queryKey: ["leads"] });
  };

  const remove = async (l: Lead) => {
    const { error } = await supabase.from("leads").delete().eq("id", l.id);
    if (error) return toast.error(error.message);
    qc.invalidateQueries({ queryKey: ["leads"] });
  };

  const makeCustomer = async (l: Lead) => {
    if (!user) return;
    const { data: existing } = await supabase
      .from("customers")
      .select("id")
      .ilike("company_name", l.company_name)
      .maybeSingle();

    let customerId = existing?.id ?? null;
    if (!customerId) {
      const { data, error } = await supabase
        .from("customers")
        .insert({
          company_name: l.company_name,
          contact_name: l.contact_name,
          phone: l.phone,
          email: l.email,
          notes: l.comment,
          owner_id: l.owner_id ?? user.id,
          created_by: user.id,
        })
        .select("id")
        .single();
      if (error) return toast.error(error.message);
      customerId = data.id;
    }
    await supabase.from("leads").update({ customer_id: customerId, status: "affar" as any }).eq("id", l.id);
    qc.invalidateQueries({ queryKey: ["leads"] });
    qc.invalidateQueries({ queryKey: ["customers"] });
    toast.success("Kundkort skapat från lead");
  };

  return (
    <>
      <PageHeader
        title="Leads"
        description="Gemensam leadslista – alla säljare ser vem som jobbar med vilken kund"
        actions={
          <Button onClick={addRow}>
            <Plus className="size-4 mr-1" /> Nytt lead
          </Button>
        }
      />
      <div className="p-6 space-y-4">
        <div className="flex flex-wrap gap-2">
          <Input placeholder="Sök företag, kontakt, mobil, mail…" value={search} onChange={e => setSearch(e.target.value)} className="max-w-xs" />
          <Select value={sellerFilter} onValueChange={setSellerFilter}>
            <SelectTrigger className="w-52"><SelectValue placeholder="Säljare" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="alla">Alla säljare</SelectItem>
              {sellers.map(id => (
                <SelectItem key={id} value={id}>{nameOf(id)}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <Card className="overflow-x-auto p-0">
          <table className="w-full text-sm border-collapse min-w-[1100px]">
            <thead>
              <tr className="bg-muted/50 text-left text-xs uppercase tracking-wide text-muted-foreground">
                <th className="border-b border-r px-3 py-2 font-semibold w-[190px]">Företagsnamn</th>
                <th className="border-b border-r px-3 py-2 font-semibold w-[150px]">Kontaktperson</th>
                <th className="border-b border-r px-3 py-2 font-semibold w-[130px]">Mobilnummer</th>
                <th className="border-b border-r px-3 py-2 font-semibold w-[180px]">Mail</th>
                <th className="border-b border-r px-3 py-2 font-semibold">Kommentar</th>
                <th className="border-b border-r px-3 py-2 font-semibold w-[140px]">Återkoppling</th>
                <th className="border-b border-r px-3 py-2 font-semibold w-[130px]">Status</th>
                <th className="border-b border-r px-3 py-2 font-semibold w-[130px]">Säljare</th>
                <th className="border-b px-3 py-2 font-semibold w-[90px]"></th>
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 && (
                <tr><td colSpan={9} className="p-8 text-center text-muted-foreground">Inga leads än</td></tr>
              )}
              {rows.map(l => {
                const editable = canEdit(l);
                return (
                  <tr key={l.id} className={cn("hover:bg-muted/30", isDuplicate(l) && "bg-amber-500/5")}>
                    <td className="border-b border-r p-0">
                      <div className="flex items-center">
                        {isDuplicate(l) && <AlertTriangle className="size-3.5 text-amber-500 ml-2 shrink-0" />}
                        <Cell value={l.company_name} disabled={!editable} onSave={v => patch(l, { company_name: v ?? "Namnlöst lead" })} />
                      </div>
                    </td>
                    <td className="border-b border-r p-0"><Cell value={l.contact_name} disabled={!editable} onSave={v => patch(l, { contact_name: v })} /></td>
                    <td className="border-b border-r p-0"><Cell value={l.phone} disabled={!editable} onSave={v => patch(l, { phone: v })} /></td>
                    <td className="border-b border-r p-0"><Cell value={l.email} disabled={!editable} onSave={v => patch(l, { email: v })} /></td>
                    <td className="border-b border-r p-0"><Cell value={l.comment} disabled={!editable} onSave={v => patch(l, { comment: v })} placeholder="Vad har ni pratat om / planerar sälja?" /></td>
                    <td className="border-b border-r p-0">
                      <input
                        type="date"
                        disabled={!editable}
                        value={l.followup_date ?? ""}
                        onChange={e => patch(l, { followup_date: e.target.value || null })}
                        className="w-full bg-transparent px-3 py-2 text-sm outline-none focus:bg-primary/5 disabled:opacity-70"
                      />
                    </td>
                    <td className="border-b border-r px-2 py-1.5">
                      <Select value={l.status} disabled={!editable} onValueChange={v => patch(l, { status: v })}>
                        <SelectTrigger className={cn("h-8 border-0 text-xs font-medium", STATUS[l.status]?.cls)}>
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {Object.entries(STATUS).map(([k, v]) => (
                            <SelectItem key={k} value={k}>{v.label}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </td>
                    <td className="border-b border-r px-3 py-2 text-xs text-muted-foreground">{nameOf(l.owner_id ?? l.created_by)}</td>
                    <td className="border-b px-2 py-1.5">
                      <div className="flex items-center gap-1">
                        <Button
                          size="icon"
                          variant="ghost"
                          className="size-7"
                          title={l.customer_id ? "Kundkort finns" : "Skapa kundkort"}
                          disabled={!editable || !!l.customer_id}
                          onClick={() => makeCustomer(l)}
                        >
                          <UserPlus className={cn("size-4", l.customer_id ? "text-emerald-600" : "text-primary")} />
                        </Button>
                        <Button size="icon" variant="ghost" className="size-7" disabled={!editable} onClick={() => remove(l)}>
                          <Trash2 className="size-4 text-destructive" />
                        </Button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </Card>
      </div>
    </>
  );
}

function Cell({
  value,
  onSave,
  disabled,
  placeholder,
}: {
  value: string | null | undefined;
  onSave: (v: string | null) => void;
  disabled?: boolean;
  placeholder?: string;
}) {
  const [draft, setDraft] = useState(value ?? "");
  useEffect(() => setDraft(value ?? ""), [value]);
  return (
    <input
      value={draft}
      disabled={disabled}
      placeholder={placeholder}
      onChange={e => setDraft(e.target.value)}
      onBlur={() => {
        if ((value ?? "") !== draft) onSave(draft.trim() || null);
      }}
      onKeyDown={e => {
        if (e.key === "Enter") (e.target as HTMLInputElement).blur();
      }}
      className="w-full bg-transparent px-3 py-2 text-sm outline-none focus:bg-primary/5 disabled:opacity-70"
    />
  );
}
