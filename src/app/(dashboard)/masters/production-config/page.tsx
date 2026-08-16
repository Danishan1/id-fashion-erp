"use client";

import { useState } from "react";
import { SimpleLookupManager } from "@/components/ui/SimpleLookupManager";

const TABS = ["Stages", "Lines"] as const;
type Tab = (typeof TABS)[number];

export default function ProductionConfigPage() {
  const [tab, setTab] = useState<Tab>("Stages");

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-lg font-semibold text-zinc-900 dark:text-zinc-50">Production Stages &amp; Lines</h1>
        <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">
          Configurable production stages (Cutting, Sewing, Finishing, …) and factory lines/work centers used to plan
          and track production in Phase 5.
        </p>
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

      {tab === "Stages" && (
        <SimpleLookupManager
          fetchUrl="/api/v1/production-stages"
          fields={[
            { key: "code", label: "Code", required: true },
            { key: "name", label: "Name", required: true },
            { key: "sequence", label: "Sequence", type: "number" },
          ]}
        />
      )}
      {tab === "Lines" && (
        <SimpleLookupManager
          fetchUrl="/api/v1/production-lines"
          fields={[
            { key: "code", label: "Code", required: true },
            { key: "name", label: "Name", required: true },
            { key: "capacityPerDay", label: "Capacity/Day", type: "number" },
          ]}
        />
      )}
    </div>
  );
}
