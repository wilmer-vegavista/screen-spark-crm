import { createFileRoute } from "@tanstack/react-router";
import { PageHeader } from "@/components/page-header";
import { Card } from "@/components/ui/card";

export const Route = createFileRoute("/_authenticated/order")({
  component: Order,
});

function Order() {
  return (
    <>
      <PageHeader title="Order" description="Hantera ordrar" />
      <div className="p-6">
        <Card className="p-8 text-center text-sm text-muted-foreground">
          Inga ordrar ännu
        </Card>
      </div>
    </>
  );
}
