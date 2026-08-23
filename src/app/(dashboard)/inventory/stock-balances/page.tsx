"use client";

import { Breadcrumb } from "@/components/ui/Breadcrumb";
import { DataTable } from "@/components/ui/DataTable";

interface StockBalanceRow {
  id: string;
  quantityOnHand: string;
  updatedAt: string;
  product: { styleName: string; styleCode: string } | null;
  warehouse: { name: string; code: string } | null;
}

export default function StockBalancesPage() {
  return (
    <div className="space-y-4">
      <Breadcrumb items={[{ label: "Dashboard", href: "/dashboard" }, { label: "Stock Balances" }]} />
      <div>
        <h1 className="text-lg font-semibold text-zinc-900 dark:text-zinc-50">Stock Balances</h1>
        <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">
          Current on-hand quantity per material and warehouse, maintained by the inventory ledger.
        </p>
      </div>

      <DataTable<StockBalanceRow>
        fetchUrl="/api/v1/inventory/stock-balances"
        searchPlaceholder="Search by material name or code…"
        columns={[
          { key: "product", header: "Material", render: (row) => (row.product ? `${row.product.styleName} (${row.product.styleCode})` : "—") },
          { key: "warehouse", header: "Warehouse", render: (row) => row.warehouse?.name ?? "—" },
          { key: "quantityOnHand", header: "Quantity On Hand", render: (row) => Number(row.quantityOnHand).toLocaleString() },
          { key: "updatedAt", header: "Last Updated", render: (row) => new Date(row.updatedAt).toLocaleString() },
        ]}
      />
    </div>
  );
}
