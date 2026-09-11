import { notFound } from "next/navigation";
import { auth } from "@/core/auth/auth";
import { getSalesOrderById } from "@/modules/sales-orders/sales-order.service";
import { Breadcrumb } from "@/components/ui/Breadcrumb";
import { SalesOrderForm } from "../../SalesOrderForm";

export default async function EditSalesOrderPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const session = await auth();

  const order = await getSalesOrderById(session!.user.companyId, id).catch(() => null);
  if (!order) notFound();

  if (order.status !== "DRAFT" && order.status !== "CONFIRMED") {
    // Matches the service's own guard — nothing else can be edited here.
    notFound();
  }

  const initialOrder = {
    id: order.id,
    status: order.status,
    customerId: order.customerId,
    buyerId: order.buyerId,
    orderDate: order.orderDate.toISOString(),
    requiredShipDate: order.requiredShipDate ? order.requiredShipDate.toISOString() : null,
    customerPoNumber: order.customerPoNumber,
    items: order.items.map((item) => ({
      productId: item.productId,
      sampleRequestId: item.sampleRequestId,
      unitPrice: item.unitPrice.toString(),
      notes: item.notes,
      breakdown: item.breakdown.map((b) => ({
        productVariantId: b.productVariantId,
        orderedQuantity: b.orderedQuantity,
      })),
    })),
  };

  return (
    <div className="space-y-4">
      <Breadcrumb
        items={[
          { label: "Dashboard", href: "/dashboard" },
          { label: "Sales Orders", href: "/sales-orders" },
          { label: order.orderNumber, href: `/sales-orders/${id}` },
          { label: "Edit" },
        ]}
      />
      <h1 className="text-lg font-semibold text-zinc-900 dark:text-zinc-50">Edit {order.orderNumber}</h1>
      {/* key={id} forces a remount on client-side navigation between two
          different orders' edit pages — same stale-data fix applied
          project-wide after the Sampling bug. */}
      <SalesOrderForm key={id} initialOrder={initialOrder} />
    </div>
  );
}
