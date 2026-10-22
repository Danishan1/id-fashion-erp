"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Breadcrumb } from "@/components/ui/Breadcrumb";

/**
 * Finished Goods Receive (2026-10-22): goods packed by Production or sent
 * back by a customer wait here. They are not in Finished Goods stock until
 * received — choose the location (per line, or tick lines and set one for
 * all), then Receive. A fully received line leaves this list.
 */

interface PendingLine {
  id: string;
  quantity: string | number;
  receivedQuantity: string | number;
  pendingQuantity: number;
  suggestedLocationId: string | null;
  productVariant: { color: { name: string }; size: { name: string } } | null;
  finishedGoodsReceipt: {
    id: string;
    receiptNumber: string;
    source: "PRODUCTION" | "CUSTOMER_RETURN";
    postedAt: string;
    remarks: string | null;
    warehouseId: string;
    warehouse: { id: string; name: string };
    product: { id: string; styleCode: string; styleName: string };
    lot: { id: string; lotNumber: string } | null;
    productionOrder: { id: string; orderNumber: string } | null;
    dispatch: { id: string; dispatchNumber: string } | null;
    dispatchReturn: { id: string; returnNumber: string } | null;
  };
}

interface LocationRef {
  id: string;
  code: string;
  isActive?: boolean;
}

interface Draft {
  locationId: string;
  quantity: string;
  remarks: string;
}

const inputClass =
  "w-full rounded-md border border-zinc-300 bg-white px-2 py-1.5 text-sm text-zinc-900 focus:border-indigo-500 focus:outline-none dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-50";

