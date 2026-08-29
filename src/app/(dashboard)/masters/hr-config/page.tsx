"use client";

import { useState } from "react";
import { SimpleLookupManager } from "@/components/ui/SimpleLookupManager";
import { Breadcrumb } from "@/components/ui/Breadcrumb";

const TABS = ["Designations", "Employee Categories", "Shifts", "Holidays"] as const;
type Tab = (typeof TABS)[number];

export default function HrConfigPage() {
  const [tab, setTab] = useState<Tab>("Designations");

  return (
    <div className="space-y-4">
      <div>
        <Breadcrumb items={[{ label: "Masters", href: "/masters" }, { label: "HR Configuration" }]} />
        <h1 className="mt-2 text-lg font-semibold text-zinc-900 dark:text-zinc-50">HR Configuration</h1>
        <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">
          Designation, employee category, shift, and holiday masters — normalized here since neither reference
          system (HRMS, Inventory, Royal Jeans) had these as real tables.
        </p>
      </div>

      <div className="flex flex-wrap gap-1 border-b border-zinc-200 dark:border-zinc-800">
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

      {tab === "Designations" && (
        <SimpleLookupManager
          fetchUrl="/api/v1/designations"
          fields={[
            { key: "code", label: "Code", required: true },
            { key: "name", label: "Name", required: true },
            { key: "departmentId", label: "Department", type: "select", optionsUrl: "/api/v1/departments" },
          ]}
        />
      )}
      {tab === "Employee Categories" && (
        <SimpleLookupManager
          fetchUrl="/api/v1/employee-categories"
          fields={[
            { key: "code", label: "Code", required: true },
            { key: "name", label: "Name", required: true },
          ]}
        />
      )}
      {tab === "Shifts" && (
        <SimpleLookupManager
          fetchUrl="/api/v1/shift-masters"
          fields={[
            { key: "code", label: "Code", required: true },
            { key: "name", label: "Name", required: true },
            { key: "startTime", label: "Start Time", required: true, placeholder: "09:00" },
            { key: "endTime", label: "End Time", required: true, placeholder: "18:00" },
            { key: "graceMinutes", label: "Grace (minutes)", type: "number", placeholder: "0" },
          ]}
        />
      )}
      {tab === "Holidays" && (
        <SimpleLookupManager
          fetchUrl="/api/v1/holiday-masters"
          fields={[
            { key: "name", label: "Name", required: true },
            { key: "date", label: "Date", type: "date", required: true },
          ]}
        />
      )}
    </div>
  );
}
