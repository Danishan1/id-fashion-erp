import { notFound } from "next/navigation";
import { auth } from "@/core/auth/auth";
import { getProductionOrderById } from "@/modules/production/production-order.service";
import { Breadcrumb } from "@/components/ui/Breadcrumb";
import { Barcode } from "@/components/ui/Barcode";
import { ProductionOrderWorkflowPanel } from "../ProductionOrderWorkflowPanel";

export default async function ProductionOrderDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const session = await auth();

  const order = await getProductionOrderById({ companyId: session!.user.companyId, userId: session!.user.id }, id).catch(() => null);
  if (!order) notFound();

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <Breadcrumb
            items={[
              { label: "Dashboard", href: "/dashboard" },
              { label: "Production Orders", href: "/production-orders" },
              { label: order.orderNumber },
            ]}
          />
          <h1 className="mt-2 text-lg font-semibold text-zinc-900 dark:text-zinc-50">{order.orderNumber}</h1>
          <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">
            {order.product.styleName} ({order.product.styleCode}) · Requested by {order.requestedBy.fullName}
          </p>
        </div>
        <Barcode value={order.orderNumber} />
      </div>

      {/* Decimal/Date fields round-trip through JSON before crossing to the
          Client Component. key={id} forces a remount on client-side
          navigation between two different orders. */}
      <ProductionOrderWorkflowPanel key={id} productionOrderId={id} initialOrder={JSON.parse(JSON.stringify(order))} />
    </div>
  );
}
