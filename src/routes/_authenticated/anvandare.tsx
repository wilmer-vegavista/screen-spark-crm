import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useCurrentUser } from "@/lib/hooks/use-current-user";
import { PageHeader } from "@/components/page-header";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { toast } from "sonner";
import { Plus, Pencil, Loader2, Mail, Eye, EyeOff, Copy, KeyRound } from "lucide-react";
import { createSeller, updateSeller, resendSellerInvite, setSellerPassword, listSellersAdmin } from "@/lib/sellers.functions";

export const Route = createFileRoute("/_authenticated/anvandare")({
  component: SaljarePage,
});

const fmt = (n: number) =>
  new Intl.NumberFormat("sv-SE", { style: "currency", currency: "SEK", maximumFractionDigits: 0 }).format(n || 0);

function SaljarePage() {
  const { isAdmin } = useCurrentUser();

  if (!isAdmin) {
    return (
      <>
        <PageHeader title="Användare" description="Hantera användare och deras uppgifter" />
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
      <PageHeader title="Användare" description="Lägg till och hantera användare, provision och grundlön" />
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
    queryFn: () => listSellersAdmin(),
  });

  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<any>(null);
  const [pwSeller, setPwSeller] = useState<any>(null);

  const handleSaved = () => {
    setDialogOpen(false);
    setEditing(null);
    qc.invalidateQueries({ queryKey: ["sellers-admin"] });
  };

  return (
    <Card>
      <div className="p-4 border-b flex items-center justify-between">
        <div>
          <h3 className="text-sm font-semibold">Användare</h3>
          <p className="text-xs text-muted-foreground">Kontaktuppgifter, lön och inloggning. Lösenord visas endast för admin.</p>
        </div>
        <Button size="sm" onClick={() => { setEditing(null); setDialogOpen(true); }}>
          <Plus className="size-4 mr-1" /> Ny användare
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
              <TableHead>Roll</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Senast inloggad</TableHead>
              <TableHead>Initialt lösenord</TableHead>
              <TableHead>Typ</TableHead>
              <TableHead className="text-right">Grundlön</TableHead>
              <TableHead className="text-right">Prov %</TableHead>
              <TableHead className="w-32"></TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {(data ?? []).map((s: any) => (
              <TableRow key={s.id}>
                <TableCell className="font-medium">{s.full_name || "—"}</TableCell>
                <TableCell className="text-xs text-muted-foreground">{s.title || "Account Manager"}</TableCell>
                <TableCell className="text-xs">{s.email || "—"}</TableCell>
                <TableCell className="text-xs">{s.phone || "—"}</TableCell>
                <TableCell>
                  <span className={`text-[10px] font-semibold uppercase tracking-wider px-2 py-0.5 rounded ${s.role === "admin" ? "bg-primary/15 text-primary" : "bg-muted text-muted-foreground"}`}>
                    {s.role === "admin" ? "Admin" : "Säljare"}
                  </span>
                </TableCell>
                <TableCell>
                  {s.pending_invite ? (
                    <span className="text-[10px] font-semibold uppercase tracking-wider px-2 py-0.5 rounded bg-amber-500/15 text-amber-600 dark:text-amber-400">Inbjuden</span>
                  ) : s.has_password ? (
                    <span className="text-[10px] font-semibold uppercase tracking-wider px-2 py-0.5 rounded bg-emerald-500/15 text-emerald-600 dark:text-emerald-400">Aktiv</span>
                  ) : (
                    <span className="text-[10px] font-semibold uppercase tracking-wider px-2 py-0.5 rounded bg-muted text-muted-foreground">Inget lösenord</span>
                  )}
                </TableCell>
                <TableCell className="text-xs">{s.last_sign_in_at ? new Date(s.last_sign_in_at).toLocaleString("sv-SE") : <span className="text-muted-foreground italic">aldrig</span>}</TableCell>
                <TableCell><PasswordCell value={s.password} /></TableCell>
                <TableCell className="text-xs">
                  {s.compensation_type === "endast_provision" ? "Endast prov." : "Med grundlön"}
                </TableCell>
                <TableCell className="text-right">
                  {s.compensation_type === "endast_provision" ? "—" : fmt(s.base_salary)}
                </TableCell>
                <TableCell className="text-right">{s.default_commission_pct}%</TableCell>
                <TableCell className="text-right">
                  <div className="flex items-center justify-end gap-0.5">
                    <Button
                      variant="ghost"
                      size="icon"
                      title="Sätt nytt lösenord"
                      onClick={() => setPwSeller(s)}
                    >
                      <KeyRound className="size-3.5" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      title="Skicka ny inbjudan via e-post"
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
                    <Button variant="ghost" size="icon" title="Redigera" onClick={() => { setEditing(s); setDialogOpen(true); }}>
                      <Pencil className="size-3.5" />
                    </Button>
                  </div>
                </TableCell>
              </TableRow>
            ))}
            {(data ?? []).length === 0 && (
              <TableRow>
                <TableCell colSpan={13} className="text-center text-muted-foreground py-6">
                  Inga användare ännu
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      )}
      <SellerDialog open={dialogOpen} onOpenChange={setDialogOpen} seller={editing} onSaved={handleSaved} />
      <SetPasswordDialog
        seller={pwSeller}
        onOpenChange={(b) => { if (!b) setPwSeller(null); }}
        onSaved={() => { setPwSeller(null); qc.invalidateQueries({ queryKey: ["sellers-admin"] }); }}
      />
    </Card>
  );
}

