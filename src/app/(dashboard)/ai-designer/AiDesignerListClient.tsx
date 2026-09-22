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

interface Props {
  title?: string;
  description?: string;
  /** Includes any query string (e.g. `?creationMode=SKETCH`) — DataTable preserves it alongside its own page/search/sort params. */
  fetchUrl?: string;
  newHref?: string;
  newLabel?: string;
  rowHrefBase?: string;
}

/**
 * Shared list-page body for AI Designer's own sub-modules — Catalogue
 * Designs (STANDARD projects) and Sketch to Garment (SKETCH projects) are
 * both real, separate modules with their own routes/list pages now, but
 * show the identical project-row shape, so this one component is reused
 * with different props rather than duplicated. Replicate Design is a
 * genuinely different project shape (its own schema entirely) and has its
 * own list client, never this one.
 */
export function AiDesignerListClient({
  title = "AI Designer",
  description = "Generate premium fashion catalogue visuals from a fabric — pick from the Fabric Master or upload a " +
    "new fabric photo, choose the customer/product/design/model/environment, and let AI build the " +
    "design image. A genuinely separate module from AI Garment Flow — its own isolated project records, " +
    "never shared with that module.",
  fetchUrl = "/api/v1/ai-designer/projects?creationMode=STANDARD",
  newHref = "/ai-designer/catalogue-designs/new",
  newLabel = "New Design",
  rowHrefBase = "/ai-designer/catalogue-designs",
}: Props) {
  return (
    <div className="space-y-4">
      <Breadcrumb
        items={
          title === "AI Designer"
            ? [{ label: "Dashboard", href: "/dashboard" }, { label: "AI Designer" }]
            : [{ label: "Dashboard", href: "/dashboard" }, { label: "AI Designer", href: "/ai-designer" }, { label: title }]
        }
      />
      <div>
        <h1 className="text-lg font-semibold text-zinc-900 dark:text-zinc-50">{title}</h1>
        <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">{description}</p>
      </div>

      <DataTable<AiDesignerProjectRow>
        fetchUrl={fetchUrl}
        searchPlaceholder="Search by design name…"
        newHref={newHref}
        newLabel={newLabel}
        rowHref={(row) => `${rowHrefBase}/${row.id}`}
        statusFilter={{
          options: Object.entries(STATUS_LABELS).map(([value, label]) => ({ value, label })),
        }}
        columns={[
          { key: "projectNumber", header: "Design #", sortable: true },
          { key: "projectName", header: "Design Name", sortable: true },
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
            sortable: true,
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
