import { notFound } from "next/navigation";
import { auth } from "@/core/auth/auth";
import { getPurchaseOrderById } from "@/modules/purchasing/purchase-order.service";
import { Breadcrumb } from "@/components/ui/Breadcrumb";
import { GoodsReceiptForm } from "./GoodsReceiptForm";

export default async function ReceiveGoodsPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const session = await auth();

  const order = await getPurchaseOrderById(session!.user.companyId, id).catch(() => null);
  if (!order) notFound();

  if (order.status !== "SENT_TO_SUPPLIER" && order.status !== "PARTIALLY_RECEIVED") {
    // Matches the service's own guard.
    notFound();
  }

  const lines = order.items
    .map((item) => ({
      purchaseOrderItemId: item.id,
      productId: item.productId,
      styleName: item.product.styleName,
      styleCode: item.product.styleCode,
      materialCategory: item.product.materialCategory,
      colorName: item.color?.name ?? null,
      shadeName: item.dye ? (item.dye.pantone ? `${item.dye.name} (${item.dye.pantone})` : item.dye.name) : null,
      uomCode: item.uom.code,
      orderedQuantity: item.orderedQuantity.toString(),
      receivedQuantity: item.receivedQuantity.toString(),
      remainingQuantity: (Number(item.orderedQuantity) - Number(item.receivedQuantity)).toString(),
    }))
    .filter((line) => Number(line.remainingQuantity) > 0);

  return (
    <div className="space-y-4">
      <Breadcrumb
        items={[
          { label: "Dashboard", href: "/dashboard" },
          { label: "Purchase Orders", href: "/purchase-orders" },
          { label: order.orderNumber, href: `/purchase-orders/${id}` },
          { label: "Receive Goods" },
        ]}
      />
      <h1 className="text-lg font-semibold text-zinc-900 dark:text-zinc-50">Record Goods Receipt — {order.orderNumber}</h1>
      <GoodsReceiptForm purchaseOrderId={id} lines={lines} />
    </div>
  );
}
