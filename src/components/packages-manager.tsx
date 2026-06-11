import { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import { toast } from "sonner";
import { Plus, Pencil, Trash2 } from "lucide-react";

type Package = {
  id: string;
  name: string;
  description: string | null;
  price: number;
  weeks: number | null;
  views: number | null;
  sov: number | null;
  active: boolean;
};

type Product = {
  id: string;
  name: string;
  address: string | null;
  screen_type: string;
};

type PackageProduct = { package_id: string; product_id: string; position: number };

export function PackagesManager() {
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<Package | null>(null);

  const { data: packages, isLoading } = useQuery({
    queryKey: ["packages-admin"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("product_packages")
        .select("*")
        .order("name");
      if (error) throw error;
      return data as Package[];
    },
  });

  const { data: links } = useQuery({
    queryKey: ["package-products-all"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("package_products")
        .select("package_id, product_id, position");
      if (error) throw error;
      return (data ?? []) as PackageProduct[];
    },
  });

  const { data: products } = useQuery({
    queryKey: ["products-for-packages"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("products")
        .select("id, name, address, screen_type")
        .eq("active", true)
        .order("name");
      if (error) throw error;
      return data as Product[];
    },
  });

  const productById = new Map((products ?? []).map((p) => [p.id, p]));
  const productsByPackage = new Map<string, Product[]>();
  (links ?? []).forEach((l) => {
    const arr = productsByPackage.get(l.package_id) ?? [];
    const p = productById.get(l.product_id);
    if (p) arr.push(p);
    productsByPackage.set(l.package_id, arr);
  });

  const handleDelete = async (id: string) => {
    if (!confirm("Ta bort paket?")) return;
    const { error } = await supabase.from("product_packages").delete().eq("id", id);
    if (error) toast.error(error.message);
    else {
      toast.success("Paket borttaget");
      qc.invalidateQueries({ queryKey: ["packages-admin"] });
      qc.invalidateQueries({ queryKey: ["packages-list"] });
    }
  };

  return (
    <>
      <div className="flex justify-end mb-4">
        <Button onClick={() => { setEditing(null); setOpen(true); }}>
          <Plus className="size-4 mr-2" /> Nytt paket
        </Button>
      </div>
      <Card className="overflow-hidden">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Namn</TableHead>
              <TableHead>Skärmar</TableHead>
              <TableHead className="text-right">Pris</TableHead>
              <TableHead className="text-right">Veckor</TableHead>
              <TableHead className="text-right">Visningar</TableHead>
              <TableHead className="text-right">SOV %</TableHead>
              <TableHead>Aktiv</TableHead>
              <TableHead className="w-24"></TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading ? (
              <TableRow><TableCell colSpan={6} className="text-center text-muted-foreground py-8">Laddar…</TableCell></TableRow>
            ) : (packages ?? []).length === 0 ? (
              <TableRow><TableCell colSpan={6} className="text-center text-muted-foreground py-8">Inga paket än</TableCell></TableRow>
            ) : packages!.map((p) => {
              const prods = productsByPackage.get(p.id) ?? [];
              return (
                <TableRow key={p.id}>
                  <TableCell className="font-medium">
                    {p.name}
                    {p.description && (
                      <div className="text-xs text-muted-foreground font-normal">{p.description}</div>
                    )}
                  </TableCell>
                  <TableCell className="text-xs text-muted-foreground">
                    {prods.length === 0 ? "—" : prods.map(x => x.name).join(", ")}
                  </TableCell>
                  <TableCell className="text-right">{Number(p.price).toLocaleString("sv-SE")} kr</TableCell>
                  <TableCell className="text-right">{p.weeks ?? "—"}</TableCell>
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
              );
            })}
          </TableBody>
        </Table>
      </Card>

      <PackageDialog
        open={open}
        onOpenChange={setOpen}
        pkg={editing}
        products={products ?? []}
        initialProductIds={editing ? (productsByPackage.get(editing.id) ?? []).map(p => p.id) : []}
        onSaved={() => {
          qc.invalidateQueries({ queryKey: ["packages-admin"] });
          qc.invalidateQueries({ queryKey: ["package-products-all"] });
          qc.invalidateQueries({ queryKey: ["packages-list"] });
        }}
      />
    </>
  );
}

