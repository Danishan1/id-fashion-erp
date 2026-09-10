"use client";

import { Breadcrumb } from "@/components/ui/Breadcrumb";
import { DataTable } from "@/components/ui/DataTable";
import { STATUS_BADGE_CLASS, STATUS_LABELS, WIZARD_STEP_LABELS } from "./statusLabels";

interface AiDesignerProjectRow {
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

export function AiDesignerListClient() {
  return (
    <div className="space-y-4">
      <Breadcrumb items={[{ label: "Dashboard", href: "/dashboard" }, { label: "AI Designer" }]} />
      <div>
        <h1 className="text-lg font-semibold text-zinc-900 dark:text-zinc-50">AI Designer</h1>
        <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">
          Generate premium fashion catalogue visuals from a fabric — pick from the Fabric Master or upload a
          new fabric photo, choose the customer/product/design/model/environment, and let AI build the
          design image. A genuinely separate module from AI Garment Flow — its own isolated project records,
          never shared with that module.
        </p>
      </div>

      <DataTable<AiDesignerProjectRow>
        fetchUrl="/api/v1/ai-designer/projects"
        searchPlaceholder="Search by project name…"
        newHref="/ai-designer/projects/new"
        newLabel="New Project"
        rowHref={(row) => `/ai-designer/projects/${row.id}`}
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
            render: (row) => WIZARD_STEP_LABELS[row.currentStep] ?? row.currentStep,
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
