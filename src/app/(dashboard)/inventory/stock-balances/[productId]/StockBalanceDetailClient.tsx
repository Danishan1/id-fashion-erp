"use client";

import { Fragment, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Breadcrumb } from "@/components/ui/Breadcrumb";
import { SearchableSelect } from "@/components/ui/SearchableSelect";

interface FabricSpec {
  shadeCode: string | null;
  shadeName: string | null;
  pantone: string | null;
  composition: string | null;
  gsm: string | null;
  width: string | null;
  construction: string | null;
  rollCount: number;
  initialQuantity: number;
  availableQuantity: number;
}

interface FabricRollRow {
  id: string;
  rollNumber: string;
  lotNumber: string;
  shadeCode: string | null;
  shadeName: string | null;
  composition: string | null;
  gsm: string | null;
  width: string | null;
  construction: string | null;
  warehouseName: string;
  locationLabel: string | null;
  initialQuantity: number;
  remainingQuantity: number;
}

interface FabricColour {
  colorId: string | null;
  colorName: string;
  hexValue: string | null;
  rollCount: number;
  shades: string[];
  initialQuantity: number;
  availableQuantity: number;
  specs: FabricSpec[];
  rolls: FabricRollRow[];
}

interface ColourBalance {
  colorId: string;
  colorName: string;
  hexValue: string | null;
  quantity: number;
  warehouses: Array<{ warehouseName: string; quantity: number }>;
}

interface WarehouseStock {
  warehouseId: string;
  warehouseName: string;
  quantity: number;
  locations: Array<{ label: string; quantity: number }>;
  unassignedQuantity: number;
}

interface StockDetail {
  materialId: string;
  materialName: string;
  materialCode: string;
  materialCategory: string | null;
  unit: string | null;
  breakdownMode: "ROLL" | "COLOUR" | "PLAIN";
  totalStock: number;
  reservedStock: number;
  availableStock: number;
  rollCount: number;
  rolledStock: number;
  notRollTrackedStock: number;
  colours: FabricColour[];
  colourBalances: ColourBalance[];
  noColourStock: number;
  warehouses: WarehouseStock[];
}

const colourKey = (c: FabricColour) => c.colorId ?? "none";
const dash = (v: string | null) => v || "—";

function shadeLabel(code: string | null, name: string | null, pantone?: string | null) {
  if (!code && !name) return "—";
  const main = code && name && code !== name ? `${code} · ${name}` : code || name;
  return pantone ? `${main} (${pantone})` : main;
}

function Chevron({ open }: { open: boolean }) {
  return (
    <svg viewBox="0 0 20 20" fill="currentColor" aria-hidden className={`h-4 w-4 transition-transform ${open ? "rotate-90" : ""}`}>
      <path fillRule="evenodd" d="M7.2 14.8a.75.75 0 0 1 0-1.06L10.94 10 7.2 6.26a.75.75 0 1 1 1.06-1.06l4.27 4.27a.75.75 0 0 1 0 1.06l-4.27 4.27a.75.75 0 0 1-1.06 0Z" clipRule="evenodd" />
    </svg>
  );
}

function Summary({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-zinc-200 bg-white px-4 py-3 dark:border-zinc-800 dark:bg-zinc-900">
      <div className="text-xs text-zinc-500 dark:text-zinc-400">{label}</div>
      <div className="mt-1 text-base font-semibold text-zinc-900 dark:text-zinc-50">{value}</div>
    </div>
  );
}

const titleCase = (v: string) => v.charAt(0) + v.slice(1).toLowerCase();

