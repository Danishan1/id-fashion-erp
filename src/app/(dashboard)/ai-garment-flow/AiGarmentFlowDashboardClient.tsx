"use client";

import Link from "next/link";
import { Breadcrumb } from "@/components/ui/Breadcrumb";
import { DataTable } from "@/components/ui/DataTable";
import { STATUS_LABELS, STATUS_BADGE_CLASS, SOURCE_TYPE_LABELS } from "./statusLabels";

interface ProjectRow {
  id: string;
  projectNumber: string;
  projectName: string;
  sourceType: keyof typeof SOURCE_TYPE_LABELS;
  status: keyof typeof STATUS_LABELS;
  updatedAt: string;
  buyer: { name: string } | null;
  customer: { name: string } | null;
  createdBy: { fullName: string } | null;
}

const ACTION_CARDS = [
  {
    source: "REFERENCE",
    title: "Start From Reference",
    description:
      "Upload a garment photograph, buyer reference, old style or inspiration image and develop new commercially differentiated garment directions.",
  },
  {
    source: "FABRIC",
    title: "Start From Fabric",
    description: "Upload a fabric swatch and identify suitable garment opportunities and design directions.",
  },
] as const;

export function AiGarmentFlowDashboardClient() {
  return (
    <div className="space-y-6">
      <Breadcrumb items={[{ label: "Dashboard", href: "/dashboard" }, { label: "AI Garment Flow" }]} />

      <div>
        <h1 className="text-xl font-semibold text-zinc-900 dark:text-zinc-50">AI Garment Flow</h1>
        <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">
          From Fabric &amp; Design to Sampling, Costing, Production, Profit &amp; Beyond.
        </p>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        {ACTION_CARDS.map((card) => (
          <Link
            key={card.source}
            href={`/ai-garment-flow/projects/new?source=${card.source}`}
            className="block rounded-lg border border-zinc-200 bg-white p-5 shadow-sm transition hover:border-indigo-400 hover:shadow-md dark:border-zinc-800 dark:bg-zinc-900"
          >
            <h2 className="text-base font-semibold text-zinc-900 dark:text-zinc-50">{card.title}</h2>
            <p className="mt-2 text-sm text-zinc-500 dark:text-zinc-400">{card.description}</p>
          </Link>
        ))}
      </div>

      <div>
        <h2 className="text-sm font-semibold text-zinc-900 dark:text-zinc-50">Recent Projects</h2>
        <div className="mt-2">
          <DataTable<ProjectRow>
            fetchUrl="/api/v1/ai-garment-projects?sortBy=updatedAt&sortOrder=desc&pageSize=10"
            searchPlaceholder="Search by project number or name…"
            rowHref={(row) => `/ai-garment-flow/projects/${row.id}`}
            columns={[
              { key: "projectNumber", header: "Project #" },
              { key: "projectName", header: "Project" },
              { key: "sourceType", header: "Source", render: (row) => SOURCE_TYPE_LABELS[row.sourceType] ?? row.sourceType },
              { key: "buyer", header: "Buyer", render: (row) => row.buyer?.name ?? row.customer?.name ?? "—" },
              {
                key: "status",
                header: "Stage / Status",
                render: (row) => (
                  <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${STATUS_BADGE_CLASS[row.status]}`}>
                    {STATUS_LABELS[row.status] ?? row.status}
                  </span>
                ),
              },
              { key: "createdBy", header: "Created By", render: (row) => row.createdBy?.fullName ?? "—" },
              { key: "updatedAt", header: "Last Updated", render: (row) => new Date(row.updatedAt).toLocaleString() },
            ]}
          />
        </div>
      </div>
    </div>
  );
}
