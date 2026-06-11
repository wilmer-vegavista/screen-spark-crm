import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState, useMemo } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useCurrentUser } from "@/lib/hooks/use-current-user";
import { PageHeader } from "@/components/page-header";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { toast } from "sonner";
import { Users, Plus, Pencil, Loader2, Mail } from "lucide-react";
import { createSeller, updateSeller, resendSellerInvite } from "@/lib/sellers.functions";

export const Route = createFileRoute("/_authenticated/saljare")({
  component: SaljarePage,
});

const fmt = (n: number) =>
  new Intl.NumberFormat("sv-SE", { style: "currency", currency: "SEK", maximumFractionDigits: 0 }).format(n || 0);

function SaljarePage() {
  const { isAdmin } = useCurrentUser();

  if (!isAdmin) {
    return (
      <>
        <PageHeader title="Säljare" description="Hantera säljare och deras uppgifter" />
        <div className="p-6">
          <Card className="p-6 text-sm text-muted-foreground">
            Du har inte behörighet att se denna sida.
          </Card>
        </div>
      </>
    );
  }

  return (
    <>
      <PageHeader title="Säljare" description="Lägg till och hantera säljare, provision och grundlön" />
      <div className="p-6">
        <SellersTable />
      </div>
    </>
  );
}

function SellersTable() {
  const qc = useQueryClient();
  const { data, isLoading } = useQuery({
    queryKey: ["sellers-admin"],
    queryFn: async () => {
      const [{ data: profiles }, { data: roles }, { data: comps }] = await Promise.all([
        supabase.from("profiles").select("id, full_name, email, phone, title"),
        supabase.from("user_roles").select("user_id, role"),
        supabase.from("seller_compensation").select("*"),
      ]);
      const sellerIds = new Set((roles ?? []).filter((r: any) => r.role === "saljare").map((r: any) => r.user_id));
      const compMap = new Map((comps ?? []).map((c: any) => [c.user_id, c]));
      return (profiles ?? [])
        .filter((p: any) => sellerIds.has(p.id))
        .map((p: any) => {
          const c = compMap.get(p.id);
          return {
            ...p,
            compensation_type: c?.compensation_type ?? "med_grundlon",
            base_salary: Number(c?.base_salary ?? 0),
            default_commission_pct: Number(c?.default_commission_pct ?? 0),
          };
        });
    },
  });

  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<any>(null);

  const handleSaved = () => {
    setDialogOpen(false);
    setEditing(null);
    qc.invalidateQueries({ queryKey: ["sellers-admin"] });
  };

  return (
    <Card>
      <div className="p-4 border-b flex items-center justify-between">
        <div>
          <h3 className="text-sm font-semibold">Säljare</h3>
          <p className="text-xs text-muted-foreground">Alla säljare i systemet med kontaktuppgifter och lön.</p>
        </div>
        <Button size="sm" onClick={() => { setEditing(null); setDialogOpen(true); }}>
          <Plus className="size-4 mr-1" /> Ny säljare
        </Button>
      </div>
      {isLoading ? (
        <div className="p-8 flex items-center justify-center text-muted-foreground text-sm">
          <Loader2 className="size-4 mr-2 animate-spin" /> Laddar…
        </div>
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Namn</TableHead>
              <TableHead>Titel</TableHead>
              <TableHead>E-post</TableHead>
              <TableHead>Telefon</TableHead>
              <TableHead>Typ</TableHead>
              <TableHead className="text-right">Grundlön</TableHead>
              <TableHead className="text-right">Provision %</TableHead>
              <TableHead className="w-20"></TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {(data ?? []).map((s: any) => (
              <TableRow key={s.id}>
                <TableCell className="font-medium">{s.full_name || "—"}</TableCell>
                <TableCell className="text-xs text-muted-foreground">{s.title || "—"}</TableCell>
                <TableCell className="text-xs">{s.email || "—"}</TableCell>
                <TableCell className="text-xs">{s.phone || "—"}</TableCell>
                <TableCell className="text-xs">
                  {s.compensation_type === "endast_provision" ? "Endast provision" : "Med grundlön"}
                </TableCell>
                <TableCell className="text-right">
                  {s.compensation_type === "endast_provision" ? "—" : fmt(s.base_salary)}
                </TableCell>
                <TableCell className="text-right">{s.default_commission_pct}%</TableCell>
                <TableCell className="text-right">
                  <div className="flex items-center justify-end gap-1">
                    <Button
                      variant="ghost"
                      size="icon"
                      title="Skicka ny inbjudan"
                      onClick={async () => {
                        if (!s.email) return;
                        try {
                          await resendSellerInvite({ data: { email: s.email } });
                          toast.success("Inbjudan skickad till " + s.email);
                        } catch (e: any) {
                          toast.error(e.message ?? "Kunde inte skicka inbjudan");
                        }
                      }}
                    >
                      <Mail className="size-3.5" />
                    </Button>
                    <Button variant="ghost" size="icon" onClick={() => { setEditing(s); setDialogOpen(true); }}>
                      <Pencil className="size-3.5" />
                    </Button>
                  </div>
                </TableCell>
              </TableRow>
            ))}
            {(data ?? []).length === 0 && (
              <TableRow>
                <TableCell colSpan={8} className="text-center text-muted-foreground py-6">
                  Inga säljare ännu
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      )}
      <SellerDialog open={dialogOpen} onOpenChange={setDialogOpen} seller={editing} onSaved={handleSaved} />
    </Card>
  );
}

function SellerDialog({ open, onOpenChange, seller, onSaved }: {
  open: boolean;
  onOpenChange: (b: boolean) => void;
  seller: any;
  onSaved: () => void;
}) {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [title, setTitle] = useState("");
  const [type, setType] = useState<"endast_provision" | "med_grundlon">("med_grundlon");
  const [base, setBase] = useState("0");
  const [pct, setPct] = useState("0");
  const [saving, setSaving] = useState(false);
  const [showTempPassword, setShowTempPassword] = useState<string | null>(null);

  useMemo(() => {
    if (open) {
      setName(seller?.full_name ?? "");
      setEmail(seller?.email ?? "");
      setPhone(seller?.phone ?? "");
      setTitle(seller?.title ?? "");
      setType((seller?.compensation_type as any) ?? "med_grundlon");
      setBase(String(seller?.base_salary ?? 0));
      setPct(String(seller?.default_commission_pct ?? 0));
      setShowTempPassword(null);
    }
  }, [open, seller]);

  const [sendInvite, setSendInvite] = useState(true);

  useMemo(() => {
    if (open) {
      setSendInvite(true);
    }
  }, [open]);

  const save = async () => {
    if (!name || !email) {
      toast.error("Namn och e-post krävs");
      return;
    }
    setSaving(true);
    try {
      if (seller) {
        await updateSeller({ data: {
          user_id: seller.id,
          full_name: name,
          email,
          phone,
          title,
          compensation_type: type,
          base_salary: type === "endast_provision" ? 0 : Number(base),
          default_commission_pct: Number(pct),
        }});
        toast.success("Säljare uppdaterad");
        onSaved();
      } else {
        const result = await createSeller({ data: {
          full_name: name,
          email,
          phone,
          title,
          compensation_type: type,
          base_salary: type === "endast_provision" ? 0 : Number(base),
          default_commission_pct: Number(pct),
          send_invite: sendInvite,
        }});
        if (result.invited) {
          toast.success("Säljare skapad — inbjudan skickad till " + email);
          onSaved();
        } else {
          toast.success("Säljare skapad");
          setShowTempPassword(result.tempPassword);
          onSaved();
        }
      }
    } catch (e: any) {
      toast.error(e.message ?? "Något gick fel");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{seller ? "Redigera säljare" : "Ny säljare"}</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <div>
            <label className="text-xs font-medium">Namn</label>
            <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Anna Svensson" />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs font-medium">E-post</label>
              <Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="anna@exempel.se" />
            </div>
            <div>
              <label className="text-xs font-medium">Telefon</label>
              <Input value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="070-123 45 67" />
            </div>
          </div>
          <div>
            <label className="text-xs font-medium">Titel</label>
            <Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Account Manager" />
          </div>
          <div>
            <label className="text-xs font-medium">Provisionskategori</label>
            <div className="grid grid-cols-2 gap-2 mt-1">
              <button
                type="button"
                onClick={() => setType("med_grundlon")}
                className={`text-left p-3 rounded-md border text-xs ${type === "med_grundlon" ? "border-primary bg-primary/10" : "border-border"}`}
              >
                <div className="font-semibold">Med grundlön</div>
                <div className="text-muted-foreground mt-1">Fast lön + lägre provision</div>
              </button>
              <button
                type="button"
                onClick={() => setType("endast_provision")}
                className={`text-left p-3 rounded-md border text-xs ${type === "endast_provision" ? "border-primary bg-primary/10" : "border-border"}`}
              >
                <div className="font-semibold">Endast provision</div>
                <div className="text-muted-foreground mt-1">Ingen fast lön, högre provision</div>
              </button>
            </div>
          </div>
          {type === "med_grundlon" && (
            <div>
              <label className="text-xs font-medium">Grundlön (kr/mån)</label>
              <Input type="number" min={0} value={base} onChange={(e) => setBase(e.target.value)} />
            </div>
          )}
          <div>
            <label className="text-xs font-medium">Standard provision %</label>
            <Input type="number" step="0.1" min={0} value={pct} onChange={(e) => setPct(e.target.value)} />
            <p className="text-[10px] text-muted-foreground mt-1">Används endast om affären saknar produkt.</p>
          </div>
          {showTempPassword && (
            <div className="rounded-md border border-warning/40 bg-warning/10 p-3 text-xs">
              <div className="font-semibold text-warning">Tillfälligt lösenord</div>
              <div className="mt-1 font-mono">{showTempPassword}</div>
              <p className="text-muted-foreground mt-1">Säljaren kan logga in med detta och byta lösenord via "Glömt lösenord".</p>
            </div>
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>Avbryt</Button>
          <Button onClick={save} disabled={saving || !name || !email}>
            {saving ? <Loader2 className="size-4 animate-spin mr-1" /> : null}
            {seller ? "Spara" : "Skapa säljare"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
