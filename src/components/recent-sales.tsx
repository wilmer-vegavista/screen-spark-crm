import { useEffect, useState, useCallback } from "react";
import { Trophy, PartyPopper, Building2, User2 } from "lucide-react";
import confetti from "canvas-confetti";
import { useNavigate } from "@tanstack/react-router";
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

const CELEBRATION_MS = 5000;

function fireConfetti() {
  const end = Date.now() + CELEBRATION_MS;
  const colors = ["#FFD700", "#FF6B6B", "#4ECDC4", "#A78BFA", "#34D399"];
  (function frame() {
    confetti({ particleCount: 6, angle: 60, spread: 100, startVelocity: 65, scalar: 1.6, ticks: 220, zIndex: 110, origin: { x: 0, y: 0.8 }, colors });
    confetti({ particleCount: 6, angle: 120, spread: 100, startVelocity: 65, scalar: 1.6, ticks: 220, zIndex: 110, origin: { x: 1, y: 0.8 }, colors });
    confetti({ particleCount: 4, spread: 140, startVelocity: 45, scalar: 1.6, ticks: 220, zIndex: 110, origin: { x: Math.random(), y: Math.random() * 0.4 }, colors });
    if (Date.now() < end) requestAnimationFrame(frame);
  })();
}

function fireMoneyRain() {
  const scalar = 3.2;
  const shapes = [
    confetti.shapeFromText({ text: "💵", scalar }),
    confetti.shapeFromText({ text: "💰", scalar }),
  ];
  const end = Date.now() + CELEBRATION_MS;
  (function frame() {
    confetti({
      particleCount: 3,
      angle: 270,
      spread: 60,
      startVelocity: 12,
      gravity: 0.9,
      drift: Math.random() * 2 - 1,
      ticks: 350,
      zIndex: 110,
      scalar,
      shapes,
      origin: { x: Math.random(), y: -0.1 },
    });
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
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [banner, setBanner] = useState<RecentOrder | null>(null);

  const goToOrder = (orderId: string) => {
    setOpen(false);
    navigate({ to: "/order", search: { order: orderId, product: undefined } });
  };

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
      const { data: p } = await supabase.from("profiles").select("full_name, email").eq("id", o.owner_id).maybeSingle();
      seller_name = (p?.full_name && p.full_name.trim()) || p?.email || null;
    }
    const item: RecentOrder = { ...o, seller_name };
    setBanner(item);
    fireConfetti();
    fireMoneyRain();
    playCelebrationSound();
    queryClient.invalidateQueries({ queryKey: ["recent-sales"] });
    setTimeout(() => setBanner(b => (b?.id === item.id ? null : b)), CELEBRATION_MS);
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
                <button
                  key={s.id}
                  type="button"
                  onClick={() => goToOrder(s.id)}
                  className="w-full text-left rounded-lg border p-3 hover:bg-accent/40 hover:border-primary/50 transition-colors cursor-pointer"
                >
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
                </button>
              ))}
            </div>
          </ScrollArea>
        </SheetContent>
      </Sheet>

      {banner && (
        <div
          className="fixed inset-0 z-[100] flex items-center justify-center animate-fade-in cursor-pointer"
          onClick={() => setBanner(null)}
        >
          <div className="absolute inset-0 bg-black/40 backdrop-blur-[2px]" />
          <div className="relative text-center px-6 select-none">
            <div className="flex items-center justify-center gap-4">
              <PartyPopper className="size-12 md:size-16 text-yellow-400 animate-bounce" />
              <div
                className="text-5xl md:text-8xl font-black uppercase tracking-tight text-white"
                style={{ textShadow: "0 4px 30px rgba(0,0,0,0.6), 0 0 60px rgba(255,215,0,0.5)" }}
              >
                Done deal! 🎉
              </div>
              <PartyPopper className="size-12 md:size-16 text-yellow-400 animate-bounce" />
            </div>
            <div
              className="mt-6 text-2xl md:text-4xl font-bold text-white"
              style={{ textShadow: "0 2px 20px rgba(0,0,0,0.6)" }}
            >
              {banner.seller_name || "Okänd"} stängde {banner.company_name}
            </div>
            <div
              className="mt-3 text-4xl md:text-6xl font-black text-yellow-400"
              style={{ textShadow: "0 2px 20px rgba(0,0,0,0.7)" }}
            >
              {formatSEK(Number(banner.total_excl_vat))}
            </div>
          </div>
        </div>
      )}
    </>
  );
}