const sectionTitle = "text-sm font-semibold text-zinc-900 dark:text-zinc-50";
const tableWrap = "overflow-x-auto rounded-lg border border-zinc-200 dark:border-zinc-800";
const thead = "bg-zinc-100 text-left text-xs font-semibold uppercase text-zinc-700 dark:bg-zinc-800 dark:text-zinc-200";
// An open colour is tinted and edged in indigo, and its detail panel carries the same edge plus a thick bottom border,
// so it is clear where one colour ends and the next begins.
const OPEN_COLOUR_ROW = "bg-indigo-50 dark:bg-indigo-950/40";
const OPEN_COLOUR_PANEL = "border-b-4 border-l-4 border-b-zinc-300 border-l-indigo-500 bg-indigo-50/50 px-4 pb-5 pt-3 dark:border-b-zinc-700 dark:bg-indigo-950/20";
const PANEL_CARD = "rounded-lg border border-indigo-200 bg-white p-3 shadow-sm dark:border-indigo-900 dark:bg-zinc-900";

function ColourDot({ hex }: { hex: string | null }) {
  return hex ? <span className="h-3 w-3 rounded-full border border-zinc-300" style={{ backgroundColor: hex }} /> : null;
}

export function StockBalanceDetailClient({ productId }: { productId: string }) {
  const searchParams = useSearchParams();
  const [warehouseId, setWarehouseId] = useState(searchParams.get("warehouseId") ?? "");
  const [warehouses, setWarehouses] = useState<Array<{ id: string; name: string }>>([]);
  const [detail, setDetail] = useState<StockDetail | null>(null);
  const [loadedKey, setLoadedKey] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/v1/warehouses?pageSize=200")
      .then((res) => res.json())
      .then((body) => setWarehouses(body.data ?? []));
  }, []);

  const requestKey = `${productId}|${warehouseId}`;
  useEffect(() => {
    fetch(`/api/v1/inventory/stock-balances/${productId}${warehouseId ? `?warehouseId=${warehouseId}` : ""}`)
      .then(async (res) => {
        const body = await res.json().catch(() => null);
        if (!res.ok) throw new Error(body?.error?.message ?? "Could not load stock.");
        setDetail(body.data);
        setError(null);
      })
      .catch((err: Error) => setError(err.message))
      .finally(() => setLoadedKey(requestKey));
  }, [productId, warehouseId, requestKey]);

  const loading = loadedKey !== requestKey;
  const unit = detail?.unit ?? "";
  const qty = (n: number) => `${n.toLocaleString("en-IN")}${unit ? ` ${unit}` : ""}`;

  return (
    <div className="space-y-4">
      <Breadcrumb
        items={[
          { label: "Dashboard", href: "/dashboard" },
          { label: "Stock Balances", href: "/inventory/stock-balances" },
          { label: detail?.materialName ?? "Material" },
        ]}
      />

      {error ? (
        <p className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700 dark:bg-red-950 dark:text-red-300">{error}</p>
      ) : !detail ? (
        <p className="text-sm text-zinc-500">Loading…</p>
      ) : (
        <>
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <h1 className="text-lg font-semibold text-zinc-900 dark:text-zinc-50">{detail.materialName}</h1>
              <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">
                Code: {detail.materialCode}
                {detail.materialCategory ? ` · ${titleCase(detail.materialCategory)}` : ""}
                {" · "}
                <Link href={`/masters/materials/${detail.materialId}/stock-history`} className="text-indigo-600 hover:underline dark:text-indigo-400">
                  Stock history
                </Link>
              </p>
            </div>
            <div className="flex items-center gap-3">
              {loading && <span className="text-xs text-zinc-500">Refreshing…</span>}
              <div className="w-64">
                <SearchableSelect
                  value={warehouseId}
                  onChange={setWarehouseId}
                  options={warehouses.map((w) => ({ id: w.id, label: w.name }))}
                  placeholder="Search warehouse…"
                  emptyOptionLabel="All Warehouses"
                />
              </div>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <Summary label="Total Stock" value={qty(detail.totalStock)} />
            <Summary label="Available Stock" value={qty(detail.availableStock)} />
            <Summary label="Reserved Stock" value={qty(detail.reservedStock)} />
            {detail.breakdownMode === "ROLL" ? (
              <Summary label="Total Rolls" value={detail.rollCount.toLocaleString("en-IN")} />
            ) : detail.breakdownMode === "COLOUR" ? (
              <Summary label="Colours" value={detail.colourBalances.length.toLocaleString("en-IN")} />
            ) : (
              <Summary label="Warehouses" value={detail.warehouses.length.toLocaleString("en-IN")} />
            )}
          </div>

          {detail.breakdownMode === "ROLL" && <RollStock detail={detail} qty={qty} warehouseId={warehouseId} />}
          {detail.breakdownMode === "COLOUR" && <ColourStock detail={detail} qty={qty} />}

          <WarehouseStockTable detail={detail} qty={qty} />
        </>
      )}
    </div>
  );
}

