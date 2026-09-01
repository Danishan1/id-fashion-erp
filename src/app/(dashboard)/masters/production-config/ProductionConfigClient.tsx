"use client";

import { useState } from "react";
import { SimpleLookupManager } from "@/components/ui/SimpleLookupManager";
import { Breadcrumb } from "@/components/ui/Breadcrumb";

const TABS = ["Stages", "Lines", "Machines"] as const;
type Tab = (typeof TABS)[number];

export function ProductionConfigClient() {
  const [tab, setTab] = useState<Tab>("Stages");

  return (
    <div className="space-y-4">
      <div>
        <Breadcrumb items={[{ label: "Masters", href: "/masters" }, { label: "Production Stages, Lines & Machines" }]} />
        <h1 className="mt-2 text-lg font-semibold text-zinc-900 dark:text-zinc-50">Production Stages, Lines &amp; Machines</h1>
        <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">
          Configurable production stages (Cutting, Sewing, Finishing, …), factory lines/work centers, and individual
          machines assigned to a line — used to plan and track production in Phase 5.
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
          entityLabel="Production Stage"
          fields={[
            { key: "code", label: "Code", required: true },
            { key: "name", label: "Name", required: true },
            { key: "sequence", label: "Sequence", type: "number" },
            {
              key: "isFinal",
              label: "Final Stage (triggers Finished Goods receipt)",
              type: "select",
              options: [
                { value: "false", label: "No" },
                { value: "true", label: "Yes" },
              ],
            },
            {
              key: "allowRework",
              label: "Allow Rework Into This Stage",
              type: "select",
              options: [
                { value: "true", label: "Yes" },
                { value: "false", label: "No" },
              ],
            },
          ]}
        />
      )}
      {tab === "Lines" && (
        <SimpleLookupManager
          fetchUrl="/api/v1/production-lines"
          entityLabel="Production Line"
          fields={[
            { key: "code", label: "Code", required: true },
            { key: "name", label: "Name", required: true },
            { key: "capacityPerDay", label: "Capacity/Day", type: "number" },
          ]}
        />
      )}
      {tab === "Machines" && (
        <SimpleLookupManager
          fetchUrl="/api/v1/machines"
          entityLabel="Machine"
          fields={[
            { key: "code", label: "Code", required: true },
            { key: "name", label: "Name", required: true },
            { key: "machineType", label: "Machine Type", placeholder: "e.g. Single Needle, Overlock" },
            {
              key: "productionLineId",
              label: "Production Line",
              type: "select",
              optionsUrl: "/api/v1/production-lines",
            },
          ]}
          displayColumns={[
            { key: "code", header: "Code" },
            { key: "name", header: "Name" },
            { key: "machineType", header: "Type" },
          ]}
        />
      )}
    </div>
  );
}
