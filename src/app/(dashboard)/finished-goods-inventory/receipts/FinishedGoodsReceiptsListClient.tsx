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
  status: "PENDING" | "PARTIALLY_RECEIVED" | "RECEIVED";
  source: "PRODUCTION" | "CUSTOMER_RETURN";
  dispatch: { dispatchNumber: string } | null;
  dispatchReturn: { returnNumber: string } | null;
}

export function FinishedGoodsReceiptsListClient() {
  const [styles, setStyles] = useState<Option[]>([]);
  const [warehouses, setWarehouses] = useState<Option[]>([]);
  const [productId, setProductId] = useState("");
  const [warehouseId, setWarehouseId] = useState("");
  const [status, setStatus] = useState("");
  const [source, setSource] = useState("");

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
          Every batch of finished goods arriving from Packing or from a customer return. A receipt reaches stock
          only once it is received into a location on the Receive page.
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
        <select
          value={status}
          onChange={(e) => setStatus(e.target.value)}
          aria-label="Filter by status"
          className="rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-900 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-50"
        >
          <option value="">All statuses</option>
          <option value="PENDING">Waiting to receive</option>
          <option value="PARTIALLY_RECEIVED">Partly received</option>
          <option value="RECEIVED">Received</option>
        </select>
        <select
          value={source}
          onChange={(e) => setSource(e.target.value)}
          aria-label="Filter by source"
          className="rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-900 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-50"
        >
          <option value="">All sources</option>
          <option value="PRODUCTION">From packing</option>
          <option value="CUSTOMER_RETURN">Customer returns</option>
        </select>
      </div>

      <DataTable<ReceiptRow>
        key={`${productId}-${warehouseId}-${status}-${source}`}
        fetchUrl="/api/v1/finished-goods-inventory/receipts"
        searchPlaceholder="Search by receipt number or style…"
        extraParams={{ productId, warehouseId, status, source }}
        rowHref={(row) => `/finished-goods-inventory/receipts/${row.id}`}
        rowHrefLabel="View"
        rowHrefIcon={<ViewIcon />}
        columns={[
          { key: "receiptNumber", header: "Receipt #" },
          { key: "product", header: "Style", render: (row) => (row.product ? `${row.product.styleCode} — ${row.product.styleName}` : "—") },
          {
            key: "status",
            header: "Status",
            render: (row) => (row.status === "PENDING" ? "Waiting to receive" : row.status === "PARTIALLY_RECEIVED" ? "Partly received" : "Received"),
          },
          {
            key: "source",
            header: "From",
            render: (row) =>
              row.source === "CUSTOMER_RETURN"
                ? `Customer return ${row.dispatchReturn?.returnNumber ?? ""} (${row.dispatch?.dispatchNumber ?? ""})`
                : `${row.productionOrder?.orderNumber ?? "—"}${row.lot ? ` · Lot ${row.lot.lotNumber}` : ""}`,
          },
          { key: "warehouse", header: "Warehouse", render: (row) => row.warehouse?.name ?? "—" },
          { key: "totalQuantity", header: "Quantity", render: (row) => Number(row.totalQuantity).toLocaleString() },
          { key: "postedBy", header: "Arrived By", render: (row) => row.postedBy?.fullName ?? "—" },
          { key: "postedAt", header: "Arrived At", render: (row) => new Date(row.postedAt).toLocaleString() },
        ]}
      />
    </div>
  );
}