export function ReceiveFinishedGoodsClient({ canEdit }: { canEdit: boolean }) {
  const [lines, setLines] = useState<PendingLine[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [locationsByWarehouse, setLocationsByWarehouse] = useState<Record<string, LocationRef[]>>({});
  const [drafts, setDrafts] = useState<Record<string, Draft>>({});
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [bulkLocation, setBulkLocation] = useState<Record<string, string>>({});
  const [sourceFilter, setSourceFilter] = useState<"" | "PRODUCTION" | "CUSTOMER_RETURN">("");
  const [search, setSearch] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const [lineErrors, setLineErrors] = useState<Record<string, string>>({});

  const load = useCallback(async () => {
    const res = await fetch("/api/v1/finished-goods-inventory/receive");
    if (!res.ok) {
      setLoadError("Could not load goods waiting to be received.");
      return;
    }
    const data = ((await res.json()).data ?? []) as PendingLine[];
    setLines(data);
    setSelected(new Set());
    setDrafts({});
    const warehouseIds = [...new Set(data.map((l) => l.finishedGoodsReceipt.warehouseId))];
    const entries = await Promise.all(
      warehouseIds.map(async (id) => {
        const body = await (await fetch(`/api/v1/warehouses/${id}`)).json();
        return [id, ((body.data?.locations ?? []) as LocationRef[]).filter((l) => l.isActive !== false)] as const;
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
    return (lines ?? []).filter((l) => {
      const r = l.finishedGoodsReceipt;
      if (sourceFilter && r.source !== sourceFilter) return false;
      if (!term) return true;
      return [
        r.receiptNumber,
        r.product.styleCode,
        r.product.styleName,
        l.productVariant?.color.name ?? "",
        l.productVariant?.size.name ?? "",
        r.lot?.lotNumber ?? "",
        r.productionOrder?.orderNumber ?? "",
        r.dispatch?.dispatchNumber ?? "",
        r.dispatchReturn?.returnNumber ?? "",
      ]
        .join(" ")
        .toLowerCase()
        .includes(term);
    });
  }, [lines, search, sourceFilter]);

  const defaultDraft = (l: PendingLine): Draft => ({
    locationId: l.suggestedLocationId ?? "",
    quantity: String(l.pendingQuantity),
    remarks: "",
  });
  const draftOf = (l: PendingLine) => drafts[l.id] ?? defaultDraft(l);
  const setDraft = (l: PendingLine, patch: Partial<Draft>) =>
    setDrafts((prev) => ({ ...prev, [l.id]: { ...(prev[l.id] ?? defaultDraft(l)), ...patch } }));

  const toggle = (id: string) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  const allVisibleSelected = visible.length > 0 && visible.every((l) => selected.has(l.id));
  const toggleAll = () => setSelected(allVisibleSelected ? new Set() : new Set(visible.map((l) => l.id)));

  const selectedLines = (lines ?? []).filter((l) => selected.has(l.id));
  const selectedWarehouses = [...new Set(selectedLines.map((l) => l.finishedGoodsReceipt.warehouseId))];

  const applyBulk = () =>
    setDrafts((prev) => {
      const next = { ...prev };
      for (const l of selectedLines) {
        const loc = bulkLocation[l.finishedGoodsReceipt.warehouseId];
        if (loc) next[l.id] = { ...(next[l.id] ?? defaultDraft(l)), locationId: loc };
      }
      return next;
    });

  const needsLocation = (l: PendingLine) => (locationsByWarehouse[l.finishedGoodsReceipt.warehouseId] ?? []).length > 0;
  const lineReady = (l: PendingLine) => {
    const d = draftOf(l);
    return Number(d.quantity) > 0 && Number(d.quantity) <= l.pendingQuantity && (!needsLocation(l) || !!d.locationId);
  };
  // Receive the ticked lines; with nothing ticked, every line that is ready.
  const toReceive = (selected.size > 0 ? selectedLines : lines ?? []).filter(lineReady);

  const submit = async () => {
    setBusy(true);
    setMessage(null);
    setLineErrors({});
    const batch = toReceive;
    const res = await fetch("/api/v1/finished-goods-inventory/receive", {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-toast": "errors" },
      body: JSON.stringify({
        lines: batch.map((l) => ({
          receiptItemId: l.id,
          quantity: Number(draftOf(l).quantity),
          warehouseLocationId: draftOf(l).locationId || null,
          remarks: draftOf(l).remarks.trim() || null,
        })),
      }),
    });
    const body = await res.json().catch(() => null);
    setBusy(false);
    if (!res.ok) {
      setMessage({ ok: false, text: body?.error?.message ?? "Could not receive the goods." });
      return;
    }
    const { received, failed, results } = body.data as {
      received: number;
      failed: number;
      results: Array<{ index: number; ok: boolean; error?: string }>;
    };
    const errors: Record<string, string> = {};
    for (const r of results) if (!r.ok && r.error) errors[batch[r.index].id] = r.error;
    await load();
    setLineErrors(errors);
    setMessage({
      ok: failed === 0,
      text: failed === 0 ? `${received} line(s) received into Finished Goods stock.` : `Received ${received} line(s); ${failed} could not be received (see below).`,
    });
  };

  const sourceLabel = (l: PendingLine) => {
    const r = l.finishedGoodsReceipt;
    if (r.source === "CUSTOMER_RETURN") {
      return (
        <>
          <span className="rounded-full bg-rose-100 px-2 py-0.5 text-xs font-medium text-rose-800 dark:bg-rose-950/50 dark:text-rose-300">Customer return</span>
          <div className="mt-1 text-xs text-zinc-500">
            {r.dispatchReturn?.returnNumber}
            {r.dispatch && (
              <>
                {" · "}
                <Link href={`/dispatch/${r.dispatch.id}`} className="text-indigo-600 hover:underline dark:text-indigo-400">
                  {r.dispatch.dispatchNumber}
                </Link>
              </>
            )}
          </div>
        </>
      );
    }
    return (
      <>
        <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-xs font-medium text-emerald-800 dark:bg-emerald-950/50 dark:text-emerald-300">From packing</span>
        <div className="mt-1 text-xs text-zinc-500">
          {r.productionOrder?.orderNumber}
          {r.lot ? ` · Lot ${r.lot.lotNumber}` : ""}
        </div>
      </>
    );
  };

  const totalPending = (lines ?? []).reduce((sum, l) => sum + l.pendingQuantity, 0);

  return (
    <div className="space-y-4">
      <div>
        <Breadcrumb items={[{ label: "Finished Goods Inventory", href: "/finished-goods-inventory" }, { label: "Receive" }]} />
        <h1 className="mt-2 text-lg font-semibold text-zinc-900 dark:text-zinc-50">Receive Finished Goods</h1>
        <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">
          Goods packed by Production and goods returned by customers wait here. They are added to Finished Goods stock
          only when you receive them — choose the location for each line (or tick lines and set one location), then
          click Receive.
        </p>
      </div>

      {loadError && <p className="text-sm text-red-600 dark:text-red-400">{loadError}</p>}
      {message && (
        <p
          className={`rounded-md px-3 py-2 text-sm ${
            message.ok ? "bg-emerald-50 text-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-300" : "bg-amber-50 text-amber-800 dark:bg-amber-950/40 dark:text-amber-300"
          }`}
        >
          {message.text}
        </p>
      )}

      {lines === null && !loadError ? (
        <p className="text-sm text-zinc-500">Loading…</p>
      ) : lines && lines.length === 0 ? (
        <p className="rounded-lg border border-zinc-200 p-6 text-center text-sm text-zinc-500 dark:border-zinc-800">
          Nothing waiting to be received.
        </p>
      ) : (
        <>
          <div className="flex flex-wrap items-end gap-3">
            <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search receipt, style, order, lot, dispatch…" className={`${inputClass} max-w-xs`} />
            <select value={sourceFilter} onChange={(e) => setSourceFilter(e.target.value as typeof sourceFilter)} className={`${inputClass} w-48`} aria-label="Filter by source">
              <option value="">All sources</option>
              <option value="PRODUCTION">From packing</option>
              <option value="CUSTOMER_RETURN">Customer returns</option>
            </select>
            <span className="text-xs text-zinc-500">
              {lines?.length ?? 0} lines · {totalPending} pcs waiting
            </span>
          </div>

          {canEdit && selected.size > 0 && (
            <div className="flex flex-wrap items-center gap-3 rounded-lg border border-indigo-200 bg-indigo-50/60 p-3 text-sm dark:border-indigo-800 dark:bg-indigo-950/30">
              <span className="font-medium text-indigo-900 dark:text-indigo-200">{selected.size} selected — set location:</span>
              {selectedWarehouses.map((wid) => {
                const name = selectedLines.find((l) => l.finishedGoodsReceipt.warehouseId === wid)?.finishedGoodsReceipt.warehouse.name ?? "";
                return (
                  <label key={wid} className="flex items-center gap-2">
                    {selectedWarehouses.length > 1 && <span className="text-xs text-zinc-600 dark:text-zinc-300">{name}</span>}
                    <select
                      aria-label={`Location for selected lines in ${name}`}
                      value={bulkLocation[wid] ?? ""}
                      onChange={(e) => setBulkLocation((prev) => ({ ...prev, [wid]: e.target.value }))}
                      className={`${inputClass} w-44`}
                    >
                      <option value="">— Location —</option>
                      {(locationsByWarehouse[wid] ?? []).map((loc) => (
                        <option key={loc.id} value={loc.id}>
                          {loc.code}
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
                      <input type="checkbox" checked={allVisibleSelected} onChange={toggleAll} aria-label="Select all lines" />
                    </th>
                  )}
                  <th className="px-3 py-2 font-medium">Receipt</th>
                  <th className="px-3 py-2 font-medium">From</th>
                  <th className="px-3 py-2 font-medium">Style</th>
                  <th className="px-3 py-2 font-medium">Colour / Size</th>
                  <th className="px-3 py-2 font-medium">Warehouse</th>
                  <th className="px-3 py-2 text-right font-medium">Waiting</th>
                  {canEdit && <th className="px-3 py-2 font-medium">Receive qty</th>}
                  {canEdit && <th className="px-3 py-2 font-medium">Location</th>}
                  {canEdit && <th className="px-3 py-2 font-medium">Remark</th>}
                </tr>
              </thead>
              <tbody>
                {visible.map((l) => {
                  const r = l.finishedGoodsReceipt;
                  const d = draftOf(l);
                  const over = Number(d.quantity) > l.pendingQuantity;
                  const locations = locationsByWarehouse[r.warehouseId] ?? [];
                  const variant = l.productVariant ? `${l.productVariant.color.name} / ${l.productVariant.size.name}` : "—";
                  return (
                    <tr key={l.id} className="border-b border-zinc-100 align-top last:border-0 dark:border-zinc-800">
                      {canEdit && (
                        <td className="px-3 py-2">
                          <input type="checkbox" checked={selected.has(l.id)} onChange={() => toggle(l.id)} aria-label={`Select ${r.receiptNumber} ${variant}`} />
                        </td>
                      )}
                      <td className="px-3 py-2">
                        <Link href={`/finished-goods-inventory/receipts/${r.id}`} className="font-medium text-indigo-600 hover:underline dark:text-indigo-400">
                          {r.receiptNumber}
                        </Link>
                      </td>
                      <td className="px-3 py-2">{sourceLabel(l)}</td>
                      <td className="px-3 py-2">
                        <div className="font-medium text-zinc-900 dark:text-zinc-50">{r.product.styleCode}</div>
                        <div className="text-xs text-zinc-500">{r.product.styleName}</div>
                      </td>
                      <td className="px-3 py-2">{variant}</td>
                      <td className="px-3 py-2">{r.warehouse.name}</td>
                      <td className="px-3 py-2 text-right font-medium">{l.pendingQuantity}</td>
                      {canEdit && (
                        <td className="px-3 py-2">
                          <input
                            type="number"
                            min={1}
                            max={l.pendingQuantity}
                            value={d.quantity}
                            onChange={(e) => setDraft(l, { quantity: e.target.value })}
                            aria-label={`Receive quantity for ${r.receiptNumber} ${variant}`}
                            className={`${inputClass} w-24 ${over ? "border-red-500" : ""}`}
                          />
                        </td>
                      )}
                      {canEdit && (
                        <td className="px-3 py-2">
                          {locations.length > 0 ? (
                            <select
                              aria-label={`Location for ${r.receiptNumber} ${variant}`}
                              value={d.locationId}
                              onChange={(e) => setDraft(l, { locationId: e.target.value })}
                              className={`${inputClass} w-40`}
                            >
                              <option value="">— Location —</option>
                              {locations.map((loc) => (
                                <option key={loc.id} value={loc.id}>
                                  {loc.code}
                                  {loc.id === l.suggestedLocationId ? " (picked from)" : ""}
                                </option>
                              ))}
                            </select>
                          ) : (
                            <span className="text-xs text-zinc-500">No locations in this warehouse</span>
                          )}
                          {lineErrors[l.id] && <p className="mt-1 text-xs text-red-600 dark:text-red-400">{lineErrors[l.id]}</p>}
                        </td>
                      )}
                      {canEdit && (
                        <td className="px-3 py-2">
                          <input value={d.remarks} onChange={(e) => setDraft(l, { remarks: e.target.value })} placeholder="optional" className={`${inputClass} w-40`} />
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
              <span className="text-xs text-zinc-500">
                {toReceive.length} line(s) ready{selected.size > 0 ? " of the selected" : ""} — a line needs a location before it can be received
              </span>
              <button
                type="button"
                onClick={submit}
                disabled={busy || toReceive.length === 0}
                className="rounded-md bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-500 disabled:opacity-60"
              >
                {busy ? "Receiving…" : `Receive (${toReceive.reduce((sum, l) => sum + Number(draftOf(l).quantity), 0)} pcs)`}
              </button>
            </div>
          )}
        </>
      )}
    </div>
  );
}
