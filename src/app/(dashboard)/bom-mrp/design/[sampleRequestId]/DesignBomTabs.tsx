"use client";

import { useState } from "react";
import { BomVersionPanel } from "../../[productId]/BomVersionPanel";
import { BomEditor } from "../../BomEditor";
import { DesignBomMaterialsPanel } from "./DesignBomMaterialsPanel";

interface DesignMaterialRow {
  id: string;
  plannedQuantity: string;
  notes: string | null;
  material: { id: string; styleName: string; styleCode: string };
  color: { id: string; name: string; hexValue: string | null } | null;
  dye: { id: string; name: string; pantone: string | null } | null;
  uom: { id: string; code: string; name: string } | null;
}

interface StyleBomVersionRow {
  id: string;
  versionNumber: number;
  status: "DRAFT" | "APPROVED" | "SUPERSEDED";
  notes: string | null;
  createdAt: string;
  createdBy: { fullName: string };
  approvedAt: string | null;
  approvedBy: { fullName: string } | null;
  items: unknown[];
}

interface StyleBomItemInput {
  materialId: string;
  colorId: string | null;
  quantityPerUnit: string;
  wastagePercentage: string;
  uomId: string;
  notes: string | null;
}

// The one place a design's "sample BOM" (its own SampleMaterial list) and
// its real Style BOM (once linked) are shown together — neither view
// duplicates the other's logic: the Design BOM tab renders
// DesignBomMaterialsPanel (edits through Sampling's own existing material
// update/remove endpoints — the same ones SampleWorkflowPanel's own
// Edit/Remove actions call), and the Style BOM tab reuses
// BomVersionPanel/BomEditor completely unchanged, the exact same
// components the dedicated /bom-mrp/[productId] page renders.
export function DesignBomTabs({
  productId,
  styleLabel,
  materials,
  canEditMaterials,
  styleBomVersions,
  styleBomCurrentVersionNumber,
  canApproveBom,
  initialStyleNotes,
  initialStyleItems,
  isStyleVersionLocked,
}: {
  productId: string | null;
  styleLabel: string | null;
  materials: DesignMaterialRow[];
  canEditMaterials: boolean;
  styleBomVersions: StyleBomVersionRow[];
  styleBomCurrentVersionNumber: number;
  canApproveBom: boolean;
  initialStyleNotes: string;
  initialStyleItems: StyleBomItemInput[];
  isStyleVersionLocked: boolean;
}) {
  const [tab, setTab] = useState<"design" | "style">("design");

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-1 border-b border-zinc-200 dark:border-zinc-800">
        <button
          type="button"
          onClick={() => setTab("design")}
          className={`px-3 py-2 text-sm font-medium ${
            tab === "design"
              ? "border-b-2 border-indigo-600 text-indigo-600"
              : "text-zinc-500 hover:text-zinc-700 dark:hover:text-zinc-300"
          }`}
        >
          Design BOM
        </button>
        {productId ? (
          <button
            type="button"
            onClick={() => setTab("style")}
            className={`px-3 py-2 text-sm font-medium ${
              tab === "style"
                ? "border-b-2 border-indigo-600 text-indigo-600"
                : "text-zinc-500 hover:text-zinc-700 dark:hover:text-zinc-300"
            }`}
          >
            Style BOM{styleLabel ? ` — ${styleLabel}` : ""}
          </button>
        ) : (
          <span
            className="cursor-not-allowed px-3 py-2 text-sm font-medium text-zinc-400 dark:text-zinc-600"
            title="This design has not been converted to a Style yet."
          >
            Style BOM
          </span>
        )}
      </div>

      {tab === "design" && <DesignBomMaterialsPanel materials={materials} canEditMaterials={canEditMaterials} />}

      {tab === "style" && productId && (
        <div className="space-y-4">
          <BomVersionPanel
            key={productId}
            productId={productId}
            versions={styleBomVersions}
            currentVersionNumber={styleBomCurrentVersionNumber}
            canApprove={canApproveBom}
          />
          <BomEditor
            key={`editor-${productId}`}
            productId={productId}
            initialNotes={initialStyleNotes}
            initialItems={initialStyleItems}
            isCurrentVersionLocked={isStyleVersionLocked}
            currentVersionNumber={styleBomCurrentVersionNumber}
          />
        </div>
      )}
    </div>
  );
}
