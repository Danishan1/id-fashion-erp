"use client";

import { Breadcrumb } from "@/components/ui/Breadcrumb";
import { DataTable } from "@/components/ui/DataTable";
import { STATUS_BADGE_CLASS, STATUS_LABELS, STEP_LABELS } from "./statusLabels";

interface ReplicateDesignProjectRow {
  id: string;
  projectNumber: string;
  projectName: string;
  status: keyof typeof STATUS_LABELS;
  currentStep: string;
  fabricProduct: { styleName: string; styleCode: string } | null;
  fabricSource: string | null;
  createdBy: { fullName: string } | null;
  _count: { versions: number };
}

export function ReplicateDesignListClient() {
  return (
    <div className="space-y-4">
      <Breadcrumb items={[{ label: "Dashboard", href: "/dashboard" }, { label: "AI Designer", href: "/ai-designer" }, { label: "Replicate Design" }]} />
      <div>
        <h1 className="text-lg font-semibold text-zinc-900 dark:text-zinc-50">Replicate Design</h1>
        <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">
          Upload a photo of an existing garment, let AI extract and lock its structural &quot;Design DNA,&quot;
          then regenerate the same garment using one of the company&apos;s own fabrics/raw materials. A
          separate flow from the guided fashion-catalogue wizard above — its own isolated project records.
        </p>
      </div>

      <DataTable<ReplicateDesignProjectRow>
        fetchUrl="/api/v1/ai-designer/replicate-projects"
        searchPlaceholder="Search by project name…"
        newHref="/ai-designer/replicate/new"
        newLabel="New Project"
        rowHref={(row) => `/ai-designer/replicate/${row.id}`}
        columns={[
          { key: "projectNumber", header: "Project #" },
          { key: "projectName", header: "Project Name" },
          {
            key: "fabric",
            header: "Fabric",
            render: (row) => row.fabricProduct?.styleName ?? (row.fabricSource === "UPLOADED" ? "Uploaded photo" : "—"),
          },
          {
            key: "currentStep",
            header: "Current Step",
            render: (row) => STEP_LABELS[row.currentStep] ?? row.currentStep,
          },
          {
            key: "status",
            header: "Status",
            render: (row) => (
              <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${STATUS_BADGE_CLASS[row.status]}`}>
                {STATUS_LABELS[row.status] ?? row.status}
              </span>
            ),
          },
          { key: "versions", header: "Versions", render: (row) => row._count.versions },
          { key: "createdBy", header: "Created By", render: (row) => row.createdBy?.fullName ?? "—" },
        ]}
      />
    </div>
  );
}
