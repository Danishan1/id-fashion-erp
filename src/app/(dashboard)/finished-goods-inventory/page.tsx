import { notFound } from "next/navigation";
import { auth } from "@/core/auth/auth";
import { PermissionService } from "@/core/rbac/PermissionService";
import { getFinishedGoodsDashboard } from "@/modules/finished-goods-inventory/finished-goods-dashboard.service";
import { Breadcrumb } from "@/components/ui/Breadcrumb";

function StatTiles({ tiles }: { tiles: { label: string; value: number }[] }) {
  return (
    <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
      {tiles.map((tile) => (
        <div key={tile.label} className="rounded-lg border border-zinc-200 bg-white p-4 shadow-sm dark:border-zinc-800 dark:bg-zinc-900">
          <p className="text-2xl font-semibold text-zinc-900 dark:text-zinc-50">{tile.value}</p>
          <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">{tile.label}</p>
        </div>
      ))}
    </div>
  );
}

export default async function FinishedGoodsInventoryDashboardPage() {
  const session = await auth();
  await PermissionService.assert(session!.user.id, "fg_inventory", "view").catch(() => notFound());

  const dashboard = await getFinishedGoodsDashboard(session!.user.companyId);

  return (
    <div className="space-y-6">
      <div>
        <Breadcrumb items={[{ label: "Dashboard", href: "/dashboard" }, { label: "Finished Goods Inventory" }]} />
        <h1 className="mt-2 text-lg font-semibold text-zinc-900 dark:text-zinc-50">Finished Goods Inventory</h1>
        <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">
          Variant and location-aware Finished Goods stock, reserved/available tracking, and warehouse putaway —
          alongside, never instead of, the existing Raw Material Inventory.
        </p>
      </div>

      <StatTiles
        tiles={[
          { label: "Total Saleable Stock", value: dashboard.totalSaleableQuantity },
          { label: "Total Rejected Stock", value: dashboard.totalRejectedQuantity },
          { label: "Styles Tracked", value: dashboard.distinctStyleCount },
          { label: "Finished Goods Warehouses", value: dashboard.finishedGoodsWarehouseCount },
        ]}
      />

      {dashboard.unallocatedLegacyStock.length > 0 && (
        <div className="rounded-lg border border-amber-300 bg-amber-50 p-4 dark:border-amber-500/40 dark:bg-amber-500/10">
          <h2 className="text-sm font-semibold text-amber-900 dark:text-amber-300">Unallocated Legacy Stock</h2>
          <p className="mt-1 text-xs text-amber-800 dark:text-amber-400">
            This stock existed before colour/size tracking began for these styles — it is real, physical stock,
            but this system does not yet know which variant it belongs to. Run a reconciliation count to
            allocate it out into real variant rows.
          </p>
          <div className="mt-3 overflow-x-auto rounded-md border border-amber-200 dark:border-amber-500/30">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-amber-200 text-left text-xs uppercase tracking-wide text-amber-700 dark:border-amber-500/30 dark:text-amber-400">
                  <th className="px-3 py-2 font-medium">Style</th>
                  <th className="px-3 py-2 font-medium">Warehouse</th>
                  <th className="px-3 py-2 font-medium">Unallocated Qty</th>
                </tr>
              </thead>
              <tbody>
                {dashboard.unallocatedLegacyStock.map((row) => (
                  <tr key={`${row.productId}-${row.warehouseId}`} className="border-b border-amber-100 last:border-0 dark:border-amber-500/20">
                    <td className="px-3 py-2 text-zinc-900 dark:text-zinc-50">
                      {row.styleCode} — {row.styleName}
                    </td>
                    <td className="px-3 py-2 text-zinc-700 dark:text-zinc-200">
                      {row.warehouseCode} — {row.warehouseName}
                    </td>
                    <td className="px-3 py-2 font-medium text-amber-800 dark:text-amber-300">
                      {row.quantity} units of unallocated legacy stock remain for this style — run a
                      reconciliation count
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
