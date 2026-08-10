import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { PageHeader } from "@/components/page-header";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from "@/components/ui/select";
import { Plus, Trash2, UserPlus, AlertTriangle, ChevronRight } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { useCurrentUser } from "@/lib/hooks/use-current-user";

export const Route = createFileRoute("/_authenticated/leads")({
  component: Leads,
  head: () => ({
    meta: [
      { title: "Leads – Vega Vista CRM" },
      { name: "description", content: "Gemensam leadslista – klicka på ett företag för att se alla uppgifter." },
      { property: "og:title", content: "Leads – Vega Vista CRM" },
      { property: "og:description", content: "Gemensam leadslista – klicka på ett företag för att se alla uppgifter." },
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
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
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

  const toggle = (id: string) =>
    setExpanded(prev => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });

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
        description="Klicka på ett företag för att se och redigera alla uppgifter"
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

        <Card className="divide-y">
          {rows.length === 0 && (
            <div className="p-8 text-center text-muted-foreground">Inga leads än</div>
          )}
          {rows.map(l => {
            const editable = canEdit(l);
            const isOpen = expanded.has(l.id);
            return (
              <div key={l.id} className={cn(isDuplicate(l) && "bg-amber-500/5")}>
                {/* Header row – bara företagsnamn */}
                <button
                  type="button"
                  onClick={() => toggle(l.id)}
                  className="flex w-full items-center gap-3 px-4 py-3 text-left hover:bg-muted/30 transition-colors"
                >
                  <ChevronRight className={cn("size-4 text-muted-foreground transition-transform", isOpen && "rotate-90")} />
                  {isDuplicate(l) && <AlertTriangle className="size-4 text-amber-500 shrink-0" />}
                  <span className="flex-1 font-medium truncate">{l.company_name || "Namnlöst lead"}</span>
                  {l.followup_date && (
                    <span className="hidden sm:inline text-xs text-muted-foreground">
                      Återkoppling {new Date(l.followup_date).toLocaleDateString("sv-SE")}
                    </span>
                  )}
                  <span className={cn("rounded-full px-2.5 py-0.5 text-xs font-medium", STATUS[l.status]?.cls)}>
                    {STATUS[l.status]?.label ?? l.status}
                  </span>
                  <span className="hidden md:inline text-xs text-muted-foreground w-28 text-right truncate">
                    {nameOf(l.owner_id ?? l.created_by)}
                  </span>
                </button>

                {/* Expanded details */}
                {isOpen && (
                  <div className="px-6 pb-5 pt-1 space-y-4 bg-muted/20">
                    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
                      <div className="space-y-1.5">
                        <Label className="text-xs text-muted-foreground">Kontaktperson</Label>
                        <Input
                          value={l.contact_name ?? ""}
                          disabled={!editable}
                          placeholder="För- och efternamn"
                          onChange={e => patch(l, { contact_name: e.target.value || null })}
                        />
                      </div>
                      <div className="space-y-1.5">
                        <Label className="text-xs text-muted-foreground">Mobilnummer</Label>
                        <Input
                          value={l.phone ?? ""}
                          disabled={!editable}
                          placeholder="070-000 00 00"
                          onChange={e => patch(l, { phone: e.target.value || null })}
                        />
                      </div>
                      <div className="space-y-1.5">
                        <Label className="text-xs text-muted-foreground">Mail</Label>
                        <Input
                          type="email"
                          value={l.email ?? ""}
                          disabled={!editable}
                          placeholder="namn@foretag.se"
                          onChange={e => patch(l, { email: e.target.value || null })}
                        />
                      </div>
                      <div className="space-y-1.5">
                        <Label className="text-xs text-muted-foreground">Företagsnamn</Label>
                        <Input
                          value={l.company_name}
                          disabled={!editable}
                          onChange={e => patch(l, { company_name: e.target.value || "Namnlöst lead" })}
                        />
                      </div>
                    </div>

                    <div className="space-y-1.5">
                      <Label className="text-xs text-muted-foreground">Kommentar – vad har ni pratat om / planerar sälja?</Label>
                      <Textarea
                        value={l.comment ?? ""}
                        disabled={!editable}
                        rows={2}
                        placeholder="Kort info om samtal eller planerad försäljning…"
                        onChange={e => patch(l, { comment: e.target.value || null })}
                      />
                    </div>

                    <div className="grid gap-4 sm:grid-cols-3">
                      <div className="space-y-1.5">
                        <Label className="text-xs text-muted-foreground">Återkoppling</Label>
                        <input
                          type="date"
                          disabled={!editable}
                          value={l.followup_date ?? ""}
                          onChange={e => patch(l, { followup_date: e.target.value || null })}
                          className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm outline-none focus:bg-primary/5 disabled:opacity-70"
                        />
                      </div>
                      <div className="space-y-1.5">
                        <Label className="text-xs text-muted-foreground">Status</Label>
                        <Select value={l.status} disabled={!editable} onValueChange={v => patch(l, { status: v })}>
                          <SelectTrigger className="h-9">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            {Object.entries(STATUS).map(([k, v]) => (
                              <SelectItem key={k} value={k}>{v.label}</SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>
                      <div className="space-y-1.5">
                        <Label className="text-xs text-muted-foreground">Säljare</Label>
                        <div className="flex h-9 items-center text-sm text-muted-foreground">{nameOf(l.owner_id ?? l.created_by)}</div>
                      </div>
                    </div>

                    <div className="flex items-center gap-2 pt-1">
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={!editable || !!l.customer_id}
                        onClick={() => makeCustomer(l)}
                      >
                        <UserPlus className="size-4 mr-1.5" />
                        {l.customer_id ? "Kundkort finns" : "Skapa kundkort"}
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        className="text-destructive"
                        disabled={!editable}
                        onClick={() => remove(l)}
                      >
                        <Trash2 className="size-4 mr-1.5" /> Ta bort
                      </Button>
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </Card>
      </div>
    </>
  );
}
