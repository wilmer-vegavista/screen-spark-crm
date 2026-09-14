import { useQuery } from "@tanstack/react-query";
import { fetchOrderInvoiceStates, orderStateLine, plannedLine } from "@/lib/fortnox/ledger";

/**
 * One additive line under an order: "Fortnox: 8 av 12 fakturerade · 7 betalda · 1 förfallen
 * (förfaller 2026-10-15)", counted from the Fortnox invoices matched to the order
 * (fortnox.v_order_invoice_state). Renders nothing when the order has no matched invoice
 * — so their pages look exactly as before for every other order — and nothing for a
 * non-admin, whose read of the view returns no rows. The CRM's planned figure sits in the
 * tooltip (hover), so the two never argue on screen.
 *
 * Erik's component (round one); their files import it with one line and render it with one.
 */
export function OrderInvoiceState({ orderId, className }: { orderId: string; className?: string }) {
  const { data } = useQuery({
    queryKey: ["fortnox-order-invoice-state"],
    queryFn: fetchOrderInvoiceStates,
    staleTime: 60_000,
    retry: false,
  });
  const state = data?.find((s) => s.order_id === orderId);
  if (!state) return null;
  const tone = state.invoices_overdue > 0 ? "text-destructive" : "text-muted-foreground";
  return (
    <div className={`text-xs ${tone} ${className ?? ""}`.trim()} title={plannedLine(state)}>
      {orderStateLine(state)}
    </div>
  );
}
