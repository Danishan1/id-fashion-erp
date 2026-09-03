"use client";

import { useState } from "react";
import { Breadcrumb } from "@/components/ui/Breadcrumb";
import { ChildrenList } from "@/components/ui/ChildrenList";
import { LocalChildrenList } from "@/components/ui/LocalChildrenList";
import { DataTable } from "@/components/ui/DataTable";
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

/** Shape of a staged, not-yet-persisted location on the Create modal — plain
 * strings, matching ChildFormModal's own buildSubmitPayload output. */
interface StagedLocation {
  [key: string]: string;
  code: string;
  zone: string;
  rack: string;
  bin: string;
  materialCategory: string;
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

const LOCATION_COLUMNS = [
  { key: "code", header: "Code" },
  { key: "zone", header: "Zone", render: (row: { zone: string | null }) => row.zone || "—" },
  { key: "rack", header: "Rack", render: (row: { rack: string | null }) => row.rack || "—" },
  { key: "bin", header: "Bin", render: (row: { bin: string | null }) => row.bin || "—" },
  {
    key: "materialCategory",
    header: "Material Category",
    render: (row: { materialCategory: string | null }) =>
      row.materialCategory ? formatCategoryLabel(row.materialCategory) : "—",
  },
];

function formatTypes(types: string[]) {
  return types.map((t) => t.replace(/_/g, " ")).join(", ") || "—";
}

/**
 * Warehouse → Locations, per the 2026-09-02 UX revisions: Locations
 * management lives directly inside the same Create/Edit modal as the
 * warehouse's own fields (not a separate "Locations" action/modal). Create
 * shows both together from the start — matching Edit exactly — by staging
 * Locations client-side (LocalChildrenList) and submitting them together
 * with the warehouse's own fields in one request; Edit already has a real
 * id, so its Locations section (ChildrenList) talks straight to the API.
 * Type is a multi-select (WarehouseForm's own checkbox group) since a single
 * physical warehouse can store more than one material kind.
 */
export function WarehousesListClient() {
  const [addOpen, setAddOpen] = useState(false);
  const [stagedLocations, setStagedLocations] = useState<StagedLocation[]>([]);
  const [editTarget, setEditTarget] = useState<WarehouseRow | null>(null);
  const [justSaved, setJustSaved] = useState(false);
  const [refreshKey, setRefreshKey] = useState(0);

  const closeAdd = () => {
    setAddOpen(false);
    setStagedLocations([]);
    setRefreshKey((k) => k + 1);
  };

  const openEdit = (row: WarehouseRow) => {
    setJustSaved(false);
    setEditTarget(row);
  };

  const closeEdit = () => {
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
        onEditRow={openEdit}
        columns={[
          { key: "code", header: "Code" },
          { key: "name", header: "Name" },
          { key: "type", header: "Type", render: (row) => formatTypes(row.type) },
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

      <Modal open={addOpen} onClose={closeAdd} title="Add Warehouse" maxWidthClass="max-w-2xl">
        <div className="space-y-6">
          <WarehouseForm
            submitUrl="/api/v1/warehouses"
            method="POST"
            extraFields={{ locations: stagedLocations }}
            onSuccess={closeAdd}
            onCancel={closeAdd}
          />
          <div className="border-t border-zinc-200 pt-4 dark:border-zinc-800">
            <h2 className="mb-2 text-sm font-semibold text-zinc-900 dark:text-zinc-50">Storage Locations</h2>
            <p className="mb-2 text-xs text-zinc-500 dark:text-zinc-400">
              Optional — add any storage locations now; they&rsquo;re created together with the warehouse when
              you Save above.
            </p>
            <LocalChildrenList<StagedLocation>
              value={stagedLocations}
              onChange={setStagedLocations}
              entityLabel="Location"
              fields={LOCATION_FIELDS}
              columns={LOCATION_COLUMNS}
              emptyMessage="No locations added yet."
            />
          </div>
        </div>
      </Modal>

      <Modal
        open={!!editTarget}
        onClose={closeEdit}
        title={`Edit Warehouse — ${editTarget?.name ?? ""}`}
        maxWidthClass="max-w-2xl"
      >
        {editTarget && (
          <div className="space-y-6">
            <WarehouseForm
              key={editTarget.id}
              initialValues={{ code: editTarget.code, name: editTarget.name, type: editTarget.type, isActive: editTarget.isActive }}
              submitUrl={`/api/v1/warehouses/${editTarget.id}`}
              method="PATCH"
              // Deliberately does NOT close the modal — Locations are right
              // below, so saving the fields shouldn't kick the user out
              // before they're done managing those too. Closing is explicit,
              // via Cancel/Done or the Modal's own X/Escape/outside-click.
              onSuccess={(saved) => {
                setJustSaved(true);
                setEditTarget((prev) => (prev ? { ...prev, code: saved.code, name: saved.name, type: saved.type, isActive: saved.isActive } : prev));
              }}
              onCancel={closeEdit}
            />
            {justSaved && <p className="text-sm text-green-700 dark:text-green-400">Saved.</p>}
            <div className="border-t border-zinc-200 pt-4 dark:border-zinc-800">
              <h2 className="mb-2 text-sm font-semibold text-zinc-900 dark:text-zinc-50">Storage Locations</h2>
              <ChildrenList<LocationRow>
                fetchUrl={`/api/v1/warehouses/${editTarget.id}/locations`}
                entityLabel="Location"
                fields={LOCATION_FIELDS}
                columns={LOCATION_COLUMNS}
                emptyMessage="No locations yet."
              />
            </div>
            <div className="flex justify-end">
              <button
                type="button"
                onClick={closeEdit}
                className="rounded-md bg-indigo-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-indigo-500"
              >
                Done
              </button>
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
}
