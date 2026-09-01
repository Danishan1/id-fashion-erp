"use client";

import { useState } from "react";
import { DataTable } from "@/components/ui/DataTable";
import { Modal } from "@/components/ui/Modal";
import { Breadcrumb } from "@/components/ui/Breadcrumb";
import { CustomerForm } from "./CustomerForm";
import { BuyersSection } from "./BuyersSection";

interface CustomerRow {
  id: string;
  code: string;
  name: string;
  type: string;
  country: string | null;
  isActive: boolean;
}

export function CustomersListClient() {
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
        <Breadcrumb items={[{ label: "Masters", href: "/masters" }, { label: "Customers" }]} />
        <h1 className="mt-2 text-lg font-semibold text-zinc-900 dark:text-zinc-50">Customers</h1>
        <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">Customers and the buyers/brands under them.</p>
      </div>

      <DataTable<CustomerRow>
        fetchUrl="/api/v1/customers"
        refreshKey={refreshKey}
        newAction={{ label: "New Customer", onClick: () => setModalOpen(true) }}
        searchPlaceholder="Search by name or code…"
        rowHref={(row) => `/masters/customers/${row.id}`}
        rowActions={(row) => <BuyersSection customerId={row.id} />}
        columns={[
          { key: "code", header: "Code" },
          { key: "name", header: "Name" },
          { key: "type", header: "Type" },
          { key: "country", header: "Country", render: (row) => row.country ?? "—" },
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

      <Modal open={modalOpen} onClose={closeModal} title="Add Customer" maxWidthClass="max-w-xl">
        <CustomerForm submitUrl="/api/v1/customers" method="POST" onSuccess={handleSuccess} onCancel={closeModal} />
      </Modal>
    </div>
  );
}
