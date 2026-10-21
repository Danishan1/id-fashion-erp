import { notFound } from "next/navigation";
import { auth } from "@/core/auth/auth";
import { getStockMovementById } from "@/modules/inventory/stock-movement.service";
import { Breadcrumb } from "@/components/ui/Breadcrumb";
import { Barcode } from "@/components/ui/Barcode";
import { formatDateTime } from "@/lib/date-format";
import { formatNumber } from "@/lib/currency";
import { PermissionService } from "@/core/rbac/PermissionService";
import { MovementStatusBadge } from "../StockMovementsListClient";
import { ReceiveTransferPanel } from "./ReceiveTransferPanel";

const MOVEMENT_TYPE_LABELS: Record<string, string> = {
  TRANSFER: "Transfer",
  ADJUSTMENT: "Adjustment",
  RETURN_TO_SUPPLIER: "Return to Supplier",
};

export default async function StockMovementDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const session = await auth();

  const movement = await getStockMovementById({ companyId: session!.user.companyId, userId: session!.user.id }, id).catch(() => null);
  if (!movement) notFound();
  const canReceive = await PermissionService.can(session!.user.id, "inventory", "create");
  const isTransfer = movement.movementType === "TRANSFER";

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <Breadcrumb
            items={[
              { label: "Dashboard", href: "/dashboard" },
              { label: "Stock Movements", href: "/inventory/stock-movements" },
              { label: movement.movementNumber },
            ]}
          />
          <h1 className="mt-2 text-lg font-semibold text-zinc-900 dark:text-zinc-50">{movement.movementNumber}</h1>
          <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">
            {MOVEMENT_TYPE_LABELS[movement.movementType] ?? movement.movementType} · Performed by {movement.performedBy.fullName} on{" "}
            {formatDateTime(movement.performedAt)}
          </p>
        </div>
        <Barcode value={movement.movementNumber} />
      </div>

      <dl className="grid grid-cols-2 gap-4 rounded-lg border border-zinc-200 p-4 text-sm dark:border-zinc-800 sm:grid-cols-3">
        <div>
          <dt className="text-xs font-medium uppercase text-zinc-500">Status</dt>
          <dd className="mt-0.5">
            <MovementStatusBadge status={movement.status} />
          </dd>
        </div>
        {movement.status === "RECEIVED" && (
          <div>
            <dt className="text-xs font-medium uppercase text-zinc-500">Received</dt>
            <dd className="mt-0.5 text-zinc-900 dark:text-zinc-50">
              {movement.receivedBy?.fullName ?? "—"}
              {movement.receivedAt ? ` on ${formatDateTime(movement.receivedAt)}` : ""}
            </dd>
          </div>
        )}
        <div>
          <dt className="text-xs font-medium uppercase text-zinc-500">{movement.movementType === "TRANSFER" ? "From Warehouse" : "Warehouse"}</dt>
          <dd className="mt-0.5 text-zinc-900 dark:text-zinc-50">{movement.warehouse.name}</dd>
        </div>
        {movement.movementType === "TRANSFER" && (
          <div>
            <dt className="text-xs font-medium uppercase text-zinc-500">To Warehouse</dt>
            <dd className="mt-0.5 text-zinc-900 dark:text-zinc-50">{movement.toWarehouse?.name ?? "—"}</dd>
          </div>
        )}
        {movement.movementType === "RETURN_TO_SUPPLIER" && (
          <div>
            <dt className="text-xs font-medium uppercase text-zinc-500">Supplier</dt>
            <dd className="mt-0.5 text-zinc-900 dark:text-zinc-50">{movement.supplier?.name ?? "—"}</dd>
          </div>
        )}
        {movement.reason && (
          <div>
            <dt className="text-xs font-medium uppercase text-zinc-500">Reason</dt>
            <dd className="mt-0.5 text-zinc-900 dark:text-zinc-50">{movement.reason}</dd>
          </div>
        )}
        {movement.remarks && (
          <div className="col-span-full">
            <dt className="text-xs font-medium uppercase text-zinc-500">Remarks</dt>
            <dd className="mt-0.5 text-zinc-900 dark:text-zinc-50">{movement.remarks}</dd>
          </div>
        )}
      </dl>

      {isTransfer && movement.status === "IN_TRANSIT" && movement.toWarehouseId && (
        <ReceiveTransferPanel
          movementId={movement.id}
          toWarehouseId={movement.toWarehouseId}
          toWarehouseName={movement.toWarehouse?.name ?? "the destination warehouse"}
          canReceive={canReceive}
          lines={movement.items.map((item) => ({
            id: item.id,
            materialName: `${item.product.styleName} (${item.product.styleCode})${item.color ? ` — ${item.color.name}` : ""}`,
            quantity: Number(item.quantity),
            uomCode: item.uom.code,
            materialCategory: item.product.materialCategory,
          }))}
        />
      )}

      <div>
        <h2 className="mb-2 text-sm font-semibold text-zinc-900 dark:text-zinc-50">Line Items</h2>
        <div className="overflow-x-auto rounded-lg border border-zinc-200 dark:border-zinc-800">
          <table className="min-w-full divide-y divide-zinc-200 text-sm dark:divide-zinc-800">
            <thead className="bg-zinc-50 dark:bg-zinc-900">
              <tr>
                <th className="px-4 py-2 text-left font-medium text-zinc-500">Material</th>
                <th className="px-4 py-2 text-left font-medium text-zinc-500">Quantity</th>
                <th className="px-4 py-2 text-left font-medium text-zinc-500">Unit</th>
                <th className="px-4 py-2 text-left font-medium text-zinc-500">Colour</th>
                <th className="px-4 py-2 text-left font-medium text-zinc-500">{isTransfer ? "From Location" : "Location"}</th>
                {isTransfer && <th className="px-4 py-2 text-left font-medium text-zinc-500">Put Away At</th>}
                <th className="px-4 py-2 text-left font-medium text-zinc-500">Remarks</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-100 dark:divide-zinc-800">
              {movement.items.map((item) => (
                <tr key={item.id}>
                  <td className="px-4 py-2 text-zinc-900 dark:text-zinc-50">
                    {item.product.styleName} ({item.product.styleCode})
                  </td>
                  <td className={`px-4 py-2 ${Number(item.quantity) < 0 ? "text-red-600 dark:text-red-400" : "text-zinc-900 dark:text-zinc-50"}`}>
                    {Number(item.quantity) > 0 ? "+" : ""}
                    {formatNumber(Number(item.quantity))}
                  </td>
                  <td className="px-4 py-2 text-zinc-500">{item.uom.code}</td>
                  <td className="px-4 py-2 text-zinc-500">{item.color?.name ?? "No colour"}</td>
                  <td className="px-4 py-2 text-zinc-500">{item.warehouseLocation?.code ?? "—"}</td>
                  {isTransfer && (
                    <td className="px-4 py-2 text-zinc-500">
                      {item.toWarehouseLocation?.code ?? (movement.status === "IN_TRANSIT" ? "In transit" : "—")}
                    </td>
                  )}
                  <td className="px-4 py-2 text-zinc-500">{item.remarks ?? "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
