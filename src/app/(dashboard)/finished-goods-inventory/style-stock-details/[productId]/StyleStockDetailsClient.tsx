"use client";

import { Fragment, useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import { Breadcrumb } from "@/components/ui/Breadcrumb";
import { SearchableSelect } from "@/components/ui/SearchableSelect";

interface Option {
  id: string;
  name?: string;
  code?: string;
}

interface StyleStockSummary {
  product: { id: string; styleCode: string; styleName: string };
  saleableQuantity: number;
  rejectedQuantity: number;
  distinctVariantCount: number;
  distinctWarehouseCount: number;
  allocatedQuantity: number;
  unallocatedQuantity: number;
}

interface SizeRow {
  sizeId: string | null;
  sizeName: string;
  saleableQuantity: number;
  rejectedQuantity: number;
  places: Array<{ label: string; quantity: number }>;
}

interface ColourGroup {
  colorId: string | null;
  colorName: string;
  hexValue: string | null;
  sizes: SizeRow[];
  saleableQuantity: number;
  rejectedQuantity: number;
}

interface Breakdown {
  saleableStock: number;
  rejectedStock: number;
  colours: ColourGroup[];
  warehouses: Array<{
    warehouseId: string;
    warehouseName: string;
    saleableQuantity: number;
    rejectedQuantity: number;
    locations: Array<{ label: string; quantity: number }>;
  }>;
}

const qty = (n: number) => n.toLocaleString("en-IN");
const colourKey = (c: ColourGroup) => c.colorId ?? "none";
const sectionTitle = "text-sm font-semibold text-zinc-900 dark:text-zinc-50";
const tableWrap = "overflow-x-auto rounded-lg border border-zinc-200 dark:border-zinc-800";
const thead = "bg-zinc-100 text-left text-xs font-semibold uppercase text-zinc-700 dark:bg-zinc-800 dark:text-zinc-200";
// An open colour is tinted and edged in indigo, and its detail panel carries the same edge plus a thick bottom border,
// so it is clear where one colour ends and the next begins.
const OPEN_COLOUR_ROW = "bg-indigo-50 dark:bg-indigo-950/40";
const OPEN_COLOUR_PANEL = "border-b-4 border-l-4 border-b-zinc-300 border-l-indigo-500 bg-indigo-50/50 px-4 pb-5 pt-3 dark:border-b-zinc-700 dark:bg-indigo-950/20";
const PANEL_CARD = "rounded-lg border border-indigo-200 bg-white p-3 shadow-sm dark:border-indigo-900 dark:bg-zinc-900";

function StatTile({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="rounded-lg border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900">
      <div className="text-xs font-medium text-zinc-500 dark:text-zinc-400">{label}</div>
      <div className="mt-1 text-2xl font-semibold text-zinc-900 dark:text-zinc-50">{value}</div>
    </div>
  );
}

function PanelTitle({ colour, detail }: { colour: { colorName: string; hexValue: string | null }; detail: string }) {
  return (
    <div className="mb-2 flex items-center gap-2 text-sm font-semibold text-indigo-700 dark:text-indigo-300">
      {colour.hexValue && <span className="h-3 w-3 rounded-full border border-zinc-300" style={{ backgroundColor: colour.hexValue }} />}
      {colour.colorName}
      <span className="text-xs font-normal text-zinc-500 dark:text-zinc-400">· {detail}</span>
    </div>
  );
}

function Chevron({ open }: { open: boolean }) {
  return (
    <svg viewBox="0 0 20 20" fill="currentColor" aria-hidden className={`h-4 w-4 transition-transform ${open ? "rotate-90" : ""}`}>
      <path fillRule="evenodd" d="M7.2 14.8a.75.75 0 0 1 0-1.06L10.94 10 7.2 6.26a.75.75 0 1 1 1.06-1.06l4.27 4.27a.75.75 0 0 1 0 1.06l-4.27 4.27a.75.75 0 0 1-1.06 0Z" clipRule="evenodd" />
    </svg>
  );
}

export function StyleStockDetailsClient({ productId, summary }: { productId: string; summary: StyleStockSummary }) {
  const searchParams = useSearchParams();
  const [warehouses, setWarehouses] = useState<Option[]>([]);
  const [warehouseId, setWarehouseId] = useState(searchParams.get("warehouseId") ?? "");
  const [breakdown, setBreakdown] = useState<Breakdown | null>(null);
  const [loadedKey, setLoadedKey] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [openState, setOpenState] = useState<{ warehouseId: string; keys: Set<string> }>({ warehouseId, keys: new Set() });

  useEffect(() => {
    fetch("/api/v1/warehouses?pageSize=200")
      .then((res) => res.json())
      .then((body) => setWarehouses(body.data ?? []));
  }, []);

  const requestKey = `${productId}|${warehouseId}`;
  useEffect(() => {
    fetch(`/api/v1/finished-goods-inventory/style-stock/${productId}${warehouseId ? `?warehouseId=${warehouseId}` : ""}`)
      .then(async (res) => {
        const body = await res.json().catch(() => null);
        if (!res.ok) throw new Error(body?.error?.message ?? "Could not load stock.");
        setBreakdown(body.data);
        setError(null);
      })
      .catch((err: Error) => setError(err.message))
      .finally(() => setLoadedKey(requestKey));
  }, [productId, warehouseId, requestKey]);

  const loading = loadedKey !== requestKey;
  // A warehouse change closes every open colour.
  const openKeys = openState.warehouseId === warehouseId ? openState.keys : new Set<string>();
  const setOpenKeys = (next: Set<string>) => setOpenState({ warehouseId, keys: next });

  const visibleColours = useMemo(() => {
    const term = search.trim().toLowerCase();
    if (!breakdown) return [];
    if (!term) return breakdown.colours;
    return breakdown.colours.filter((c) => c.colorName.toLowerCase().includes(term) || c.sizes.some((s) => s.sizeName.toLowerCase().includes(term)));
  }, [breakdown, search]);
  const allVisibleOpen = visibleColours.length > 0 && visibleColours.every((c) => openKeys.has(colourKey(c)));

  // Single-open accordion: opening a colour closes the one open before it.
  function toggle(key: string) {
    setOpenKeys(openKeys.has(key) ? new Set([...openKeys].filter((k) => k !== key)) : new Set([key]));
  }

  return (
    <div className="space-y-4">
      <Breadcrumb
        items={[
          { label: "Dashboard", href: "/dashboard" },
          { label: "Finished Goods Inventory", href: "/finished-goods-inventory" },
          { label: "Stock List", href: "/finished-goods-inventory/stock-list" },
          { label: `${summary.product.styleCode} — ${summary.product.styleName}` },
        ]}
      />
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-lg font-semibold text-zinc-900 dark:text-zinc-50">{summary.product.styleName}</h1>
          <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">Style Code: {summary.product.styleCode}</p>
        </div>
        <div className="flex items-center gap-3">
          {loading && <span className="text-xs text-zinc-500">Refreshing…</span>}
          <div className="w-64">
            <SearchableSelect
              value={warehouseId}
              onChange={setWarehouseId}
              options={warehouses.map((w) => ({ id: w.id, label: w.name ?? w.code ?? "" }))}
              placeholder="Search warehouse…"
              emptyOptionLabel="All Warehouses"
            />
          </div>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
        <StatTile label="Saleable Stock" value={qty(warehouseId && breakdown ? breakdown.saleableStock : summary.saleableQuantity)} />
        <StatTile label="Rejected Stock" value={qty(warehouseId && breakdown ? breakdown.rejectedStock : summary.rejectedQuantity)} />
        <StatTile label="Allocated to Orders" value={qty(summary.allocatedQuantity)} />
        <StatTile label="Available for New Orders" value={qty(summary.unallocatedQuantity)} />
        <StatTile label="Variants Tracked" value={summary.distinctVariantCount} />
        <StatTile label="Warehouses" value={summary.distinctWarehouseCount} />
      </div>
      <p className="text-xs text-zinc-500 dark:text-zinc-400">
        &quot;Allocated to Orders&quot; and &quot;Available for New Orders&quot; are for all warehouses. Allocated is the packed
        quantity still owed to open Sales Orders — informational only; Dispatch re-checks live stock at shipment.
      </p>

      {error ? (
        <p className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700 dark:bg-red-950 dark:text-red-300">{error}</p>
      ) : !breakdown ? (
        <p className="text-sm text-zinc-500">Loading…</p>
      ) : (
        <>
          <div className="space-y-2">
            <h2 className={sectionTitle}>Colour &amp; Size-wise Stock</h2>
            <div className="flex flex-wrap items-center gap-3">
              <input
                type="search"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search colour or size…"
                aria-label="Search colour or size"
                className="w-64 rounded-md border border-zinc-300 bg-white px-3 py-1.5 text-sm dark:border-zinc-700 dark:bg-zinc-900"
              />
              {visibleColours.length > 1 && (
                <button
                  type="button"
                  onClick={() => setOpenKeys(allVisibleOpen ? new Set() : new Set(visibleColours.map(colourKey)))}
                  className="rounded-md border border-zinc-300 px-3 py-1.5 text-sm font-medium text-zinc-700 hover:bg-zinc-50 dark:border-zinc-700 dark:text-zinc-200 dark:hover:bg-zinc-800"
                >
                  {allVisibleOpen ? "Collapse All" : "Expand All"}
                </button>
              )}
            </div>
            <div className={tableWrap}>
              <table className="min-w-full divide-y divide-zinc-200 text-sm dark:divide-zinc-800">
                <thead className={thead}>
                  <tr>
                    <th className="w-10 px-3 py-2" />
                    <th className="px-3 py-2">Colour</th>
                    <th className="px-3 py-2">Sizes</th>
                    <th className="px-3 py-2 text-right">Saleable</th>
                    <th className="px-3 py-2 text-right">Rejected</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-zinc-200 dark:divide-zinc-800">
                  {visibleColours.length === 0 ? (
                    <tr>
                      <td colSpan={5} className="px-3 py-6 text-center text-zinc-500">
                        {breakdown.colours.length === 0 ? "No stock of this style is on hand." : "No colour or size matches your search."}
                      </td>
                    </tr>
                  ) : (
                    visibleColours.map((colour) => {
                      const key = colourKey(colour);
                      const open = openKeys.has(key);
                      return (
                        <Fragment key={key}>
                          <tr className={`cursor-pointer ${open ? OPEN_COLOUR_ROW : "hover:bg-zinc-50 dark:hover:bg-zinc-900"}`} onClick={() => toggle(key)}>
                            <td className={`border-l-4 px-3 py-2 ${open ? "border-l-indigo-500" : "border-l-transparent"}`}>
                              <button
                                type="button"
                                aria-expanded={open}
                                aria-label={`${open ? "Collapse" : "Expand"} ${colour.colorName}`}
                                onClick={(e) => {
                                  e.stopPropagation();
                                  toggle(key);
                                }}
                                className="rounded p-1 text-zinc-500 hover:bg-zinc-100 dark:hover:bg-zinc-800"
                              >
                                <Chevron open={open} />
                              </button>
                            </td>
                            <td className="px-3 py-2 font-medium text-zinc-900 dark:text-zinc-50">
                              <span className="flex items-center gap-2">
                                {colour.hexValue && <span className="h-3 w-3 rounded-full border border-zinc-300" style={{ backgroundColor: colour.hexValue }} />}
                                {colour.colorName}
                              </span>
                            </td>
                            <td className="px-3 py-2 text-zinc-600 dark:text-zinc-300">
                              {colour.sizes.map((s) => `${s.sizeName}: ${qty(s.saleableQuantity + s.rejectedQuantity)}`).join(", ")}
                            </td>
                            <td className="px-3 py-2 text-right font-medium">{qty(colour.saleableQuantity)}</td>
                            <td className="px-3 py-2 text-right">{qty(colour.rejectedQuantity)}</td>
                          </tr>
                          {open && (
                            <tr>
                              <td colSpan={5} className={OPEN_COLOUR_PANEL}>
                                <div className={PANEL_CARD}>
                                <PanelTitle colour={colour} detail={`${colour.sizes.length} size${colour.sizes.length === 1 ? "" : "s"}`} />
                                <table className="min-w-full text-xs">
                                  <thead className="bg-zinc-100 text-left font-semibold text-zinc-700 dark:bg-zinc-800 dark:text-zinc-200">
                                    <tr>
                                      <th className="px-2 py-1.5">Size</th>
                                      <th className="px-2 py-1.5 text-right">Saleable</th>
                                      <th className="px-2 py-1.5 text-right">Rejected</th>
                                      <th className="px-2 py-1.5">Warehouse / Location</th>
                                    </tr>
                                  </thead>
                                  <tbody className="divide-y divide-zinc-200 dark:divide-zinc-800">
                                    {colour.sizes.map((s) => (
                                      <tr key={s.sizeId ?? "none"}>
                                        <td className="px-2 py-1.5 font-medium">{s.sizeName}</td>
                                        <td className="px-2 py-1.5 text-right font-medium">{qty(s.saleableQuantity)}</td>
                                        <td className="px-2 py-1.5 text-right">{qty(s.rejectedQuantity)}</td>
                                        <td className="px-2 py-1.5 text-zinc-600 dark:text-zinc-300">
                                          {s.places.map((p) => `${p.label}: ${qty(p.quantity)}`).join(", ")}
                                        </td>
                                      </tr>
                                    ))}
                                  </tbody>
                                </table>
                                </div>
                              </td>
                            </tr>
                          )}
                        </Fragment>
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>
          </div>

          <div className="space-y-2">
            <h2 className={sectionTitle}>Warehouse-wise Stock</h2>
            <div className={tableWrap}>
              <table className="min-w-full divide-y divide-zinc-200 text-sm dark:divide-zinc-800">
                <thead className={thead}>
                  <tr>
                    <th className="px-3 py-2">Warehouse</th>
                    <th className="px-3 py-2">Location(s)</th>
                    <th className="px-3 py-2 text-right">Saleable</th>
                    <th className="px-3 py-2 text-right">Rejected</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-zinc-200 dark:divide-zinc-800">
                  {breakdown.warehouses.length === 0 ? (
                    <tr>
                      <td colSpan={4} className="px-3 py-6 text-center text-zinc-500">
                        No stock of this style is on hand.
                      </td>
                    </tr>
                  ) : (
                    breakdown.warehouses.map((w) => (
                      <tr key={w.warehouseId}>
                        <td className="px-3 py-2 font-medium text-zinc-900 dark:text-zinc-50">{w.warehouseName}</td>
                        <td className="px-3 py-2 text-zinc-600 dark:text-zinc-300">{w.locations.map((l) => `${l.label}: ${qty(l.quantity)}`).join(", ")}</td>
                        <td className="px-3 py-2 text-right font-medium">{qty(w.saleableQuantity)}</td>
                        <td className="px-3 py-2 text-right">{qty(w.rejectedQuantity)}</td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
