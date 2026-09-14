"use client";

import { useState } from "react";
import { BomEditor } from "../BomEditor";
import { BomVersionPanel } from "./BomVersionPanel";
import { BomCostSheetPanel } from "./BomCostSheetPanel";

const TABS = ["Edit BOM", "Cost Sheet"] as const;
type Tab = (typeof TABS)[number];

interface LineItem {
  materialId: string;
  colorId: string | null;
  quantityPerUnit: string;
  wastagePercentage: string;
  uomId: string;
  notes: string | null;
}

interface BomVersionSummary {
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

export function BomDetailTabs({
  productId,
  versions,
  currentVersionNumber,
  canApprove,
  initialNotes,
  initialItems,
  isCurrentVersionLocked,
}: {
  productId: string;
  versions: BomVersionSummary[];
  currentVersionNumber: number;
  canApprove: boolean;
  initialNotes: string;
  initialItems: LineItem[];
  isCurrentVersionLocked: boolean;
}) {
  const [tab, setTab] = useState<Tab>("Edit BOM");

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-1 border-b border-zinc-200 dark:border-zinc-800">
        {TABS.map((t) => (
          <button
            key={t}
            type="button"
            onClick={() => setTab(t)}
            className={`px-3 py-2 text-sm font-medium ${
              tab === t ? "border-b-2 border-indigo-600 text-indigo-600" : "text-zinc-500 hover:text-zinc-700 dark:hover:text-zinc-300"
            }`}
          >
            {t}
          </button>
        ))}
      </div>

      {tab === "Edit BOM" && (
        <div className="space-y-4">
          <BomVersionPanel
            productId={productId}
            versions={versions}
            currentVersionNumber={currentVersionNumber}
            canApprove={canApprove}
          />
          <BomEditor
            productId={productId}
            initialNotes={initialNotes}
            initialItems={initialItems}
            isCurrentVersionLocked={isCurrentVersionLocked}
            currentVersionNumber={currentVersionNumber}
          />
        </div>
      )}
      {tab === "Cost Sheet" && <BomCostSheetPanel productId={productId} />}
    </div>
  );
}