function PackageDialog({
  open, onOpenChange, pkg, products, initialProductIds, onSaved,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  pkg: Package | null;
  products: Product[];
  initialProductIds: string[];
  onSaved: () => void;
}) {
  const isEdit = !!pkg;
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState<Partial<Package>>({});
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());

  useEffect(() => {
    if (!open) return;
    setForm(pkg ?? { name: "", price: 0, active: true });
    setSelectedIds(new Set(initialProductIds));
  }, [open, pkg, initialProductIds.join(",")]);

  const toggle = (id: string) => {
    setSelectedIds(prev => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  };

  const handleSave = async () => {
    if (!form.name?.trim()) { toast.error("Namn krävs"); return; }
    setSaving(true);
    const payload = {
      name: form.name,
      description: form.description || null,
      price: Number(form.price ?? 0),
      weeks: form.weeks != null && (form.weeks as any) !== "" ? Number(form.weeks) : null,
      active: form.active ?? true,
      product_id: null,
    };

    let pkgId = pkg?.id;
    if (isEdit) {
      const { error } = await supabase.from("product_packages").update(payload).eq("id", pkg!.id);
      if (error) { setSaving(false); toast.error(error.message); return; }
    } else {
      const { data, error } = await supabase.from("product_packages").insert(payload).select("id").single();
      if (error || !data) { setSaving(false); toast.error(error?.message ?? "Fel"); return; }
      pkgId = data.id;
    }

    // Replace link rows
    await supabase.from("package_products").delete().eq("package_id", pkgId!);
    const ids = Array.from(selectedIds);
    if (ids.length > 0) {
      const rows = ids.map((product_id, position) => ({ package_id: pkgId!, product_id, position }));
      const { error } = await supabase.from("package_products").insert(rows);
      if (error) { setSaving(false); toast.error(error.message); return; }
    }

    setSaving(false);
    toast.success(isEdit ? "Paket uppdaterat" : "Paket skapat");
    onSaved();
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{isEdit ? "Redigera paket" : "Nytt paket"}</DialogTitle>
        </DialogHeader>
        <div className="grid grid-cols-2 gap-4">
          <div className="col-span-2">
            <Label>Namn *</Label>
            <Input value={form.name ?? ""} placeholder="t.ex. Citypaketet" onChange={(e) => setForm({ ...form, name: e.target.value })} />
          </div>
          <div className="col-span-2">
            <Label>Beskrivning</Label>
            <Textarea value={form.description ?? ""} onChange={(e) => setForm({ ...form, description: e.target.value })} />
          </div>
          <div>
            <Label>Pris (kr)</Label>
            <Input type="number" value={form.price ?? 0} onChange={(e) => setForm({ ...form, price: e.target.value as any })} />
          </div>
          <div>
            <Label>Antal veckor</Label>
            <Input type="number" value={form.weeks ?? ""} onChange={(e) => setForm({ ...form, weeks: e.target.value as any })} />
          </div>
          <div className="col-span-2 flex items-center gap-2">
            <Switch checked={form.active ?? true} onCheckedChange={(v) => setForm({ ...form, active: v })} />
            <Label>Aktiv</Label>
          </div>
          <div className="col-span-2">
            <Label>Skärmar som ingår ({selectedIds.size} valda)</Label>
            <div className="mt-2 border rounded-md max-h-72 overflow-y-auto divide-y">
              {products.length === 0 ? (
                <div className="p-4 text-sm text-muted-foreground">Inga aktiva produkter</div>
              ) : products.map((p) => (
                <label key={p.id} className="flex items-center gap-3 p-2 cursor-pointer hover:bg-muted/50">
                  <Checkbox
                    checked={selectedIds.has(p.id)}
                    onCheckedChange={() => toggle(p.id)}
                  />
                  <div className="flex-1">
                    <div className="text-sm font-medium">{p.name}</div>
                    <div className="text-xs text-muted-foreground">
                      {p.address ?? "—"} · {p.screen_type}
                    </div>
                  </div>
                </label>
              ))}
            </div>
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
