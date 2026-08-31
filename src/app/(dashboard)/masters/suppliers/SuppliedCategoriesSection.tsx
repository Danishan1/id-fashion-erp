"use client";

import { useMemo, useState } from "react";
import { Modal } from "@/components/ui/Modal";
import { textInputClass } from "@/components/ui/FormField";

interface CategoryEntry {
  id: string;
  code: string;
  name: string;
  granted: boolean;
}

interface SuppliedCategoriesSectionProps {
  supplierId: string;
}

/**
 * The coarse "supplies this whole category" toggle — a supplier ticked here
 * for e.g. Fabric is treated as eligible for every Fabric material,
 * including ones added to the catalog later, without ever needing this
 * Supplier record reopened again. Deliberately separate from — and
 * accessible alongside — the specific-materials checklist in
 * SuppliedMaterialsSection: a supplier can broadly cover a couple of
 * categories and still have a few extra specific materials outside those
 * ticked individually.
 *
 * The checklist itself is sourced live from the real, per-company Supplier
 * Category master (Masters → Categories → Supplier Category) — not a fixed
 * list — so adding/renaming a category there is reflected here with no code
 * change.
 *
 * Mirrors SuppliedMaterialsSection's own linked-list + search + checklist +
 * "Add Selected" shape exactly (per explicit user request for the same UX),
 * rather than the earlier flat "toggle any pill, then Save" design — a
 * granted category now has its own visible row with an immediate Remove
 * action, and adding is a search-and-multi-select-then-submit action, same
 * as materials. Both directions still go through the one existing
 * full-replace PUT endpoint under the hood (no new API needed) — a Remove
 * submits the granted set minus that one id, an Add Selected submits the
 * granted set plus the newly checked ones.
 *
 * Rendered as a small row-action button on the Suppliers list (between Edit
 * and the Active/Inactive toggle, per explicit user placement); self-fetches
 * on open rather than requiring a server-preloaded prop, since a list row
 * has no per-row detail fetch of its own to piggyback on.
 */
