import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useCurrentUser } from "@/lib/hooks/use-current-user";
import { PageHeader } from "@/components/page-header";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { toast } from "sonner";
import { Plus, Pencil, Trash2 } from "lucide-react";

export const Route = createFileRoute("/_authenticated/produkter")({
  component: ProdukterPage,
});

type Product = {
  id: string;
  name: string;
  description: string | null;
  address: string | null;
  screen_type: string;
  format: string | null;
  dimensions: string | null;
  file_format: string | null;
  ad_duration_seconds: number | null;
  material_spec: string | null;
  image_url: string | null;
  default_commission_pct: number;
  commission_pct_with_base: number | null;
  commission_pct_provision_only: number | null;
  contacts_per_week: number | null;
  active: boolean;
};

const SCREEN_TYPES = ["led", "lcd", "print", "other"];
const AD_DURATIONS = [5, 10, 15, 20];

function buildStorlek(format?: string | null, dimensions?: string | null, file_format?: string | null) {
  return [format, dimensions, file_format].filter(Boolean).join(" · ") || null;
}

function ProdukterPage() {
  const { isAdmin } = useCurrentUser();

  if (!isAdmin) {
    return (
      <>
        <PageHeader title="Produkter" />
        <div className="p-6">
          <Card className="p-6 text-sm text-muted-foreground">
            Du har inte behörighet att se denna sida.
          </Card>
        </div>
      </>
    );
  }

  return <ProductsView />;
}

