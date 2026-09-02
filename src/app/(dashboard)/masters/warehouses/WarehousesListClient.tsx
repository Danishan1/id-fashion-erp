"use client";

import { useState } from "react";
import { ActionMenu } from "@/components/ui/ActionMenu";
import { Breadcrumb } from "@/components/ui/Breadcrumb";
import { DataTable } from "@/components/ui/DataTable";
import { ManageChildrenModal } from "@/components/ui/ManageChildrenModal";
import { Modal } from "@/components/ui/Modal";
import { MATERIAL_CATEGORIES } from "@/modules/products/product.schema";
import { formatCategoryLabel } from "@/lib/format-category-label";
import { WarehouseForm, type WarehouseFormValues } from "./WarehouseForm";

interface WarehouseRow {
  id: string;
  code: string;
  name: string;
  type: WarehouseFormValues["type"];
  isActive: boolean;
}

interface LocationRow {
  id: string;
  code: string;
  zone: string | null;
  rack: string | null;
  bin: string | null;
  materialCategory: string | null;
  isActive: boolean;
}

const LOCATION_FIELDS = [
  { key: "code", label: "Code", required: true },
  { key: "zone", label: "Zone" },
  { key: "rack", label: "Rack" },
  { key: "bin", label: "Bin" },
  {
    key: "materialCategory",
    label: "Material Category",
    type: "select" as const,
    placeholder: "— Not tagged —",
    options: MATERIAL_CATEGORIES.map((c) => ({ value: c, label: formatCategoryLabel(c) })),
  },
];

/**
 * Reference implementation of the ERP-wide List → Actions → Manage-Child
 * modal CRUD standard (Warehouse → Locations). Create and Edit are both
 * modals reusing the existing, navigation-agnostic WarehouseForm; Locations
 * is the new generic ManageChildrenModal/ChildFormModal pair. There is no
 * more `/masters/warehouses/[id]` page — everything happens from this list.
 */
export function WarehousesListClient() {
  const [addOpen, setAddOpen] = useState(false);
  const [editTarget, setEditTarget] = useState<WarehouseRow | null>(null);
  const [locationsTarget, setLocationsTarget] = useState<WarehouseRow | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);

  const handleCreated = () => {
    setAddOpen(false);
    setRefreshKey((k) => k + 1);
  };

  const handleEdited = () => {
    setEditTarget(null);
    setRefreshKey((k) => k + 1);
  };

  return (
    <div className="space-y-4">
      <div>
        <Breadcrumb items={[{ label: "Masters", href: "/masters" }, { label: "Warehouses" }]} />
        <h1 className="mt-2 text-lg font-semibold text-zinc-900 dark:text-zinc-50">Warehouses</h1>
        <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">Warehouses and their storage locations.</p>
      </div>

      <DataTable<WarehouseRow>
        fetchUrl="/api/v1/warehouses"
        refreshKey={refreshKey}
        newAction={{ label: "New Warehouse", onClick: () => setAddOpen(true) }}
        searchPlaceholder="Search by name or code…"
        rowActions={(row) => (
          <ActionMenu
            items={[
              { label: "Edit", onClick: () => setEditTarget(row) },
              { label: "Locations", onClick: () => setLocationsTarget(row) },
            ]}
          />
        )}
        columns={[
          { key: "code", header: "Code" },
          { key: "name", header: "Name" },
          { key: "type", header: "Type" },
          {
            key: "isActive",
            header: "Status",
            render: (row) => (
              <span
                className={`rounded-full px-2 py-0.5 text-xs font-medium ${
                  row.isActive
                    ? "bg-green-100 text-green-700 dark:bg-green-500/10 dark:text-green-400"
                    : "bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-400"
                }`}
              >
                {row.isActive ? "Active" : "Inactive"}
              </span>
            ),
          },
        ]}
      />

      <Modal open={addOpen} onClose={() => setAddOpen(false)} title="Add Warehouse" maxWidthClass="max-w-xl">
        <WarehouseForm submitUrl="/api/v1/warehouses" method="POST" onSuccess={handleCreated} onCancel={() => setAddOpen(false)} />
      </Modal>

      <Modal
        open={!!editTarget}
        onClose={() => setEditTarget(null)}
        title={`Edit Warehouse — ${editTarget?.name ?? ""}`}
        maxWidthClass="max-w-xl"
      >
        {editTarget && (
          <WarehouseForm
            key={editTarget.id}
            initialValues={{ code: editTarget.code, name: editTarget.name, type: editTarget.type, isActive: editTarget.isActive }}
            submitUrl={`/api/v1/warehouses/${editTarget.id}`}
            method="PATCH"
            onSuccess={handleEdited}
            onCancel={() => setEditTarget(null)}
          />
        )}
      </Modal>

      {locationsTarget && (
        <ManageChildrenModal<LocationRow>
          open={!!locationsTarget}
          onClose={() => setLocationsTarget(null)}
          title={`Locations — ${locationsTarget.name} (${locationsTarget.code})`}
          fetchUrl={`/api/v1/warehouses/${locationsTarget.id}/locations`}
          entityLabel="Location"
          fields={LOCATION_FIELDS}
          columns={[
            { key: "code", header: "Code" },
            { key: "zone", header: "Zone", render: (row) => row.zone ?? "—" },
            { key: "rack", header: "Rack", render: (row) => row.rack ?? "—" },
            { key: "bin", header: "Bin", render: (row) => row.bin ?? "—" },
            {
              key: "materialCategory",
              header: "Material Category",
              render: (row) => (row.materialCategory ? formatCategoryLabel(row.materialCategory) : "—"),
            },
          ]}
          emptyMessage="No locations yet."
        />
      )}
    </div>
  );
}
