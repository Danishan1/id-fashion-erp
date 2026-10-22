"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Breadcrumb } from "@/components/ui/Breadcrumb";

/**
 * Unlocated stock (2026-10-22): Finished Goods received at a warehouse but
 * not yet put away to a location. Pick a location per row, or tick rows and
 * set one location for all of them, then Update Locations. A row whose whole
 * quantity got a location drops off this list.
 */

interface StagingRow {
  id: string;
  productId: string;
  productVariantId: string;
  warehouseId: string;
  stockStatus: "SALEABLE" | "REJECTED";
  quantityOnHand: string | number;
  product: { id: string; styleCode: string; styleName: string };
  productVariant: { color: { name: string }; size: { name: string } };
  warehouse: { id: string; name: string };
}

interface LocationRef {
  id: string;
  code: string;
  isActive?: boolean;
}

interface Draft {
  locationId: string;
  quantity: string;
}

const inputClass =
  "w-full rounded-md border border-zinc-300 bg-white px-2 py-1.5 text-sm text-zinc-900 focus:border-indigo-500 focus:outline-none dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-50";

export function UnlocatedStockClient({ canEdit }: { canEdit: boolean }) {
  const [rows, setRows] = useState<StagingRow[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [locationsByWarehouse, setLocationsByWarehouse] = useState<Record<string, LocationRef[]>>({});
  const [drafts, setDrafts] = useState<Record<string, Draft>>({});
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [bulkLocation, setBulkLocation] = useState<Record<string, string>>({});
  const [search, setSearch] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const [rowErrors, setRowErrors] = useState<Record<string, string>>({});

  const load = useCallback(async () => {
    const res = await fetch("/api/v1/finished-goods-inventory/unlocated");
    if (!res.ok) {
      setLoadError("Could not load unlocated stock.");
      return;
    }
    const data = ((await res.json()).data ?? []) as StagingRow[];
    setRows(data);
    setSelected(new Set());
    setDrafts({});
    const warehouseIds = [...new Set(data.map((r) => r.warehouseId))];
    const entries = await Promise.all(
      warehouseIds.map(async (id) => {
        const body = await (await fetch(`/api/v1/warehouses/${id}`)).json();
        const locations = ((body.data?.locations ?? []) as LocationRef[]).filter((l) => l.isActive !== false);
        return [id, locations] as const;
      })
    );
    setLocationsByWarehouse(Object.fromEntries(entries));
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- initial load
    void load();
  }, [load]);

  const visible = useMemo(() => {
    const term = search.trim().toLowerCase();
    if (!rows) return [];
    if (!term) return rows;
    return rows.filter((r) =>
      [r.product.styleCode, r.product.styleName, r.productVariant.color.name, r.productVariant.size.name, r.warehouse.name]
        .join(" ")
        .toLowerCase()
        .includes(term)
    );
  }, [rows, search]);

  const qtyOf = (r: StagingRow) => Number(r.quantityOnHand);
  const draftOf = (r: StagingRow): Draft => drafts[r.id] ?? { locationId: "", quantity: String(qtyOf(r)) };
  const setDraft = (id: string, patch: Partial<Draft>, row: StagingRow) =>
    setDrafts((prev) => ({ ...prev, [id]: { ...(prev[id] ?? { locationId: "", quantity: String(qtyOf(row)) }), ...patch } }));

  const toggle = (id: string) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  const allVisibleSelected = visible.length > 0 && visible.every((r) => selected.has(r.id));
  const toggleAll = () => setSelected(allVisibleSelected ? new Set() : new Set(visible.map((r) => r.id)));

  const selectedWarehouses = [...new Set((rows ?? []).filter((r) => selected.has(r.id)).map((r) => r.warehouseId))];

  const applyBulk = () => {
    setDrafts((prev) => {
      const next = { ...prev };
      for (const r of rows ?? []) {
        const loc = bulkLocation[r.warehouseId];
        if (selected.has(r.id) && loc) next[r.id] = { ...(next[r.id] ?? { locationId: "", quantity: String(qtyOf(r)) }), locationId: loc };
      }
      return next;
    });
  };

  const ready = (rows ?? []).filter((r) => {
    const d = draftOf(r);
    return d.locationId && Number(d.quantity) > 0;
  });

  const submit = async () => {
    setBusy(true);
    setMessage(null);
    setRowErrors({});
    const payloadRows = ready.map((r) => ({
      productId: r.productId,
      productVariantId: r.productVariantId,
      warehouseId: r.warehouseId,
      stockStatus: r.stockStatus,
      warehouseLocationId: draftOf(r).locationId,
      quantity: Number(draftOf(r).quantity),
    }));
    const res = await fetch("/api/v1/finished-goods-inventory/unlocated/putaway", {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-toast": "errors" },
      body: JSON.stringify({ rows: payloadRows }),
    });
    const body = await res.json().catch(() => null);
    setBusy(false);
    if (!res.ok) {
      setMessage({ ok: false, text: body?.error?.message ?? "Could not update locations." });
      return;
    }
    const { updated, failed, results } = body.data as {
      updated: number;
      failed: number;
      results: Array<{ index: number; ok: boolean; error?: string }>;
    };
    const errors: Record<string, string> = {};
    for (const r of results) if (!r.ok && r.error) errors[ready[r.index].id] = r.error;
    await load();
    setRowErrors(errors);
    setMessage({
      ok: failed === 0,
      text: failed === 0 ? `Location updated for ${updated} row(s).` : `Updated ${updated} row(s); ${failed} could not be updated (see below).`,
    });
  };

  const totalPcs = (rows ?? []).reduce((sum, r) => sum + qtyOf(r), 0);

  return (
    <div className="space-y-4">
      <div>
        <Breadcrumb
          items={[
            { label: "Finished Goods Inventory", href: "/finished-goods-inventory" },
            { label: "Unlocated Stock" },
          ]}
        />
        <h1 className="mt-2 text-lg font-semibold text-zinc-900 dark:text-zinc-50">Unlocated Stock</h1>
        <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">
          Finished goods received at a warehouse but not yet put away to a location. Choose a location for each row —
          or tick rows and set one location for all of them — then click Update Locations. Rows that get a location for
          their whole quantity leave this list.
        </p>
      </div>

      {loadError && <p className="text-sm text-red-600 dark:text-red-400">{loadError}</p>}
      {message && (
        <p
          className={`rounded-md px-3 py-2 text-sm ${
            message.ok
              ? "bg-emerald-50 text-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-300"
              : "bg-amber-50 text-amber-800 dark:bg-amber-950/40 dark:text-amber-300"
          }`}
        >
          {message.text}
        </p>
      )}

      {rows === null && !loadError ? (
        <p className="text-sm text-zinc-500">Loading…</p>
      ) : rows && rows.length === 0 ? (
        <p className="rounded-lg border border-zinc-200 p-6 text-center text-sm text-zinc-500 dark:border-zinc-800">
          All finished goods have a location. Nothing to put away.
        </p>
      ) : (
        <>
          <div className="flex flex-wrap items-end gap-3">
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search style, colour, size, warehouse…"
              className={`${inputClass} max-w-xs`}
            />
            <span className="text-xs text-zinc-500">
              {rows?.length ?? 0} rows · {totalPcs} pcs without a location
            </span>
          </div>

          {canEdit && selected.size > 0 && (
            <div className="flex flex-wrap items-center gap-3 rounded-lg border border-indigo-200 bg-indigo-50/60 p-3 text-sm dark:border-indigo-800 dark:bg-indigo-950/30">
              <span className="font-medium text-indigo-900 dark:text-indigo-200">{selected.size} selected — set location:</span>
              {selectedWarehouses.map((wid) => {
                const name = rows?.find((r) => r.warehouseId === wid)?.warehouse.name ?? "";
                return (
                  <label key={wid} className="flex items-center gap-2">
                    {selectedWarehouses.length > 1 && <span className="text-xs text-zinc-600 dark:text-zinc-300">{name}</span>}
                    <select
                      aria-label={`Location for selected rows in ${name}`}
                      value={bulkLocation[wid] ?? ""}
                      onChange={(e) => setBulkLocation((prev) => ({ ...prev, [wid]: e.target.value }))}
                      className={`${inputClass} w-44`}
                    >
                      <option value="">— Location —</option>
                      {(locationsByWarehouse[wid] ?? []).map((l) => (
                        <option key={l.id} value={l.id}>
                          {l.code}
                        </option>
                      ))}
                    </select>
                  </label>
                );
              })}
              <button
                type="button"
                onClick={applyBulk}
                disabled={!selectedWarehouses.some((wid) => bulkLocation[wid])}
                className="rounded-md border border-indigo-300 px-3 py-1.5 text-xs font-medium text-indigo-700 hover:bg-indigo-100 disabled:opacity-50 dark:border-indigo-700 dark:text-indigo-300"
              >
                Apply to selected
              </button>
            </div>
          )}

          <div className="overflow-x-auto rounded-lg border border-zinc-200 dark:border-zinc-800">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-zinc-200 text-left text-xs uppercase tracking-wide text-zinc-500 dark:border-zinc-800 dark:text-zinc-400">
                  {canEdit && (
                    <th className="px-3 py-2">
                      <input type="checkbox" checked={allVisibleSelected} onChange={toggleAll} aria-label="Select all rows" />
                    </th>
                  )}
                  <th className="px-3 py-2 font-medium">Style</th>
                  <th className="px-3 py-2 font-medium">Colour / Size</th>
                  <th className="px-3 py-2 font-medium">Status</th>
                  <th className="px-3 py-2 font-medium">Warehouse</th>
                  <th className="px-3 py-2 text-right font-medium">Unlocated Qty</th>
                  {canEdit && <th className="px-3 py-2 font-medium">Qty to put away</th>}
                  {canEdit && <th className="px-3 py-2 font-medium">Location</th>}
                </tr>
              </thead>
              <tbody>
                {visible.map((r) => {
                  const d = draftOf(r);
                  const over = Number(d.quantity) > qtyOf(r);
                  return (
                    <tr key={r.id} className="border-b border-zinc-100 align-top last:border-0 dark:border-zinc-800">
                      {canEdit && (
                        <td className="px-3 py-2">
                          <input type="checkbox" checked={selected.has(r.id)} onChange={() => toggle(r.id)} aria-label={`Select ${r.product.styleCode} ${r.productVariant.color.name} ${r.productVariant.size.name}`} />
                        </td>
                      )}
                      <td className="px-3 py-2">
                        <div className="font-medium text-zinc-900 dark:text-zinc-50">{r.product.styleCode}</div>
                        <div className="text-xs text-zinc-500">{r.product.styleName}</div>
                      </td>
                      <td className="px-3 py-2">
                        {r.productVariant.color.name} / {r.productVariant.size.name}
                      </td>
                      <td className="px-3 py-2">{r.stockStatus === "SALEABLE" ? "Saleable" : "Rejected"}</td>
                      <td className="px-3 py-2">{r.warehouse.name}</td>
                      <td className="px-3 py-2 text-right font-medium">{qtyOf(r)}</td>
                      {canEdit && (
                        <td className="px-3 py-2">
                          <input
                            type="number"
                            min={1}
                            max={qtyOf(r)}
                            value={d.quantity}
                            onChange={(e) => setDraft(r.id, { quantity: e.target.value }, r)}
                            className={`${inputClass} w-24 ${over ? "border-red-500" : ""}`}
                          />
                        </td>
                      )}
                      {canEdit && (
                        <td className="px-3 py-2">
                          <select
                            aria-label={`Location for ${r.product.styleCode} ${r.productVariant.color.name} ${r.productVariant.size.name}`}
                            value={d.locationId}
                            onChange={(e) => setDraft(r.id, { locationId: e.target.value }, r)}
                            className={`${inputClass} w-44`}
                          >
                            <option value="">— Location —</option>
                            {(locationsByWarehouse[r.warehouseId] ?? []).map((l) => (
                              <option key={l.id} value={l.id}>
                                {l.code}
                              </option>
                            ))}
                          </select>
                          {(locationsByWarehouse[r.warehouseId] ?? []).length === 0 && (
                            <p className="mt-1 text-xs text-amber-700 dark:text-amber-400">This warehouse has no locations yet.</p>
                          )}
                          {rowErrors[r.id] && <p className="mt-1 text-xs text-red-600 dark:text-red-400">{rowErrors[r.id]}</p>}
                        </td>
                      )}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {canEdit && (
            <div className="flex items-center justify-end gap-3">
              <span className="text-xs text-zinc-500">{ready.length} row(s) ready</span>
              <button
                type="button"
                onClick={submit}
                disabled={busy || ready.length === 0 || ready.some((r) => Number(draftOf(r).quantity) > qtyOf(r))}
                className="rounded-md bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-500 disabled:opacity-60"
              >
                {busy ? "Updating…" : `Update Locations (${ready.length})`}
              </button>
            </div>
          )}
        </>
      )}
    </div>
  );
}
