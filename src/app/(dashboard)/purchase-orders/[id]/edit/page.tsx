import { notFound } from "next/navigation";
import { auth } from "@/core/auth/auth";
import { getPurchaseOrderById } from "@/modules/purchasing/purchase-order.service";
import { Breadcrumb } from "@/components/ui/Breadcrumb";
import { PurchaseOrderForm } from "../../PurchaseOrderForm";

export default async function EditPurchaseOrderPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const session = await auth();

  const order = await getPurchaseOrderById({ companyId: session!.user.companyId, userId: session!.user.id }, id).catch(() => null);
  if (!order) notFound();

  if (order.status !== "DRAFT" && order.status !== "APPROVED") {
    // Matches the service's own guard — nothing else can be edited here.
    notFound();
  }

  const initialOrder = {
    id: order.id,
    status: order.status,
    supplierId: order.supplierId,
    orderDate: order.orderDate.toISOString(),
    expectedDeliveryDate: order.expectedDeliveryDate ? order.expectedDeliveryDate.toISOString() : null,
    items: order.items.map((item) => ({
      productId: item.productId,
      uomId: item.uomId,
      orderedQuantity: item.orderedQuantity.toString(),
      unitPrice: item.unitPrice.toString(),
      notes: item.notes,
      colorId: item.colorId,
      dyeId: item.dyeId,
    })),
  };

  return (
    <div className="space-y-4">
      <Breadcrumb
        items={[
          { label: "Dashboard", href: "/dashboard" },
          { label: "Purchase Orders", href: "/purchase-orders" },
          { label: order.orderNumber, href: `/purchase-orders/${id}` },
          { label: "Edit" },
        ]}
      />
      <h1 className="text-lg font-semibold text-zinc-900 dark:text-zinc-50">Edit {order.orderNumber}</h1>
      <PurchaseOrderForm key={id} initialOrder={initialOrder} />
    </div>
  );
}
