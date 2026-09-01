"use client";

import { useState } from "react";
import { DataTable } from "@/components/ui/DataTable";
import { Modal } from "@/components/ui/Modal";
import { Breadcrumb } from "@/components/ui/Breadcrumb";
import { SupplierForm } from "./SupplierForm";
import { SuppliedCategoriesSection } from "./SuppliedCategoriesSection";
import { SuppliedMaterialsSection } from "./SuppliedMaterialsSection";

interface SupplierRow {
  id: string;
  code: string;
  name: string;
  category: { name: string };
  isActive: boolean;
}

export function SuppliersListClient() {
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
        <Breadcrumb items={[{ label: "Masters", href: "/masters" }, { label: "Suppliers" }]} />
        <h1 className="mt-2 text-lg font-semibold text-zinc-900 dark:text-zinc-50">Suppliers</h1>
        <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">Fabric, trims, packaging, and service vendors.</p>
      </div>

      <DataTable<SupplierRow>
        fetchUrl="/api/v1/suppliers"
        refreshKey={refreshKey}
        newAction={{ label: "New Supplier", onClick: () => setModalOpen(true) }}
        searchPlaceholder="Search by name or code…"
        rowHref={(row) => `/masters/suppliers/${row.id}`}
        rowActions={(row) => (
          <>
            <SuppliedCategoriesSection supplierId={row.id} />
            <SuppliedMaterialsSection supplierId={row.id} />
          </>
        )}
        columns={[
          { key: "code", header: "Code" },
          { key: "name", header: "Name" },
          { key: "category", header: "Category", render: (row) => row.category?.name ?? "—" },
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

      <Modal open={modalOpen} onClose={closeModal} title="Add Supplier" maxWidthClass="max-w-xl">
        <SupplierForm submitUrl="/api/v1/suppliers" method="POST" onSuccess={handleSuccess} onCancel={closeModal} />
      </Modal>
    </div>
  );
}
