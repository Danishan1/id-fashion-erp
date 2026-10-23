"use client";

import { Fragment, useEffect, useMemo, useState } from "react";
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

interface FabricStockDetail {
  fabricId: string;
  fabricName: string;
  fabricCode: string;
  unit: string | null;
  totalStock: number;
  reservedStock: number;
  availableStock: number;
  rollCount: number;
  rolledStock: number;
  notRollTrackedStock: number;
  colours: FabricColour[];
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

export function FabricStockDetailClient({ productId }: { productId: string }) {
  const searchParams = useSearchParams();
  const [warehouseId, setWarehouseId] = useState(searchParams.get("warehouseId") ?? "");
  const [warehouses, setWarehouses] = useState<Array<{ id: string; name: string }>>([]);
  const [detail, setDetail] = useState<FabricStockDetail | null>(null);
  const [loadedKey, setLoadedKey] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [openKeys, setOpenKeys] = useState<Set<string>>(new Set());

  useEffect(() => {
    fetch("/api/v1/warehouses?pageSize=200")
      .then((res) => res.json())
      .then((body) => setWarehouses(body.data ?? []));
  }, []);

  const requestKey = `${productId}|${warehouseId}`;
  useEffect(() => {
    fetch(`/api/v1/inventory/fabric-stock/${productId}${warehouseId ? `?warehouseId=${warehouseId}` : ""}`)
      .then(async (res) => {
        const body = await res.json().catch(() => null);
        if (!res.ok) throw new Error(body?.error?.message ?? "Could not load fabric stock.");
        setDetail(body.data);
        setError(null);
      })
      .catch((err: Error) => setError(err.message))
      .finally(() => setLoadedKey(requestKey));
  }, [productId, warehouseId, requestKey]);

  const loading = loadedKey !== requestKey;
  const unit = detail?.unit ?? "";
  const qty = (n: number) => `${n.toLocaleString("en-IN")}${unit ? ` ${unit}` : ""}`;

  const visibleColours = useMemo(() => {
    const term = search.trim().toLowerCase();
    if (!detail) return [];
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
    setOpenKeys(allVisibleOpen ? new Set() : new Set(visibleColours.map(colourKey)));
  }

  return (
    <div className="space-y-4">
      <Breadcrumb
        items={[
          { label: "Dashboard", href: "/dashboard" },
          { label: "Fabric Stock", href: "/inventory/fabric-stock" },
          { label: detail?.fabricName ?? "Fabric" },
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
              <h1 className="text-lg font-semibold text-zinc-900 dark:text-zinc-50">{detail.fabricName}</h1>
              <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">Fabric Code: {detail.fabricCode}</p>
            </div>
            <div className="w-64">
              <SearchableSelect
                value={warehouseId}
                onChange={(id) => {
                  setWarehouseId(id);
                  setOpenKeys(new Set());
                }}
                options={warehouses.map((w) => ({ id: w.id, label: w.name }))}
                placeholder="Search warehouse…"
                emptyOptionLabel="All Warehouses"
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <Summary label="Total Stock" value={qty(detail.totalStock)} />
            <Summary label="Available Stock" value={qty(detail.availableStock)} />
            <Summary label="Reserved Stock" value={qty(detail.reservedStock)} />
            <Summary label="Total Rolls" value={detail.rollCount.toLocaleString("en-IN")} />
          </div>

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
            {loading && <span className="text-xs text-zinc-500">Refreshing…</span>}
          </div>

          <div className="overflow-x-auto rounded-lg border border-zinc-200 dark:border-zinc-800">
            <table className="min-w-full divide-y divide-zinc-200 text-sm dark:divide-zinc-800">
              <thead className="bg-zinc-50 text-left text-xs font-medium uppercase text-zinc-500 dark:bg-zinc-900 dark:text-zinc-400">
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
                      {detail.colours.length === 0 ? "No rolls of this fabric are in stock." : "No colour matches your search."}
                    </td>
                  </tr>
                ) : (
                  visibleColours.map((colour) => {
                    const key = colourKey(colour);
                    const open = openKeys.has(key);
                    return (
                      <Fragment key={key}>
                        <tr
                          className="cursor-pointer hover:bg-zinc-50 dark:hover:bg-zinc-900"
                          onClick={() => toggle(key)}
                        >
                          <td className="px-3 py-2">
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
                              {colour.hexValue && (
                                <span className="h-3 w-3 rounded-full border border-zinc-300" style={{ backgroundColor: colour.hexValue }} />
                              )}
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
                            <td colSpan={6} className="bg-zinc-50 px-4 py-4 dark:bg-zinc-950">
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
        </>
      )}
    </div>
  );
}

function ColourDetail({ colour, qty }: { colour: FabricColour; qty: (n: number) => string }) {
  const cell = "px-2 py-1.5";
  return (
    <div className="space-y-4">
      <div>
        <h3 className="mb-2 text-xs font-semibold uppercase text-zinc-500">Fabric Specifications</h3>
        <div className="overflow-x-auto">
          <table className="min-w-full text-xs">
            <thead className="text-left text-zinc-500">
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
            <thead className="text-left text-zinc-500">
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
