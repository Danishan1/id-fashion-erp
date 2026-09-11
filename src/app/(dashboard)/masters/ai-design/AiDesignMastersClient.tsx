"use client";

import { useState } from "react";
import { Breadcrumb } from "@/components/ui/Breadcrumb";
import { ProductDesignAttributesPanel } from "./ProductDesignAttributesPanel";

const TABS = ["Product Design"] as const;
type Tab = (typeof TABS)[number];

/**
 * Masters -> AI Design. A single tab today (Product Design), structured as
 * a tabbed page like Categories/Garment Attributes/Fabric Configuration so
 * a future AI Designer master (e.g. Model options, Environment presets)
 * can be added as a sibling tab without restructuring this page.
 */
export function AiDesignMastersClient() {
  const [tab, setTab] = useState<Tab>("Product Design");

  return (
    <div className="space-y-4">
      <div>
        <Breadcrumb items={[{ label: "Masters", href: "/masters" }, { label: "AI Design" }]} />
        <h1 className="mt-2 text-lg font-semibold text-zinc-900 dark:text-zinc-50">AI Design</h1>
        <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">
          AI Designer&apos;s own configurable masters — control which attributes and options show up in the
          Product Design step of the wizard.
        </p>
      </div>

      <div className="flex flex-wrap gap-1 border-b border-zinc-200 dark:border-zinc-800">
        {TABS.map((t) => (
          <button
            key={t}
            type="button"
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

      {tab === "Product Design" && <ProductDesignAttributesPanel />}
    </div>
  );
}
