"use client";

/**
 * Read-only views of what is SAVED on a dispatch (2026-10-22), so the store
 * can see at a glance what each carton holds and whether the packed pieces
 * match the picked ones — the edit forms above only show the draft.
 */

interface VariantName {
  color: { name: string };
  size: { name: string };
}

interface SummaryItem {
  id: string;
  product: { styleName: string; styleCode: string };
  pickLines: Array<{ productVariantId: string; quantity: number | string; productVariant: VariantName }>;
  orderedVariants?: Array<{ productVariantId: string; colorName: string; sizeName: string; orderedQuantity: number }>;
}

interface SummaryCarton {
  id: string;
  cartonNumber: number;
  totalQuantity: number;
  items: Array<{ dispatchItemId: string; productVariantId: string | null; quantity: number; productVariant: VariantName | null }>;
}

const variantLabel = (v: VariantName | null | undefined) => (v ? `${v.color.name} / ${v.size.name}` : "Any colour / size");

/** One card per saved carton: what's inside and how many pieces. */
export function SavedCartonsSummary({ items, cartons }: { items: SummaryItem[]; cartons: SummaryCarton[] }) {
  if (cartons.length === 0) {
    return <p className="text-sm text-zinc-500 dark:text-zinc-400">No cartons saved yet.</p>;
  }
  const styleOf = (dispatchItemId: string) => items.find((i) => i.id === dispatchItemId)?.product;
  const grandTotal = cartons.reduce((sum, c) => sum + c.totalQuantity, 0);

  return (
    <div className="space-y-2">
      <p className="text-xs text-zinc-500 dark:text-zinc-400">
        {cartons.length} carton{cartons.length === 1 ? "" : "s"} saved · {grandTotal} pcs in total
      </p>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {cartons.map((carton) => (
          <div key={carton.id} className="rounded-lg border border-zinc-200 p-3 dark:border-zinc-800">
            <div className="mb-2 flex items-center justify-between">
              <span className="text-sm font-semibold text-zinc-900 dark:text-zinc-50">Carton {carton.cartonNumber}</span>
              <span className="rounded-full bg-zinc-100 px-2 py-0.5 text-xs font-medium text-zinc-700 dark:bg-zinc-800 dark:text-zinc-200">
                {carton.totalQuantity} pcs
              </span>
            </div>
            <table className="w-full text-xs">
              <thead>
                <tr className="text-left text-zinc-500">
                  <th className="py-1 pr-2 font-medium">Style</th>
                  <th className="py-1 pr-2 font-medium">Colour / Size</th>
                  <th className="py-1 text-right font-medium">Pcs</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-100 dark:divide-zinc-800">
                {carton.items.map((line, index) => (
                  <tr key={index}>
                    <td className="py-1 pr-2 text-zinc-700 dark:text-zinc-200">{styleOf(line.dispatchItemId)?.styleCode ?? "—"}</td>
                    <td className="py-1 pr-2 text-zinc-700 dark:text-zinc-200">{variantLabel(line.productVariant)}</td>
                    <td className="py-1 text-right font-medium text-zinc-900 dark:text-zinc-50">{line.quantity}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ))}
      </div>
    </div>
  );
}

/**
 * Ordered vs Picked vs Packed per colour/size (saved figures). Picked must
 * equal Packed for each colour/size before the dispatch can be confirmed.
 */
export function PickedVsPackedSummary({ items, cartons }: { items: SummaryItem[]; cartons: SummaryCarton[] }) {
  type Row = { key: string; style: string; label: string; ordered: number | null; picked: number; packed: number };
  const rows = new Map<string, Row>();
  const rowFor = (item: SummaryItem, variantId: string | null, label: string) => {
    const key = `${item.id}:${variantId ?? "none"}`;
    let row = rows.get(key);
    if (!row) {
      const ordered = item.orderedVariants?.find((v) => v.productVariantId === variantId)?.orderedQuantity ?? null;
      row = { key, style: item.product.styleCode, label, ordered, picked: 0, packed: 0 };
      rows.set(key, row);
    }
    return row;
  };

  for (const item of items) {
    for (const v of item.orderedVariants ?? []) rowFor(item, v.productVariantId, `${v.colorName} / ${v.sizeName}`);
    for (const line of item.pickLines) rowFor(item, line.productVariantId, variantLabel(line.productVariant)).picked += Number(line.quantity);
  }
  for (const carton of cartons) {
    for (const line of carton.items) {
      const item = items.find((i) => i.id === line.dispatchItemId);
      if (item) rowFor(item, line.productVariantId, variantLabel(line.productVariant)).packed += Number(line.quantity);
    }
  }

  const list = Array.from(rows.values()).filter((r) => r.picked > 0 || r.packed > 0 || (r.ordered ?? 0) > 0);
  if (list.length === 0) return null;
  const totals = list.reduce((t, r) => ({ picked: t.picked + r.picked, packed: t.packed + r.packed }), { picked: 0, packed: 0 });
  const allMatch = list.every((r) => r.picked === r.packed);

  return (
    <div className="rounded-lg border border-zinc-200 p-3 dark:border-zinc-800">
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <span className="text-sm font-semibold text-zinc-900 dark:text-zinc-50">Picked vs Packed (saved)</span>
        <span
          className={`rounded-full px-2 py-0.5 text-xs font-medium ${
            allMatch
              ? "bg-emerald-100 text-emerald-800 dark:bg-emerald-950/50 dark:text-emerald-300"
              : "bg-amber-100 text-amber-800 dark:bg-amber-950/50 dark:text-amber-300"
          }`}
        >
          {allMatch ? "All picked pieces are packed" : "Picked and packed don't match yet"}
        </span>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-xs">
          <thead>
            <tr className="text-left text-zinc-500">
              <th className="py-1 pr-2 font-medium">Style</th>
              <th className="py-1 pr-2 font-medium">Colour / Size</th>
              <th className="py-1 pr-2 text-right font-medium">Ordered</th>
              <th className="py-1 pr-2 text-right font-medium">Picked</th>
              <th className="py-1 pr-2 text-right font-medium">Packed</th>
              <th className="py-1 font-medium"></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-zinc-100 dark:divide-zinc-800">
            {list.map((r) => {
              const diff = r.picked - r.packed;
              return (
                <tr key={r.key}>
                  <td className="py-1 pr-2 text-zinc-700 dark:text-zinc-200">{r.style}</td>
                  <td className="py-1 pr-2 text-zinc-700 dark:text-zinc-200">{r.label}</td>
                  <td className="py-1 pr-2 text-right text-zinc-500">{r.ordered ?? "—"}</td>
                  <td className="py-1 pr-2 text-right text-zinc-900 dark:text-zinc-50">{r.picked}</td>
                  <td className="py-1 pr-2 text-right text-zinc-900 dark:text-zinc-50">{r.packed}</td>
                  <td className="py-1 text-xs">
                    {diff === 0 ? (
                      <span className="text-emerald-700 dark:text-emerald-400">✓</span>
                    ) : diff > 0 ? (
                      <span className="text-amber-700 dark:text-amber-400">{diff} not in a carton</span>
                    ) : (
                      <span className="text-red-600 dark:text-red-400">{-diff} packed but not picked</span>
                    )}
                  </td>
                </tr>
              );
            })}
            <tr className="font-medium">
              <td className="py-1 pr-2 text-zinc-900 dark:text-zinc-50" colSpan={3}>
                Total
              </td>
              <td className="py-1 pr-2 text-right text-zinc-900 dark:text-zinc-50">{totals.picked}</td>
              <td className="py-1 pr-2 text-right text-zinc-900 dark:text-zinc-50">{totals.packed}</td>
              <td />
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  );
}
