"use client";

import { useEffect, useState } from "react";
import { Breadcrumb } from "@/components/ui/Breadcrumb";
import { Button } from "@/components/ui/Button";
import { FormField, textInputClass } from "@/components/ui/FormField";

interface GarmentProvenance {
  id: string;
  unitCode: string;
  status: string;
  product: {
    id: string;
    styleCode: string;
    styleName: string;
  };
  productVariant: {
    id: string;
    skuCode: string;
    color: { name: string };
    size: { name: string };
  };
  productionOrder: {
    id: string;
    orderNumber: string;
    status: string;
  };
  lot: {
    id: string;
    lotNumber: string;
    status: string;
  };
  salesOrder?: {
    id: string;
    orderNumber: string;
    customer: {
      id: string;
      name: string;
    };
  } | null;
  carton?: {
    id: string;
    cartonNumber: number;
    dispatch: {
      id: string;
      dispatchNumber: string;
      status: string;
      dispatchedAt: string | null;
    };
  } | null;
  dispatch?: {
    id: string;
    dispatchNumber: string;
    status: string;
    dispatchedAt: string | null;
  } | null;
  events: Array<{
    id: string;
    eventType: string;
    fromStatus: string | null;
    toStatus: string;
    remarks: string | null;
    createdAt: string;
  }>;
}

interface WarehouseOption {
  id: string;
  name: string;
}

interface CustomerReturnRow {
  id: string;
  returnNumber: string;
  status: string;
  createdAt: string;
  remarks: string | null;
  customer: {
    id: string;
    name: string;
  };
  salesOrder?: {
    id: string;
    orderNumber: string;
  } | null;
  receivedBy: {
    fullName: string;
  };
  items: Array<{
    id: string;
    returnReason: string;
    condition: string;
    disposition: string;
    remarks: string | null;
    productUnit: {
      unitCode: string;
      product: {
        styleCode: string;
        styleName: string;
      };
      productVariant: {
        skuCode: string;
        color: { name: string };
        size: { name: string };
      };
    };
  }>;
}

