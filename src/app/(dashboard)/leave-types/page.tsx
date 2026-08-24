"use client";

import { Breadcrumb } from "@/components/ui/Breadcrumb";
import { SimpleLookupManager } from "@/components/ui/SimpleLookupManager";

export default function LeaveTypesPage() {
  return (
    <div className="space-y-4">
      <Breadcrumb items={[{ label: "Dashboard", href: "/dashboard" }, { label: "Leave Types" }]} />
      <div>
        <h1 className="text-lg font-semibold text-zinc-900 dark:text-zinc-50">Leave Types</h1>
        <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">
          Annual leave quota per type — used to compute each employee&apos;s remaining balance when approving a request.
        </p>
      </div>

      <SimpleLookupManager
        fetchUrl="/api/v1/leave-types"
        fields={[
          { key: "name", label: "Name", required: true },
          { key: "annualDays", label: "Annual Days", type: "number", required: true },
        ]}
      />
    </div>
  );
}