function PasswordCell({ value }: { value: string | null }) {
  const [show, setShow] = useState(false);
  if (!value) return <span className="text-xs text-muted-foreground italic">inbjuden</span>;
  return (
    <div className="flex items-center gap-1">
      <span className="text-xs font-mono">{show ? value : "••••••••"}</span>
      <Button variant="ghost" size="icon" className="size-6" onClick={() => setShow((v) => !v)} title={show ? "Dölj" : "Visa"}>
        {show ? <EyeOff className="size-3" /> : <Eye className="size-3" />}
      </Button>
      <Button
        variant="ghost"
        size="icon"
        className="size-6"
        onClick={() => { navigator.clipboard.writeText(value); toast.success("Kopierat"); }}
        title="Kopiera"
      >
        <Copy className="size-3" />
      </Button>
    </div>
  );
}

function SetPasswordDialog({ seller, onOpenChange, onSaved }: {
  seller: any;
  onOpenChange: (b: boolean) => void;
  onSaved: () => void;
}) {
  const [pw, setPw] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (seller) setPw("");
  }, [seller]);

  const save = async () => {
    if (pw.length < 6) {
      toast.error("Lösenord måste vara minst 6 tecken");
      return;
    }
    setSaving(true);
    try {
      await setSellerPassword({ data: { user_id: seller.id, password: pw } });
      toast.success("Lösenord uppdaterat");
      onSaved();
    } catch (e: any) {
      toast.error(e.message ?? "Kunde inte uppdatera lösenord");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={!!seller} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Sätt nytt lösenord</DialogTitle>
        </DialogHeader>
        <div className="space-y-3 text-sm">
          <div className="text-xs text-muted-foreground">
            Användare: <span className="font-medium text-foreground">{seller?.full_name || seller?.email}</span>
          </div>
          <div>
            <label className="text-xs font-medium">Nytt lösenord</label>
            <Input type="text" value={pw} onChange={(e) => setPw(e.target.value)} placeholder="minst 6 tecken" />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>Avbryt</Button>
          <Button onClick={save} disabled={saving || pw.length < 6}>
            {saving ? <Loader2 className="size-4 animate-spin mr-1" /> : null}
            Spara
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
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
  const [role, setRole] = useState<"saljare" | "admin">("saljare");
  const [saving, setSaving] = useState(false);

  // Credential mode (endast vid skapande)
  const [credMode, setCredMode] = useState<"password" | "invite">("password");
  const [password, setPassword] = useState("");

  useEffect(() => {
    if (open) {
      setName(seller?.full_name ?? "");
      setEmail(seller?.email ?? "");
      setPhone(seller?.phone ?? "");
      setTitle(seller?.title ?? "");
      setType((seller?.compensation_type as any) ?? "med_grundlon");
      setBase(String(seller?.base_salary ?? 0));
      setPct(String(seller?.default_commission_pct ?? 0));
      setRole((seller?.role as any) ?? "saljare");
      setCredMode("password");
      setPassword(generateSuggestedPassword());
    }
  }, [open, seller]);

  const save = async () => {
    if (!name || !email) {
      toast.error("Namn och e-post krävs");
      return;
    }
    if (!seller && credMode === "password" && password.length < 6) {
      toast.error("Lösenord måste vara minst 6 tecken");
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
          role,
          compensation_type: type,
          base_salary: type === "endast_provision" ? 0 : Number(base),
          default_commission_pct: Number(pct),
        }});
        toast.success("Användare uppdaterad");
      } else {
        const result = await createSeller({ data: {
          full_name: name,
          email,
          phone,
          title,
          role,
          compensation_type: type,
          base_salary: type === "endast_provision" ? 0 : Number(base),
          default_commission_pct: Number(pct),
          credential_mode: credMode,
          password: credMode === "password" ? password : undefined,
        }});
        if (result.invited) {
          toast.success("Användare skapad — inbjudan skickad till " + email);
        } else {
          toast.success("Användare skapad med lösenord");
        }
      }
      onSaved();
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
          <DialogTitle>{seller ? "Redigera användare" : "Ny användare"}</DialogTitle>
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
            <label className="text-xs font-medium">Roll</label>
            <div className="grid grid-cols-2 gap-2 mt-1">
              <button
                type="button"
                onClick={() => setRole("saljare")}
                className={`text-left p-3 rounded-md border text-xs ${role === "saljare" ? "border-primary bg-primary/10" : "border-border"}`}
              >
                <div className="font-semibold">Säljare</div>
                <div className="text-muted-foreground mt-1">Skapar kunder, ordrar och offerter</div>
              </button>
              <button
                type="button"
                onClick={() => setRole("admin")}
                className={`text-left p-3 rounded-md border text-xs ${role === "admin" ? "border-primary bg-primary/10" : "border-border"}`}
              >
                <div className="font-semibold">Admin</div>
                <div className="text-muted-foreground mt-1">Full tillgång till systemet, inkl. användare och faktura</div>
              </button>
            </div>
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

          {!seller && (
            <div className="space-y-2 rounded-md border p-3">
              <div className="text-xs font-semibold">Inloggning</div>
              <div className="grid grid-cols-2 gap-2">
                <button
                  type="button"
                  onClick={() => setCredMode("password")}
                  className={`text-left p-2 rounded-md border text-xs ${credMode === "password" ? "border-primary bg-primary/10" : "border-border"}`}
                >
                  <div className="font-semibold">Sätt lösenord</div>
                  <div className="text-muted-foreground mt-1">Du väljer lösenordet. Syns på adminsidan.</div>
                </button>
                <button
                  type="button"
                  onClick={() => setCredMode("invite")}
                  className={`text-left p-2 rounded-md border text-xs ${credMode === "invite" ? "border-primary bg-primary/10" : "border-border"}`}
                >
                  <div className="font-semibold">Skicka inbjudan</div>
                  <div className="text-muted-foreground mt-1">Säljaren sätter eget lösenord via mail.</div>
                </button>
              </div>
              {credMode === "password" && (
                <div>
                  <label className="text-xs font-medium">Lösenord</label>
                  <div className="flex gap-2">
                    <Input
                      type="text"
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      placeholder="minst 6 tecken"
                      className="font-mono"
                    />
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={() => setPassword(generateSuggestedPassword())}
                    >
                      Förslag
                    </Button>
                  </div>
                  <p className="text-[10px] text-muted-foreground mt-1">
                    ⚠️ Lösenordet sparas i klartext så det syns på adminsidan. Be säljaren byta lösenord vid första inloggning.
                  </p>
                </div>
              )}
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

function generateSuggestedPassword() {
  const uuid = crypto.randomUUID();
  return `${uuid.slice(0, 8)}A1!`;
}
