"use client";

import { useState } from "react";
import { DataTable } from "@/components/ui/DataTable";
import { Modal } from "@/components/ui/Modal";
import { Breadcrumb } from "@/components/ui/Breadcrumb";
import { ForwarderForm } from "./ForwarderForm";

interface ForwarderRow {
  id: string;
  code: string;
  name: string;
  type: string;
  contactPerson: string | null;
  phone: string | null;
  city: string | null;
  isActive: boolean;
}

const TYPE_LABELS: Record<string, string> = {
  COURIER: "Courier",
  ROAD: "Road / Truck",
  RAIL: "Rail",
  AIR: "Air",
  OTHER: "Other",
};

export function ForwardersListClient() {
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
        <Breadcrumb items={[{ label: "Masters", href: "/masters" }, { label: "Forwarders" }]} />
        <h1 className="mt-2 text-lg font-semibold text-zinc-900 dark:text-zinc-50">Forwarders</h1>
        <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">
          Couriers / transporters used to ship a Dispatch — pick one on the Dispatch form to record LR/AWB number,
          driver details and freight charges per shipment.
        </p>
      </div>

      <DataTable<ForwarderRow>
        fetchUrl="/api/v1/forwarders"
        refreshKey={refreshKey}
        newAction={{ label: "New Forwarder", onClick: () => setModalOpen(true) }}
        searchPlaceholder="Search by name or code…"
        rowHref={(row) => `/masters/forwarders/${row.id}`}
        columns={[
          { key: "code", header: "Code", sortable: true },
          { key: "name", header: "Name", sortable: true },
          { key: "type", header: "Type", render: (row) => TYPE_LABELS[row.type] ?? row.type },
          { key: "contactPerson", header: "Contact Person", render: (row) => row.contactPerson ?? "—" },
          { key: "phone", header: "Phone", render: (row) => row.phone ?? "—" },
          { key: "city", header: "City", render: (row) => row.city ?? "—" },
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

      <Modal open={modalOpen} onClose={closeModal} title="Add Forwarder" maxWidthClass="max-w-xl">
        <ForwarderForm submitUrl="/api/v1/forwarders" method="POST" onSuccess={handleSuccess} onCancel={closeModal} />
      </Modal>
    </div>
  );
}
