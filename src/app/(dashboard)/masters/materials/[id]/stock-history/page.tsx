import { notFound } from "next/navigation";
import { auth } from "@/core/auth/auth";
import { PermissionService } from "@/core/rbac/PermissionService";
import { getMaterialById } from "@/modules/products/product.service";
import { getStockLedgerDescriptor } from "@/modules/reports/inventory.reports";
import { Breadcrumb } from "@/components/ui/Breadcrumb";
import { ReportTable } from "@/components/reports/ReportTable";

/**
 * A single material's full stock/transaction history — linked from Stock
 * Balances (row click + the "View" row action). Deliberately reuses
 * getStockLedgerDescriptor() (the exact same query the registered "Stock
 * Ledger" report itself uses, now with an added productId filter) rather
 * than a second, parallel ledger query — so this view can never disagree
 * with the real Stock Ledger report over the same data.
 */
export default async function MaterialStockHistoryPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const session = await auth();
  await PermissionService.assert(session!.user.id, "inventory", "view", {
    sessionIssuedAt: session!.user.sessionIssuedAt,
  }).catch(() => notFound());

  const material = await getMaterialById(session!.user.companyId, id).catch(() => null);
  if (!material) notFound();

  const descriptor = await getStockLedgerDescriptor(session!.user.companyId, session!.user.name ?? "Unknown", {
    productId: id,
  });

  return (
    <div className="space-y-4">
      <Breadcrumb
        items={[
          { label: "Dashboard", href: "/dashboard" },
          { label: "Stock Balances", href: "/inventory/stock-balances" },
          { label: material.styleName },
        ]}
      />
      <div>
        <h1 className="text-lg font-semibold text-zinc-900 dark:text-zinc-50">{material.styleName} — Stock History</h1>
        <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">
          Item Code: {material.styleCode} · every inventory transaction recorded for this material, most recent first.
        </p>
      </div>

      <ReportTable
        columns={descriptor.columns}
        rows={descriptor.rows}
        totals={descriptor.totals}
        emptyMessage="No stock transactions have been recorded yet for this material."
      />
    </div>
  );
}
