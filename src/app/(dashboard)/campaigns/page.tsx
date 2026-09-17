"use client";

import { Suspense, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Breadcrumb } from "@/components/ui/Breadcrumb";
import { DataTable } from "@/components/ui/DataTable";
import { CsvImportModal } from "@/components/ui/CsvImportModal";
import { CHANNEL_LABELS, STATUS_LABELS, APPROVAL_LABELS } from "./statusLabels";

interface CampaignRow {
  id: string;
  campaignNumber: string;
  name: string;
  channel: keyof typeof CHANNEL_LABELS;
  status: keyof typeof STATUS_LABELS;
  approvalStatus: keyof typeof APPROVAL_LABELS;
  budget: string;
  owner: { fullName: string } | null;
  metrics: { spend: number; leads: number; customers: number; revenue: number };
}

export default function CampaignsListPage() {
  return (
    <Suspense>
      <CampaignsListContent />
    </Suspense>
  );
}

function CampaignsListContent() {
  const searchParams = useSearchParams();
  const channel = searchParams.get("channel");
  const fetchUrl = channel ? `/api/v1/campaigns?channel=${encodeURIComponent(channel)}` : "/api/v1/campaigns";
  const [importOpen, setImportOpen] = useState(false);
  const [importKey, setImportKey] = useState(0);
  const [refreshKey, setRefreshKey] = useState(0);

  return (
    <div className="space-y-4">
      <Breadcrumb items={[{ label: "Dashboard", href: "/dashboard" }, { label: "Campaigns" }]} />
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-lg font-semibold text-zinc-900 dark:text-zinc-50">Campaigns</h1>
          <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">
            Marketing campaigns with budget, spend, and lead/customer attribution — spend, leads and revenue
            are always computed live, never a number to remember to keep in sync.
          </p>
        </div>
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={() => {
              setImportKey((k) => k + 1);
              setImportOpen(true);
            }}
            className="whitespace-nowrap rounded-md border border-zinc-300 px-3 py-1.5 text-sm font-medium text-zinc-700 hover:bg-zinc-50 dark:border-zinc-700 dark:text-zinc-200 dark:hover:bg-zinc-800"
          >
            Import Daily Metrics from CSV
          </button>
          <Link href="/imports" className="whitespace-nowrap text-sm font-medium text-indigo-600 hover:underline dark:text-indigo-400">
            Import History →
          </Link>
          <a href="/marketing" className="whitespace-nowrap text-sm font-medium text-indigo-600 hover:underline dark:text-indigo-400">
            Marketing Dashboard →
          </a>
        </div>
      </div>

      {channel && (
        <p className="text-sm text-zinc-500 dark:text-zinc-400">
          Filtered to <span className="font-medium text-zinc-700 dark:text-zinc-300">{CHANNEL_LABELS[channel as keyof typeof CHANNEL_LABELS] ?? channel}</span>{" "}
          — <Link href="/campaigns" className="text-indigo-600 hover:underline dark:text-indigo-400">clear filter</Link>
        </p>
      )}

      <DataTable<CampaignRow>
        key={channel ?? "all"}
        fetchUrl={fetchUrl}
        searchPlaceholder="Search by campaign name…"
        newHref="/campaigns/new"
        newLabel="New Campaign"
        rowHref={(row) => `/campaigns/${row.id}`}
        refreshKey={refreshKey}
        statusFilter={{
          options: Object.entries(STATUS_LABELS).map(([value, label]) => ({ value, label })),
        }}
        columns={[
          { key: "campaignNumber", header: "Campaign #", sortable: true },
          { key: "name", header: "Name", sortable: true },
          { key: "channel", header: "Channel", sortable: true, render: (row) => CHANNEL_LABELS[row.channel] ?? row.channel },
          { key: "budget", header: "Budget", sortable: true, render: (row) => `₹${Number(row.budget).toLocaleString()}` },
          { key: "spend", header: "Spend", render: (row) => `₹${row.metrics.spend.toLocaleString()}` },
          { key: "leads", header: "Leads", render: (row) => row.metrics.leads },
          { key: "customers", header: "Customers", render: (row) => row.metrics.customers },
          { key: "revenue", header: "Revenue", render: (row) => `₹${row.metrics.revenue.toLocaleString()}` },
          { key: "status", header: "Status", sortable: true, render: (row) => STATUS_LABELS[row.status] ?? row.status },
          { key: "approvalStatus", header: "Approval", sortable: true, render: (row) => APPROVAL_LABELS[row.approvalStatus] ?? row.approvalStatus },
        ]}
      />

      <CsvImportModal
        key={importKey}
        open={importOpen}
        onClose={() => setImportOpen(false)}
        importType="CAMPAIGN_DAILY_METRIC"
        title="Import Campaign Daily Metrics from CSV"
        onImported={() => setRefreshKey((k) => k + 1)}
      />
    </div>
  );
}
