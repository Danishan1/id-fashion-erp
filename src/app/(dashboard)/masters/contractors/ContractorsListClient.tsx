"use client";

import { useState } from "react";
import { DataTable } from "@/components/ui/DataTable";
import { Modal } from "@/components/ui/Modal";
import { Breadcrumb } from "@/components/ui/Breadcrumb";
import { ContractorForm } from "./ContractorForm";

interface ContractorRow {
  id: string;
  code: string;
  name: string;
  contactPerson: string | null;
  phone: string | null;
  isActive: boolean;
}

export function ContractorsListClient() {
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
        <Breadcrumb items={[{ label: "Masters", href: "/masters" }, { label: "Contractors" }]} />
        <h1 className="mt-2 text-lg font-semibold text-zinc-900 dark:text-zinc-50">Contractors</h1>
        <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">
          External job-work units — paid via Piece-Rate earnings, not the Purchase/Invoice/Payment pipeline.
        </p>
      </div>

      <DataTable<ContractorRow>
        fetchUrl="/api/v1/contractors"
        refreshKey={refreshKey}
        newAction={{ label: "New Contractor", onClick: () => setModalOpen(true) }}
        searchPlaceholder="Search by name or code…"
        rowHref={(row) => `/masters/contractors/${row.id}`}
        columns={[
          { key: "code", header: "Code", sortable: true },
          { key: "name", header: "Name", sortable: true },
          { key: "contactPerson", header: "Contact Person", render: (row) => row.contactPerson ?? "—" },
          { key: "phone", header: "Phone", render: (row) => row.phone ?? "—" },
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
      />

      <Modal open={modalOpen} onClose={closeModal} title="Add Contractor" maxWidthClass="max-w-xl">
        <ContractorForm submitUrl="/api/v1/contractors" method="POST" onSuccess={handleSuccess} onCancel={closeModal} />
      </Modal>
    </div>
  );
}
