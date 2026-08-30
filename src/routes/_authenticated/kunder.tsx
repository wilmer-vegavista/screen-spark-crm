import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState, useEffect, useMemo } from "react";
import { supabase } from "@/integrations/supabase/client";
import { PageHeader } from "@/components/page-header";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem, SelectGroup, SelectLabel } from "@/components/ui/select";
import { Plus, Search, Building2, Trash2, X, ArrowUpDown } from "lucide-react";
import { CustomerDetailDialog } from "@/components/customer-detail-dialog";
import { toast } from "sonner";

export const Route = createFileRoute("/_authenticated/kunder")({
  validateSearch: (s: Record<string, unknown>) => ({
    customer: typeof s.customer === "string" ? s.customer : undefined,
  }),
  component: Kunder,
});

function fmt(n: number) {
  return new Intl.NumberFormat("sv-SE", { style: "currency", currency: "SEK", maximumFractionDigits: 0 }).format(n || 0);
}

type SortKey = "total" | "orders" | "name" | "newest";

function Kunder() {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const { customer: customerParam } = Route.useSearch();
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const [screenFilter, setScreenFilter] = useState("all");
  const [sort, setSort] = useState<SortKey>("total");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [selectMode, setSelectMode] = useState(false);

  const { data } = useQuery({
    queryKey: ["customers"],
    queryFn: async () => {
      const { data } = await supabase.from("customers").select("*").order("company_name");
      return data ?? [];
    },
  });

  const { data: orders } = useQuery({
    queryKey: ["customers-orders-agg"],
    queryFn: async () => {
      const { data } = await supabase
        .from("orders")
        .select("customer_id, order_type, total_excl_vat, order_items(product_name, unit_price, weeks)");
      return data ?? [];
    },
  });

  const { data: products } = useQuery({
    queryKey: ["products-screens"],
    queryFn: async () => {
      const { data } = await supabase.from("products").select("name, city").order("name");
      return data ?? [];
    },
  });

  // Old links use /kunder?customer=<id> — send them to the new detail page
  useEffect(() => {
    if (!customerParam) return;
    navigate({ to: "/kunder/$customerId", params: { customerId: customerParam }, replace: true });
  }, [customerParam, navigate]);

  const productCity = useMemo(() => {
    const m = new Map<string, string>();
    (products ?? []).forEach((p: any) => { if (p.city) m.set(p.name, p.city); });
    return m;
  }, [products]);

  const agg = useMemo(() => {
    const m = new Map<string, { total: number; quoteTotal: number; orders: number; quotes: number; screens: Set<string> }>();
    (orders ?? []).forEach((o: any) => {
      if (!o.customer_id) return;
      const cur = m.get(o.customer_id) ?? { total: 0, quoteTotal: 0, orders: 0, quotes: 0, screens: new Set<string>() };
      if (o.order_type === "bokning") {
        cur.total += Number(o.total_excl_vat || 0);
        cur.orders += 1;
      } else {
        cur.quoteTotal += Number(o.total_excl_vat || 0);
        cur.quotes += 1;
      }
      (o.order_items ?? []).forEach((it: any) => cur.screens.add(it.product_name));
      m.set(o.customer_id, cur);
    });
    return m;
  }, [orders]);

  const cities = useMemo(() => {
    const s = new Set<string>();
    (products ?? []).forEach((p: any) => { if (p.city) s.add(p.city); });
    return [...s].sort((a, b) => a.localeCompare(b, "sv"));
  }, [products]);

  const screenNames = useMemo(() => {
    const s = new Set<string>((products ?? []).map((p: any) => p.name));
    // Include screens that only exist on order rows (e.g. removed products)
    (orders ?? []).forEach((o: any) => (o.order_items ?? []).forEach((it: any) => s.add(it.product_name)));
    return [...s].sort((a, b) => a.localeCompare(b, "sv"));
  }, [products, orders]);

  const matchesScreenFilter = (c: any) => {
    if (screenFilter === "all") return true;
    const bought = agg.get(c.id)?.screens;
    if (!bought || bought.size === 0) return false;
    if (screenFilter.startsWith("city:")) {
      const city = screenFilter.slice(5).toLowerCase();
      return [...bought].some(name =>
        (productCity.get(name)?.toLowerCase() === city) || name.toLowerCase().includes(city)
      );
    }
    return bought.has(screenFilter.slice(7));
  };

  const filtered = useMemo(() => {
    const list = (data ?? []).filter(c =>
      (!q || c.company_name.toLowerCase().includes(q.toLowerCase()) || (c.contact_name?.toLowerCase().includes(q.toLowerCase())))
      && matchesScreenFilter(c)
    );
    const a = (id: string) => agg.get(id);
    return list.sort((x, y) => {
      if (sort === "total") return (a(y.id)?.total ?? 0) - (a(x.id)?.total ?? 0);
      if (sort === "orders") return (a(y.id)?.orders ?? 0) - (a(x.id)?.orders ?? 0);
      if (sort === "newest") return new Date(y.created_at).getTime() - new Date(x.created_at).getTime();
      return x.company_name.localeCompare(y.company_name, "sv");
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data, q, screenFilter, sort, agg, productCity]);

  const toggleOne = (id: string) => {
    const next = new Set(selected);
    next.has(id) ? next.delete(id) : next.add(id);
    setSelected(next);
  };

  const toggleAll = () => {
    if (selected.size === filtered.length) setSelected(new Set());
    else setSelected(new Set(filtered.map(c => c.id)));
  };

  const bulkDelete = async () => {
    if (!selected.size) return;
    if (!confirm(`Ta bort ${selected.size} kund(er)? Detta kan inte ångras.`)) return;
    const { error } = await supabase.from("customers").delete().in("id", [...selected]);
    if (error) return toast.error(error.message);
    toast.success(`${selected.size} kund(er) borttagna`);
    setSelected(new Set());
    setSelectMode(false);
    qc.invalidateQueries({ queryKey: ["customers"] });
  };

  const grandTotal = filtered.reduce((s, c) => s + (agg.get(c.id)?.total ?? 0), 0);

  return (
    <>
      <PageHeader
        title="Kunder"
        description="Alla bolag i CRM:t"
        actions={
          <div className="flex items-center gap-2">
            {selectMode ? (
              <>
                <span className="text-sm text-muted-foreground">{selected.size} valda</span>
                <Button size="sm" variant="destructive" onClick={bulkDelete} disabled={!selected.size}>
                  <Trash2 className="size-4 mr-1" /> Ta bort
                </Button>
                <Button size="sm" variant="ghost" onClick={() => { setSelectMode(false); setSelected(new Set()); }}>
                  <X className="size-4 mr-1" /> Avbryt
                </Button>
              </>
            ) : (
              <>
                <Button size="sm" variant="outline" onClick={() => setSelectMode(true)}>Markera flera</Button>
                <Button onClick={() => setOpen(true)}><Plus className="size-4 mr-1" /> Ny kund</Button>
              </>
            )}
          </div>
        }
      />
      <div className="p-6 space-y-4">
        <div className="flex items-center gap-3 flex-wrap">
          <div className="relative max-w-sm flex-1 min-w-52">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 size-4 text-muted-foreground" />
            <Input placeholder="Sök kund eller kontakt..." value={q} onChange={e => setQ(e.target.value)} className="pl-8" />
          </div>
          <Select value={screenFilter} onValueChange={setScreenFilter}>
            <SelectTrigger className="w-56">
              <SelectValue placeholder="Alla skärmar" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Alla skärmar / orter</SelectItem>
              {cities.length > 0 && (
                <SelectGroup>
                  <SelectLabel>Ort</SelectLabel>
                  {cities.map(c => <SelectItem key={c} value={`city:${c}`}>{c}</SelectItem>)}
                </SelectGroup>
              )}
              <SelectGroup>
                <SelectLabel>Skärm</SelectLabel>
                {screenNames.map(n => <SelectItem key={n} value={`screen:${n}`}>{n}</SelectItem>)}
              </SelectGroup>
            </SelectContent>
          </Select>
          <Select value={sort} onValueChange={(v) => setSort(v as SortKey)}>
            <SelectTrigger className="w-44">
              <ArrowUpDown className="size-3.5 mr-1 text-muted-foreground" />
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="total">Köpt mest</SelectItem>
              <SelectItem value="orders">Flest ordrar</SelectItem>
              <SelectItem value="name">Namn A–Ö</SelectItem>
              <SelectItem value="newest">Senast tillagd</SelectItem>
            </SelectContent>
          </Select>
          {selectMode && (
            <Button size="sm" variant="ghost" onClick={toggleAll}>
              {selected.size === filtered.length ? "Avmarkera alla" : "Markera alla"}
            </Button>
          )}
        </div>

        <div className="text-sm text-muted-foreground">
          {filtered.length} kunder • Totalt köpt: <span className="font-medium text-foreground">{fmt(grandTotal)}</span>
          {screenFilter !== "all" && (
            <Button size="sm" variant="ghost" className="ml-2 h-6 px-2 text-xs" onClick={() => setScreenFilter("all")}>
              <X className="size-3 mr-1" /> Rensa filter
            </Button>
          )}
        </div>

        <div className="border rounded-md overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-muted/50">
              <tr className="text-left">
                {selectMode && <th className="p-2 w-8" />}
                <th className="p-2">Kund</th>
                <th className="p-2 hidden md:table-cell">Skärmar</th>
                <th className="p-2 text-right hidden sm:table-cell">Ordrar</th>
                <th className="p-2 text-right hidden sm:table-cell">Offerter</th>
                <th className="p-2 text-right">Totalt köpt</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map(c => {
                const a = agg.get(c.id);
                const screens = a ? [...a.screens] : [];
                const isSelected = selected.has(c.id);
                return (
                  <tr
                    key={c.id}
                    className={`border-t cursor-pointer hover:bg-accent/40 transition-colors ${isSelected ? "bg-primary/5" : ""}`}
                    onClick={() => {
                      if (selectMode) toggleOne(c.id);
                      else navigate({ to: "/kunder/$customerId", params: { customerId: c.id } });
                    }}
                  >
                    {selectMode && (
                      <td className="p-2">
                        <Checkbox
                          checked={isSelected}
                          onCheckedChange={() => toggleOne(c.id)}
                          onClick={(e) => e.stopPropagation()}
                        />
                      </td>
                    )}
                    <td className="p-2">
                      <div className="flex items-center gap-2.5 min-w-0">
                        <div className="size-8 rounded-md bg-accent flex items-center justify-center shrink-0">
                          <Building2 className="size-4" />
                        </div>
                        <div className="min-w-0">
                          <div className="font-medium truncate">{c.company_name}</div>
                          <div className="text-xs text-muted-foreground truncate">
                            {[c.contact_name, c.city].filter(Boolean).join(" • ") || "—"}
                          </div>
                        </div>
                      </div>
                    </td>
                    <td className="p-2 hidden md:table-cell">
                      <div className="flex items-center gap-1 flex-wrap">
                        {screens.slice(0, 2).map(s => <Badge key={s} variant="outline" className="text-xs font-normal">{s}</Badge>)}
                        {screens.length > 2 && <span className="text-xs text-muted-foreground">+{screens.length - 2}</span>}
                        {screens.length === 0 && <span className="text-xs text-muted-foreground">—</span>}
                      </div>
                    </td>
                    <td className="p-2 text-right hidden sm:table-cell">{a?.orders ?? 0}</td>
                    <td className="p-2 text-right hidden sm:table-cell">{a?.quotes ?? 0}</td>
                    <td className="p-2 text-right font-medium">{fmt(a?.total ?? 0)}</td>
                  </tr>
                );
              })}
              {filtered.length === 0 && (
                <tr><td colSpan={selectMode ? 6 : 5} className="p-8 text-center text-sm text-muted-foreground">Inga kunder matchar</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
      <CustomerDetailDialog open={open} onOpenChange={setOpen} customer={null} />
    </>
  );
}
