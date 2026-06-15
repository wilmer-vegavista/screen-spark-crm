import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Input } from "@/components/ui/input";
import { Search, Users, ShoppingCart, Monitor, FileText, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";

type Hit =
  | { kind: "customer"; id: string; title: string; subtitle?: string }
  | { kind: "order"; id: string; title: string; subtitle?: string }
  | { kind: "product"; id: string; title: string; subtitle?: string };

export function GlobalSearch() {
  const navigate = useNavigate();
  const [q, setQ] = useState("");
  const [debounced, setDebounced] = useState("");
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const wrapRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const t = setTimeout(() => setDebounced(q.trim()), 200);
    return () => clearTimeout(t);
  }, [q]);

  useEffect(() => {
    const onClick = (e: MouseEvent) => {
      if (!wrapRef.current?.contains(e.target as Node)) setOpen(false);
    };
    window.addEventListener("mousedown", onClick);
    return () => window.removeEventListener("mousedown", onClick);
  }, []);

  const { data, isFetching } = useQuery({
    queryKey: ["global-search", debounced],
    enabled: debounced.length >= 2,
    queryFn: async (): Promise<Hit[]> => {
      const term = debounced;
      const like = `%${term}%`;
      const [customers, orders, products, items] = await Promise.all([
        supabase
          .from("customers")
          .select("id, company_name, contact_name, contact_email, org_number")
          .or(
            `company_name.ilike.${like},contact_name.ilike.${like},contact_email.ilike.${like},org_number.ilike.${like}`
          )
          .limit(8),
        supabase
          .from("orders")
          .select("id, company_name, contact_name, order_type, total_excl_vat")
          .or(`company_name.ilike.${like},contact_name.ilike.${like}`)
          .limit(8),
        supabase
          .from("products")
          .select("id, name, city, address, screen_type")
          .or(`name.ilike.${like},city.ilike.${like},address.ilike.${like}`)
          .limit(8),
        supabase
          .from("order_items")
          .select("order_id, product_name, orders!inner(id, company_name, order_type)")
          .ilike("product_name", like)
          .limit(6),
      ]);

      const hits: Hit[] = [];
      (customers.data ?? []).forEach((c: any) =>
        hits.push({
          kind: "customer",
          id: c.id,
          title: c.company_name,
          subtitle: [c.contact_name, c.contact_email].filter(Boolean).join(" · "),
        })
      );
      (orders.data ?? []).forEach((o: any) =>
        hits.push({
          kind: "order",
          id: o.id,
          title: o.company_name,
          subtitle: `${o.order_type === "offert" ? "Offert" : "Bokning"}${o.contact_name ? " · " + o.contact_name : ""}`,
        })
      );
      (products.data ?? []).forEach((p: any) =>
        hits.push({
          kind: "product",
          id: p.id,
          title: p.name,
          subtitle: [p.location, p.category].filter(Boolean).join(" · "),
        })
      );
      (items.data ?? []).forEach((it: any) => {
        const o = it.orders;
        if (!o) return;
        hits.push({
          kind: "order",
          id: o.id,
          title: o.company_name,
          subtitle: `Rad: ${it.product_name}`,
        });
      });
      // dedupe order hits by id
      const seen = new Set<string>();
      return hits.filter((h) => {
        const k = `${h.kind}:${h.id}:${h.subtitle ?? ""}`;
        if (seen.has(k)) return false;
        seen.add(k);
        return true;
      });
    },
  });

  const results = useMemo(() => data ?? [], [data]);

  const go = (h: Hit) => {
    setOpen(false);
    setQ("");
    if (h.kind === "customer") {
      navigate({ to: "/kunder", search: { customer: h.id } as any });
    } else if (h.kind === "order") {
      navigate({ to: "/order", search: { order: h.id } as any });
    } else {
      navigate({ to: "/order", search: { product: h.id } as any });
    }
  };

  const onKey = (e: React.KeyboardEvent) => {
    if (!open) return;
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActive((a) => Math.min(a + 1, results.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActive((a) => Math.max(a - 1, 0));
    } else if (e.key === "Enter" && results[active]) {
      e.preventDefault();
      go(results[active]);
    } else if (e.key === "Escape") {
      setOpen(false);
    }
  };

  const iconFor = (k: Hit["kind"]) =>
    k === "customer" ? Users : k === "order" ? ShoppingCart : Monitor;

  return (
    <div ref={wrapRef} className="relative w-full max-w-lg">
      <div className="relative">
        <Search className="size-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
        <Input
          value={q}
          placeholder="Sök kund, order eller skärm…"
          className="pl-9 h-9"
          onFocus={() => setOpen(true)}
          onChange={(e) => {
            setQ(e.target.value);
            setOpen(true);
            setActive(0);
          }}
          onKeyDown={onKey}
        />
        {isFetching && debounced.length >= 2 && (
          <Loader2 className="size-4 absolute right-3 top-1/2 -translate-y-1/2 animate-spin text-muted-foreground" />
        )}
      </div>
      {open && debounced.length >= 2 && (
        <div className="absolute left-0 right-0 top-full mt-1 rounded-md border border-border bg-popover shadow-lg z-50 max-h-[60vh] overflow-y-auto">
          {results.length === 0 && !isFetching && (
            <div className="px-3 py-4 text-sm text-muted-foreground text-center">
              Inga träffar
            </div>
          )}
          {results.map((h, i) => {
            const Icon = iconFor(h.kind);
            return (
              <button
                key={`${h.kind}-${h.id}-${i}`}
                type="button"
                onMouseEnter={() => setActive(i)}
                onClick={() => go(h)}
                className={cn(
                  "w-full text-left px-3 py-2 flex items-center gap-3 border-b border-border/40 last:border-0",
                  i === active ? "bg-accent" : "hover:bg-accent/50"
                )}
              >
                <div className="size-7 rounded-md bg-accent flex items-center justify-center shrink-0">
                  <Icon className="size-4" />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-medium truncate">{h.title}</div>
                  {h.subtitle && (
                    <div className="text-xs text-muted-foreground truncate">{h.subtitle}</div>
                  )}
                </div>
                <span className="text-[10px] uppercase tracking-wider text-muted-foreground">
                  {h.kind === "customer" ? "Kund" : h.kind === "order" ? "Order" : "Skärm"}
                </span>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