function ColourStock({ detail, qty }: { detail: StockDetail; qty: (n: number) => string }) {
  return (
    <div className="space-y-2">
      <h2 className={sectionTitle}>Colour-wise Stock</h2>
      <div className={tableWrap}>
        <table className="min-w-full divide-y divide-zinc-200 text-sm dark:divide-zinc-800">
          <thead className={thead}>
            <tr>
              <th className="px-3 py-2">Colour</th>
              <th className="px-3 py-2">Warehouse</th>
              <th className="px-3 py-2 text-right">Available Quantity</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-zinc-200 dark:divide-zinc-800">
            {detail.colourBalances.map((c) => (
              <tr key={c.colorId}>
                <td className="px-3 py-2 font-medium text-zinc-900 dark:text-zinc-50">
                  <span className="flex items-center gap-2">
                    <ColourDot hex={c.hexValue} />
                    {c.colorName}
                  </span>
                </td>
                <td className="px-3 py-2 text-zinc-600 dark:text-zinc-300">
                  {c.warehouses.map((w) => `${w.warehouseName}: ${qty(w.quantity)}`).join(", ")}
                </td>
                <td className="px-3 py-2 text-right font-medium">{qty(c.quantity)}</td>
              </tr>
            ))}
            {detail.noColourStock > 0 && (
              <tr>
                <td className="px-3 py-2 text-zinc-500">No colour recorded</td>
                <td className="px-3 py-2 text-zinc-500">—</td>
                <td className="px-3 py-2 text-right font-medium">{qty(detail.noColourStock)}</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function WarehouseStockTable({ detail, qty }: { detail: StockDetail; qty: (n: number) => string }) {
  return (
    <div className="space-y-2">
      <h2 className={sectionTitle}>Warehouse-wise Stock</h2>
      <div className={tableWrap}>
        <table className="min-w-full divide-y divide-zinc-200 text-sm dark:divide-zinc-800">
          <thead className={thead}>
            <tr>
              <th className="px-3 py-2">Warehouse</th>
              <th className="px-3 py-2">Location(s)</th>
              <th className="px-3 py-2 text-right">Quantity On Hand</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-zinc-200 dark:divide-zinc-800">
            {detail.warehouses.length === 0 ? (
              <tr>
                <td colSpan={3} className="px-3 py-6 text-center text-zinc-500">
                  No stock of this material is on hand.
                </td>
              </tr>
            ) : (
              detail.warehouses.map((w) => {
                const parts = w.locations.map((l) => `${l.label}: ${qty(l.quantity)}`);
                if (w.unassignedQuantity > 0 && w.locations.length > 0) parts.push(`No location: ${qty(w.unassignedQuantity)}`);
                return (
                  <tr key={w.warehouseId}>
                    <td className="px-3 py-2 font-medium text-zinc-900 dark:text-zinc-50">{w.warehouseName}</td>
                    <td className="px-3 py-2 text-zinc-600 dark:text-zinc-300">{parts.length ? parts.join(", ") : "—"}</td>
                    <td className="px-3 py-2 text-right font-medium">{qty(w.quantity)}</td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function RollStock({ detail, qty, warehouseId }: { detail: StockDetail; qty: (n: number) => string; warehouseId: string }) {
  const unit = detail.unit ?? "";
  const [search, setSearch] = useState("");
  const [openState, setOpenState] = useState<{ warehouseId: string; keys: Set<string> }>({ warehouseId, keys: new Set() });
  // A warehouse change closes every open colour.
  const openKeys = openState.warehouseId === warehouseId ? openState.keys : new Set<string>();
  const setOpenKeys = (next: (prev: Set<string>) => Set<string>) => setOpenState({ warehouseId, keys: next(openKeys) });

  const visibleColours = useMemo(() => {
    const term = search.trim().toLowerCase();
    if (!term) return detail.colours;
    return detail.colours.filter(
      (c) => c.colorName.toLowerCase().includes(term) || c.shades.some((s) => s.toLowerCase().includes(term))
    );
  }, [detail, search]);

  const allVisibleOpen = visibleColours.length > 0 && visibleColours.every((c) => openKeys.has(colourKey(c)));

  // Single-open accordion: opening a colour closes the one open before it.
  function toggle(key: string) {
    setOpenKeys((prev) => (prev.has(key) ? new Set([...prev].filter((k) => k !== key)) : new Set([key])));
  }

  function toggleAll() {
    setOpenKeys(() => (allVisibleOpen ? new Set() : new Set(visibleColours.map(colourKey))));
  }

  return (
    <div className="space-y-2">
      <h2 className={sectionTitle}>Colour &amp; Roll-wise Stock</h2>
      {detail.notRollTrackedStock > 0 && (
        <p className="rounded-md bg-amber-50 px-3 py-2 text-sm text-amber-800 dark:bg-amber-950 dark:text-amber-200">
          {qty(detail.notRollTrackedStock)} of the total isn&apos;t on any roll (for example opening stock, or an issue made
          without picking a roll), so it isn&apos;t shown under a colour below.
        </p>
      )}
      {detail.rolledStock > detail.totalStock + 0.0001 && (
        <p className="rounded-md bg-amber-50 px-3 py-2 text-sm text-amber-800 dark:bg-amber-950 dark:text-amber-200">
          The rolls hold {qty(detail.rolledStock)}, more than the ledger total. Some stock was issued without picking a roll.
        </p>
      )}

      <div className="flex flex-wrap items-center gap-3">
        <input
          type="search"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search colour or shade…"
          aria-label="Search colour"
          className="w-64 rounded-md border border-zinc-300 bg-white px-3 py-1.5 text-sm dark:border-zinc-700 dark:bg-zinc-900"
        />
        {visibleColours.length > 1 && (
          <button
            type="button"
            onClick={toggleAll}
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
              <th className="px-3 py-2 text-right">Rolls</th>
              <th className="px-3 py-2">Shade</th>
              <th className="px-3 py-2 text-right">Available Quantity</th>
              <th className="px-3 py-2">Unit</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-zinc-200 dark:divide-zinc-800">
            {visibleColours.length === 0 ? (
              <tr>
                <td colSpan={6} className="px-3 py-6 text-center text-zinc-500">
                  {detail.colours.length === 0 ? "No rolls of this material are in stock." : "No colour matches your search."}
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
                          <ColourDot hex={colour.hexValue} />
                          {colour.colorName}
                        </span>
                      </td>
                      <td className="px-3 py-2 text-right">{colour.rollCount}</td>
                      <td className="px-3 py-2">{colour.shades.length ? colour.shades.join(", ") : "—"}</td>
                      <td className="px-3 py-2 text-right">{colour.availableQuantity.toLocaleString("en-IN")}</td>
                      <td className="px-3 py-2">{unit || "—"}</td>
                    </tr>
                    {open && (
                      <tr>
                        <td colSpan={6} className={OPEN_COLOUR_PANEL}>
                          <ColourDetail colour={colour} qty={qty} />
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
  );
}

function ColourDetail({ colour, qty }: { colour: FabricColour; qty: (n: number) => string }) {
  const cell = "px-2 py-1.5";
  return (
    <div className={`space-y-4 ${PANEL_CARD}`}>
      <div className="flex items-center gap-2 text-sm font-semibold text-indigo-700 dark:text-indigo-300">
        {colour.hexValue && <span className="h-3 w-3 rounded-full border border-zinc-300" style={{ backgroundColor: colour.hexValue }} />}
        {colour.colorName}
        <span className="text-xs font-normal text-zinc-500 dark:text-zinc-400">
          · {colour.rollCount} roll{colour.rollCount === 1 ? "" : "s"}
        </span>
      </div>
      <div>
        <h3 className="mb-2 text-xs font-semibold uppercase text-zinc-500">Fabric Specifications</h3>
        <div className="overflow-x-auto">
          <table className="min-w-full text-xs">
            <thead className="bg-zinc-100 text-left font-semibold text-zinc-700 dark:bg-zinc-800 dark:text-zinc-200">
              <tr>
                <th className={cell}>Colour</th>
                <th className={cell}>Shade</th>
                <th className={cell}>Composition</th>
                <th className={cell}>GSM</th>
                <th className={cell}>Width</th>
                <th className={cell}>Construction</th>
                <th className={`${cell} text-right`}>Rolls</th>
                <th className={`${cell} text-right`}>Total Quantity</th>
                <th className={`${cell} text-right`}>Available Quantity</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-200 dark:divide-zinc-800">
              {colour.specs.map((spec, i) => (
                <tr key={i}>
                  <td className={cell}>{colour.colorName}</td>
                  <td className={cell}>{shadeLabel(spec.shadeCode, spec.shadeName, spec.pantone)}</td>
                  <td className={cell}>{dash(spec.composition)}</td>
                  <td className={cell}>{dash(spec.gsm)}</td>
                  <td className={cell}>{dash(spec.width)}</td>
                  <td className={cell}>{dash(spec.construction)}</td>
                  <td className={`${cell} text-right`}>{spec.rollCount}</td>
                  <td className={`${cell} text-right`}>{qty(spec.initialQuantity)}</td>
                  <td className={`${cell} text-right font-medium`}>{qty(spec.availableQuantity)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <div>
        <h3 className="mb-2 text-xs font-semibold uppercase text-zinc-500">Rolls</h3>
        <div className="overflow-x-auto">
          <table className="min-w-full text-xs">
            <thead className="bg-zinc-100 text-left font-semibold text-zinc-700 dark:bg-zinc-800 dark:text-zinc-200">
              <tr>
                <th className={cell}>Roll No.</th>
                <th className={cell}>Lot/Batch No.</th>
                <th className={cell}>Shade</th>
                <th className={cell}>Composition</th>
                <th className={`${cell} text-right`}>GSM</th>
                <th className={cell}>Width</th>
                <th className={cell}>Warehouse/Bin</th>
                <th className={`${cell} text-right`}>Initial Qty</th>
                <th className={`${cell} text-right`}>Remaining Qty</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-200 dark:divide-zinc-800">
              {colour.rolls.map((roll) => (
                <tr key={roll.id}>
                  <td className={`${cell} font-medium`}>{roll.rollNumber}</td>
                  <td className={cell}>{roll.lotNumber}</td>
                  <td className={cell}>{shadeLabel(roll.shadeCode, roll.shadeName)}</td>
                  <td className={cell}>{dash(roll.composition)}</td>
                  <td className={`${cell} text-right`}>{dash(roll.gsm)}</td>
                  <td className={cell}>{dash(roll.width)}</td>
                  <td className={cell}>
                    {roll.warehouseName}
                    {roll.locationLabel ? ` / ${roll.locationLabel}` : ""}
                  </td>
                  <td className={`${cell} text-right`}>{qty(roll.initialQuantity)}</td>
                  <td className={`${cell} text-right font-medium`}>{qty(roll.remainingQuantity)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
