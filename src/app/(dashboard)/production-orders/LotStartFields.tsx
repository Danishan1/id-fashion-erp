"use client";

import { useEffect, useState } from "react";
import { FormField, textInputClass } from "@/components/ui/FormField";
import { SearchableSelect } from "@/components/ui/SearchableSelect";

export interface WorkerRowDraft {
  key: string;
  employeeId: string;
  assignedQuantity: string;
  expectedEndAt: string;
  productionOperationId: string;
}

interface EmployeeOption {
  id: string;
  fullName: string;
  employeeCode?: string | null;
  workSkills?: Array<{ productionStageId: string }>;
}

/** True when this employee has the stage in their Work Skills. */
export function hasWorkSkill(employee: { workSkills?: Array<{ productionStageId: string }> }, stageId: string | null | undefined) {
  return !!stageId && (employee.workSkills ?? []).some((w) => w.productionStageId === stageId);
}

interface OperationOption {
  id: string;
  name: string;
}

let rowCounter = 0;
export function newWorkerRow(assignedQuantity = ""): WorkerRowDraft {
  rowCounter += 1;
  return { key: `w${rowCounter}`, employeeId: "", assignedQuantity, expectedEndAt: "", productionOperationId: "" };
}

/** The request body shape createLot/startLot expect for each worker. */
export function workerRowsToPayload(rows: WorkerRowDraft[]) {
  return rows
    .filter((r) => r.employeeId)
    .map((r) => ({
      employeeId: r.employeeId,
      assignedQuantity: Number(r.assignedQuantity),
      expectedEndAt: r.expectedEndAt ? new Date(r.expectedEndAt).toISOString() : "",
      productionOperationId: r.productionOperationId || undefined,
    }));
}

/** Client-side mirror of the server's worker rules — the server re-checks everything. */
export function validateWorkerRows(rows: WorkerRowDraft[], maxPieces: number): string | null {
  const filled = rows.filter((r) => r.employeeId);
  if (filled.length === 0) return "Assign at least one worker.";
  for (const r of filled) {
    const q = Number(r.assignedQuantity);
    if (!Number.isInteger(q) || q <= 0) return "Each worker's assigned quantity must be a whole number greater than 0.";
    if (!r.expectedEndAt) return "Expected completion time is required for each worker.";
    if (new Date(r.expectedEndAt).getTime() <= Date.now()) return "Expected completion time must be in the future.";
  }
  const total = filled.reduce((s, r) => s + Number(r.assignedQuantity), 0);
  if (maxPieces > 0 && total > maxPieces) return `Assigned quantity (${total}) cannot be greater than the lot quantity (${maxPieces}).`;
  const ids = filled.map((r) => r.employeeId);
  if (new Set(ids).size !== ids.length) return "The same worker is listed twice — combine their pieces into one row.";
  return null;
}

/**
 * Worker rows for a lot's first stage (Cutting). Used by Add Lot and Start
 * Lot — no lot can start without at least one worker on it.
 */
