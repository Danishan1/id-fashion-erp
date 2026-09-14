"use client";

import Link from "next/link";
import { Fragment, useEffect, useMemo, useState } from "react";
import { Breadcrumb } from "@/components/ui/Breadcrumb";
import { FormField } from "@/components/ui/FormField";
import { SearchableSelect } from "@/components/ui/SearchableSelect";

type MaterialStatus = "PENDING" | "FULFILLED";

interface SalesOrderOption {
  id: string;
  orderNumber: string;
  customerName: string;
  materialStatus: MaterialStatus;
}

type SalesOrderFilter = "PENDING" | "FULFILLED" | "ALL";

const SALES_ORDER_FILTERS: { value: SalesOrderFilter; label: string }[] = [
  { value: "PENDING", label: "Pending" },
  { value: "FULFILLED", label: "Fulfilled" },
  { value: "ALL", label: "All" },
];

interface ContributingStyle {
  productId: string;
  styleName: string;
  neededQuantity: number;
}

interface MaterialRow {
  materialId: string;
  materialName: string;
  materialCode: string;
  uomId: string;
  uomCode: string;
  neededQuantity: number;
  availableQuantity: number;
  issuedQuantity: number;
  shortfallQuantity: number;
  defaultSupplierId: string | null;
  unitCost: number | null;
  contributingStyles: ContributingStyle[];
}

interface RequirementsResponse {
  salesOrder: { orderNumber: string; customerName: string };
  materials: MaterialRow[];
  stylesWithoutBom: Array<{ productId: string; styleName: string; reason: string }>;
  unconvertibleLines: Array<{ materialId: string; materialName: string; reason: string }>;
}

interface WarehouseOption {
  id: string;
  name: string;
}

interface DuplicateEntry {
  requestId: string;
  requestNumber: string;
  remainingQuantity: number;
}

function formatQty(n: number) {
  return n.toLocaleString("en-IN", { maximumFractionDigits: 4 });
}

