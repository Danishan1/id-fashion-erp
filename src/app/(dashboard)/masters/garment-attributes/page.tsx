"use client";

import { useState } from "react";
import { SimpleLookupManager } from "@/components/ui/SimpleLookupManager";
import { Breadcrumb } from "@/components/ui/Breadcrumb";

const TABS = [
  "Brands",
  "Categories",
  "Seasons",
  "Fittings",
  "Product Types",
  "Designs",
  "Design Patterns",
  "Patterns",
  "Supplier Categories",
] as const;
type Tab = (typeof TABS)[number];

const CODE_NAME_FIELDS = [
  { key: "code", label: "Code", required: true },
  { key: "name", label: "Name", required: true },
];

export default function GarmentAttributesPage() {
  const [tab, setTab] = useState<Tab>("Brands");

  return (
    <div className="space-y-4">
      <div>
        <Breadcrumb items={[{ label: "Masters", href: "/masters" }, { label: "Garment Attributes" }]} />
        <h1 className="mt-2 text-lg font-semibold text-zinc-900 dark:text-zinc-50">Garment Attributes</h1>
        <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">
          Style-level attribute masters — brand, category, season, fitting, product type, design, and pattern —
          imported from the Inventory and Royal Jeans reference systems. Supplier Categories classifies what a
          supplier provides (fabric, trims, packaging, services, ...), used on the Suppliers master.
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

      {tab === "Brands" && <SimpleLookupManager fetchUrl="/api/v1/brands" fields={CODE_NAME_FIELDS} />}
      {tab === "Categories" && <SimpleLookupManager fetchUrl="/api/v1/categories" fields={CODE_NAME_FIELDS} />}
      {tab === "Seasons" && <SimpleLookupManager fetchUrl="/api/v1/seasons" fields={CODE_NAME_FIELDS} />}
      {tab === "Fittings" && <SimpleLookupManager fetchUrl="/api/v1/product-fittings" fields={CODE_NAME_FIELDS} />}
      {tab === "Product Types" && <SimpleLookupManager fetchUrl="/api/v1/product-types" fields={CODE_NAME_FIELDS} />}
      {tab === "Designs" && <SimpleLookupManager fetchUrl="/api/v1/designs" fields={CODE_NAME_FIELDS} />}
      {tab === "Design Patterns" && <SimpleLookupManager fetchUrl="/api/v1/design-patterns" fields={CODE_NAME_FIELDS} />}
      {tab === "Patterns" && <SimpleLookupManager fetchUrl="/api/v1/patterns" fields={CODE_NAME_FIELDS} />}
      {tab === "Supplier Categories" && <SimpleLookupManager fetchUrl="/api/v1/supplier-categories" fields={CODE_NAME_FIELDS} />}
    </div>
  );
}