export function WorkerAssignmentRowsEditor({
  rows,
  onChange,
  stageName,
  stageId,
}: {
  rows: WorkerRowDraft[];
  onChange: (rows: WorkerRowDraft[]) => void;
  stageName: string;
  /** The stage these workers start at — only employees skilled for it are offered. */
  stageId: string | null;
}) {
  const [employees, setEmployees] = useState<EmployeeOption[]>([]);
  const [operations, setOperations] = useState<OperationOption[]>([]);

  useEffect(() => {
    fetch("/api/v1/employees?pageSize=200")
      .then((res) => res.json())
      .then((body) => setEmployees((body.data ?? []).filter((e: { isActive?: boolean }) => e.isActive !== false)))
      .catch(() => {});
    fetch("/api/v1/production-operations")
      .then((res) => res.json())
      .then((body) => setOperations(body.data ?? []))
      .catch(() => {});
  }, []);

  const update = (key: string, patch: Partial<WorkerRowDraft>) => onChange(rows.map((r) => (r.key === key ? { ...r, ...patch } : r)));
  // Work Skills: only workers trained for this stage (the backend enforces the same rule).
  const skilledEmployees = employees.filter((e) => hasWorkSkill(e, stageId));

  return (
    <div className="space-y-3 rounded-md border border-zinc-200 p-3 dark:border-zinc-700">
      <div className="flex items-center justify-between">
        <p className="text-sm font-medium text-zinc-800 dark:text-zinc-100">
          {stageName} Worker Assignment <span className="text-red-500">*</span>
        </p>
        <button
          type="button"
          onClick={() => onChange([...rows, newWorkerRow()])}
          className="text-xs font-medium text-indigo-600 hover:underline dark:text-indigo-400"
        >
          + Add worker
        </button>
      </div>
      {stageId && employees.length > 0 && skilledEmployees.length === 0 && (
        <p className="text-xs text-amber-700 dark:text-amber-400">
          No employee has the {stageName} skill yet. Add it under Work Skills in Masters → Employees.
        </p>
      )}
      {rows.map((row, i) => (
        <div key={row.key} className="space-y-2 rounded border border-zinc-100 p-2 dark:border-zinc-800">
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-[2fr_1fr]">
            <FormField label={`Worker ${i + 1}`} htmlFor={`worker-${row.key}`} required>
              <SearchableSelect
                id={`worker-${row.key}`}
                required
                value={row.employeeId}
                onChange={(v) => update(row.key, { employeeId: v })}
                options={skilledEmployees.map((e) => ({ id: e.id, label: e.fullName, sublabel: e.employeeCode ?? undefined }))}
                placeholder="Search worker…"
              />
            </FormField>
            <FormField label="Assigned Qty (pcs)" htmlFor={`qty-${row.key}`} required>
              <input
                id={`qty-${row.key}`}
                type="number"
                inputMode="numeric"
                min={1}
                step={1}
                value={row.assignedQuantity}
                onChange={(e) => update(row.key, { assignedQuantity: e.target.value })}
                className={textInputClass()}
              />
            </FormField>
          </div>
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            <FormField label="Expected Completion" htmlFor={`end-${row.key}`} required>
              <input
                id={`end-${row.key}`}
                type="datetime-local"
                value={row.expectedEndAt}
                onChange={(e) => update(row.key, { expectedEndAt: e.target.value })}
                className={textInputClass()}
              />
            </FormField>
            {operations.length > 0 && (
              <FormField label="Operation (piece-rate, optional)" htmlFor={`op-${row.key}`}>
                <select
                  id={`op-${row.key}`}
                  value={row.productionOperationId}
                  onChange={(e) => update(row.key, { productionOperationId: e.target.value })}
                  className={textInputClass()}
                >
                  <option value="">— None —</option>
                  {operations.map((o) => (
                    <option key={o.id} value={o.id}>
                      {o.name}
                    </option>
                  ))}
                </select>
              </FormField>
            )}
          </div>
          {rows.length > 1 && (
            <button
              type="button"
              onClick={() => onChange(rows.filter((r) => r.key !== row.key))}
              className="text-xs text-red-600 hover:underline dark:text-red-400"
            >
              Remove worker
            </button>
          )}
        </div>
      ))}
    </div>
  );
}

export interface LotMaterialReadinessRow {
  materialId: string;
  materialName: string;
  materialCode: string;
  uomCode: string;
  perPieceQuantity: number;
  requiredQuantity: number;
  issuedQuantity: number;
  remainingQuantity: number;
}

export interface LotMaterialReadiness {
  existingLotPieces: number;
  newLotPieces: number;
  totalPieces: number;
  hasMaterialPlan: boolean;
  materialRequestCount: number;
  rows: LotMaterialReadinessRow[];
  ready: boolean;
  blockingMessage: string | null;
}

function fmt(n: number) {
  return n.toLocaleString("en-IN", { maximumFractionDigits: 4 });
}

/**
 * Live preview of the lot material gate: required = pieces × consumption,
 * issued so far, remaining — the exact numbers the server enforces.
 */
