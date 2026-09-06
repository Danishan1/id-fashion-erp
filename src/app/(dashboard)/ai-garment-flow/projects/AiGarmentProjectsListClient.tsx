"use client";

import { Breadcrumb } from "@/components/ui/Breadcrumb";
import { DataTable } from "@/components/ui/DataTable";
import { STATUS_LABELS, STATUS_BADGE_CLASS, SOURCE_TYPE_LABELS } from "../statusLabels";

interface ProjectRow {
  id: string;
  projectNumber: string;
  projectName: string;
  sourceType: keyof typeof SOURCE_TYPE_LABELS;
  status: keyof typeof STATUS_LABELS;
  createdAt: string;
  buyer: { name: string } | null;
  customer: { name: string } | null;
  brand: { name: string } | null;
  season: { name: string } | null;
  createdBy: { fullName: string } | null;
}

export function AiGarmentProjectsListClient() {
  return (
    <div className="space-y-4">
      <Breadcrumb items={[{ label: "Dashboard", href: "/dashboard" }, { label: "AI Garment Flow", href: "/ai-garment-flow" }, { label: "Projects" }]} />
      <div>
        <h1 className="text-lg font-semibold text-zinc-900 dark:text-zinc-50">AI Garment Flow Projects</h1>
        <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">
          Every product-development project started from a reference or a fabric swatch — resumable at any stage.
        </p>
      </div>

      <DataTable<ProjectRow>
        fetchUrl="/api/v1/ai-garment-projects"
        searchPlaceholder="Search by project number or name…"
        newHref="/ai-garment-flow/projects/new?source=REFERENCE"
        newLabel="New Project"
        rowHref={(row) => `/ai-garment-flow/projects/${row.id}`}
        columns={[
          { key: "projectNumber", header: "Project #" },
          { key: "projectName", header: "Project" },
          { key: "sourceType", header: "Source", render: (row) => SOURCE_TYPE_LABELS[row.sourceType] ?? row.sourceType },
          { key: "buyer", header: "Buyer / Customer", render: (row) => row.buyer?.name ?? row.customer?.name ?? "—" },
          { key: "brand", header: "Brand", render: (row) => row.brand?.name ?? "—" },
          { key: "season", header: "Season", render: (row) => row.season?.name ?? "—" },
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
          { key: "createdAt", header: "Created", render: (row) => new Date(row.createdAt).toLocaleDateString() },
        ]}
      />
    </div>
  );
}
