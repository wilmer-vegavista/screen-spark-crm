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
import { Plus } from "lucide-react";
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

  return (
    <>
      <PageHeader
        title="Aktiviteter"
        description="Samtal, möten, uppgifter och påminnelser"
        actions={<Button onClick={() => setOpen(true)}><Plus className="size-4 mr-1" /> Ny aktivitet</Button>}
      />
      <div className="p-6">
        <Card className="divide-y">
          {(data ?? []).length === 0 && <div className="p-6 text-sm text-muted-foreground text-center">Inga aktiviteter än</div>}
          {data?.map(a => {
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
      <ActivityDialog open={open} onOpenChange={setOpen} />
    </>
  );
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
