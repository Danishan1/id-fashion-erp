"use client";

import { useState } from "react";
import { SimpleLookupManager } from "@/components/ui/SimpleLookupManager";
import { Breadcrumb } from "@/components/ui/Breadcrumb";

const TABS = ["GSM", "Dye", "Dye Type", "Weave Type", "Width", "Composition"] as const;
type Tab = (typeof TABS)[number];

export function FabricConfigClient() {
  const [tab, setTab] = useState<Tab>("GSM");

  return (
    <div className="space-y-4">
      <div>
        <Breadcrumb items={[{ label: "Masters", href: "/masters" }, { label: "Fabric Configuration" }]} />
        <h1 className="mt-2 text-lg font-semibold text-zinc-900 dark:text-zinc-50">Fabric Configuration</h1>
        <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">
          Fabric-specific attribute masters (GSM, dye, dye type, weave type, width, composition) imported from Royal Jeans —
          describe fabric-category raw materials in the Materials master.
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
      {tab === "Dye Type" && (
        <SimpleLookupManager
          fetchUrl="/api/v1/fabric-dye-types"
          entityLabel="Dye Type"
          fields={[
            { key: "code", label: "Code", required: true },
            { key: "name", label: "Name", required: true },
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
            { key: "unitId", label: "Unit", type: "select", optionsUrl: "/api/v1/units" },
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
    </div>
  );
}