function ProductsView() {
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<Product | null>(null);

  const { data, isLoading } = useQuery({
    queryKey: ["products-admin"],
    queryFn: async () => {
      const { data, error } = await supabase.from("products").select("*").order("name");
      if (error) throw error;
      return data as Product[];
    },
  });

  const handleDelete = async (id: string) => {
    if (!confirm("Ta bort produkt?")) return;
    const { error } = await supabase.from("products").delete().eq("id", id);
    if (error) toast.error(error.message);
    else {
      toast.success("Produkt borttagen");
      qc.invalidateQueries({ queryKey: ["products-admin"] });
    }
  };

  return (
    <>
      <PageHeader
        title="Produkter"
        description="Hantera skyltar och produkter som säljarna kan sälja"
        actions={
          <Button onClick={() => { setEditing(null); setOpen(true); }}>
            <Plus className="size-4 mr-2" /> Ny produkt
          </Button>
        }
      />
      <div className="p-6">
        <Card className="overflow-hidden">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Namn</TableHead>
                <TableHead>Typ</TableHead>
                <TableHead>Adress</TableHead>
                <TableHead>Format</TableHead>
                <TableHead className="text-right">Provision %</TableHead>
                <TableHead>Aktiv</TableHead>
                <TableHead className="w-24"></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading ? (
                <TableRow><TableCell colSpan={7} className="text-center text-muted-foreground py-8">Laddar…</TableCell></TableRow>
              ) : (data ?? []).length === 0 ? (
                <TableRow><TableCell colSpan={7} className="text-center text-muted-foreground py-8">Inga produkter än</TableCell></TableRow>
              ) : data!.map(p => (
                <TableRow key={p.id}>
                  <TableCell className="font-medium">{p.name}</TableCell>
                  <TableCell className="uppercase text-xs text-muted-foreground">{p.screen_type}</TableCell>
                  <TableCell className="text-muted-foreground">{p.address || "—"}</TableCell>
                  <TableCell className="text-muted-foreground">{p.format || "—"} {p.dimensions ? `· ${p.dimensions}` : ""}</TableCell>
                  <TableCell className="text-right">{p.default_commission_pct}%</TableCell>
                  <TableCell>{p.active ? "Ja" : "Nej"}</TableCell>
                  <TableCell>
                    <div className="flex justify-end gap-1">
                      <Button variant="ghost" size="icon" onClick={() => { setEditing(p); setOpen(true); }}>
                        <Pencil className="size-4" />
                      </Button>
                      <Button variant="ghost" size="icon" onClick={() => handleDelete(p.id)}>
                        <Trash2 className="size-4" />
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </Card>
      </div>

      <ProductDialog
        open={open}
        onOpenChange={setOpen}
        product={editing}
        onSaved={() => qc.invalidateQueries({ queryKey: ["products-admin"] })}
      />
    </>
  );
}

function ProductDialog({
  open, onOpenChange, product, onSaved,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  product: Product | null;
  onSaved: () => void;
}) {
  const isEdit = !!product;
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState<Partial<Product>>({});

  // Reset when opening
  const init = () => setForm(product ?? {
    name: "",
    screen_type: "led",
    default_commission_pct: 10,
    active: true,
  });

  const handleSave = async () => {
    if (!form.name?.trim()) { toast.error("Namn krävs"); return; }
    setSaving(true);
    const storlek = buildStorlek(form.format, form.dimensions, form.file_format);
    const payload: any = {
      name: form.name,
      description: form.description || null,
      address: form.address || null,
      screen_type: form.screen_type || "led",
      format: form.format || null,
      dimensions: form.dimensions || null,
      file_format: form.file_format || null,
      ad_duration_seconds: form.ad_duration_seconds != null && form.ad_duration_seconds !== ("" as any) ? Number(form.ad_duration_seconds) : null,
      material_spec: storlek,
      image_url: form.image_url || null,
      default_commission_pct: Number(form.default_commission_pct ?? 0),
      commission_pct_with_base: form.commission_pct_with_base != null && form.commission_pct_with_base !== ("" as any) ? Number(form.commission_pct_with_base) : null,
      commission_pct_provision_only: form.commission_pct_provision_only != null && form.commission_pct_provision_only !== ("" as any) ? Number(form.commission_pct_provision_only) : null,
      contacts_per_week: form.contacts_per_week != null && form.contacts_per_week !== ("" as any) ? Number(form.contacts_per_week) : null,
      active: form.active ?? true,
    };
    const { error } = isEdit
      ? await supabase.from("products").update(payload).eq("id", product!.id)
      : await supabase.from("products").insert(payload);
    setSaving(false);
    if (error) { toast.error(error.message); return; }
    toast.success(isEdit ? "Produkt uppdaterad" : "Produkt skapad");
    onSaved();
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={(v) => { if (v) init(); onOpenChange(v); }}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{isEdit ? "Redigera produkt" : "Ny produkt"}</DialogTitle>
        </DialogHeader>
        <div className="grid grid-cols-2 gap-4">
          <div className="col-span-2">
            <Label>Namn *</Label>
            <Input value={form.name ?? ""} onChange={(e) => setForm({ ...form, name: e.target.value })} />
          </div>
          <div>
            <Label>Typ</Label>
            <Select value={form.screen_type ?? "led"} onValueChange={(v) => setForm({ ...form, screen_type: v })}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {SCREEN_TYPES.map(t => <SelectItem key={t} value={t}>{t.toUpperCase()}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label>Adress</Label>
            <Input value={form.address ?? ""} onChange={(e) => setForm({ ...form, address: e.target.value })} />
          </div>
          <div>
            <Label>Format</Label>
            <Input value={form.format ?? ""} onChange={(e) => setForm({ ...form, format: e.target.value })} />
          </div>
          <div>
            <Label>Mått</Label>
            <Input value={form.dimensions ?? ""} onChange={(e) => setForm({ ...form, dimensions: e.target.value })} />
          </div>
          <div>
            <Label>Filformat</Label>
            <Input value={form.file_format ?? ""} placeholder="t.ex. MP4, JPG, PNG" onChange={(e) => setForm({ ...form, file_format: e.target.value })} />
          </div>
          <div>
            <Label>Annonslängd</Label>
            <Select
              value={form.ad_duration_seconds ? String(form.ad_duration_seconds) : ""}
              onValueChange={(v) => setForm({ ...form, ad_duration_seconds: Number(v) as any })}
            >
              <SelectTrigger><SelectValue placeholder="Välj längd" /></SelectTrigger>
              <SelectContent>
                {AD_DURATIONS.map(s => <SelectItem key={s} value={String(s)}>{s} sekunder</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div className="col-span-2">
            <Label>Storlek (genereras automatiskt)</Label>
            <Input disabled value={buildStorlek(form.format, form.dimensions, form.file_format) ?? ""} placeholder="Format · Mått · Filformat" />
          </div>
          <div className="col-span-2">
            <Label>Beskrivning</Label>
            <Textarea value={form.description ?? ""} onChange={(e) => setForm({ ...form, description: e.target.value })} />
          </div>
          <div className="col-span-2">
            <Label>Bild-URL</Label>
            <Input value={form.image_url ?? ""} onChange={(e) => setForm({ ...form, image_url: e.target.value })} />
          </div>
          <div>
            <Label>Standard provision %</Label>
            <Input type="number" value={form.default_commission_pct ?? 0} onChange={(e) => setForm({ ...form, default_commission_pct: e.target.value as any })} />
          </div>
          <div>
            <Label>Kontakter / vecka</Label>
            <Input type="number" value={form.contacts_per_week ?? ""} onChange={(e) => setForm({ ...form, contacts_per_week: e.target.value as any })} />
          </div>
          <div>
            <Label>Provision % (med grundlön)</Label>
            <Input type="number" value={form.commission_pct_with_base ?? ""} onChange={(e) => setForm({ ...form, commission_pct_with_base: e.target.value as any })} />
          </div>
          <div>
            <Label>Provision % (endast provision)</Label>
            <Input type="number" value={form.commission_pct_provision_only ?? ""} onChange={(e) => setForm({ ...form, commission_pct_provision_only: e.target.value as any })} />
          </div>
          <div className="col-span-2 flex items-center gap-2">
            <Switch checked={form.active ?? true} onCheckedChange={(v) => setForm({ ...form, active: v })} />
            <Label>Aktiv</Label>
          </div>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>Avbryt</Button>
          <Button onClick={handleSave} disabled={saving}>{saving ? "Sparar…" : "Spara"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
