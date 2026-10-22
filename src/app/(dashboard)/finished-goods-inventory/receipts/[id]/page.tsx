import { notFound } from "next/navigation";
import Link from "next/link";
import { auth } from "@/core/auth/auth";
import { PermissionService } from "@/core/rbac/PermissionService";
import { getFinishedGoodsReceiptById } from "@/modules/finished-goods-inventory/finished-goods-receipt-list.service";
import { Breadcrumb } from "@/components/ui/Breadcrumb";
import { Barcode } from "@/components/ui/Barcode";
import { formatDateTime } from "@/lib/date-format";

const STATUS_LABEL = { PENDING: "Waiting to receive", PARTIALLY_RECEIVED: "Partly received", RECEIVED: "Received" } as const;
const STATUS_CLASS = {
  PENDING: "bg-amber-100 text-amber-800 dark:bg-amber-950/50 dark:text-amber-300",
  PARTIALLY_RECEIVED: "bg-sky-100 text-sky-800 dark:bg-sky-950/50 dark:text-sky-300",
  RECEIVED: "bg-emerald-100 text-emerald-800 dark:bg-emerald-950/50 dark:text-emerald-300",
} as const;

export default async function FinishedGoodsReceiptDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const session = await auth();
  await PermissionService.assert(session!.user.id, "fg_inventory", "view").catch(() => notFound());

  const receipt = await getFinishedGoodsReceiptById(session!.user.companyId, id).catch(() => null);
  if (!receipt) notFound();

  const isReturn = receipt.source === "CUSTOMER_RETURN";
  const variantName = (v: { color: { name: string }; size: { name: string } } | null) => (v ? `${v.color.name} / ${v.size.name}` : "—");
  const pending = receipt.items.reduce((sum, i) => sum + Number(i.quantity) - Number(i.receivedQuantity), 0);

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
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <h1 className="text-lg font-semibold text-zinc-900 dark:text-zinc-50">{receipt.receiptNumber}</h1>
            <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${STATUS_CLASS[receipt.status]}`}>{STATUS_LABEL[receipt.status]}</span>
          </div>
          <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">
            {receipt.product.styleCode} — {receipt.product.styleName} · {isReturn ? "Customer return" : "From packing"}
          </p>
          {pending > 0 && (
            <p className="mt-2 text-sm">
              {pending} pcs are not in stock yet —{" "}
              <Link href="/finished-goods-inventory/receive" className="font-medium text-indigo-600 hover:underline dark:text-indigo-400">
                receive them
              </Link>
              .
            </p>
          )}
        </div>
        <Barcode value={receipt.receiptNumber} />
      </div>

      <dl className="grid grid-cols-2 gap-4 rounded-lg border border-zinc-200 p-4 text-sm dark:border-zinc-800 sm:grid-cols-3">
        <div>
          <dt className="text-xs font-medium uppercase text-zinc-500">Warehouse</dt>
          <dd className="mt-0.5 text-zinc-900 dark:text-zinc-50">{receipt.warehouse.name}</dd>
        </div>
        <div>
          <dt className="text-xs font-medium uppercase text-zinc-500">Total Quantity</dt>
          <dd className="mt-0.5 text-zinc-900 dark:text-zinc-50">{Number(receipt.totalQuantity).toLocaleString()}</dd>
        </div>
        {isReturn ? (
          <>
            <div>
              <dt className="text-xs font-medium uppercase text-zinc-500">Dispatch</dt>
              <dd className="mt-0.5">
                {receipt.dispatch ? (
                  <Link href={`/dispatch/${receipt.dispatch.id}`} className="text-indigo-600 hover:underline dark:text-indigo-400">
                    {receipt.dispatch.dispatchNumber}
                  </Link>
                ) : (
                  "—"
                )}
              </dd>
            </div>
            <div>
              <dt className="text-xs font-medium uppercase text-zinc-500">Customer Return</dt>
              <dd className="mt-0.5 text-zinc-900 dark:text-zinc-50">{receipt.dispatchReturn?.returnNumber ?? "—"}</dd>
            </div>
          </>
        ) : (
          <>
            <div>
              <dt className="text-xs font-medium uppercase text-zinc-500">Lot</dt>
              <dd className="mt-0.5">
                {receipt.lot && receipt.productionOrder ? (
                  <Link href={`/production-orders/${receipt.productionOrder.id}/lots/${receipt.lot.id}`} className="text-indigo-600 hover:underline dark:text-indigo-400">
                    {receipt.lot.lotNumber}
                  </Link>
                ) : (
                  "—"
                )}
              </dd>
            </div>
            <div>
              <dt className="text-xs font-medium uppercase text-zinc-500">Production Order</dt>
              <dd className="mt-0.5">
                {receipt.productionOrder ? (
                  <Link href={`/production-orders/${receipt.productionOrder.id}`} className="text-indigo-600 hover:underline dark:text-indigo-400">
                    {receipt.productionOrder.orderNumber}
                  </Link>
                ) : (
                  "—"
                )}
              </dd>
            </div>
          </>
        )}
        <div>
          <dt className="text-xs font-medium uppercase text-zinc-500">Arrived</dt>
          <dd className="mt-0.5 text-zinc-900 dark:text-zinc-50">
            {formatDateTime(receipt.postedAt)} · {receipt.postedBy.fullName}
          </dd>
        </div>
        {receipt.remarks && (
          <div className="col-span-2 sm:col-span-3">
            <dt className="text-xs font-medium uppercase text-zinc-500">Remark</dt>
            <dd className="mt-0.5 text-zinc-900 dark:text-zinc-50">{receipt.remarks}</dd>
          </div>
        )}
      </dl>

      <div>
        <h2 className="mb-2 text-sm font-semibold text-zinc-900 dark:text-zinc-50">Colour / Size Breakdown</h2>
        <div className="overflow-x-auto rounded-lg border border-zinc-200 dark:border-zinc-800">
          <table className="min-w-full divide-y divide-zinc-200 text-sm dark:divide-zinc-800">
            <thead className="bg-zinc-50 dark:bg-zinc-900">
              <tr>
                <th className="px-4 py-2 text-left font-medium text-zinc-500">Colour / Size</th>
                <th className="px-4 py-2 text-right font-medium text-zinc-500">Quantity</th>
                <th className="px-4 py-2 text-right font-medium text-zinc-500">Received</th>
                <th className="px-4 py-2 text-right font-medium text-zinc-500">Waiting</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-100 dark:divide-zinc-800">
              {receipt.items.map((item) => (
                <tr key={item.id}>
                  <td className="px-4 py-2 text-zinc-900 dark:text-zinc-50">{variantName(item.productVariant)}</td>
                  <td className="px-4 py-2 text-right text-zinc-900 dark:text-zinc-50">{Number(item.quantity).toLocaleString()}</td>
                  <td className="px-4 py-2 text-right text-zinc-900 dark:text-zinc-50">{Number(item.receivedQuantity).toLocaleString()}</td>
                  <td className="px-4 py-2 text-right text-zinc-900 dark:text-zinc-50">
                    {(Number(item.quantity) - Number(item.receivedQuantity)).toLocaleString()}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <div>
        <h2 className="mb-2 text-sm font-semibold text-zinc-900 dark:text-zinc-50">History</h2>
        <ol className="space-y-2 border-l border-zinc-200 pl-4 text-sm dark:border-zinc-800">
          <li>
            <span className="font-medium text-zinc-900 dark:text-zinc-50">{isReturn ? "Returned by customer" : "Arrived from packing"}</span>
            <span className="text-zinc-500"> · {formatDateTime(receipt.postedAt)} · {receipt.postedBy.fullName}</span>
            <div className="text-xs text-zinc-500">{Number(receipt.totalQuantity).toLocaleString()} pcs waiting to be received</div>
          </li>
          {receipt.postings.map((posting) => (
            <li key={posting.id}>
              <span className="font-medium text-zinc-900 dark:text-zinc-50">
                Received {Number(posting.quantity).toLocaleString()} pcs into {posting.warehouseLocation?.code ?? "the warehouse (no location)"}
              </span>
              <span className="text-zinc-500"> · {formatDateTime(posting.createdAt)} · {posting.receivedBy.fullName}</span>
              <div className="text-xs text-zinc-500">
                {variantName(posting.receiptItem.productVariant)}
                {posting.remarks ? ` — ${posting.remarks}` : ""}
              </div>
            </li>
          ))}
          {receipt.status === "RECEIVED" && receipt.postings.length === 0 && (
            <li className="text-xs text-zinc-500">Posted straight to stock (before the receive step existed).</li>
          )}
        </ol>
      </div>
    </div>
  );
}
