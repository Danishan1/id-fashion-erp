"use client";

import { useState } from "react";
import { SimpleLookupManager } from "@/components/ui/SimpleLookupManager";
import { Breadcrumb } from "@/components/ui/Breadcrumb";
import { useSubmoduleVisibility } from "@/lib/use-submodule-visibility";
import type { SubmoduleKey } from "@/config/submodule-registry";

const TABS = ["GSM", "Dye", "Weave Type", "Width", "Composition"] as const;
type Tab = (typeof TABS)[number];

const TAB_SUBMODULE_KEY: Record<Tab, SubmoduleKey> = {
  GSM: "FABRIC_GSM",
  Dye: "FABRIC_DYE",
  "Weave Type": "FABRIC_WEAVE_TYPE",
  Width: "FABRIC_WIDTH",
  Composition: "FABRIC_COMPOSITION",
};

export function FabricConfigClient() {
  const isVisible = useSubmoduleVisibility();
  const visibleTabs = TABS.filter((t) => isVisible(TAB_SUBMODULE_KEY[t]));
  // Derived, not effect-based, so "the currently-open tab just got hidden"
  // never needs a useEffect + setState round-trip — manualTab only ever
  // reflects an explicit click, and falls back to the first visible tab
  // whenever it isn't (or is no longer) a visible one.
  const [manualTab, setManualTab] = useState<Tab | null>(null);
  const tab = manualTab && visibleTabs.includes(manualTab) ? manualTab : visibleTabs[0];

  return (
    <div className="space-y-4">
      <div>
        <Breadcrumb items={[{ label: "Masters", href: "/masters" }, { label: "Fabric Configuration" }]} />
        <h1 className="mt-2 text-lg font-semibold text-zinc-900 dark:text-zinc-50">Fabric Configuration</h1>
        <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">
          Fabric-specific attribute masters (GSM, dye, weave type, width, composition) imported from Royal Jeans —
          describe fabric-category raw materials in the Materials master.
        </p>
      </div>

      {visibleTabs.length === 0 ? (
        <p className="text-sm text-zinc-500 dark:text-zinc-400">
          All fabric attribute types are hidden for this company. A Super Admin can re-enable them under
          Admin → Module Visibility.
        </p>
      ) : (
        <>
          <div className="flex flex-wrap gap-1 border-b border-zinc-200 dark:border-zinc-800">
            {visibleTabs.map((t) => (
              <button
                key={t}
                onClick={() => setManualTab(t)}
                className={`px-3 py-2 text-sm font-medium ${
                  tab === t
                    ? "border-b-2 border-indigo-600 text-indigo-600"
                    : "text-zinc-500 hover:text-zinc-700 dark:hover:text-zinc-300"
                }`}
              >
                {t}
              </button>
            ))}
          </div>

          {tab === "GSM" && (
            <SimpleLookupManager
              fetchUrl="/api/v1/fabric-gsms"
              entityLabel="GSM"
              fields={[
                { key: "code", label: "Code", required: true },
                { key: "name", label: "Name", required: true },
              ]}
            />
          )}
          {tab === "Dye" && (
            <SimpleLookupManager
              fetchUrl="/api/v1/fabric-dyes"
              entityLabel="Dye"
              fields={[
                { key: "code", label: "Code", required: true },
                { key: "name", label: "Name", required: true },
                { key: "pantone", label: "Pantone", placeholder: "e.g. 19-4052 TCX" },
              ]}
            />
          )}
          {tab === "Weave Type" && (
            <SimpleLookupManager
              fetchUrl="/api/v1/fabric-weave-types"
              entityLabel="Weave Type"
              fields={[
                { key: "code", label: "Code", required: true },
                { key: "name", label: "Name", required: true },
              ]}
            />
          )}
          {tab === "Width" && (
            <SimpleLookupManager
              fetchUrl="/api/v1/fabric-widths"
              entityLabel="Width"
              fields={[
                { key: "code", label: "Code", required: true },
                { key: "name", label: "Name", required: true },
                { key: "unit", label: "Unit", placeholder: "cm" },
              ]}
            />
          )}
          {tab === "Composition" && (
            <SimpleLookupManager
              fetchUrl="/api/v1/fabric-compositions"
              entityLabel="Composition"
              fields={[
                { key: "code", label: "Code", required: true },
                { key: "name", label: "Name", required: true },
              ]}
            />
          )}
        </>
      )}
    </div>
  );
}
