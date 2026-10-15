"use client";

import { useEffect, useState } from "react";
import { Breadcrumb } from "@/components/ui/Breadcrumb";
import { DataTable } from "@/components/ui/DataTable";
import { SearchableSelect } from "@/components/ui/SearchableSelect";
import { ViewIcon } from "@/components/ui/icons";

interface Option {
  id: string;
  name?: string;
  code?: string;
  styleName?: string;
  styleCode?: string;
}

interface ReceiptRow {
  id: string;
  receiptNumber: string;
  totalQuantity: string;
  postedAt: string;
  product: { styleCode: string; styleName: string } | null;
  lot: { lotNumber: string } | null;
  productionOrder: { orderNumber: string } | null;
  warehouse: { code: string; name: string } | null;
  postedBy: { fullName: string } | null;
}

export function FinishedGoodsReceiptsListClient() {
  const [styles, setStyles] = useState<Option[]>([]);
  const [warehouses, setWarehouses] = useState<Option[]>([]);
  const [productId, setProductId] = useState("");
  const [warehouseId, setWarehouseId] = useState("");

  useEffect(() => {
    fetch("/api/v1/products?pageSize=200")
      .then((res) => res.json())
      .then((body) => setStyles(body.data ?? []));
    fetch("/api/v1/warehouses?pageSize=200")
      .then((res) => res.json())
      .then((body) => setWarehouses(body.data ?? []));
  }, []);

  return (
    <div className="space-y-4">
      <Breadcrumb
        items={[
          { label: "Dashboard", href: "/dashboard" },
          { label: "Finished Goods Inventory", href: "/finished-goods-inventory" },
          { label: "Receipts" },
        ]}
      />
      <div>
        <h1 className="text-lg font-semibold text-zinc-900 dark:text-zinc-50">Finished Goods Receipts</h1>
        <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">
          Every batch of finished goods that has entered stock from Production — one receipt per completed
          lot, posted automatically the moment a job order finishes at its final stage.
        </p>
      </div>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        <SearchableSelect
          value={productId}
          onChange={setProductId}
          options={styles.map((s) => ({ id: s.id, label: s.styleName ? `${s.styleCode} — ${s.styleName}` : (s.name ?? s.code ?? "") }))}
          placeholder="Search style…"
          emptyOptionLabel="All Styles"
        />
        <SearchableSelect
          value={warehouseId}
          onChange={setWarehouseId}
          options={warehouses.map((w) => ({ id: w.id, label: w.name ?? w.code ?? "" }))}
          placeholder="Search warehouse…"
          emptyOptionLabel="All Warehouses"
        />
      </div>

      <DataTable<ReceiptRow>
        key={`${productId}-${warehouseId}`}
        fetchUrl="/api/v1/finished-goods-inventory/receipts"
        searchPlaceholder="Search by receipt number or style…"
        extraParams={{ productId, warehouseId }}
        rowHref={(row) => `/finished-goods-inventory/receipts/${row.id}`}
        rowHrefLabel="View"
        rowHrefIcon={<ViewIcon />}
        columns={[
          { key: "receiptNumber", header: "Receipt #" },
          { key: "product", header: "Style", render: (row) => (row.product ? `${row.product.styleCode} — ${row.product.styleName}` : "—") },
          { key: "lot", header: "Lot", render: (row) => row.lot?.lotNumber ?? "—" },
          { key: "productionOrder", header: "Production Order", render: (row) => row.productionOrder?.orderNumber ?? "—" },
          { key: "warehouse", header: "Warehouse", render: (row) => row.warehouse?.name ?? "—" },
          { key: "totalQuantity", header: "Quantity", render: (row) => Number(row.totalQuantity).toLocaleString() },
          { key: "postedBy", header: "Posted By", render: (row) => row.postedBy?.fullName ?? "—" },
          { key: "postedAt", header: "Posted At", render: (row) => new Date(row.postedAt).toLocaleString() },
        ]}
      />
    </div>
  );
}