export function LotMaterialReadinessPanel({
  productionOrderId,
  newLotPieces,
  onReadinessChange,
}: {
  productionOrderId: string;
  newLotPieces: number;
  onReadinessChange?: (readiness: LotMaterialReadiness | null) => void;
}) {
  const [readiness, setReadiness] = useState<LotMaterialReadiness | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    const handle = setTimeout(() => {
      fetch(`/api/v1/production-orders/${productionOrderId}/lot-readiness?quantity=${newLotPieces}`)
        .then(async (res) => {
          const body = await res.json().catch(() => null);
          if (!res.ok) throw new Error(body?.error?.message ?? "Could not check material readiness.");
          return body.data as LotMaterialReadiness;
        })
        .then((data) => {
          if (cancelled) return;
          setReadiness(data);
          setLoadError(null);
          onReadinessChange?.(data);
        })
        .catch((err: Error) => {
          if (cancelled) return;
          setLoadError(err.message);
          setReadiness(null);
          onReadinessChange?.(null);
        });
    }, 250);
    return () => {
      cancelled = true;
      clearTimeout(handle);
    };
    // onReadinessChange is intentionally excluded — callers pass inline setters.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [productionOrderId, newLotPieces]);

  if (loadError) return <p className="text-xs text-red-600 dark:text-red-400">{loadError}</p>;
  if (!readiness) return <p className="text-xs text-zinc-400">Checking material…</p>;

  return (
    <div
      className={`space-y-2 rounded-md border p-3 text-xs ${
        readiness.ready
          ? "border-emerald-200 bg-emerald-50 dark:border-emerald-900 dark:bg-emerald-950/40"
          : "border-amber-200 bg-amber-50 dark:border-amber-900 dark:bg-amber-950/40"
      }`}
    >
      <p className="font-medium text-zinc-800 dark:text-zinc-100">
        Material check — {fmt(readiness.totalPieces)} PCS
        {readiness.existingLotPieces > 0 && ` (${fmt(readiness.existingLotPieces)} in existing lots + ${fmt(readiness.newLotPieces)} in this lot)`}
        {" · "}
        Material requests: {readiness.materialRequestCount}
      </p>
      {readiness.rows.length > 0 && (
        <div className="overflow-x-auto">
          <table className="min-w-full">
            <thead>
              <tr className="text-left text-zinc-500">
                <th className="py-1 pr-3 font-medium">Material</th>
                <th className="py-1 pr-3 text-right font-medium">Per PCS</th>
                <th className="py-1 pr-3 text-right font-medium">Required</th>
                <th className="py-1 pr-3 text-right font-medium">Issued</th>
                <th className="py-1 text-right font-medium">Remaining</th>
              </tr>
            </thead>
            <tbody>
              {readiness.rows.map((r) => (
                <tr key={r.materialId} className="border-t border-zinc-200/70 dark:border-zinc-700/70">
                  <td className="py-1 pr-3 text-zinc-800 dark:text-zinc-100">{r.materialName}</td>
                  <td className="py-1 pr-3 text-right">
                    {fmt(r.perPieceQuantity)} {r.uomCode}
                  </td>
                  <td className="py-1 pr-3 text-right font-medium">
                    {fmt(r.requiredQuantity)} {r.uomCode}
                  </td>
                  <td className="py-1 pr-3 text-right">
                    {fmt(r.issuedQuantity)} {r.uomCode}
                  </td>
                  <td className={`py-1 text-right font-medium ${r.remainingQuantity > 0 ? "text-red-600 dark:text-red-400" : "text-emerald-700 dark:text-emerald-400"}`}>
                    {fmt(r.remainingQuantity)} {r.uomCode}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {readiness.blockingMessage ? (
        <p className="text-amber-800 dark:text-amber-300">{readiness.blockingMessage}</p>
      ) : (
        <p className="text-emerald-800 dark:text-emerald-300">Material is issued for every piece — the lot can be created.</p>
      )}
    </div>
  );
}