export function SuppliedCategoriesSection({ supplierId }: SuppliedCategoriesSectionProps) {
  const [open, setOpen] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [categories, setCategories] = useState<CategoryEntry[]>([]);
  const [search, setSearch] = useState("");
  const [checked, setChecked] = useState<Set<string>>(new Set());
  const [error, setError] = useState<string | null>(null);
  const [isAdding, setIsAdding] = useState(false);
  const [removingId, setRemovingId] = useState<string | null>(null);

  async function openModal() {
    setOpen(true);
    setError(null);
    setIsLoading(true);
    try {
      const res = await fetch(`/api/v1/suppliers/${supplierId}/material-categories`);
      const body = await res.json();
      if (!res.ok) throw new Error(body.error?.message ?? "Failed to load categories");
      setCategories(body.data ?? []);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load categories");
    } finally {
      setIsLoading(false);
    }
  }

  const granted = useMemo(() => categories.filter((c) => c.granted), [categories]);

  const available = useMemo(() => {
    const query = search.trim().toLowerCase();
    return categories.filter((c) => !c.granted && (!query || c.name.toLowerCase().includes(query) || c.code.toLowerCase().includes(query)));
  }, [categories, search]);

  function toggle(id: string) {
    setChecked((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  async function submit(newGrantedIds: string[]) {
    const res = await fetch(`/api/v1/suppliers/${supplierId}/material-categories`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ supplierCategoryIds: newGrantedIds }),
    });
    const body = await res.json();
    if (!res.ok) throw new Error(body.error?.message ?? "Failed to save categories");
    setCategories(body.data ?? []);
  }

  async function handleAddSelected() {
    if (checked.size === 0 || isAdding) return;
    setIsAdding(true);
    setError(null);
    try {
      await submit([...granted.map((c) => c.id), ...checked]);
      setChecked(new Set());
      setSearch("");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to add categories.");
    } finally {
      setIsAdding(false);
    }
  }

  async function handleRemove(categoryId: string) {
    setRemovingId(categoryId);
    setError(null);
    try {
      await submit(granted.filter((c) => c.id !== categoryId).map((c) => c.id));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to remove category.");
    } finally {
      setRemovingId(null);
    }
  }

  return (
    <>
      <button
        type="button"
        onClick={openModal}
        className="whitespace-nowrap rounded-md border border-zinc-300 px-2 py-1 text-xs font-medium text-zinc-700 hover:bg-zinc-50 dark:border-zinc-700 dark:text-zinc-200 dark:hover:bg-zinc-800"
      >
        Categories
      </button>

      <Modal open={open} onClose={() => setOpen(false)} title="Categories Supplied (broad)" maxWidthClass="max-w-xl">
        <div className="space-y-3">
          <p className="text-xs text-zinc-500 dark:text-zinc-400">
            Select a category to treat this supplier as eligible for <strong>every</strong> material in it —
            including ones added later — without listing each one individually in Materials Supplied. Use
            this when a supplier genuinely deals across a whole category (e.g. all Fabric); use Materials
            Supplied for a supplier that only handles a few specific items.
          </p>

          {error && <p className="text-sm text-red-600 dark:text-red-400">{error}</p>}

          {isLoading ? (
            <p className="text-sm text-zinc-500">Loading…</p>
          ) : (
            <>
              {granted.length === 0 ? (
                <p className="text-sm text-zinc-500">No categories linked yet.</p>
              ) : (
                <ul className="divide-y divide-zinc-100 rounded-md border border-zinc-200 dark:divide-zinc-800 dark:border-zinc-800">
                  {granted.map((entry) => (
                    <li key={entry.id} className="flex items-center justify-between px-3 py-2 text-sm">
                      <span className="font-medium text-zinc-800 dark:text-zinc-100">{entry.name}</span>
                      <button
                        type="button"
                        onClick={() => handleRemove(entry.id)}
                        disabled={removingId === entry.id}
                        className="text-sm text-red-600 hover:text-red-500 disabled:opacity-60 dark:text-red-400"
                      >
                        {removingId === entry.id ? "Removing…" : "Remove"}
                      </button>
                    </li>
                  ))}
                </ul>
              )}

              <div className="rounded-md border border-zinc-200 dark:border-zinc-800">
                <div className="border-b border-zinc-200 p-2 dark:border-zinc-800">
                  <input
                    type="text"
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                    placeholder="Search categories to add…"
                    className={textInputClass()}
                  />
                </div>
                <div className="max-h-64 overflow-y-auto">
                  {available.length === 0 && <p className="px-3 py-3 text-sm text-zinc-500">No more categories to add.</p>}
                  {available.map((entry) => (
                    <label
                      key={entry.id}
                      className="flex cursor-pointer items-center gap-2 px-3 py-1.5 text-sm text-zinc-700 hover:bg-zinc-50 dark:text-zinc-200 dark:hover:bg-zinc-800"
                    >
                      <input
                        type="checkbox"
                        checked={checked.has(entry.id)}
                        onChange={() => toggle(entry.id)}
                        className="h-4 w-4 rounded border-zinc-300 text-indigo-600 focus:ring-indigo-500 dark:border-zinc-700"
                      />
                      {entry.name}
                    </label>
                  ))}
                </div>
                <div className="flex items-center justify-between border-t border-zinc-200 p-2 dark:border-zinc-800">
                  <span className="text-xs text-zinc-500">{checked.size > 0 ? `${checked.size} selected` : "Select one or more"}</span>
                  <button
                    type="button"
                    onClick={handleAddSelected}
                    disabled={checked.size === 0 || isAdding}
                    className="rounded-md bg-indigo-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-indigo-500 disabled:opacity-60"
                  >
                    {isAdding ? "Adding…" : `Add Selected${checked.size > 0 ? ` (${checked.size})` : ""}`}
                  </button>
                </div>
              </div>
            </>
          )}

          <div className="flex justify-end">
            <button
              type="button"
              onClick={() => setOpen(false)}
              className="rounded-md border border-zinc-300 px-3 py-1.5 text-sm font-medium text-zinc-700 hover:bg-zinc-50 dark:border-zinc-700 dark:text-zinc-200 dark:hover:bg-zinc-800"
            >
              Close
            </button>
          </div>
        </div>
      </Modal>
    </>
  );
}
