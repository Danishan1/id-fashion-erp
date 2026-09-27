"use client";

import { useState } from "react";
import { SimpleLookupManager } from "@/components/ui/SimpleLookupManager";
import { Breadcrumb } from "@/components/ui/Breadcrumb";

const TABS = ["Pipeline Stages", "Lead Sources", "Lost Reasons"] as const;
type Tab = (typeof TABS)[number];

const STAGE_KIND_OPTIONS = [
  { value: "OPEN", label: "Open (in progress)" },
  { value: "WON", label: "Won" },
  { value: "LOST", label: "Lost (requires a lost reason)" },
  { value: "DORMANT", label: "Dormant / follow later" },
];

const CODE_NAME_SORT_FIELDS = [
  { key: "code", label: "Code", required: true },
  { key: "name", label: "Name", required: true },
  { key: "sortOrder", label: "Sort Order", type: "number" as const },
];

export function CrmSettingsClient() {
  const [tab, setTab] = useState<Tab>("Pipeline Stages");

  return (
    <div className="space-y-4">
      <div>
        <Breadcrumb items={[{ label: "Dashboard", href: "/dashboard" }, { label: "CRM", href: "/crm" }, { label: "CRM Settings" }]} />
        <h1 className="mt-2 text-lg font-semibold text-zinc-900 dark:text-zinc-50">CRM Settings</h1>
        <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">
          Configure your own sales pipeline, lead sources and lost reasons. Stages can be renamed, reordered or added freely — every
          rule (Won/Lost handling, reports) works off a stage&apos;s <em>type</em>, never its name. A stage that currently holds leads
          cannot be deactivated or change type until its leads are moved.
        </p>
      </div>

      <div className="flex flex-wrap gap-1 border-b border-zinc-200 dark:border-zinc-800">
        {TABS.map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`px-3 py-2 text-sm font-medium ${
              tab === t ? "border-b-2 border-indigo-600 text-indigo-600" : "text-zinc-500 hover:text-zinc-700 dark:hover:text-zinc-300"
            }`}
          >
            {t}
          </button>
        ))}
      </div>

      {tab === "Pipeline Stages" && (
        <SimpleLookupManager
          fetchUrl="/api/v1/crm/pipeline-stages"
          entityLabel="Pipeline Stage"
          fields={[...CODE_NAME_SORT_FIELDS, { key: "kind", label: "Type", type: "select", required: true, options: STAGE_KIND_OPTIONS }]}
          displayColumns={[
            { key: "sortOrder", header: "Order" },
            { key: "code", header: "Code" },
            { key: "name", header: "Name" },
            { key: "kind", header: "Type" },
          ]}
        />
      )}
      {tab === "Lead Sources" && (
        <SimpleLookupManager
          fetchUrl="/api/v1/crm/lead-sources"
          entityLabel="Lead Source"
          fields={CODE_NAME_SORT_FIELDS}
          displayColumns={[
            { key: "sortOrder", header: "Order" },
            { key: "code", header: "Code" },
            { key: "name", header: "Name" },
          ]}
        />
      )}
      {tab === "Lost Reasons" && (
        <SimpleLookupManager
          fetchUrl="/api/v1/crm/lost-reasons"
          entityLabel="Lost Reason"
          fields={CODE_NAME_SORT_FIELDS}
          displayColumns={[
            { key: "sortOrder", header: "Order" },
            { key: "code", header: "Code" },
            { key: "name", header: "Name" },
          ]}
        />
      )}
    </div>
  );
}
