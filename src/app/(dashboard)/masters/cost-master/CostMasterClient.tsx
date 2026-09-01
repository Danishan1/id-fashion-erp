"use client";

import { SimpleLookupManager } from "@/components/ui/SimpleLookupManager";
import { Breadcrumb } from "@/components/ui/Breadcrumb";

export function CostMasterClient() {
  return (
    <div className="space-y-4">
      <div>
        <Breadcrumb items={[{ label: "Masters", href: "/masters" }, { label: "Cost Master" }]} />
        <h1 className="mt-2 text-lg font-semibold text-zinc-900 dark:text-zinc-50">Cost Master</h1>
        <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">
          Overhead cost rates (hourly, monthly, per-unit, fixed) — imported from the Inventory reference system,
          used for costing BOM/production overheads.
        </p>
      </div>

      <SimpleLookupManager
        fetchUrl="/api/v1/cost-masters"
        entityLabel="Cost Rate"
        fields={[
          { key: "code", label: "Code", required: true },
          { key: "name", label: "Name", required: true },
          {
            key: "type",
            label: "Type",
            type: "select",
            required: true,
            options: [
              { value: "HOURLY", label: "Hourly" },
              { value: "MONTHLY", label: "Monthly" },
              { value: "PER_UNIT", label: "Per Unit" },
              { value: "FIXED", label: "Fixed" },
            ],
          },
          { key: "rate", label: "Rate", type: "number", required: true },
        ]}
      />
    </div>
  );
}
