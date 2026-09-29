"use client";

import { useState } from "react";
import { DataTable } from "@/components/ui/DataTable";
import { Modal } from "@/components/ui/Modal";
import { Breadcrumb } from "@/components/ui/Breadcrumb";
import { GenerateBarcodeButton } from "@/components/ui/GenerateBarcodeButton";
import { MaterialForm } from "./MaterialForm";

interface MaterialRow {
  id: string;
  styleCode: string;
  styleName: string;
  materialCategory: string | null;
  baseUom: { code: string } | null;
  reorderLevel: string | null;
  isActive: boolean;
}

export function MaterialsListClient() {
  const [modalOpen, setModalOpen] = useState(false);
  const [refreshKey, setRefreshKey] = useState(0);

  const closeModal = () => setModalOpen(false);

  const handleSuccess = () => {
    closeModal();
    setRefreshKey((k) => k + 1);
  };

  return (
    <div className="space-y-4">
      <div>
        <Breadcrumb items={[{ label: "Masters", href: "/masters" }, { label: "Raw Materials" }]} />
        <h1 className="mt-2 text-lg font-semibold text-zinc-900 dark:text-zinc-50">Raw Materials</h1>
        <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">
          Fabric, trims, accessories, and packaging items used in production.
        </p>
      </div>

      <DataTable<MaterialRow>
        fetchUrl="/api/v1/materials"
        refreshKey={refreshKey}
        newAction={{ label: "New Material", onClick: () => setModalOpen(true) }}
        searchPlaceholder="Search by name or item code…"
        rowHref={(row) => `/masters/materials/${row.id}`}
        columns={[
          { key: "styleCode", header: "Item Code", sortable: true },
          { key: "styleName", header: "Item Name", sortable: true },
          { key: "materialCategory", header: "Category", sortable: true, render: (row) => row.materialCategory ?? "—" },
          { key: "baseUom", header: "UOM", render: (row) => row.baseUom?.code ?? "—" },
          { key: "reorderLevel", header: "Reorder Level", sortable: true, render: (row) => row.reorderLevel ?? "—" },
          {
            key: "isActive",
            header: "Status",
            sortable: true,
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
        rowActions={(row) => <GenerateBarcodeButton entityType="ITEM" entityId={row.id} />}
      />

      <Modal open={modalOpen} onClose={closeModal} title="Add Material" maxWidthClass="max-w-xl">
        <MaterialForm submitUrl="/api/v1/materials" method="POST" onSuccess={handleSuccess} onCancel={closeModal} />
      </Modal>
    </div>
  );
}
