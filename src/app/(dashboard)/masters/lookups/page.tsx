"use client";

import { useState } from "react";
import { SimpleLookupManager } from "@/components/ui/SimpleLookupManager";
import { Breadcrumb } from "@/components/ui/Breadcrumb";

const TABS = ["Colors", "Sizes", "Units"] as const;
type Tab = (typeof TABS)[number];

export default function LookupsPage() {
  const [tab, setTab] = useState<Tab>("Colors");

  return (
    <div className="space-y-4">
      <div>
        <Breadcrumb items={[{ label: "Masters", href: "/masters" }, { label: "Colors, Sizes & Units" }]} />
        <h1 className="mt-2 text-lg font-semibold text-zinc-900 dark:text-zinc-50">Colors, Sizes & Units</h1>
        <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">Shared lookup values used across styles and production.</p>
      </div>

      <div className="flex gap-1 border-b border-zinc-200 dark:border-zinc-800">
        {TABS.map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
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

      {tab === "Colors" && (
        <SimpleLookupManager
          fetchUrl="/api/v1/colors"
          fields={[
            { key: "code", label: "Code", required: true },
            { key: "name", label: "Name", required: true },
            { key: "hexValue", label: "Hex", placeholder: "#RRGGBB" },
          ]}
        />
      )}
      {tab === "Sizes" && (
        <SimpleLookupManager
          fetchUrl="/api/v1/sizes"
          fields={[
            { key: "code", label: "Code", required: true },
            { key: "name", label: "Name", required: true },
            { key: "sortOrder", label: "Sort Order", type: "number" },
          ]}
        />
      )}
      {tab === "Units" && (
        <SimpleLookupManager
          fetchUrl="/api/v1/units"
          hasActiveToggle={false}
          fields={[
            { key: "code", label: "Code", required: true },
            { key: "name", label: "Name", required: true },
            { key: "conversionFactor", label: "Conversion Factor", type: "number" },
          ]}
        />
      )}
    </div>
  );
}