export function MaterialRequirementsClient() {
  const [salesOrders, setSalesOrders] = useState<SalesOrderOption[]>([]);
  const [salesOrderFilter, setSalesOrderFilter] = useState<SalesOrderFilter>("PENDING");
  const [salesOrderId, setSalesOrderId] = useState("");
  const [warehouses, setWarehouses] = useState<WarehouseOption[]>([]);
  const [warehouseId, setWarehouseId] = useState("");
  const [data, setData] = useState<RequirementsResponse | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [expandedMaterialId, setExpandedMaterialId] = useState<string | null>(null);
  const [selectedMaterialIds, setSelectedMaterialIds] = useState<Set<string>>(new Set());
  const [duplicates, setDuplicates] = useState<Record<string, DuplicateEntry[]>>({});
  const [isGenerating, setIsGenerating] = useState(false);
  const [generatedRequest, setGeneratedRequest] = useState<{ id: string; requestNumber: string } | null>(null);
  const [duplicateBlock, setDuplicateBlock] = useState<Record<string, DuplicateEntry[]> | null>(null);

  useEffect(() => {
    fetch("/api/v1/bom-mrp/sales-orders")
      .then((res) => res.json())
      .then((body) => setSalesOrders(body.data ?? []));
    fetch("/api/v1/warehouses?pageSize=200")
      .then((res) => res.json())
      .then((body) => setWarehouses(body.data ?? []));
  }, []);

  // The currently-selected order must stay selectable even if the filter
  // changes out from under it afterward (e.g. Pending -> Fulfilled once its
  // last material gets issued mid-session) — never yank the active
  // selection out of the dropdown just because its own status moved.
  const filteredSalesOrders = useMemo(() => {
    if (salesOrderFilter === "ALL") return salesOrders;
    return salesOrders.filter((o) => o.id === salesOrderId || o.materialStatus === salesOrderFilter);
  }, [salesOrders, salesOrderFilter, salesOrderId]);

  const loadRequirements = async (id: string) => {
    setSalesOrderId(id);
    setData(null);
    setSelectedMaterialIds(new Set());
    setDuplicates({});
    setError(null);
    setGeneratedRequest(null);
    setDuplicateBlock(null);
    if (!id) return;

    setIsLoading(true);
    const res = await fetch(`/api/v1/bom-mrp/requirements?salesOrderId=${id}`);
    setIsLoading(false);

    if (!res.ok) {
      const body = await res.json().catch(() => null);
      setError(body?.error?.message ?? "Failed to compute material requirements.");
      return;
    }
    const body = await res.json();
    setData(body.data);
  };

  const toggleSelected = (materialId: string) => {
    setSelectedMaterialIds((prev) => {
      const next = new Set(prev);
      if (next.has(materialId)) next.delete(materialId);
      else next.add(materialId);
      if (next.size === 0) setDuplicates({});
      return next;
    });
  };

  // Proactive, advisory only — re-checked (with an override) by the server
  // when Generate is actually clicked.
  useEffect(() => {
    if (!salesOrderId || selectedMaterialIds.size === 0) return;
    const materialIds = [...selectedMaterialIds].join(",");
    fetch(`/api/v1/material-requests/duplicate-check?salesOrderId=${salesOrderId}&materialIds=${materialIds}`)
      .then((res) => res.json())
      .then((body) => setDuplicates(body.data ?? {}));
  }, [salesOrderId, selectedMaterialIds]);

  const generateMaterialRequest = async (overrideDuplicateCheck = false) => {
    if (!warehouseId || selectedMaterialIds.size === 0) return;
    setIsGenerating(true);
    setError(null);
    setDuplicateBlock(null);

    const res = await fetch("/api/v1/bom-mrp/generate-material-request", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        salesOrderId,
        warehouseId,
        materialIds: [...selectedMaterialIds],
        overrideDuplicateCheck,
      }),
    });
    setIsGenerating(false);

    if (!res.ok) {
      const body = await res.json().catch(() => null);
      if (body?.error?.code === "DUPLICATE_MATERIAL_REQUEST_EXISTS") {
        setDuplicateBlock(body.error.details?.duplicates ?? {});
        return;
      }
      setError(body?.error?.message ?? "Failed to generate a material request.");
      return;
    }

    const body = await res.json();
    setGeneratedRequest({ id: body.data.id, requestNumber: body.data.requestNumber });
    setSelectedMaterialIds(new Set());
  };

  const materialName = (materialId: string) =>
    data?.materials.find((m) => m.materialId === materialId)?.materialName ?? materialId;

  return (
    <div className="space-y-6">
      <Breadcrumb items={[{ label: "Dashboard", href: "/dashboard" }, { label: "BOM / MRP", href: "/bom-mrp" }, { label: "Material Requirements" }]} />
      <div>
        <h1 className="text-lg font-semibold text-zinc-900 dark:text-zinc-50">Material Requirements</h1>
        <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">
          Needed vs. already-issued per material for a Sales Order, based on each style&apos;s BOM. A material still
          shows a checkbox when there&apos;s a real gap between what&apos;s needed and what&apos;s already been
          issued — select it and generate a Material Request; Inventory checks stock and issues what&apos;s
          available, anything still short can be escalated to Purchasing from there. Available (current company
          stock) stays informational alongside it.
        </p>
      </div>

      <div className="max-w-md space-y-2">
        <div className="flex gap-1">
          {SALES_ORDER_FILTERS.map((f) => (
            <button
              key={f.value}
              type="button"
              onClick={() => {
                setSalesOrderFilter(f.value);
                // Switching the filter is a deliberate "start over" action —
                // clear whatever order/material data is currently shown so
                // the page never keeps displaying a selection that no
                // longer matches the tab the user just clicked.
                loadRequirements("");
              }}
              className={`rounded-md border px-2.5 py-1 text-xs font-medium transition ${
                salesOrderFilter === f.value
                  ? "border-indigo-600 bg-indigo-600 text-white"
                  : "border-zinc-300 text-zinc-600 hover:bg-zinc-50 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-900/40"
              }`}
            >
              {f.label}
            </button>
          ))}
        </div>
        <FormField label="Sales Order" htmlFor="salesOrderId">
          <SearchableSelect
            id="salesOrderId"
            value={salesOrderId}
            onChange={loadRequirements}
            options={filteredSalesOrders.map((o) => ({
              id: o.id,
              label: o.orderNumber,
              sublabel: `${o.customerName}${o.materialStatus === "FULFILLED" ? " — fully issued" : ""}`,
            }))}
            placeholder="Search sales order…"
          />
        </FormField>
        <p className="text-xs text-zinc-400">
          {salesOrderFilter === "PENDING" && "Showing orders with at least one material not yet fully issued."}
          {salesOrderFilter === "FULFILLED" && "Showing orders where every material has already been fully issued."}
          {salesOrderFilter === "ALL" && "Showing every order regardless of issuance status."}
        </p>
      </div>

      {isLoading && <p className="text-sm text-zinc-500">Calculating…</p>}
      {error && <p className="text-sm text-red-600 dark:text-red-400">{error}</p>}

      {generatedRequest && (
        <div className="rounded-md border border-green-300 bg-green-50 px-3 py-2 text-sm text-green-700 dark:border-green-700 dark:bg-green-900/20 dark:text-green-300">
          Created{" "}
          <Link href={`/material-requests/${generatedRequest.id}`} className="font-medium underline">
            {generatedRequest.requestNumber}
          </Link>
          .
        </div>
      )}

      {data && (
        <div className="space-y-6">
          {data.stylesWithoutBom.length > 0 && (
            <div className="rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-700 dark:border-amber-700 dark:bg-amber-900/20 dark:text-amber-300">
              Requirements could not be calculated for:{" "}
              {data.stylesWithoutBom.map((s) => `${s.styleName} (${s.reason})`).join("; ")}.
            </div>
          )}
          {data.unconvertibleLines.length > 0 && (
            <div className="rounded-md border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-700 dark:border-red-700 dark:bg-red-900/20 dark:text-red-300">
              Some BOM lines were skipped due to a unit-conversion problem:{" "}
              {data.unconvertibleLines.map((l) => `${l.materialName} (${l.reason})`).join("; ")}
            </div>
          )}

          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs text-zinc-500">
                <th className="py-1 pr-3 font-medium"></th>
                <th className="py-1 pr-3 font-medium">Material</th>
                <th className="py-1 pr-3 font-medium">Needed</th>
                <th className="py-1 pr-3 font-medium">Available</th>
                <th className="py-1 font-medium">Issued</th>
              </tr>
            </thead>
            <tbody>
              {data.materials.map((m) => (
                <Fragment key={m.materialId}>
                  <tr className="border-t border-zinc-100 dark:border-zinc-800">
                    <td className="py-2 pr-3">
                      {m.shortfallQuantity > 0 && (
                        <input
                          type="checkbox"
                          checked={selectedMaterialIds.has(m.materialId)}
                          onChange={() => toggleSelected(m.materialId)}
                        />
                      )}
                    </td>
                    <td className="py-2 pr-3 text-zinc-700 dark:text-zinc-200">
                      {m.materialName} <span className="text-xs text-zinc-400">({m.materialCode})</span>
                      <button
                        type="button"
                        onClick={() => setExpandedMaterialId(expandedMaterialId === m.materialId ? null : m.materialId)}
                        className="ml-2 text-xs text-indigo-600 hover:underline dark:text-indigo-400"
                      >
                        {expandedMaterialId === m.materialId ? "hide styles" : "show styles"}
                      </button>
                    </td>
                    <td className="py-2 pr-3 text-zinc-700 dark:text-zinc-200">
                      {formatQty(m.neededQuantity)} {m.uomCode}
                    </td>
                    <td className="py-2 pr-3 text-zinc-700 dark:text-zinc-200">
                      {formatQty(m.availableQuantity)} {m.uomCode}
                    </td>
                    <td className="py-2 text-zinc-700 dark:text-zinc-200">
                      {formatQty(m.issuedQuantity)} {m.uomCode}
                    </td>
                  </tr>
                  {selectedMaterialIds.has(m.materialId) && duplicates[m.materialId] && (
                    <tr className="bg-amber-50 dark:bg-amber-900/10">
                      <td></td>
                      <td colSpan={4} className="py-2 pr-3 text-xs text-amber-700 dark:text-amber-300">
                        Already has an open Material Request for this Sales Order:{" "}
                        {duplicates[m.materialId].map((d, i) => (
                          <span key={d.requestId}>
                            {i > 0 && ", "}
                            <Link href={`/material-requests/${d.requestId}`} className="underline">
                              {d.requestNumber}
                            </Link>{" "}
                            ({formatQty(d.remainingQuantity)} {m.uomCode} remaining)
                          </span>
                        ))}
                      </td>
                    </tr>
                  )}
                  {expandedMaterialId === m.materialId && (
                    <tr className="bg-zinc-50 dark:bg-zinc-900">
                      <td></td>
                      <td colSpan={4} className="py-2 pr-3 text-xs text-zinc-500">
                        {m.contributingStyles.map((s) => (
                          <div key={s.productId}>
                            {s.styleName}: {formatQty(s.neededQuantity)} {m.uomCode}
                          </div>
                        ))}
                      </td>
                    </tr>
                  )}
                </Fragment>
              ))}
            </tbody>
          </table>

          {selectedMaterialIds.size > 0 && (
            <div className="rounded-lg border border-zinc-200 p-4 dark:border-zinc-800">
              <h2 className="mb-2 text-sm font-semibold text-zinc-900 dark:text-zinc-50">Generate Material Request</h2>

              <div className="mb-3 max-w-xs">
                <FormField label="Issue From (Warehouse)" htmlFor="mrpWarehouseId" required>
                  <SearchableSelect
                    id="mrpWarehouseId"
                    required
                    value={warehouseId}
                    onChange={setWarehouseId}
                    options={warehouses.map((w) => ({ id: w.id, label: w.name }))}
                    placeholder="Search warehouse…"
                  />
                </FormField>
              </div>

              {duplicateBlock && (
                <div className="mb-3 rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-700 dark:border-amber-700 dark:bg-amber-900/20 dark:text-amber-300">
                  <p className="mb-2">
                    An open Material Request already exists for:{" "}
                    {Object.keys(duplicateBlock)
                      .map((materialId) => materialName(materialId))
                      .join(", ")}
                    .
                  </p>
                  <button
                    type="button"
                    onClick={() => generateMaterialRequest(true)}
                    disabled={isGenerating}
                    className="rounded-md border border-amber-400 px-3 py-1.5 text-sm font-medium text-amber-800 hover:bg-amber-100 disabled:opacity-50 dark:text-amber-200 dark:hover:bg-amber-900/30"
                  >
                    Generate Anyway
                  </button>
                </div>
              )}

              <button
                type="button"
                onClick={() => generateMaterialRequest(false)}
                disabled={isGenerating || !warehouseId}
                className="rounded-md bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-500 disabled:opacity-50"
              >
                {isGenerating ? "Generating…" : `Generate Material Request — ${selectedMaterialIds.size} material(s)`}
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
