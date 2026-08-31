"use client";

import { useEffect, useMemo, useState } from "react";
import { MATERIAL_CATEGORIES } from "@/modules/products/product.schema";
import { formatCategoryLabel } from "@/lib/format-category-label";
import { textInputClass } from "@/components/ui/FormField";

interface MaterialOption {
  id: string;
  styleName: string;
  styleCode: string;
  materialCategory: string | null;
}

interface SuppliedMaterial {
  id: string;
  product: {
    id: string;
    styleName: string;
    styleCode: string;
    materialCategory: string | null;
    baseUom: { code: string } | null;
  };
}

interface SuppliedMaterialsSectionProps {
  supplierId: string;
  initialMaterials: SuppliedMaterial[];
}

/**
 * "Which raw materials can this Supplier supply" — a real many-to-many
 * catalog (SupplierMaterial), deliberately separate from each Material's
 * own single "Default Supplier" field (that one only auto-suggests a
 * supplier for a Purchase Order; this list is the fuller "who could I buy
 * this from at all" picture).
 *
 * Multi-select checklist rather than MaterialPicker's one-at-a-time
 * search-select-Add flow — a supplier legitimately supplying dozens of
 * materials (the ordinary case, not an edge case) made repeating that cycle
 * once per material genuinely tedious. Search narrows the list; checking
 * several and hitting "Add Selected" submits them all in one call.
 */
export function SuppliedMaterialsSection({ supplierId, initialMaterials }: SuppliedMaterialsSectionProps) {
  const [links, setLinks] = useState(initialMaterials);
  const [allMaterials, setAllMaterials] = useState<MaterialOption[]>([]);
  const [search, setSearch] = useState("");
  const [checked, setChecked] = useState<Set<string>>(new Set());
  const [error, setError] = useState<string | null>(null);
  const [isAdding, setIsAdding] = useState(false);
  const [removingId, setRemovingId] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/v1/materials?pageSize=200")
      .then((res) => res.json())
      .then((body) => setAllMaterials(body.data ?? []))
      .catch(() => setAllMaterials([]));
  }, []);

  const availableMaterials = useMemo(() => {
    const linkedMaterialIds = new Set(links.map((l) => l.product.id));
    return allMaterials.filter((m) => !linkedMaterialIds.has(m.id));
  }, [allMaterials, links]);

  const groups = useMemo(() => {
    const query = search.trim().toLowerCase();
    const filtered = availableMaterials.filter(
      (m) => !query || m.styleName.toLowerCase().includes(query) || m.styleCode.toLowerCase().includes(query)
    );
    const byCategory = new Map<string, MaterialOption[]>();
    for (const m of filtered) {
      const cat = m.materialCategory ?? "OTHER";
      byCategory.set(cat, [...(byCategory.get(cat) ?? []), m]);
    }
    const orderedCategories = [...MATERIAL_CATEGORIES, ...[...byCategory.keys()].filter((c) => !MATERIAL_CATEGORIES.includes(c as never))];
    return orderedCategories.filter((cat) => byCategory.has(cat)).map((cat) => ({ category: cat, items: byCategory.get(cat)! }));
  }, [availableMaterials, search]);

  function toggle(id: string) {
    setChecked((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  async function handleAddSelected() {
    if (checked.size === 0 || isAdding) return;
    setIsAdding(true);
    setError(null);

    const res = await fetch(`/api/v1/suppliers/${supplierId}/materials/bulk`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ materialIds: Array.from(checked) }),
    });

    setIsAdding(false);

    if (!res.ok) {
      const body = await res.json().catch(() => null);
      setError(body?.error?.message ?? "Failed to add materials.");
      return;
    }

    const { data } = await res.json();
    setLinks(data);
    setChecked(new Set());
    setSearch("");
  }

  async function handleRemove(link: SuppliedMaterial) {
    setRemovingId(link.id);
    setError(null);

    const res = await fetch(`/api/v1/suppliers/${supplierId}/materials/${link.product.id}`, { method: "DELETE" });

    setRemovingId(null);

    if (!res.ok) {
      const body = await res.json().catch(() => null);
      setError(body?.error?.message ?? "Failed to remove material.");
      return;
    }

    setLinks(links.filter((l) => l.id !== link.id));
  }

  return (
    <div className="max-w-xl space-y-3">
      <div>
        <h2 className="text-sm font-semibold text-zinc-900 dark:text-zinc-50">Materials Supplied</h2>
        <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">
          Every raw material this supplier can be sourced from — separate from a material&apos;s own
          &ldquo;Default Supplier&rdquo; (which only picks one for auto-suggesting on a new Purchase Order).
        </p>
      </div>

      {error && <p className="text-sm text-red-600 dark:text-red-400">{error}</p>}

      {links.length === 0 ? (
        <p className="text-sm text-zinc-500">No materials linked yet.</p>
      ) : (
        <ul className="divide-y divide-zinc-100 rounded-md border border-zinc-200 dark:divide-zinc-800 dark:border-zinc-800">
          {links.map((link) => (
            <li key={link.id} className="flex items-center justify-between px-3 py-2 text-sm">
              <div>
                <span className="font-medium text-zinc-800 dark:text-zinc-100">
                  {link.product.styleName} <span className="text-zinc-400">({link.product.styleCode})</span>
                </span>
                {link.product.materialCategory && (
                  <span className="ml-2 text-xs text-zinc-500">{formatCategoryLabel(link.product.materialCategory)}</span>
                )}
              </div>
              <button
                type="button"
                onClick={() => handleRemove(link)}
                disabled={removingId === link.id}
                className="text-sm text-red-600 hover:text-red-500 disabled:opacity-60 dark:text-red-400"
              >
                {removingId === link.id ? "Removing…" : "Remove"}
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
            placeholder="Search materials to add…"
            className={textInputClass()}
          />
        </div>
        <div className="max-h-64 overflow-y-auto">
          {groups.length === 0 && <p className="px-3 py-3 text-sm text-zinc-500">No more materials to add.</p>}
          {groups.map((group) => (
            <div key={group.category}>
              <div className="sticky top-0 bg-zinc-100 px-3 py-1 text-xs font-semibold text-zinc-500 dark:bg-zinc-800 dark:text-zinc-400">
                {formatCategoryLabel(group.category)}
              </div>
              {group.items.map((m) => (
                <label
                  key={m.id}
                  className="flex cursor-pointer items-center gap-2 px-3 py-1.5 text-sm text-zinc-700 hover:bg-zinc-50 dark:text-zinc-200 dark:hover:bg-zinc-800"
                >
                  <input
                    type="checkbox"
                    checked={checked.has(m.id)}
                    onChange={() => toggle(m.id)}
                    className="h-4 w-4 rounded border-zinc-300 text-indigo-600 focus:ring-indigo-500 dark:border-zinc-700"
                  />
                  {m.styleName} <span className="text-xs text-zinc-400">({m.styleCode})</span>
                </label>
              ))}
            </div>
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
    </div>
  );
}
