"use client";

import { Breadcrumb } from "@/components/ui/Breadcrumb";
import { DataTable } from "@/components/ui/DataTable";
import { STATUS_LABELS } from "./statusLabels";

interface BuyerEnquiryRow {
  id: string;
  enquiryNumber: string;
  status: keyof typeof STATUS_LABELS;
  enquiryDate: string;
  customer: { name: string } | null;
  buyer: { name: string } | null;
  requestedBy: { fullName: string } | null;
  _count: { lines: number };
}

export default function BuyerEnquiriesListPage() {
  return (
    <div className="space-y-4">
      <Breadcrumb items={[{ label: "Dashboard", href: "/dashboard" }, { label: "Buyer Enquiries" }]} />
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-lg font-semibold text-zinc-900 dark:text-zinc-50">Buyer Enquiries</h1>
          <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">
            An optional intake layer before Sampling — log a buyer&apos;s multi-style ask, review each line, and
            convert only the ones worth sampling. Sample Requests and Sales Orders can still be created
            directly without ever going through here.
          </p>
        </div>
      </div>

      <DataTable<BuyerEnquiryRow>
        fetchUrl="/api/v1/buyer-enquiries"
        searchPlaceholder="Search by enquiry number…"
        newHref="/buyer-enquiries/new"
        newLabel="New Buyer Enquiry"
        rowHref={(row) => `/buyer-enquiries/${row.id}`}
        columns={[
          { key: "enquiryNumber", header: "Enquiry #" },
          {
            key: "customer",
            header: "Customer / Prospect",
            render: (row) => row.customer?.name ?? "— Prospect —",
          },
          { key: "buyer", header: "Buyer", render: (row) => row.buyer?.name ?? "—" },
          { key: "lines", header: "Lines", render: (row) => row._count.lines },
          { key: "status", header: "Status", render: (row) => STATUS_LABELS[row.status] ?? row.status },
          { key: "requestedBy", header: "Requested By", render: (row) => row.requestedBy?.fullName ?? "—" },
          {
            key: "enquiryDate",
            header: "Enquiry Date",
            render: (row) => new Date(row.enquiryDate).toLocaleDateString(),
          },
        ]}
      />
    </div>
  );
}
