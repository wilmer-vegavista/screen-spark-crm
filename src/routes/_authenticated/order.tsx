import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { PageHeader } from "@/components/page-header";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Plus, FileText, ShoppingCart, Trash2, X, Users, User } from "lucide-react";
import { useCurrentUser } from "@/lib/hooks/use-current-user";
import { OrderDialog } from "@/components/order-dialog";
import { deleteOrders } from "@/lib/orders.functions";
import { format } from "date-fns";
import { toast } from "sonner";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

export const Route = createFileRoute("/_authenticated/order")({
  validateSearch: (s: Record<string, unknown>) => ({
    order: typeof s.order === "string" ? s.order : undefined,
    product: typeof s.product === "string" ? s.product : undefined,
  }),
  component: OrderPage,
});

const SEK = (n: number) =>
  new Intl.NumberFormat("sv-SE", { style: "decimal", minimumFractionDigits: 0, maximumFractionDigits: 0 }).format(n || 0);

function OrderPage() {
  const navigate = useNavigate();
  const { order: orderParam, product: productParam } = Route.useSearch();
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<any | null>(null);
  const [selectMode, setSelectMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [sellerFilter, setSellerFilter] = useState<string>("all");
  const [productFilter, setProductFilter] = useState<string | null>(null);
  const queryClient = useQueryClient();

  const { data } = useQuery({
    queryKey: ["orders"],
    queryFn: async () => {
      const { data } = await supabase.from("orders").select(ORDER_SELECT).order("created_at", { ascending: false });
      return data ?? [];
    },
  });

  const { data: sellers } = useQuery({
    queryKey: ["all-profiles-min"],
    queryFn: async () => {
      const { data } = await supabase.from("profiles").select("id, full_name, email").order("full_name");
      return data ?? [];
    },
  });

  const { data: orderIdsForProduct } = useQuery({
    queryKey: ["orders-for-product", productFilter],
    enabled: !!productFilter,
    queryFn: async () => {
      const { data } = await supabase
        .from("order_items")
        .select("order_id")
        .eq("product_id", productFilter!);
      return new Set((data ?? []).map((r: any) => r.order_id));
    },
  });

  const { data: productInfo } = useQuery({
    queryKey: ["product-info", productFilter],
    enabled: !!productFilter,
    queryFn: async () => {
      const { data } = await supabase.from("products").select("name").eq("id", productFilter!).maybeSingle();
      return data;
    },
  });

  useEffect(() => {
    if (!orderParam || !data) return;
    const found = data.find((o: any) => o.id === orderParam);
    if (found) {
      setEditing(found);
      setOpen(true);
      navigate({ to: "/order", search: (prev: any) => ({ ...prev, order: undefined }) as any, replace: true });
    }
  }, [orderParam, data, navigate]);

  useEffect(() => {
    if (productParam) setProductFilter(productParam);
  }, [productParam]);

  const allOrders = data ?? [];
  let orders = sellerFilter === "all"
    ? allOrders
    : allOrders.filter((o: any) => o.owner_id === sellerFilter || o.created_by === sellerFilter);
  if (productFilter && orderIdsForProduct) {
    orders = orders.filter((o: any) => orderIdsForProduct.has(o.id));
  }

  const clearProductFilter = () => {
    setProductFilter(null);
    navigate({ to: "/order", search: (prev: any) => ({ ...prev, product: undefined }) as any, replace: true });
  };

  const toggleSelect = (id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const toggleSelectAll = () => {
    if (selectedIds.size === orders.length && orders.length > 0) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(orders.map((o: any) => o.id)));
    }
  };

  const exitSelectMode = () => {
    setSelectMode(false);
    setSelectedIds(new Set());
  };

  const handleDelete = async () => {
    try {
      await deleteOrders({ data: { ids: Array.from(selectedIds) } });
      queryClient.invalidateQueries({ queryKey: ["orders"] });
      toast.success(`${selectedIds.size} order${selectedIds.size === 1 ? "" : "r"} borttagna`);
      exitSelectMode();
    } catch (err: any) {
      toast.error("Kunde inte ta bort ordrar: " + (err?.message || "Okänt fel"));
    }
    setConfirmOpen(false);
  };

  const allSelected = orders.length > 0 && selectedIds.size === orders.length;

  return (
    <>
      <PageHeader
        title="Order"
        description="Skapa offerter och bokningar"
        actions={
          <div className="flex items-center gap-2">
            {selectMode ? (
              <>
                <Button variant="outline" size="sm" onClick={toggleSelectAll}>
                  {allSelected ? "Avmarkera alla" : "Markera alla"}
                </Button>
                {selectedIds.size > 0 && (
                  <Button variant="destructive" size="sm" onClick={() => setConfirmOpen(true)}>
                    <Trash2 className="size-4 mr-1" /> Ta bort {selectedIds.size} st
                  </Button>
                )}
                <Button variant="ghost" size="sm" onClick={exitSelectMode}>
                  <X className="size-4 mr-1" /> Avbryt
                </Button>
              </>
            ) : (
              <>
                <Button variant="outline" size="sm" onClick={() => setSelectMode(true)}>
                  Markera flera
                </Button>
                <Button onClick={() => { setEditing(null); setOpen(true); }}>
                  <Plus className="size-4 mr-1" /> Ny order
                </Button>
              </>
            )}
          </div>
        }
      />
      <div className="p-6 space-y-3">
        <Card className="p-3 flex items-center gap-2 flex-wrap">
          <Users className="size-4 text-muted-foreground" />
          <span className="text-xs text-muted-foreground">Säljare:</span>
          <Select value={sellerFilter} onValueChange={setSellerFilter}>
            <SelectTrigger className="w-64 h-8"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Alla säljare</SelectItem>
              {(sellers ?? []).map((s: any) => (
                <SelectItem key={s.id} value={s.id}>{s.full_name || s.email}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          {productFilter && (
            <Badge variant="secondary" className="gap-1">
              Skärm: {productInfo?.name ?? "…"}
              <button type="button" onClick={clearProductFilter} className="ml-1 hover:text-foreground">
                <X className="size-3" />
              </button>
            </Badge>
          )}
          <span className="text-xs text-muted-foreground ml-auto">{orders.length} order{orders.length === 1 ? "" : "r"}</span>
        </Card>
        {orders.length === 0 && (
          <Card className="p-8 text-center text-sm text-muted-foreground">Inga ordrar ännu</Card>
        )}
        {orders.map((o: any) => (
          <Card
            key={o.id}
            className={`p-4 transition-colors ${selectMode ? "" : "cursor-pointer hover:border-primary/50"}`}
            onClick={() => {
              if (!selectMode) {
                setEditing(o);
                setOpen(true);
              }
            }}
          >
            <div className="flex items-center gap-4">
              {selectMode && (
                <div onClick={(e) => e.stopPropagation()}>
                  <Checkbox
                    checked={selectedIds.has(o.id)}
                    onCheckedChange={() => toggleSelect(o.id)}
                  />
                </div>
              )}
              <div className="size-10 rounded-md bg-accent flex items-center justify-center shrink-0">
                {o.order_type === "offert" ? <FileText className="size-5" /> : <ShoppingCart className="size-5" />}
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <span className="font-medium truncate">{o.company_name}</span>
                  <Badge variant={o.order_type === "offert" ? "secondary" : "default"}>
                    {o.order_type === "offert" ? "Offert" : "Bokning"}
                  </Badge>
                </div>
                <div className="text-xs text-muted-foreground">
                  {o.contact_name || "—"} · {format(new Date(o.created_at), "yyyy-MM-dd")}
                </div>
              </div>
              <div className="text-right">
                <div className="text-sm font-semibold">{SEK(Number(o.total_excl_vat))} SEK</div>
                <div className="text-xs text-primary">Provision: {SEK(Number(o.total_commission))} SEK</div>
              </div>
            </div>
          </Card>
        ))}
        {orders.length > 0 && (
          <div className="flex justify-end pt-2">
            <div className="text-right">
              <div className="text-xs text-muted-foreground">Totalt ordervärde</div>
              <div className="text-lg font-bold">
                {SEK(orders.reduce((sum: number, o: any) => sum + Number(o.total_excl_vat || 0), 0))} SEK
              </div>
            </div>
          </div>
        )}
      </div>
      <OrderDialog open={open} onOpenChange={setOpen} order={editing} />

      <AlertDialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Ta bort {selectedIds.size} order{selectedIds.size === 1 ? "" : "r"}?</AlertDialogTitle>
            <AlertDialogDescription>
              Detta kan inte ångras. Ordern{selectedIds.size === 1 ? "" : "a"} och tillhörande orderrader tas bort permanent.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel onClick={() => setConfirmOpen(false)}>Avbryt</AlertDialogCancel>
            <AlertDialogAction onClick={handleDelete} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">
              Ta bort
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
