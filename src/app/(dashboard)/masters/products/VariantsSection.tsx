"use client";

import { useState } from "react";
import { Modal } from "@/components/ui/Modal";

interface Variant {
  id: string;
  skuCode: string;
  color: { name: string };
  size: { name: string };
  isActive: boolean;
}

interface Option {
  id: string;
  code: string;
  name: string;
}

interface VariantsSectionProps {
  productId: string;
}

/**
 * Rendered as a small row-action button on the Styles list, mirroring
 * Customers' "Buyers" / Suppliers' "Categories"/"Materials" row-action
 * pattern — moved off the Product edit page (there is no such page anymore;
 * see [id]/page.tsx's redirect). Self-fetches on open rather than taking a
 * server-preloaded prop, since a list row has no per-row detail fetch to
 * piggyback on.
 */
export function VariantsSection({ productId }: VariantsSectionProps) {
  const [open, setOpen] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [variants, setVariants] = useState<Variant[]>([]);
  const [colors, setColors] = useState<Option[]>([]);
  const [sizes, setSizes] = useState<Option[]>([]);
  const [selectedColorIds, setSelectedColorIds] = useState<string[]>([]);
  const [selectedSizeIds, setSelectedSizeIds] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  async function openModal() {
    setOpen(true);
    setError(null);
    setMessage(null);
    setIsLoading(true);
    const [productRes, colorsRes, sizesRes] = await Promise.all([
      fetch(`/api/v1/products/${productId}`),
      fetch("/api/v1/colors"),
      fetch("/api/v1/sizes"),
    ]);
    const productBody = await productRes.json();
    setColors((await colorsRes.json()).data ?? []);
    setSizes((await sizesRes.json()).data ?? []);
    setIsLoading(false);
    if (productRes.ok) {
      setVariants(productBody.data.variants ?? []);
    } else {
      setError(productBody?.error?.message ?? "Failed to load variants.");
    }
  }

  const toggle = (list: string[], setList: (v: string[]) => void, id: string) => {
    setList(list.includes(id) ? list.filter((x) => x !== id) : [...list, id]);
  };

  const handleGenerate = async () => {
    if (selectedColorIds.length === 0 || selectedSizeIds.length === 0) {
      setError("Select at least one color and one size.");
      return;
    }
    setIsSubmitting(true);
    setError(null);
    setMessage(null);

    const res = await fetch(`/api/v1/products/${productId}/variants/bulk`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ colorIds: selectedColorIds, sizeIds: selectedSizeIds }),
    });

    setIsSubmitting(false);

    if (!res.ok) {
      const body = await res.json().catch(() => null);
      setError(body?.error?.message ?? "Failed to generate variants.");
      return;
    }

    const { data } = await res.json();
    setMessage(`Generated ${data.created} new variant(s).`);

    const refreshed = await fetch(`/api/v1/products/${productId}`).then((r) => r.json());
    setVariants(refreshed.data.variants);
  };

  return (
    <>
      <button
        type="button"
        onClick={openModal}
        className="whitespace-nowrap rounded-md border border-zinc-300 px-2 py-1 text-xs font-medium text-zinc-700 hover:bg-zinc-50 dark:border-zinc-700 dark:text-zinc-200 dark:hover:bg-zinc-800"
      >
        Variants
      </button>

      <Modal open={open} onClose={() => setOpen(false)} title="Variants (Color × Size)" maxWidthClass="max-w-xl">
        <div className="space-y-4">
          {isLoading ? (
            <p className="text-sm text-zinc-500">Loading…</p>
          ) : (
            <>
              <div className="grid grid-cols-2 gap-4 rounded-md border border-zinc-200 p-3 dark:border-zinc-800">
                <div>
                  <p className="mb-1 text-xs font-medium text-zinc-600 dark:text-zinc-400">Colors</p>
                  <div className="space-y-1">
                    {colors.length === 0 && <p className="text-xs text-zinc-400">No colors defined yet.</p>}
                    {colors.map((c) => (
                      <label key={c.id} className="flex items-center gap-2 text-sm text-zinc-700 dark:text-zinc-300">
                        <input
                          type="checkbox"
                          checked={selectedColorIds.includes(c.id)}
                          onChange={() => toggle(selectedColorIds, setSelectedColorIds, c.id)}
                        />
                        {c.name}
                      </label>
                    ))}
                  </div>
                </div>
                <div>
                  <p className="mb-1 text-xs font-medium text-zinc-600 dark:text-zinc-400">Sizes</p>
                  <div className="space-y-1">
                    {sizes.length === 0 && <p className="text-xs text-zinc-400">No sizes defined yet.</p>}
                    {sizes.map((s) => (
                      <label key={s.id} className="flex items-center gap-2 text-sm text-zinc-700 dark:text-zinc-300">
                        <input
                          type="checkbox"
                          checked={selectedSizeIds.includes(s.id)}
                          onChange={() => toggle(selectedSizeIds, setSelectedSizeIds, s.id)}
                        />
                        {s.name}
                      </label>
                    ))}
                  </div>
                </div>
              </div>

              <button
                onClick={handleGenerate}
                disabled={isSubmitting}
                className="rounded-md bg-indigo-600 px-3 py-2 text-sm font-medium text-white hover:bg-indigo-500 disabled:opacity-60"
              >
                {isSubmitting ? "Generating…" : "Generate Variants"}
              </button>

              {error && <p className="text-sm text-red-600 dark:text-red-400">{error}</p>}
              {message && <p className="text-sm text-green-700 dark:text-green-400">{message}</p>}

              {variants.length === 0 ? (
                <p className="text-sm text-zinc-500">No variants yet.</p>
              ) : (
                <div className="overflow-x-auto rounded-md border border-zinc-200 dark:border-zinc-800">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-zinc-200 text-left text-xs uppercase tracking-wide text-zinc-500 dark:border-zinc-800 dark:text-zinc-400">
                        <th className="px-3 py-2 font-medium">SKU</th>
                        <th className="px-3 py-2 font-medium">Color</th>
                        <th className="px-3 py-2 font-medium">Size</th>
                      </tr>
                    </thead>
                    <tbody>
                      {variants.map((v) => (
                        <tr key={v.id} className="border-b border-zinc-100 last:border-0 dark:border-zinc-800">
                          <td className="px-3 py-2 font-mono text-xs text-zinc-700 dark:text-zinc-200">{v.skuCode}</td>
                          <td className="px-3 py-2 text-zinc-700 dark:text-zinc-200">{v.color.name}</td>
                          <td className="px-3 py-2 text-zinc-700 dark:text-zinc-200">{v.size.name}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
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
