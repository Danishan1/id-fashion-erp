"use client";

import { useState } from "react";
import { formatCategoryLabel } from "@/lib/format-category-label";

interface CategoryEntry {
  category: string;
  granted: boolean;
}

interface SuppliedCategoriesSectionProps {
  supplierId: string;
  initialCategories: CategoryEntry[];
}

/**
 * The coarse "supplies this whole category" toggle — a supplier ticked here
 * for e.g. Fabric is treated as eligible for every Fabric material,
 * including ones added to the catalog later, without ever needing this
 * Supplier record reopened again. Deliberately separate from — and shown
 * alongside — the specific-materials checklist below it: a supplier can
 * broadly cover a couple of categories and still have a few extra specific
 * materials outside those ticked individually.
 */
export function SuppliedCategoriesSection({ supplierId, initialCategories }: SuppliedCategoriesSectionProps) {
  const [selected, setSelected] = useState<Set<string>>(new Set(initialCategories.filter((c) => c.granted).map((c) => c.category)));
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  function toggle(category: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(category)) next.delete(category);
      else next.add(category);
      return next;
    });
  }

  async function handleSave() {
    setIsSaving(true);
    setError(null);
    setSaved(false);
    try {
      const res = await fetch(`/api/v1/suppliers/${supplierId}/material-categories`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ categories: Array.from(selected) }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error?.message ?? "Failed to save categories");
      setSaved(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to save categories");
    } finally {
      setIsSaving(false);
    }
  }

  return (
    <div className="max-w-xl space-y-3">
      <div>
        <h2 className="text-sm font-semibold text-zinc-900 dark:text-zinc-50">Categories Supplied (broad)</h2>
        <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">
          Select a category to treat this supplier as eligible for <strong>every</strong> material in it —
          including ones added later — without listing each one individually below. Use this when a supplier
          genuinely deals across a whole category (e.g. all Fabric); use &ldquo;Materials Supplied&rdquo; below
          for a supplier that only handles a few specific items.
        </p>
      </div>

      {error && <p className="text-sm text-red-600 dark:text-red-400">{error}</p>}
      {saved && <p className="text-sm text-emerald-600 dark:text-emerald-400">Saved.</p>}

      <div className="flex flex-wrap gap-2">
        {initialCategories.map((entry) => (
          <label
            key={entry.category}
            className={`flex cursor-pointer items-center gap-2 rounded-md border px-3 py-1.5 text-sm ${
              selected.has(entry.category)
                ? "border-indigo-300 bg-indigo-50 text-indigo-700 dark:border-indigo-500/40 dark:bg-indigo-500/10 dark:text-indigo-300"
                : "border-zinc-300 text-zinc-700 dark:border-zinc-700 dark:text-zinc-200"
            }`}
          >
            <input
              type="checkbox"
              checked={selected.has(entry.category)}
              onChange={() => toggle(entry.category)}
              className="h-4 w-4 rounded border-zinc-300 text-indigo-600 focus:ring-indigo-500 dark:border-zinc-700"
            />
            {formatCategoryLabel(entry.category)}
          </label>
        ))}
      </div>

      <div className="flex justify-end">
        <button
          type="button"
          disabled={isSaving}
          onClick={handleSave}
          className="rounded-md bg-indigo-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-indigo-500 disabled:opacity-60"
        >
          {isSaving ? "Saving…" : "Save Categories"}
        </button>
      </div>
    </div>
  );
}
