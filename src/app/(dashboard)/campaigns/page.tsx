"use client";

import { Breadcrumb } from "@/components/ui/Breadcrumb";
import { DataTable } from "@/components/ui/DataTable";
import { CHANNEL_LABELS, STATUS_LABELS } from "./statusLabels";

interface CampaignRow {
  id: string;
  campaignNumber: string;
  name: string;
  channel: keyof typeof CHANNEL_LABELS;
  status: keyof typeof STATUS_LABELS;
  budget: string;
  owner: { fullName: string } | null;
  metrics: { spend: number; leads: number; customers: number; revenue: number };
}

export default function CampaignsListPage() {
  return (
    <div className="space-y-4">
      <Breadcrumb items={[{ label: "Dashboard", href: "/dashboard" }, { label: "Campaigns" }]} />
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-lg font-semibold text-zinc-900 dark:text-zinc-50">Campaigns</h1>
          <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">
            Marketing campaigns with budget, spend, and lead/customer attribution — spend, leads and revenue
            are always computed live, never a number to remember to keep in sync.
          </p>
        </div>
        <a href="/marketing" className="text-sm font-medium text-indigo-600 hover:underline dark:text-indigo-400">
          Marketing Dashboard →
        </a>
      </div>

      <DataTable<CampaignRow>
        fetchUrl="/api/v1/campaigns"
        searchPlaceholder="Search by campaign name…"
        newHref="/campaigns/new"
        newLabel="New Campaign"
        rowHref={(row) => `/campaigns/${row.id}`}
        columns={[
          { key: "campaignNumber", header: "Campaign #" },
          { key: "name", header: "Name" },
          { key: "channel", header: "Channel", render: (row) => CHANNEL_LABELS[row.channel] ?? row.channel },
          { key: "budget", header: "Budget", render: (row) => `₹${Number(row.budget).toLocaleString()}` },
          { key: "spend", header: "Spend", render: (row) => `₹${row.metrics.spend.toLocaleString()}` },
          { key: "leads", header: "Leads", render: (row) => row.metrics.leads },
          { key: "customers", header: "Customers", render: (row) => row.metrics.customers },
          { key: "revenue", header: "Revenue", render: (row) => `₹${row.metrics.revenue.toLocaleString()}` },
          { key: "status", header: "Status", render: (row) => STATUS_LABELS[row.status] ?? row.status },
        ]}
      />
    </div>
  );
}
