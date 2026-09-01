"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { DataTable } from "@/components/ui/DataTable";
import { Modal } from "@/components/ui/Modal";
import { Breadcrumb } from "@/components/ui/Breadcrumb";
import { InternalTransferForm } from "./new/InternalTransferForm";
import { STATUS_LABELS, STATUS_BADGE_CLASS } from "../simpleDocumentStatusLabels";

interface InternalTransferRow {
  id: string;
  transferNumber: string;
  transferDate: string;
  amount: string;
  status: keyof typeof STATUS_LABELS;
  fromPaymentType: { name: string };
  toPaymentType: { name: string };
}

export function InternalTransfersListClient() {
  const router = useRouter();
  const [modalOpen, setModalOpen] = useState(false);
  const [refreshKey, setRefreshKey] = useState(0);

  const closeModal = () => setModalOpen(false);

  const handleSuccess = () => {
    closeModal();
    setRefreshKey((k) => k + 1);
    router.refresh();
  };

  return (
    <div className="space-y-4">
      <div>
        <Breadcrumb items={[{ label: "Accounts", href: "/accounts" }, { label: "Internal Transfers" }]} />
        <h1 className="mt-2 text-lg font-semibold text-zinc-900 dark:text-zinc-50">Internal Transfers</h1>
        <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">
          Moving money between the company&apos;s own Cash/Bank accounts — zero P&amp;L impact, not an Expense.
        </p>
      </div>

      <DataTable<InternalTransferRow>
        fetchUrl="/api/v1/internal-transfers"
        refreshKey={refreshKey}
        newAction={{ label: "New Transfer", onClick: () => setModalOpen(true) }}
        searchPlaceholder="Search by transfer number…"
        rowHref={(row) => `/accounts/internal-transfers/${row.id}`}
        columns={[
          { key: "transferNumber", header: "Transfer No." },
          { key: "from", header: "From", render: (row) => row.fromPaymentType.name },
          { key: "to", header: "To", render: (row) => row.toPaymentType.name },
          { key: "transferDate", header: "Date", render: (row) => row.transferDate?.slice(0, 10) },
          { key: "amount", header: "Amount", render: (row) => `₹${Number(row.amount).toFixed(2)}` },
          {
            key: "status",
            header: "Status",
            render: (row) => (
              <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${STATUS_BADGE_CLASS[row.status]}`}>
                {STATUS_LABELS[row.status] ?? row.status}
              </span>
            ),
          },
        ]}
      />

      <Modal open={modalOpen} onClose={closeModal} title="New Internal Transfer" maxWidthClass="max-w-2xl">
        <InternalTransferForm onSuccess={handleSuccess} onCancel={closeModal} />
      </Modal>
    </div>
  );
}
