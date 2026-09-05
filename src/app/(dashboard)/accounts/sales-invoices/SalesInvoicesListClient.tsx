"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { DataTable } from "@/components/ui/DataTable";
import { Modal } from "@/components/ui/Modal";
import { Breadcrumb } from "@/components/ui/Breadcrumb";
import { SalesInvoiceForm } from "./new/SalesInvoiceForm";
import { STATUS_LABELS, STATUS_BADGE_CLASS } from "../invoiceStatusLabels";

interface SalesInvoiceRow {
  id: string;
  invoiceNumber: string;
  invoiceDate: string;
  dueDate: string;
  status: keyof typeof STATUS_LABELS;
  totalAmount: string;
  salesOrder: { orderNumber: string };
  customer: { name: string };
}

export function SalesInvoicesListClient() {
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
        <Breadcrumb items={[{ label: "Accounts", href: "/accounts" }, { label: "Sales Invoices" }]} />
        <h1 className="mt-2 text-lg font-semibold text-zinc-900 dark:text-zinc-50">Sales Invoices</h1>
        <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">Invoices raised against confirmed sales orders.</p>
      </div>

      <DataTable<SalesInvoiceRow>
        fetchUrl="/api/v1/sales-invoices"
        exportUrl="/api/v1/sales-invoices/export/xlsx"
        refreshKey={refreshKey}
        newAction={{ label: "New Invoice", onClick: () => setModalOpen(true) }}
        searchPlaceholder="Search by invoice number…"
        rowHref={(row) => `/accounts/sales-invoices/${row.id}`}
        columns={[
          { key: "invoiceNumber", header: "Invoice No." },
          { key: "salesOrder", header: "Sales Order", render: (row) => row.salesOrder?.orderNumber ?? "—" },
          { key: "customer", header: "Customer", render: (row) => row.customer?.name ?? "—" },
          { key: "invoiceDate", header: "Date", render: (row) => row.invoiceDate?.slice(0, 10) },
          { key: "dueDate", header: "Due", render: (row) => row.dueDate?.slice(0, 10) },
          { key: "totalAmount", header: "Total", render: (row) => Number(row.totalAmount).toFixed(2) },
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

      <Modal open={modalOpen} onClose={closeModal} title="New Sales Invoice" maxWidthClass="max-w-4xl">
        <SalesInvoiceForm onSuccess={handleSuccess} onCancel={closeModal} />
      </Modal>
    </div>
  );
}
