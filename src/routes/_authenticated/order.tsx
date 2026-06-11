import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { PageHeader } from "@/components/page-header";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Plus, FileText, ShoppingCart } from "lucide-react";
import { OrderDialog } from "@/components/order-dialog";
import { format } from "date-fns";

export const Route = createFileRoute("/_authenticated/order")({
  component: OrderPage,
});

const SEK = (n: number) =>
  new Intl.NumberFormat("sv-SE", { style: "decimal", minimumFractionDigits: 0, maximumFractionDigits: 0 }).format(n || 0);

function OrderPage() {
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<any | null>(null);

  const { data } = useQuery({
    queryKey: ["orders"],
    queryFn: async () => {
      const { data } = await supabase.from("orders").select("*").order("created_at", { ascending: false });
      return data ?? [];
    },
  });

  return (
    <>
      <PageHeader
        title="Order"
        description="Skapa offerter och bokningar"
        actions={
          <Button onClick={() => { setEditing(null); setOpen(true); }}>
            <Plus className="size-4 mr-1" /> Ny order
          </Button>
        }
      />
      <div className="p-6 space-y-3">
        {(data ?? []).length === 0 && (
          <Card className="p-8 text-center text-sm text-muted-foreground">Inga ordrar ännu</Card>
        )}
        {(data ?? []).map((o: any) => (
          <Card key={o.id} className="p-4 cursor-pointer hover:border-primary/50 transition-colors" onClick={() => { setEditing(o); setOpen(true); }}>
            <div className="flex items-center gap-4">
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
      </div>
      <OrderDialog open={open} onOpenChange={setOpen} order={editing} />
    </>
  );
}
