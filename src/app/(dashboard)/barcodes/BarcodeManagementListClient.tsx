"use client";

import { useState } from "react";
import { DataTable } from "@/components/ui/DataTable";
import { ConfirmModal } from "@/components/ui/ConfirmModal";
import { Breadcrumb } from "@/components/ui/Breadcrumb";

interface BarcodeRow {
  id: string;
  code: string;
  entityType: string;
  status: "ACTIVE" | "DISABLED";
  createdAt: string;
  createdBy: { fullName: string } | null;
}

const ENTITY_TYPE_LABELS: Record<string, string> = {
  FABRIC_ROLL: "Fabric Roll",
  PRODUCTION_LOT: "Production Lot",
  CARTON: "Carton",
  ITEM: "Item",
  SKU: "SKU",
};

/**
 * The Barcode Management screen (spec §12, 2026-09-29) — every barcode ever
 * registered, searchable by code, filterable by entity type/status, with
 * reprint and disable actions. Read-only over the underlying entities
 * themselves (see barcode.service.ts's own doc comment) — this screen only
 * manages the registry, never the entities it points at.
 */
export function BarcodeManagementListClient() {
  const [refreshKey, setRefreshKey] = useState(0);
  const [entityType, setEntityType] = useState("");
  const [pendingDisable, setPendingDisable] = useState<BarcodeRow | null>(null);
  const [isDisabling, setIsDisabling] = useState(false);

  async function confirmDisable() {
    if (!pendingDisable) return;
    setIsDisabling(true);
    await fetch(`/api/v1/barcodes/${pendingDisable.id}`, { method: "PATCH" });
    setIsDisabling(false);
    setPendingDisable(null);
    setRefreshKey((k) => k + 1);
  }

  return (
    <div className="space-y-4">
      <div>
        <Breadcrumb items={[{ label: "Dashboard", href: "/dashboard" }, { label: "Barcode Management" }]} />
        <h1 className="mt-2 text-lg font-semibold text-zinc-900 dark:text-zinc-50">Barcode Management</h1>
        <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">
          Every barcode ever registered — Fabric Rolls, Production Lots, Cartons, Items, and Style Variants (SKUs).
        </p>
      </div>

      <div className="flex items-center gap-2">
        <label className="text-xs font-medium text-zinc-600 dark:text-zinc-400" htmlFor="entity-type-filter">
          Entity Type
        </label>
        <select
          id="entity-type-filter"
          value={entityType}
          onChange={(e) => setEntityType(e.target.value)}
          className="rounded-md border border-zinc-300 px-2 py-1 text-sm dark:border-zinc-700 dark:bg-zinc-800"
        >
          <option value="">All</option>
          {Object.entries(ENTITY_TYPE_LABELS).map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </select>
      </div>

      <DataTable<BarcodeRow>
        fetchUrl={`/api/v1/barcodes${entityType ? `?entityType=${entityType}` : ""}`}
        refreshKey={refreshKey}
        searchPlaceholder="Search by code…"
        statusFilter={{
          options: [
            { value: "ACTIVE", label: "Active" },
            { value: "DISABLED", label: "Disabled" },
          ],
        }}
        columns={[
          { key: "code", header: "Code", sortable: true, render: (row) => <span className="font-mono">{row.code}</span> },
          { key: "entityType", header: "Entity Type", render: (row) => ENTITY_TYPE_LABELS[row.entityType] ?? row.entityType },
          {
            key: "status",
            header: "Status",
            render: (row) => (
              <span
                className={`rounded-full px-2 py-0.5 text-xs font-medium ${
                  row.status === "ACTIVE"
                    ? "bg-green-100 text-green-700 dark:bg-green-500/10 dark:text-green-400"
                    : "bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-400"
                }`}
              >
                {row.status === "ACTIVE" ? "Active" : "Disabled"}
              </span>
            ),
          },
          { key: "createdBy", header: "Created By", render: (row) => row.createdBy?.fullName ?? "—" },
          { key: "createdAt", header: "Created", sortable: true, render: (row) => new Date(row.createdAt).toLocaleString("en-IN") },
        ]}
        rowActions={(row) => (
          <>
            <a href={`/api/v1/barcodes/${row.id}/label.pdf`} className="text-indigo-600 hover:underline dark:text-indigo-400">
              Print Label
            </a>
            {row.status === "ACTIVE" && (
              <button
                type="button"
                onClick={() => setPendingDisable(row)}
                className="text-red-600 hover:underline dark:text-red-400"
              >
                Disable
              </button>
            )}
          </>
        )}
      />

      <ConfirmModal
        open={pendingDisable !== null}
        title="Disable this barcode?"
        message={`"${pendingDisable?.code}" will stop resolving via the scanner. Generate a new barcode for this item afterward if a replacement label is needed.`}
        confirmLabel="Disable"
        isDangerous
        isBusy={isDisabling}
        onConfirm={confirmDisable}
        onCancel={() => setPendingDisable(null)}
      />
    </div>
  );
}
