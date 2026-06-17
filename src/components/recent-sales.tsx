import { useEffect, useState, useCallback } from "react";
import { Trophy, PartyPopper, Building2, User2 } from "lucide-react";
import confetti from "canvas-confetti";
import { supabase } from "@/integrations/supabase/client";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";

type RecentOrder = {
  id: string;
  company_name: string;
  total_excl_vat: number;
  owner_id: string | null;
  order_type: string;
  created_at: string;
  seller_name: string | null;
};

const formatSEK = (n: number) =>
  new Intl.NumberFormat("sv-SE", { style: "currency", currency: "SEK", maximumFractionDigits: 0 }).format(n || 0);

async function fetchRecentSales(): Promise<RecentOrder[]> {
  const { data: orders, error } = await supabase
    .from("orders")
    .select("id, company_name, total_excl_vat, owner_id, order_type, created_at")
    .neq("order_type", "offert")
    .order("created_at", { ascending: false })
    .limit(25);
  if (error) throw error;
  const ownerIds = Array.from(new Set((orders ?? []).map(o => o.owner_id).filter(Boolean) as string[]));
  let nameMap = new Map<string, string>();
  if (ownerIds.length) {
    const { data: profs } = await supabase.from("profiles").select("id, full_name, email").in("id", ownerIds);
    nameMap = new Map((profs ?? []).map(p => [p.id, (p.full_name && p.full_name.trim()) || p.email || ""]));
  }
  return (orders ?? []).map(o => ({ ...o, seller_name: o.owner_id ? nameMap.get(o.owner_id) ?? null : null }));
}

function fireConfetti() {
  const end = Date.now() + 1200;
  const colors = ["#FFD700", "#FF6B6B", "#4ECDC4", "#A78BFA", "#34D399"];
  (function frame() {
    confetti({ particleCount: 4, angle: 60, spread: 70, origin: { x: 0, y: 0.7 }, colors });
    confetti({ particleCount: 4, angle: 120, spread: 70, origin: { x: 1, y: 0.7 }, colors });
    if (Date.now() < end) requestAnimationFrame(frame);
  })();
}

function playCelebrationSound() {
  try {
    const ctx = new AudioContext();
    const now = ctx.currentTime;
    const notes = [523.25, 659.25, 783.99, 1046.5]; // C5 E5 G5 C6
    notes.forEach((freq, i) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = "sine";
      osc.frequency.value = freq;
      osc.connect(gain);
      gain.connect(ctx.destination);
      const t = now + i * 0.1;
      gain.gain.setValueAtTime(0.15, t);
      gain.gain.exponentialRampToValueAtTime(0.001, t + 0.6);
      osc.start(t);
      osc.stop(t + 0.7);
    });
    setTimeout(() => ctx.close(), 1200);
  } catch {
    // ignore audio errors
  }
}

export function RecentSalesPanel() {
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [banner, setBanner] = useState<RecentOrder | null>(null);

  const { data: sales = [] } = useQuery({
    queryKey: ["recent-sales"],
    queryFn: fetchRecentSales,
    staleTime: 30_000,
  });

  const handleNewOrder = useCallback(async (orderId: string) => {
    const { data: o } = await supabase
      .from("orders")
      .select("id, company_name, total_excl_vat, owner_id, order_type, created_at")
      .eq("id", orderId)
      .maybeSingle();
    if (!o || o.order_type === "offert") return;
    let seller_name: string | null = null;
    if (o.owner_id) {
      const { data: p } = await supabase.from("profiles").select("full_name").eq("id", o.owner_id).maybeSingle();
      seller_name = p?.full_name ?? null;
    }
    const item: RecentOrder = { ...o, seller_name };
    setBanner(item);
    fireConfetti();
    playCelebrationSound();
    queryClient.invalidateQueries({ queryKey: ["recent-sales"] });
    setTimeout(() => setBanner(b => (b?.id === item.id ? null : b)), 7000);
  }, [queryClient]);

  useEffect(() => {
    const channel = supabase
      .channel("orders-new-sales")
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "orders" },
        (payload) => {
          const row = payload.new as { id: string; order_type: string };
          if (row.order_type !== "offert") void handleNewOrder(row.id);
        }
      )
      .on(
        "postgres_changes",
        { event: "UPDATE", schema: "public", table: "orders" },
        (payload) => {
          const oldRow = payload.old as { order_type?: string };
          const newRow = payload.new as { id: string; order_type: string };
          if (oldRow.order_type === "offert" && newRow.order_type !== "offert") {
            void handleNewOrder(newRow.id);
          }
        }
      )
      .subscribe();
    return () => {
      void supabase.removeChannel(channel);
    };
  }, [handleNewOrder]);

  return (
    <>
      <Sheet open={open} onOpenChange={setOpen}>
        <SheetTrigger asChild>
          <Button variant="outline" size="sm" className="gap-2">
            <Trophy className="size-4 text-primary" />
            Senaste sälj
          </Button>
        </SheetTrigger>
        <SheetContent className="w-full sm:max-w-md">
          <SheetHeader>
            <SheetTitle className="flex items-center gap-2">
              <Trophy className="size-5 text-primary" /> Senaste sälj
            </SheetTitle>
          </SheetHeader>
          <ScrollArea className="h-[calc(100vh-6rem)] mt-4 pr-3">
            <div className="space-y-2">
              {sales.length === 0 && (
                <div className="text-sm text-muted-foreground p-4 text-center">Inga sälj än.</div>
              )}
              {sales.map((s) => (
                <div key={s.id} className="rounded-lg border p-3 hover:bg-accent/40 transition-colors">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="flex items-center gap-1.5 text-sm font-semibold truncate">
                        <Building2 className="size-3.5 text-muted-foreground shrink-0" />
                        {s.company_name}
                      </div>
                      <div className="flex items-center gap-1.5 text-xs text-muted-foreground mt-1 truncate">
                        <User2 className="size-3 shrink-0" />
                        {s.seller_name || "Okänd säljare"}
                      </div>
                      <div className="text-[10px] text-muted-foreground/80 mt-1">
                        {new Date(s.created_at).toLocaleString("sv-SE", { dateStyle: "short", timeStyle: "short" })}
                      </div>
                    </div>
                    <div className="text-right shrink-0">
                      <div className="text-sm font-bold text-primary">{formatSEK(Number(s.total_excl_vat))}</div>
                      <Badge variant="secondary" className="mt-1 text-[10px]">{s.order_type}</Badge>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </ScrollArea>
        </SheetContent>
      </Sheet>

      {banner && (
        <div className="fixed top-4 left-1/2 -translate-x-1/2 z-[100] animate-fade-in">
          <div
            className="flex items-center gap-3 px-5 py-3 rounded-xl shadow-2xl border border-primary/40 backdrop-blur-md"
            style={{ background: "var(--gradient-primary)", color: "var(--primary-foreground)" }}
          >
            <PartyPopper className="size-6 animate-bounce" />
            <div className="min-w-0">
              <div className="text-xs uppercase tracking-wider opacity-90 font-semibold">Nytt sälj! 🎉</div>
              <div className="text-sm font-bold truncate">
                {banner.seller_name || "Okänd"} stängde {banner.company_name}
              </div>
              <div className="text-xs opacity-95">{formatSEK(Number(banner.total_excl_vat))}</div>
            </div>
            <button
              onClick={() => setBanner(null)}
              className="ml-2 text-xs opacity-80 hover:opacity-100 underline"
            >
              Stäng
            </button>
          </div>
        </div>
      )}
    </>
  );
}
