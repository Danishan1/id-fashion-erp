"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState, type FormEvent } from "react";
import { FormField, textInputClass } from "@/components/ui/FormField";
import { SearchableSelect } from "@/components/ui/SearchableSelect";
import { todayIsoDate } from "@/lib/date";
import { useSubmoduleVisibility } from "@/lib/use-submodule-visibility";

interface Line {
  purchaseOrderItemId: string;
  productId: string;
  styleName: string;
  styleCode: string;
  materialCategory: string | null;
  colorName: string | null;
  shadeName: string | null;
  uomCode: string;
  orderedQuantity: string;
  receivedQuantity: string;
  remainingQuantity: string;
}

interface Option {
  id: string;
  name: string;
  code?: string;
}

interface LocationOption {
  id: string;
  code: string;
}

interface RollDraft {
  rollNumber: string;
  rollQuantity: string;
  batchNo: string;
  gsmId: string;
  dyeId: string;
  weaveTypeId: string;
  widthId: string;
  compositionId: string;
}

interface LineDraft {
  receivedQuantity: string;
  warehouseId: string;
  warehouseLocationId: string;
  notes: string;
  rolls: RollDraft[];
}

function emptyRoll(): RollDraft {
  return { rollNumber: "", rollQuantity: "", batchNo: "", gsmId: "", dyeId: "", weaveTypeId: "", widthId: "", compositionId: "" };
}

function emptyDraft(): LineDraft {
  return { receivedQuantity: "", warehouseId: "", warehouseLocationId: "", notes: "", rolls: [] };
}

const TODAY = todayIsoDate();

