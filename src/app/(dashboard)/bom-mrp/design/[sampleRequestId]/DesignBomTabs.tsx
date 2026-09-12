"use client";

import { useState } from "react";
import { BomVersionPanel } from "../../[productId]/BomVersionPanel";
import { BomEditor } from "../../BomEditor";

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
// duplicates the other's logic: the Design BOM tab is a plain read-only
// table over data already fetched for the Sample detail page, and the
// Style BOM tab reuses BomVersionPanel/BomEditor completely unchanged, the
// exact same components the dedicated /bom-mrp/[productId] page renders.
export function DesignBomTabs({
  productId,
  styleLabel,
  materials,
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

      {tab === "design" && <DesignBomTable materials={materials} />}

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

function DesignBomTable({ materials }: { materials: DesignMaterialRow[] }) {
  if (materials.length === 0) {
    return (
      <p className="rounded-lg border border-zinc-200 p-4 text-sm text-zinc-500 dark:border-zinc-800 dark:text-zinc-400">
        No materials recorded on this design&rsquo;s current sample version yet.
      </p>
    );
  }

  return (
    <div className="overflow-x-auto rounded-lg border border-zinc-200 dark:border-zinc-800">
      <table className="min-w-full divide-y divide-zinc-200 text-sm dark:divide-zinc-800">
        <thead>
          <tr>
            <th className="px-3 py-2 text-left font-medium text-zinc-500 dark:text-zinc-400">Material</th>
            <th className="px-3 py-2 text-left font-medium text-zinc-500 dark:text-zinc-400">Color</th>
            <th className="px-3 py-2 text-left font-medium text-zinc-500 dark:text-zinc-400">Shade / Pantone</th>
            <th className="px-3 py-2 text-left font-medium text-zinc-500 dark:text-zinc-400">Quantity</th>
            <th className="px-3 py-2 text-left font-medium text-zinc-500 dark:text-zinc-400">Unit</th>
            <th className="px-3 py-2 text-left font-medium text-zinc-500 dark:text-zinc-400">Notes</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-zinc-100 dark:divide-zinc-800">
          {materials.map((m) => (
            <tr key={m.id}>
              <td className="px-3 py-2 font-medium text-zinc-900 dark:text-zinc-50">
                {m.material.styleName} <span className="text-xs text-zinc-400">({m.material.styleCode})</span>
              </td>
              <td className="px-3 py-2 text-zinc-700 dark:text-zinc-300">
                {m.color ? (
                  <span className="inline-flex items-center gap-1.5">
                    {m.color.hexValue && (
                      <span
                        className="inline-block h-3 w-3 rounded-full border border-zinc-300 dark:border-zinc-700"
                        style={{ backgroundColor: m.color.hexValue }}
                      />
                    )}
                    {m.color.name}
                  </span>
                ) : (
                  "—"
                )}
              </td>
              <td className="px-3 py-2 text-zinc-700 dark:text-zinc-300">
                {m.dye ? `${m.dye.name}${m.dye.pantone ? ` (${m.dye.pantone})` : ""}` : "—"}
              </td>
              <td className="px-3 py-2 text-zinc-700 dark:text-zinc-300">{m.plannedQuantity}</td>
              <td className="px-3 py-2 text-zinc-700 dark:text-zinc-300">{m.uom?.code ?? "—"}</td>
              <td className="px-3 py-2 text-zinc-600 dark:text-zinc-400">{m.notes ?? "—"}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
