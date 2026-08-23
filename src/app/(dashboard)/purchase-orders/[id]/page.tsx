import { notFound } from "next/navigation";
import { auth } from "@/core/auth/auth";
import { getPurchaseOrderById } from "@/modules/purchasing/purchase-order.service";
import { Breadcrumb } from "@/components/ui/Breadcrumb";
import { Barcode } from "@/components/ui/Barcode";
import { PurchaseOrderWorkflowPanel } from "../PurchaseOrderWorkflowPanel";

export default async function PurchaseOrderDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const session = await auth();

  const order = await getPurchaseOrderById(session!.user.companyId, id).catch(() => null);
  if (!order) notFound();

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <Breadcrumb
            items={[
              { label: "Dashboard", href: "/dashboard" },
              { label: "Purchase Orders", href: "/purchase-orders" },
              { label: order.orderNumber },
            ]}
          />
          <h1 className="mt-2 text-lg font-semibold text-zinc-900 dark:text-zinc-50">{order.orderNumber}</h1>
          <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">
            {order.supplier.name} · Requested by {order.requestedBy.fullName} on{" "}
            {new Date(order.orderDate).toLocaleDateString()}
            {order.expectedDeliveryDate
              ? ` · Expected delivery: ${new Date(order.expectedDeliveryDate).toLocaleDateString()}`
              : ""}
          </p>
        </div>
        <Barcode value={order.orderNumber} />
      </div>

      {/* Decimal/Date fields round-trip through JSON before crossing to the
          Client Component, same pattern as Sales Orders/Sampling. key={id}
          forces a remount on client-side navigation between two different
          orders. */}
      <PurchaseOrderWorkflowPanel key={id} purchaseOrderId={id} initialOrder={JSON.parse(JSON.stringify(order))} />
    </div>
  );
}
