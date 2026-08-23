import { notFound } from "next/navigation";
import { auth } from "@/core/auth/auth";
import { getGoodsReceiptById } from "@/modules/purchasing/goods-receipt.service";
import { Breadcrumb } from "@/components/ui/Breadcrumb";
import { Barcode } from "@/components/ui/Barcode";
import { GoodsReceiptDetailPanel } from "../GoodsReceiptDetailPanel";

export default async function GoodsReceiptDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const session = await auth();

  const receipt = await getGoodsReceiptById(session!.user.companyId, id).catch(() => null);
  if (!receipt) notFound();

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <Breadcrumb
            items={[
              { label: "Dashboard", href: "/dashboard" },
              { label: "Goods Receipts", href: "/goods-receipts" },
              { label: receipt.receiptNumber },
            ]}
          />
          <h1 className="mt-2 text-lg font-semibold text-zinc-900 dark:text-zinc-50">{receipt.receiptNumber}</h1>
          <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">
            Against{" "}
            <a href={`/purchase-orders/${receipt.purchaseOrder.id}`} className="text-indigo-600 hover:underline dark:text-indigo-400">
              {receipt.purchaseOrder.orderNumber}
            </a>{" "}
            · Received by {receipt.receivedBy.fullName} on {new Date(receipt.receivedDate).toLocaleDateString()}
          </p>
        </div>
        <Barcode value={receipt.receiptNumber} />
      </div>

      <GoodsReceiptDetailPanel key={id} goodsReceiptId={id} initialReceipt={JSON.parse(JSON.stringify(receipt))} />
    </div>
  );
}