export function CustomerReturnsClient() {
  const [barcodeInput, setBarcodeInput] = useState("");
  const [isSearching, setIsSearching] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);
  const [provenance, setProvenance] = useState<GarmentProvenance | null>(null);

  // Return Form State
  const [returnReason, setReturnReason] = useState("SIZE_FIT_ISSUE");
  const [condition, setCondition] = useState<"GOOD" | "DAMAGED" | "DEFECTIVE" | "WRONG_ITEM">("GOOD");
  const [disposition, setDisposition] = useState<"RESTOCK" | "REWORK" | "QUARANTINE" | "SCRAP">("RESTOCK");
  const [restockWarehouseId, setRestockWarehouseId] = useState("");
  const [returnRemarks, setReturnRemarks] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [successBanner, setSuccessBanner] = useState<string | null>(null);

  // Options & List State
  const [warehouses, setWarehouses] = useState<WarehouseOption[]>([]);
  const [returnsList, setReturnsList] = useState<CustomerReturnRow[]>([]);
  const [isLoadingReturns, setIsLoadingReturns] = useState(true);

  const loadReturns = async () => {
    setIsLoadingReturns(true);
    try {
      const res = await fetch("/api/v1/returns");
      const json = await res.json();
      if (json.data) {
        setReturnsList(json.data);
      }
    } catch {
      // ignore
    } finally {
      setIsLoadingReturns(false);
    }
  };

  // Load warehouses & past returns. isLoadingReturns already starts true
  // (useState(true) above), so the mount case never needs loadReturns' own
  // synchronous setIsLoadingReturns(true) call — only its eventual false,
  // set here inside .finally() rather than by calling loadReturns() directly
  // from the effect body (which would call setState synchronously).
  useEffect(() => {
    fetch("/api/v1/warehouses")
      .then((r) => r.json())
      .then((res) => {
        if (res.data) setWarehouses(res.data);
      })
      .catch(() => {});

    fetch("/api/v1/returns")
      .then((r) => r.json())
      .then((json) => {
        if (json.data) setReturnsList(json.data);
      })
      .catch(() => {})
      .finally(() => setIsLoadingReturns(false));
  }, []);

  const handleLookup = async (code: string) => {
    const trimmed = code.trim();
    if (!trimmed) return;

    setIsSearching(true);
    setSearchError(null);
    setProvenance(null);
    setSubmitError(null);
    setSuccessBanner(null);

    try {
      const res = await fetch(`/api/v1/product-units?code=${encodeURIComponent(trimmed)}`);
      const body = await res.json();
      if (!res.ok) {
        throw new Error(body?.error?.message ?? "Garment not found.");
      }
      setProvenance(body.data);
      if (body.data.salesOrder?.customer?.id) {
        // Automatically default warehouse if restock
        if (warehouses.length > 0 && !restockWarehouseId) {
          setRestockWarehouseId(warehouses[0].id);
        }
      }
    } catch (err) {
      setSearchError((err as Error).message);
    } finally {
      setIsSearching(false);
    }
  };

  const handleSubmitReturn = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!provenance) return;

    const customerId = provenance.salesOrder?.customer?.id;
    if (!customerId) {
      setSubmitError("Cannot process return: This garment is not associated with an identified customer / Sales Order.");
      return;
    }

    if (disposition === "RESTOCK" && !restockWarehouseId) {
      setSubmitError("Please select a destination warehouse to restock this garment.");
      return;
    }

    setIsSubmitting(true);
    setSubmitError(null);

    try {
      const payload = {
        customerId,
        salesOrderId: provenance.salesOrder?.id ?? null,
        remarks: returnRemarks.trim() || undefined,
        items: [
          {
            productUnitCode: provenance.unitCode,
            returnReason,
            condition,
            disposition,
            restockWarehouseId: disposition === "RESTOCK" ? restockWarehouseId : null,
            remarks: returnRemarks.trim() || undefined,
          },
        ],
      };

      const res = await fetch("/api/v1/returns", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      const body = await res.json();
      if (!res.ok) {
        throw new Error(body?.error?.message ?? "Failed to submit customer return.");
      }

      setSuccessBanner(
        `Customer Return ${body.data.returnNumber} created successfully for garment ${provenance.unitCode} (${disposition}).`
      );
      setProvenance(null);
      setBarcodeInput("");
      setReturnRemarks("");
      loadReturns();
    } catch (err) {
      setSubmitError((err as Error).message);
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="space-y-6">
      <Breadcrumb
        items={[
          { label: "Dashboard", href: "/dashboard" },
          { label: "Barcodes", href: "/barcodes" },
          { label: "Customer Returns" },
        ]}
      />

      <div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-xl font-semibold text-zinc-900 dark:text-zinc-50">
            Customer Garment Returns & Reverse Logistics
          </h1>
          <p className="text-xs text-zinc-500 dark:text-zinc-400">
            Scan any returned garment piece (FG-XXXXXXXX) to verify complete production provenance, order history, and process restocking or rework.
          </p>
        </div>
      </div>

      {successBanner && (
        <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-4 text-sm font-medium text-emerald-800 dark:border-emerald-900/50 dark:bg-emerald-950/30 dark:text-emerald-300">
          ✓ {successBanner}
        </div>
      )}

      {/* Barcode Scan / Lookup Bar */}
      <div className="rounded-xl border border-indigo-200 bg-gradient-to-r from-indigo-50/70 to-purple-50/40 p-5 dark:border-indigo-950 dark:bg-zinc-900/50">
        <label className="block text-xs font-semibold uppercase tracking-wider text-indigo-900 dark:text-indigo-400">
          Scan / Enter Garment Barcode
        </label>
        <div className="mt-2 flex items-center gap-2">
          <input
            type="text"
            value={barcodeInput}
            onChange={(e) => setBarcodeInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                handleLookup(barcodeInput);
              }
            }}
            placeholder="Scan barcode with reader or type e.g. FG-00000001 and press Enter…"
            className="flex-1 rounded-md border border-zinc-300 bg-white px-3.5 py-2 text-sm shadow-sm dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100"
          />
          <Button
            variant="primary"
            onClick={() => handleLookup(barcodeInput)}
            isLoading={isSearching}
            loadingLabel="Searching…"
          >
            Lookup Provenance
          </Button>
        </div>
        {searchError && (
          <p className="mt-2 text-xs font-semibold text-red-600 dark:text-red-400">
            {searchError}
          </p>
        )}
      </div>

      {/* Garment Provenance & Return Form */}
      {provenance && (
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
          {/* Provenance Card */}
          <div className="space-y-4 rounded-xl border border-zinc-200 bg-white p-5 shadow-sm dark:border-zinc-800 dark:bg-zinc-900 lg:col-span-2">
            <div className="flex items-center justify-between border-b border-zinc-100 pb-3 dark:border-zinc-800">
              <div className="flex items-center gap-3">
                <span className="font-mono text-base font-bold text-indigo-600 dark:text-indigo-400">
                  {provenance.unitCode}
                </span>
                <span
                  className={`rounded-full px-2.5 py-0.5 text-xs font-semibold ${
                    provenance.status === "DISPATCHED"
                      ? "bg-amber-100 text-amber-800 dark:bg-amber-950/60 dark:text-amber-300"
                      : provenance.status === "RETURNED" || provenance.status === "IN_STOCK"
                      ? "bg-emerald-100 text-emerald-800 dark:bg-emerald-950/60 dark:text-emerald-300"
                      : "bg-zinc-100 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300"
                  }`}
                >
                  Status: {provenance.status}
                </span>
              </div>
              <a
                href={`/api/v1/barcodes/${provenance.unitCode}/label.pdf`}
                target="_blank"
                rel="noopener noreferrer"
                className="text-xs font-medium text-indigo-600 hover:underline dark:text-indigo-400"
              >
                Print Tag (PDF)
              </a>
            </div>

            <div className="grid grid-cols-2 gap-4 text-xs">
              <div>
                <p className="text-zinc-500 dark:text-zinc-400">Style / Design</p>
                <p className="font-semibold text-zinc-800 dark:text-zinc-200">
                  {provenance.product.styleCode} — {provenance.product.styleName}
                </p>
              </div>
              <div>
                <p className="text-zinc-500 dark:text-zinc-400">Color & Size</p>
                <p className="font-semibold text-zinc-800 dark:text-zinc-200">
                  {provenance.productVariant.color.name} / {provenance.productVariant.size.name}
                </p>
                <span className="font-mono text-xs text-zinc-400">
                  SKU: {provenance.productVariant.skuCode}
                </span>
              </div>
              <div>
                <p className="text-zinc-500 dark:text-zinc-400">Production Provenance</p>
                <p className="font-medium text-zinc-800 dark:text-zinc-200">
                  Order: {provenance.productionOrder.orderNumber}
                </p>
                <p className="font-medium text-zinc-800 dark:text-zinc-200">
                  Lot: {provenance.lot.lotNumber}
                </p>
              </div>
              <div>
                <p className="text-zinc-500 dark:text-zinc-400">Original Customer & Order</p>
                <p className="font-semibold text-zinc-800 dark:text-zinc-200">
                  {provenance.salesOrder?.customer?.name ?? "Stock / Make-to-Stock"}
                </p>
                {provenance.salesOrder && (
                  <p className="text-zinc-600 dark:text-zinc-400">
                    SO: {provenance.salesOrder.orderNumber}
                  </p>
                )}
              </div>
              <div>
                <p className="text-zinc-500 dark:text-zinc-400">Dispatch & Carton</p>
                <p className="font-medium text-zinc-800 dark:text-zinc-200">
                  {provenance.dispatch
                    ? `Dispatch: ${provenance.dispatch.dispatchNumber}`
                    : provenance.carton
                    ? `Carton #${provenance.carton.cartonNumber} (${provenance.carton.dispatch.dispatchNumber})`
                    : "Not Yet Dispatched"}
                </p>
                {provenance.dispatch?.dispatchedAt && (
                  <p className="text-zinc-400">
                    Date: {new Date(provenance.dispatch.dispatchedAt).toLocaleDateString("en-IN")}
                  </p>
                )}
              </div>
            </div>

            {/* Lifecycle Audit Events */}
            <div className="mt-4 border-t border-zinc-100 pt-3 dark:border-zinc-800">
              <h3 className="mb-2 text-xs font-semibold uppercase tracking-wider text-zinc-500 dark:text-zinc-400">
                Traceability Audit History
              </h3>
              <div className="space-y-1.5 max-h-36 overflow-y-auto">
                {provenance.events.map((ev) => (
                  <div key={ev.id} className="flex items-center justify-between text-xs text-zinc-600 dark:text-zinc-400">
                    <span className="font-medium text-zinc-800 dark:text-zinc-200">
                      {ev.eventType} ({ev.fromStatus ?? "NONE"} → {ev.toStatus})
                    </span>
                    <span className="text-zinc-400">
                      {new Date(ev.createdAt).toLocaleString("en-IN")}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          </div>

          {/* Action Disposition Form */}
          <div className="rounded-xl border border-zinc-200 bg-white p-5 shadow-sm dark:border-zinc-800 dark:bg-zinc-900">
            <h2 className="text-sm font-semibold text-zinc-900 dark:text-zinc-50 mb-3">
              Process Return Disposition
            </h2>
            <form onSubmit={handleSubmitReturn} className="space-y-3.5">
              <FormField label="Return Reason" htmlFor="returnReason" required>
                <select
                  id="returnReason"
                  value={returnReason}
                  onChange={(e) => setReturnReason(e.target.value)}
                  className={textInputClass()}
                >
                  <option value="SIZE_FIT_ISSUE">Wrong Size / Fit Issue</option>
                  <option value="FABRIC_DEFECT">Fabric / Stitching Defect</option>
                  <option value="TRANSIT_DAMAGE">Damaged in Transit</option>
                  <option value="WRONG_ITEM">Wrong Item / Color Sent</option>
                  <option value="CUSTOMER_CANCEL">Customer Cancellation</option>
                  <option value="EXCESS_STOCK">Excess Stock Return</option>
                  <option value="OTHER">Other Reason</option>
                </select>
              </FormField>

              <FormField label="Inspected Condition" htmlFor="condition" required>
                <select
                  id="condition"
                  value={condition}
                  onChange={(e) => setCondition(e.target.value as typeof condition)}
                  className={textInputClass()}
                >
                  <option value="GOOD">Good (Unworn / Resaleable)</option>
                  <option value="DEFECTIVE">Defective (Manufacturing Defect)</option>
                  <option value="DAMAGED">Damaged (Tear / Stain / Hardware)</option>
                  <option value="WRONG_ITEM">Wrong Item (Mismatched Tag)</option>
                </select>
              </FormField>

              <FormField label="Disposition Action" htmlFor="disposition" required>
                <select
                  id="disposition"
                  value={disposition}
                  onChange={(e) => setDisposition(e.target.value as typeof disposition)}
                  className={textInputClass()}
                >
                  <option value="RESTOCK">Restock (Return to Finished Goods Stock)</option>
                  <option value="REWORK">Rework (Send to Alteration / Repair)</option>
                  <option value="QUARANTINE">Quarantine (Hold for QC Assessment)</option>
                  <option value="SCRAP">Scrap (Dispose / Reject)</option>
                </select>
              </FormField>

              {disposition === "RESTOCK" && (
                <FormField label="Destination FG Warehouse" htmlFor="warehouse" required>
                  <select
                    id="warehouse"
                    value={restockWarehouseId}
                    onChange={(e) => setRestockWarehouseId(e.target.value)}
                    required
                    className={textInputClass()}
                  >
                    <option value="">— Select Warehouse —</option>
                    {warehouses.map((w) => (
                      <option key={w.id} value={w.id}>
                        {w.name}
                      </option>
                    ))}
                  </select>
                </FormField>
              )}

              <FormField label="Remarks / Return Notes" htmlFor="returnRemarks">
                <input
                  id="returnRemarks"
                  type="text"
                  value={returnRemarks}
                  onChange={(e) => setReturnRemarks(e.target.value)}
                  placeholder="Optional customer feedback or notes…"
                  className={textInputClass()}
                />
              </FormField>

              {submitError && (
                <p className="text-xs font-medium text-red-600 dark:text-red-400">
                  {submitError}
                </p>
              )}

              <Button
                variant="primary"
                type="submit"
                isLoading={isSubmitting}
                loadingLabel="Processing…"
                disabled={isSubmitting || provenance.status !== "DISPATCHED"}
              >
                {provenance.status !== "DISPATCHED"
                  ? `Cannot Return (${provenance.status})`
                  : "Submit Return & Update Stock"}
              </Button>
            </form>
          </div>
        </div>
      )}

      {/* Customer Returns History Table */}
      <div className="space-y-3">
        <h2 className="text-sm font-semibold text-zinc-900 dark:text-zinc-50">
          Processed Customer Returns
        </h2>

        {isLoadingReturns ? (
          <p className="text-sm text-zinc-500">Loading returns history…</p>
        ) : returnsList.length === 0 ? (
          <p className="text-sm text-zinc-500">No customer returns processed yet.</p>
        ) : (
          <div className="overflow-x-auto rounded-lg border border-zinc-200 dark:border-zinc-800">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-zinc-200 text-left text-xs uppercase tracking-wide text-zinc-500 dark:border-zinc-800 dark:text-zinc-400">
                  <th className="px-3 py-2 font-medium">Return #</th>
                  <th className="px-3 py-2 font-medium">Date</th>
                  <th className="px-3 py-2 font-medium">Customer</th>
                  <th className="px-3 py-2 font-medium">Garment Code</th>
                  <th className="px-3 py-2 font-medium">Style / Variant</th>
                  <th className="px-3 py-2 font-medium">Condition</th>
                  <th className="px-3 py-2 font-medium">Disposition</th>
                  <th className="px-3 py-2 font-medium">Received By</th>
                </tr>
              </thead>
              <tbody>
                {returnsList.flatMap((ret) =>
                  ret.items.map((item) => (
                    <tr
                      key={item.id}
                      className="border-b border-zinc-100 last:border-0 dark:border-zinc-800 hover:bg-zinc-50 dark:hover:bg-zinc-850"
                    >
                      <td className="px-3 py-2 font-mono text-xs font-semibold text-zinc-900 dark:text-zinc-100">
                        {ret.returnNumber}
                      </td>
                      <td className="px-3 py-2 text-xs text-zinc-500">
                        {new Date(ret.createdAt).toLocaleDateString("en-IN")}
                      </td>
                      <td className="px-3 py-2 text-zinc-800 dark:text-zinc-200">
                        {ret.customer.name}
                      </td>
                      <td className="px-3 py-2 font-mono text-xs text-indigo-600 dark:text-indigo-400">
                        {item.productUnit.unitCode}
                      </td>
                      <td className="px-3 py-2 text-xs">
                        <span className="font-medium text-zinc-800 dark:text-zinc-200">
                          {item.productUnit.product.styleCode}
                        </span>
                        {" — "}
                        <span className="text-zinc-500">
                          {item.productUnit.productVariant.color.name}/
                          {item.productUnit.productVariant.size.name}
                        </span>
                      </td>
                      <td className="px-3 py-2 text-xs">
                        <span
                          className={`rounded px-1.5 py-0.5 text-xs font-medium ${
                            item.condition === "GOOD"
                              ? "bg-green-100 text-green-800 dark:bg-green-950 dark:text-green-300"
                              : "bg-red-100 text-red-800 dark:bg-red-950 dark:text-red-300"
                          }`}
                        >
                          {item.condition}
                        </span>
                      </td>
                      <td className="px-3 py-2 text-xs font-medium text-zinc-700 dark:text-zinc-300">
                        {item.disposition}
                      </td>
                      <td className="px-3 py-2 text-xs text-zinc-500">
                        {ret.receivedBy.fullName}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
