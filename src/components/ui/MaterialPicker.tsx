"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { MATERIAL_CATEGORIES } from "@/modules/products/product.schema";
import { formatCategoryLabel } from "@/lib/format-category-label";
import { textInputClass } from "./FormField";

export interface MaterialPickerOption {
  id: string;
  styleName: string;
  styleCode: string;
  materialCategory: string | null;
}

interface MaterialPickerProps {
  id?: string;
  materials: MaterialPickerOption[];
  value: string;
  onChange: (materialId: string) => void;
  placeholder?: string;
  required?: boolean;
}

function materialLabel(m: MaterialPickerOption) {
  return `${m.styleName} (${m.styleCode})`;
}

/**
 * Searchable, category-grouped replacement for a plain flat `<select>` of
 * materials — a flat dropdown stops being usable once a company's real
 * material master grows into the hundreds/thousands. Reused everywhere a
 * "pick a raw material" field exists (Material Request, Purchase Order,
 * BOM, Sampling's Add Material) instead of every module re-implementing its
 * own grouping/search UI.
 */
export function MaterialPicker({ id, materials, value, onChange, placeholder = "Search material…", required }: MaterialPickerProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [highlightedIndex, setHighlightedIndex] = useState(0);
  const containerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const selected = materials.find((m) => m.id === value);

  useEffect(() => {
    if (!isOpen) return;
    const onMouseDown = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setIsOpen(false);
        setSearch("");
      }
    };
    document.addEventListener("mousedown", onMouseDown);
    return () => document.removeEventListener("mousedown", onMouseDown);
  }, [isOpen]);

  const groups = useMemo(() => {
    const query = search.trim().toLowerCase();
    const filtered = materials.filter(
      (m) => !query || m.styleName.toLowerCase().includes(query) || m.styleCode.toLowerCase().includes(query)
    );

    const byCategory = new Map<string, MaterialPickerOption[]>();
    for (const m of filtered) {
      const cat = m.materialCategory ?? "OTHER";
      byCategory.set(cat, [...(byCategory.get(cat) ?? []), m]);
    }

    const orderedCategories = [...MATERIAL_CATEGORIES, ...[...byCategory.keys()].filter((c) => !MATERIAL_CATEGORIES.includes(c as never))];
    return orderedCategories
      .filter((cat) => byCategory.has(cat))
      .map((cat) => ({ category: cat, items: byCategory.get(cat)! }));
  }, [materials, search]);

  const flatList = useMemo(() => groups.flatMap((g) => g.items), [groups]);

  const openPicker = () => {
    setIsOpen(true);
    setSearch("");
    setHighlightedIndex(0);
  };

  const select = (materialId: string) => {
    onChange(materialId);
    setIsOpen(false);
    setSearch("");
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (!isOpen) {
      if (e.key === "ArrowDown" || e.key === "Enter") {
        e.preventDefault();
        openPicker();
      }
      return;
    }
    if (e.key === "Escape") {
      e.preventDefault();
      setIsOpen(false);
      setSearch("");
    } else if (e.key === "ArrowDown") {
      e.preventDefault();
      setHighlightedIndex((i) => Math.min(i + 1, flatList.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setHighlightedIndex((i) => Math.max(i - 1, 0));
    } else if (e.key === "Enter") {
      e.preventDefault();
      if (flatList[highlightedIndex]) select(flatList[highlightedIndex].id);
    }
  };

  return (
    <div ref={containerRef} className="relative">
      <input
        id={id}
        ref={inputRef}
        type="text"
        required={required}
        value={isOpen ? search : selected ? materialLabel(selected) : ""}
        placeholder={placeholder}
        onFocus={openPicker}
        onClick={openPicker}
        onChange={(e) => {
          setSearch(e.target.value);
          setHighlightedIndex(0);
          if (!isOpen) setIsOpen(true);
        }}
        onKeyDown={onKeyDown}
        className={textInputClass()}
        autoComplete="off"
      />

      {isOpen && (
        <div className="absolute z-20 mt-1 max-h-72 w-full overflow-y-auto rounded-md border border-zinc-200 bg-white shadow-lg dark:border-zinc-800 dark:bg-zinc-900">
          {flatList.length === 0 && <p className="px-3 py-2 text-sm text-zinc-500">No materials found.</p>}
          {groups.map((group) => (
            <div key={group.category}>
              <div className="sticky top-0 bg-zinc-100 px-3 py-1 text-xs font-semibold text-zinc-500 dark:bg-zinc-800 dark:text-zinc-400">
                {formatCategoryLabel(group.category)}
              </div>
              {group.items.map((m) => {
                const flatIndex = flatList.indexOf(m);
                return (
                  <button
                    key={m.id}
                    type="button"
                    onClick={() => select(m.id)}
                    onMouseEnter={() => setHighlightedIndex(flatIndex)}
                    className={`block w-full px-3 py-2 text-left text-sm ${
                      flatIndex === highlightedIndex
                        ? "bg-indigo-50 text-indigo-700 dark:bg-indigo-500/10 dark:text-indigo-300"
                        : "text-zinc-700 hover:bg-zinc-50 dark:text-zinc-200 dark:hover:bg-zinc-800"
                    }`}
                  >
                    {m.styleName} <span className="text-xs text-zinc-400">({m.styleCode})</span>
                  </button>
                );
              })}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
