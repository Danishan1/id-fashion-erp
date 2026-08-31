"use client";

import { useState } from "react";
import { SimpleLookupManager } from "@/components/ui/SimpleLookupManager";
import { Breadcrumb } from "@/components/ui/Breadcrumb";

const TABS = ["Garment Category", "Supplier Category", "Employee Category"] as const;
type Tab = (typeof TABS)[number];

const CODE_NAME_FIELDS = [
  { key: "code", label: "Code", required: true },
  { key: "name", label: "Name", required: true },
];

/**
 * Every "Category"-shaped master in one place — previously scattered across
 * Garment Attributes (Category, Supplier Category) and HR Configuration
 * (Employee Category), each a plain {code, name} lookup on its own separate
 * page. Pure UI consolidation: every tab here reuses the exact same
 * fetchUrl/fields it already had — no schema, service, or API route changed
 * at all, so nothing that already links to a category (Product.categoryId,
 * Supplier.categoryId, Employee's own category field) is affected.
 */
export default function CategoriesPage() {
  const [tab, setTab] = useState<Tab>("Garment Category");

  return (
    <div className="space-y-4">
      <div>
        <Breadcrumb items={[{ label: "Masters", href: "/masters" }, { label: "Categories" }]} />
        <h1 className="mt-2 text-lg font-semibold text-zinc-900 dark:text-zinc-50">Categories</h1>
        <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">
          Every category-type master in one place. <strong>Garment Category</strong> classifies a Style
          (Shirts, Trousers, …). <strong>Supplier Category</strong> classifies what a supplier provides
          (fabric, trims, packaging, services, …). <strong>Employee Category</strong> classifies staff
          (Permanent, Contract, …).
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

      {tab === "Garment Category" && <SimpleLookupManager fetchUrl="/api/v1/categories" fields={CODE_NAME_FIELDS} />}
      {tab === "Supplier Category" && <SimpleLookupManager fetchUrl="/api/v1/supplier-categories" fields={CODE_NAME_FIELDS} />}
      {tab === "Employee Category" && <SimpleLookupManager fetchUrl="/api/v1/employee-categories" fields={CODE_NAME_FIELDS} />}
    </div>
  );
}
