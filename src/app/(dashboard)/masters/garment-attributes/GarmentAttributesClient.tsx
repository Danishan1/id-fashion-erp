"use client";

import { useState } from "react";
import { SimpleLookupManager } from "@/components/ui/SimpleLookupManager";
import { Breadcrumb } from "@/components/ui/Breadcrumb";

const TABS = ["Brands", "Seasons", "Fittings", "Product Types", "Designs", "Design Patterns", "Patterns"] as const;
type Tab = (typeof TABS)[number];

const CODE_NAME_FIELDS = [
  { key: "code", label: "Code", required: true },
  { key: "name", label: "Name", required: true },
];

export function GarmentAttributesClient() {
  const [tab, setTab] = useState<Tab>("Brands");

  return (
    <div className="space-y-4">
      <div>
        <Breadcrumb items={[{ label: "Masters", href: "/masters" }, { label: "Garment Attributes" }]} />
        <h1 className="mt-2 text-lg font-semibold text-zinc-900 dark:text-zinc-50">Garment Attributes</h1>
        <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">
          Style-level attribute masters — brand, season, fitting, product type, design, and pattern — imported
          from the Inventory and Royal Jeans reference systems. Garment/Supplier/Employee Category all moved
          to the consolidated <a href="/masters/categories" className="text-indigo-600 hover:underline dark:text-indigo-400">Categories</a> page.
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

      {tab === "Brands" && <SimpleLookupManager fetchUrl="/api/v1/brands" entityLabel="Brand" fields={CODE_NAME_FIELDS} />}
      {tab === "Seasons" && <SimpleLookupManager fetchUrl="/api/v1/seasons" entityLabel="Season" fields={CODE_NAME_FIELDS} />}
      {tab === "Fittings" && (
        <SimpleLookupManager fetchUrl="/api/v1/product-fittings" entityLabel="Fitting" fields={CODE_NAME_FIELDS} />
      )}
      {tab === "Product Types" && (
        <SimpleLookupManager fetchUrl="/api/v1/product-types" entityLabel="Product Type" fields={CODE_NAME_FIELDS} />
      )}
      {tab === "Designs" && <SimpleLookupManager fetchUrl="/api/v1/designs" entityLabel="Design" fields={CODE_NAME_FIELDS} />}
      {tab === "Design Patterns" && (
        <SimpleLookupManager fetchUrl="/api/v1/design-patterns" entityLabel="Design Pattern" fields={CODE_NAME_FIELDS} />
      )}
      {tab === "Patterns" && <SimpleLookupManager fetchUrl="/api/v1/patterns" entityLabel="Pattern" fields={CODE_NAME_FIELDS} />}
    </div>
  );
}
