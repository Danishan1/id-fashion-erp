import { notFound } from "next/navigation";
import Link from "next/link";
import { auth } from "@/core/auth/auth";
import { PermissionService } from "@/core/rbac/PermissionService";
import { getFinishedGoodsReceiptById } from "@/modules/finished-goods-inventory/finished-goods-receipt-list.service";
import { Breadcrumb } from "@/components/ui/Breadcrumb";
import { Barcode } from "@/components/ui/Barcode";
import { formatDateTime } from "@/lib/date-format";

export default async function FinishedGoodsReceiptDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const session = await auth();
  await PermissionService.assert(session!.user.id, "fg_inventory", "view").catch(() => notFound());

  const receipt = await getFinishedGoodsReceiptById(session!.user.companyId, id).catch(() => null);
  if (!receipt) notFound();

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <Breadcrumb
            items={[
              { label: "Dashboard", href: "/dashboard" },
              { label: "Finished Goods Inventory", href: "/finished-goods-inventory" },
              { label: "Receipts", href: "/finished-goods-inventory/receipts" },
              { label: receipt.receiptNumber },
            ]}
          />
          <h1 className="mt-2 text-lg font-semibold text-zinc-900 dark:text-zinc-50">{receipt.receiptNumber}</h1>
          <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">
            {receipt.product.styleCode} — {receipt.product.styleName} · Posted by {receipt.postedBy.fullName} on{" "}
            {formatDateTime(receipt.postedAt)}
          </p>
        </div>
        <Barcode value={receipt.receiptNumber} />
      </div>

      <dl className="grid grid-cols-2 gap-4 rounded-lg border border-zinc-200 p-4 text-sm dark:border-zinc-800 sm:grid-cols-3">
        <div>
          <dt className="text-xs font-medium uppercase text-zinc-500">Style</dt>
          <dd className="mt-0.5 text-zinc-900 dark:text-zinc-50">
            {receipt.product.styleCode} — {receipt.product.styleName}
          </dd>
        </div>
        <div>
          <dt className="text-xs font-medium uppercase text-zinc-500">Warehouse</dt>
          <dd className="mt-0.5 text-zinc-900 dark:text-zinc-50">{receipt.warehouse.name}</dd>
        </div>
        <div>
          <dt className="text-xs font-medium uppercase text-zinc-500">Total Quantity</dt>
          <dd className="mt-0.5 text-zinc-900 dark:text-zinc-50">{Number(receipt.totalQuantity).toLocaleString()}</dd>
        </div>
        <div>
          <dt className="text-xs font-medium uppercase text-zinc-500">Lot</dt>
          <dd className="mt-0.5">
            <Link
              href={`/production-orders/${receipt.productionOrder.id}/lots/${receipt.lot.id}`}
              className="text-indigo-600 hover:underline dark:text-indigo-400"
            >
              {receipt.lot.lotNumber}
            </Link>
          </dd>
        </div>
        <div>
          <dt className="text-xs font-medium uppercase text-zinc-500">Production Order</dt>
          <dd className="mt-0.5">
            <Link href={`/production-orders/${receipt.productionOrder.id}`} className="text-indigo-600 hover:underline dark:text-indigo-400">
              {receipt.productionOrder.orderNumber}
            </Link>
          </dd>
        </div>
        <div>
          <dt className="text-xs font-medium uppercase text-zinc-500">Posted By</dt>
          <dd className="mt-0.5 text-zinc-900 dark:text-zinc-50">{receipt.postedBy.fullName}</dd>
        </div>
      </dl>

      <div>
        <h2 className="mb-2 text-sm font-semibold text-zinc-900 dark:text-zinc-50">Colour / Size Breakdown</h2>
        <div className="overflow-x-auto rounded-lg border border-zinc-200 dark:border-zinc-800">
          <table className="min-w-full divide-y divide-zinc-200 text-sm dark:divide-zinc-800">
            <thead className="bg-zinc-50 dark:bg-zinc-900">
              <tr>
                <th className="px-4 py-2 text-left font-medium text-zinc-500">Colour</th>
                <th className="px-4 py-2 text-left font-medium text-zinc-500">Size</th>
                <th className="px-4 py-2 text-left font-medium text-zinc-500">Quantity</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-100 dark:divide-zinc-800">
              {receipt.items.map((item) => (
                <tr key={item.id}>
                  <td className="px-4 py-2 text-zinc-900 dark:text-zinc-50">{item.productVariant.color.name}</td>
                  <td className="px-4 py-2 text-zinc-900 dark:text-zinc-50">{item.productVariant.size.name}</td>
                  <td className="px-4 py-2 text-zinc-900 dark:text-zinc-50">{Number(item.quantity).toLocaleString()}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