export function GoodsReceiptForm({ purchaseOrderId, lines }: { purchaseOrderId: string; lines: Line[] }) {
  const router = useRouter();
  const isVisible = useSubmoduleVisibility();
  const [receivedDate, setReceivedDate] = useState(TODAY);
  const [drafts, setDrafts] = useState<Record<string, LineDraft>>(
    Object.fromEntries(lines.map((l) => [l.purchaseOrderItemId, emptyDraft()]))
  );
  const [warehouses, setWarehouses] = useState<Option[]>([]);
  const [locationsByWarehouse, setLocationsByWarehouse] = useState<Record<string, LocationOption[]>>({});
  const [gsms, setGsms] = useState<Option[]>([]);
  const [dyes, setDyes] = useState<Option[]>([]);
  const [weaveTypes, setWeaveTypes] = useState<Option[]>([]);
  const [widths, setWidths] = useState<Option[]>([]);
  const [compositions, setCompositions] = useState<Option[]>([]);
  const [invoiceFile, setInvoiceFile] = useState<File | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  // One value for the lifetime of this mounted form — reused on every submit
  // attempt (a double-click, or a manual retry after a network error shown
  // below), so the server can recognize a retry of the SAME create as the
  // same physical event rather than a second one. See CF-5 in the
  // independent hardening audit.
  const [idempotencyKey] = useState(() => crypto.randomUUID());

  useEffect(() => {
    fetch("/api/v1/warehouses?pageSize=200").then((res) => res.json()).then((body) => setWarehouses(body.data ?? []));
    fetch("/api/v1/fabric-gsms").then((res) => res.json()).then((body) => setGsms(body.data ?? []));
    fetch("/api/v1/fabric-dyes").then((res) => res.json()).then((body) => setDyes(body.data ?? []));
    fetch("/api/v1/fabric-weave-types").then((res) => res.json()).then((body) => setWeaveTypes(body.data ?? []));
    fetch("/api/v1/fabric-widths").then((res) => res.json()).then((body) => setWidths(body.data ?? []));
    fetch("/api/v1/fabric-compositions").then((res) => res.json()).then((body) => setCompositions(body.data ?? []));
  }, []);

  const updateDraft = (itemId: string, patch: Partial<LineDraft>) => {
    setDrafts((prev) => ({ ...prev, [itemId]: { ...prev[itemId], ...patch } }));
  };

  const onWarehouseChange = (itemId: string, warehouseId: string) => {
    updateDraft(itemId, { warehouseId, warehouseLocationId: "" });
    if (warehouseId && !locationsByWarehouse[warehouseId]) {
      fetch(`/api/v1/warehouses/${warehouseId}`)
        .then((res) => res.json())
        .then((body) => setLocationsByWarehouse((prev) => ({ ...prev, [warehouseId]: body.data?.locations ?? [] })));
    }
  };

  const addRoll = (itemId: string) => {
    updateDraft(itemId, { rolls: [...drafts[itemId].rolls, emptyRoll()] });
  };
  const updateRoll = (itemId: string, rollIndex: number, patch: Partial<RollDraft>) => {
    const rolls = drafts[itemId].rolls.map((r, i) => (i === rollIndex ? { ...r, ...patch } : r));
    updateDraft(itemId, { rolls });
  };
  const removeRoll = (itemId: string, rollIndex: number) => {
    updateDraft(itemId, { rolls: drafts[itemId].rolls.filter((_, i) => i !== rollIndex) });
  };

  const rollSum = (itemId: string) => drafts[itemId].rolls.reduce((sum, r) => sum + (Number(r.rollQuantity) || 0), 0);

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (isSubmitting) return;
    setIsSubmitting(true);
    setError(null);

    const items = Object.entries(drafts)
      .filter(([, d]) => Number(d.receivedQuantity) > 0)
      .map(([purchaseOrderItemId, d]) => ({
        purchaseOrderItemId,
        receivedQuantity: Number(d.receivedQuantity),
        warehouseId: d.warehouseId,
        warehouseLocationId: d.warehouseLocationId || undefined,
        notes: d.notes || undefined,
        rolls: d.rolls.map((r) => ({
          rollNumber: r.rollNumber,
          rollQuantity: Number(r.rollQuantity),
          batchNo: r.batchNo || undefined,
          gsmId: r.gsmId || undefined,
          dyeId: r.dyeId || undefined,
          weaveTypeId: r.weaveTypeId || undefined,
          widthId: r.widthId || undefined,
          compositionId: r.compositionId || undefined,
        })),
      }));

    if (items.length === 0) {
      setError("Enter a received quantity for at least one line.");
      setIsSubmitting(false);
      return;
    }

    try {
      const res = await fetch(`/api/v1/purchase-orders/${purchaseOrderId}/receipts`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ receivedDate, items, idempotencyKey }),
      });

      if (!res.ok) {
        const body = await res.json().catch(() => null);
        setError(body?.error?.message ?? "Failed to record this goods receipt.");
        return;
      }

      const { data } = await res.json();

      // Uploaded after the receipt itself is created, since the attachment
      // route is scoped to a real receipt id — a failed upload here is
      // surfaced but never rolls back the (already-successful) receipt; the
      // user can always attach the invoice/slip again from the receipt's own
      // detail page.
      if (invoiceFile) {
        const formData = new FormData();
        formData.append("file", invoiceFile);
        const uploadRes = await fetch(`/api/v1/goods-receipts/${data.id}/attachments`, { method: "POST", body: formData });
        if (!uploadRes.ok) {
          const body = await uploadRes.json().catch(() => null);
          setError(
            `Goods receipt ${data.receiptNumber ?? ""} was recorded, but the attachment failed to upload: ${body?.error?.message ?? "unknown error"}. You can upload it again from the receipt's own page.`
          );
          setIsSubmitting(false);
          return;
        }
      }

      router.push(`/goods-receipts/${data.id}`);
      router.refresh();
    } catch {
      // A genuine network failure (not a server-returned error) — the exact
      // "response lost to a network blip" scenario this key exists for.
      // Re-enabling the button lets the user retry with the SAME key below,
      // instead of the button staying permanently disabled with no recourse.
      setError("Could not reach the server. Check your connection and try again — it's safe to resubmit.");
    } finally {
      setIsSubmitting(false);
    }
  };

  if (lines.length === 0) {
    return <p className="text-sm text-zinc-500">Every line on this order has already been fully received.</p>;
  }

  return (
    <form onSubmit={handleSubmit} className="max-w-3xl space-y-6">
      <FormField label="Received Date" htmlFor="receivedDate" required>
        <input
          id="receivedDate"
          type="date"
          required
          value={receivedDate}
          onChange={(e) => setReceivedDate(e.target.value)}
          className={textInputClass()}
        />
      </FormField>

      <FormField label="Invoice / Delivery Slip (optional)" htmlFor="invoiceFile">
        <input
          id="invoiceFile"
          type="file"
          onChange={(e) => setInvoiceFile(e.target.files?.[0] ?? null)}
          className="block w-full text-sm text-zinc-600 file:mr-3 file:rounded-md file:border-0 file:bg-indigo-50 file:px-3 file:py-1.5 file:text-sm file:font-medium file:text-indigo-600 hover:file:bg-indigo-100 dark:text-zinc-300 dark:file:bg-indigo-500/10 dark:file:text-indigo-300"
        />
      </FormField>

      <div className="space-y-4">
        {lines.map((line) => {
          const draft = drafts[line.purchaseOrderItemId];
          const isFabric = line.materialCategory === "FABRIC";
          const locations = locationsByWarehouse[draft.warehouseId] ?? [];

          return (
            <div key={line.purchaseOrderItemId} className="space-y-3 rounded-lg border border-zinc-200 p-4 dark:border-zinc-800">
              <div className="flex items-center justify-between">
                <p className="text-sm font-medium text-zinc-900 dark:text-zinc-50">
                  {line.styleName} <span className="text-xs text-zinc-400">({line.styleCode})</span>
                  {isFabric && (
                    <span className="ml-1 rounded bg-indigo-50 px-1.5 py-0.5 text-[10px] font-medium text-indigo-600 dark:bg-indigo-500/10 dark:text-indigo-300">
                      Fabric — roll tracking required
                    </span>
                  )}
                  {(line.colorName || line.shadeName) && (
                    <span className="ml-1 rounded bg-zinc-100 px-1.5 py-0.5 text-[10px] font-medium text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300">
                      {[line.colorName, line.shadeName].filter(Boolean).join(" / ")}
                    </span>
                  )}
                </p>
                <p className="text-xs text-zinc-500">
                  Ordered {line.orderedQuantity} {line.uomCode} · Received so far {line.receivedQuantity} · Remaining{" "}
                  {line.remainingQuantity}
                </p>
              </div>

              <div className="grid grid-cols-3 gap-3">
                <FormField label={`Receiving Now (${line.uomCode})`} htmlFor={`qty-${line.purchaseOrderItemId}`}>
                  <input
                    id={`qty-${line.purchaseOrderItemId}`}
                    type="number"
                    min={0}
                    step="0.0001"
                    value={draft.receivedQuantity}
                    onChange={(e) => updateDraft(line.purchaseOrderItemId, { receivedQuantity: e.target.value })}
                    className={textInputClass()}
                  />
                  {/* Enter exactly what physically arrived — no cap against
                      what's still "remaining" on the order. This is purely
                      an informational readout of the gap, never a block. */}
                  {draft.receivedQuantity !== "" &&
                    (() => {
                      const variance = Number(draft.receivedQuantity) - Number(line.remainingQuantity);
                      if (!Number.isFinite(variance) || variance === 0) return null;
                      const short = variance < 0;
                      return (
                        <p className={`mt-1 text-xs font-medium ${short ? "text-amber-600 dark:text-amber-400" : "text-sky-600 dark:text-sky-400"}`}>
                          {short ? `Short by ${Math.abs(variance)}` : `Extra by ${variance}`} {line.uomCode}
                        </p>
                      );
                    })()}
                </FormField>
                <FormField label="Warehouse" htmlFor={`warehouse-${line.purchaseOrderItemId}`}>
                  <SearchableSelect
                    id={`warehouse-${line.purchaseOrderItemId}`}
                    value={draft.warehouseId}
                    onChange={(warehouseId) => onWarehouseChange(line.purchaseOrderItemId, warehouseId)}
                    options={warehouses.map((w) => ({ id: w.id, label: w.name }))}
                    placeholder="Search warehouse…"
                  />
                </FormField>
                <FormField label="Location (optional)" htmlFor={`location-${line.purchaseOrderItemId}`}>
                  <select
                    id={`location-${line.purchaseOrderItemId}`}
                    value={draft.warehouseLocationId}
                    onChange={(e) => updateDraft(line.purchaseOrderItemId, { warehouseLocationId: e.target.value })}
                    disabled={!draft.warehouseId}
                    className={textInputClass()}
                  >
                    <option value="">— None —</option>
                    {locations.map((l) => (
                      <option key={l.id} value={l.id}>
                        {l.code}
                      </option>
                    ))}
                  </select>
                </FormField>
              </div>

              {Number(draft.receivedQuantity) > 0 && isFabric && (
                <div className="space-y-2 rounded-md border border-dashed border-zinc-300 p-3 dark:border-zinc-700">
                  <div className="flex items-center justify-between">
                    <p className="text-xs font-medium text-zinc-600 dark:text-zinc-300">
                      Rolls — sum {rollSum(line.purchaseOrderItemId)} must equal {draft.receivedQuantity}
                    </p>
                    <button
                      type="button"
                      onClick={() => addRoll(line.purchaseOrderItemId)}
                      className="text-xs font-medium text-indigo-600 hover:text-indigo-500"
                    >
                      + Add Roll
                    </button>
                  </div>

                  {draft.rolls.map((roll, rollIndex) => (
                    <div key={rollIndex} className="grid grid-cols-6 gap-2 rounded-md border border-zinc-200 p-2 dark:border-zinc-800">
                      <input
                        placeholder="Roll No."
                        value={roll.rollNumber}
                        onChange={(e) => updateRoll(line.purchaseOrderItemId, rollIndex, { rollNumber: e.target.value })}
                        className={textInputClass()}
                      />
                      <input
                        type="number"
                        min={0}
                        step="0.0001"
                        placeholder="Qty"
                        value={roll.rollQuantity}
                        onChange={(e) => updateRoll(line.purchaseOrderItemId, rollIndex, { rollQuantity: e.target.value })}
                        className={textInputClass()}
                      />
                      <input
                        placeholder="Batch No."
                        value={roll.batchNo}
                        onChange={(e) => updateRoll(line.purchaseOrderItemId, rollIndex, { batchNo: e.target.value })}
                        className={textInputClass()}
                      />
                      {isVisible("FABRIC_GSM") && (
                        <select
                          value={roll.gsmId}
                          onChange={(e) => updateRoll(line.purchaseOrderItemId, rollIndex, { gsmId: e.target.value })}
                          className={textInputClass()}
                        >
                          <option value="">GSM</option>
                          {gsms.map((g) => (
                            <option key={g.id} value={g.id}>
                              {g.name}
                            </option>
                          ))}
                        </select>
                      )}
                      {isVisible("FABRIC_DYE") && (
                        <select
                          value={roll.dyeId}
                          onChange={(e) => updateRoll(line.purchaseOrderItemId, rollIndex, { dyeId: e.target.value })}
                          className={textInputClass()}
                        >
                          <option value="">Dye/Color</option>
                          {dyes.map((d) => (
                            <option key={d.id} value={d.id}>
                              {d.name}
                            </option>
                          ))}
                        </select>
                      )}
                      <div className="flex items-center gap-1">
                        {isVisible("FABRIC_WIDTH") && (
                          <select
                            value={roll.widthId}
                            onChange={(e) => updateRoll(line.purchaseOrderItemId, rollIndex, { widthId: e.target.value })}
                            className={textInputClass()}
                          >
                            <option value="">Width</option>
                            {widths.map((w) => (
                              <option key={w.id} value={w.id}>
                                {w.name}
                              </option>
                            ))}
                          </select>
                        )}
                        <button
                          type="button"
                          onClick={() => removeRoll(line.purchaseOrderItemId, rollIndex)}
                          className="text-xs font-medium text-red-600 hover:text-red-500"
                        >
                          ✕
                        </button>
                      </div>
                      {isVisible("FABRIC_WEAVE_TYPE") && (
                        <select
                          value={roll.weaveTypeId}
                          onChange={(e) => updateRoll(line.purchaseOrderItemId, rollIndex, { weaveTypeId: e.target.value })}
                          className={`${textInputClass()} col-span-2`}
                        >
                          <option value="">Weave Type</option>
                          {weaveTypes.map((w) => (
                            <option key={w.id} value={w.id}>
                              {w.name}
                            </option>
                          ))}
                        </select>
                      )}
                      {isVisible("FABRIC_COMPOSITION") && (
                        <select
                          value={roll.compositionId}
                          onChange={(e) => updateRoll(line.purchaseOrderItemId, rollIndex, { compositionId: e.target.value })}
                          className={`${textInputClass()} col-span-2`}
                        >
                          <option value="">Composition</option>
                          {compositions.map((c) => (
                            <option key={c.id} value={c.id}>
                              {c.name}
                            </option>
                          ))}
                        </select>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </div>

      {error && <p className="text-sm text-red-600 dark:text-red-400">{error}</p>}

      <button
        type="submit"
        disabled={isSubmitting}
        className="rounded-md bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-500 disabled:opacity-60"
      >
        {isSubmitting ? "Saving…" : "Record Goods Receipt"}
      </button>
    </form>
  );
}
