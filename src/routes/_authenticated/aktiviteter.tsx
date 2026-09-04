import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { PageHeader } from "@/components/page-header";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Checkbox } from "@/components/ui/checkbox";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { ListStatusBoard } from "@/components/list-status-board";
import { Plus, ListChecks, Tags } from "lucide-react";
import { format, isPast, isToday } from "date-fns";
import { sv } from "date-fns/locale";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/_authenticated/aktiviteter")({
  component: Aktiviteter,
});

function Aktiviteter() {
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);

  const { data } = useQuery({
    queryKey: ["activities"],
    queryFn: async () => {
      const { data } = await supabase.from("activities").select("*").order("completed").order("due_at", { ascending: true, nullsFirst: false });
      return data ?? [];
    },
  });

  const toggle = async (id: string, completed: boolean) => {
    const { error } = await supabase.from("activities").update({
      completed: !completed,
      completed_at: !completed ? new Date().toISOString() : null,
    }).eq("id", id);
    if (error) toast.error(error.message);
    else qc.invalidateQueries({ queryKey: ["activities"] });
  };

  const groups = groupByDay(data ?? []);

  return (
    <>
      <PageHeader
        title="Aktiviteter"
        description="Samtal, möten, uppgifter och återkopplingar – dag för dag"
        actions={<Button onClick={() => setOpen(true)}><Plus className="size-4 mr-1" /> Ny aktivitet</Button>}
      />
      <div className="p-6">
        <Tabs defaultValue="aktiviteter">
          <TabsList>
            <TabsTrigger value="aktiviteter">
              <ListChecks className="size-3.5 mr-1" /> Aktiviteter
            </TabsTrigger>
            <TabsTrigger value="kundstatus">
              <Tags className="size-3.5 mr-1" /> Kundstatus
            </TabsTrigger>
          </TabsList>

          <TabsContent value="aktiviteter" className="space-y-6 pt-4">
            {(data ?? []).length === 0 && (
              <Card><div className="p-6 text-sm text-muted-foreground text-center">Inga aktiviteter än</div></Card>
            )}
            {groups.map(g => (
              <div key={g.key} className="space-y-2">
                <div className="flex items-center gap-2">
                  <h2 className={cn("text-sm font-semibold", g.tone === "overdue" && "text-destructive", g.tone === "today" && "text-primary")}>
                    {g.label}
                  </h2>
                  <span className="text-xs text-muted-foreground">{g.items.length} st</span>
                </div>
                <Card className="divide-y">
                  {g.items.map(a => {
                    const overdue = a.due_at && !a.completed && isPast(new Date(a.due_at)) && !isToday(new Date(a.due_at));
                    return (
                      <div key={a.id} className="flex items-center gap-3 p-3">
                        <Checkbox checked={a.completed} onCheckedChange={() => toggle(a.id, a.completed)} />
                        <div className="flex-1 min-w-0">
                          <div className={cn("text-sm font-medium", a.completed && "line-through text-muted-foreground")}>{a.title}</div>
                          <div className="text-xs text-muted-foreground flex items-center gap-2">
                            <span className="capitalize">{a.type}</span>
                            {a.description && <><span>·</span><span className="truncate">{a.description}</span></>}
                          </div>
                        </div>
                        {a.due_at && (
                          <div className={cn("text-xs", overdue ? "text-destructive font-medium" : "text-muted-foreground")}>
                            {format(new Date(a.due_at), "d MMM HH:mm", { locale: sv })}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </Card>
              </div>
            ))}
          </TabsContent>

          <TabsContent value="kundstatus" className="pt-4">
            <ListStatusBoard />
          </TabsContent>
        </Tabs>
      </div>
      <ActivityDialog open={open} onOpenChange={setOpen} />
    </>
  );
}

type Act = { id: string; completed: boolean; due_at: string | null; [k: string]: any };

function groupByDay(items: Act[]) {
  const groups: { key: string; label: string; tone: "overdue" | "today" | "future" | "none"; items: Act[] }[] = [];
  const push = (key: string, label: string, tone: "overdue" | "today" | "future" | "none", item: Act) => {
    let g = groups.find(g => g.key === key);
    if (!g) { g = { key, label, tone, items: [] }; groups.push(g); }
    g.items.push(item);
  };

  for (const a of items) {
    if (a.completed) { push("done", "Klara", "none", a); continue; }
    if (!a.due_at) { push("nodate", "Utan datum", "none", a); continue; }
    const d = new Date(a.due_at);
    const key = format(d, "yyyy-MM-dd");
    if (isPast(d) && !isToday(d)) push("overdue", "Försenade", "overdue", a);
    else if (isToday(d)) push(key, `Idag – ${format(d, "EEEE d MMMM", { locale: sv })}`, "today", a);
    else push(key, format(d, "EEEE d MMMM yyyy", { locale: sv }), "future", a);
  }

  const rank = (k: string) => (k === "overdue" ? 0 : k === "nodate" ? 2 : k === "done" ? 3 : 1);
  return groups.sort((a, b) => rank(a.key) - rank(b.key) || a.key.localeCompare(b.key));
}


function ActivityDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (v: boolean) => void }) {
  const qc = useQueryClient();
  const [title, setTitle] = useState("");
  const [type, setType] = useState("uppgift");
  const [description, setDescription] = useState("");
  const [dueAt, setDueAt] = useState("");
  const [loading, setLoading] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    const { data: u } = await supabase.auth.getUser();
    const { error } = await supabase.from("activities").insert({
      title, type: type as any, description: description || null,
      due_at: dueAt || null,
      assigned_to: u.user?.id, created_by: u.user?.id,
    });
    setLoading(false);
    if (error) return toast.error(error.message);
    toast.success("Aktivitet skapad");
    setTitle(""); setDescription(""); setDueAt("");
    qc.invalidateQueries({ queryKey: ["activities"] });
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader><DialogTitle>Ny aktivitet</DialogTitle></DialogHeader>
        <form onSubmit={submit} className="space-y-3">
          <div><Label>Titel</Label><Input value={title} onChange={e => setTitle(e.target.value)} required /></div>
          <div>
            <Label>Typ</Label>
            <Select value={type} onValueChange={setType}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="samtal">Samtal</SelectItem>
                <SelectItem value="mote">Möte</SelectItem>
                <SelectItem value="mejl">Mejl</SelectItem>
                <SelectItem value="uppgift">Uppgift</SelectItem>
                <SelectItem value="paminnelse">Påminnelse</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div><Label>Beskrivning</Label><Textarea value={description} onChange={e => setDescription(e.target.value)} /></div>
          <div><Label>Deadline</Label><Input type="datetime-local" value={dueAt} onChange={e => setDueAt(e.target.value)} /></div>
          <DialogFooter><Button type="submit" disabled={loading}>Spara</Button></DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
