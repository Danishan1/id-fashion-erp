import { notFound } from "next/navigation";
import { auth } from "@/core/auth/auth";
import { getLotById } from "@/modules/production/lot.service";
import { getProductionRecordScope } from "@/modules/production/production-scope";
import { Breadcrumb } from "@/components/ui/Breadcrumb";
import { LotWorkflowPanel } from "../../../LotWorkflowPanel";

export default async function LotDetailPage({ params }: { params: Promise<{ id: string; lotId: string }> }) {
  const { id, lotId } = await params;
  const session = await auth();

  const lot = await getLotById(session!.user.companyId, lotId, session!.user.id).catch(() => null);
  if (!lot || lot.productionOrder.id !== id) notFound();
  // P1: a worker (no production.view_all) gets a read-only view of their own cards.
  const recordScope = await getProductionRecordScope(session!.user.id);

  return (
    <div className="space-y-6">
      <Breadcrumb
        items={[
          { label: "Dashboard", href: "/dashboard" },
          { label: "Production Orders", href: "/production-orders" },
          { label: lot.productionOrder.orderNumber, href: `/production-orders/${id}` },
          { label: lot.lotNumber },
        ]}
      />
      <h1 className="text-lg font-semibold text-zinc-900 dark:text-zinc-50">
        {lot.lotNumber} <span className="text-sm font-normal text-zinc-500">— {lot.productionOrder.product.styleName}</span>
      </h1>

      <LotWorkflowPanel
        key={lotId}
        lotId={lotId}
        productionOrderId={id}
        initialLot={JSON.parse(JSON.stringify(lot))}
        assignedOnly={recordScope.mode === "ASSIGNED"}
      />
    </div>
  );
}
