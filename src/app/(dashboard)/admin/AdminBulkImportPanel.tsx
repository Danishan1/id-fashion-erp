"use client";

import { useEffect, useRef, useState } from "react";
import { ConfirmModal } from "@/components/ui/ConfirmModal";
import { BULK_IMPORT_DEPENDENCY_ORDER, type BulkImportMasterType } from "@/modules/import/import.schema";

const MASTER_TYPE_LABELS: Record<BulkImportMasterType, string> = {
  CUSTOMER: "Customer",
  SUPPLIER: "Vendor / Supplier",
  PRODUCT: "Product / Style",
  PRODUCT_VARIANT: "Product Variant",
  OPENING_STOCK: "Opening Stock",
  CHART_OF_ACCOUNT: "Chart of Accounts",

  // Tier 1 + Tier 2 masters (2026-09-05)
  UNIT: "Unit of Measure",
  COLOR: "Color",
  SIZE: "Size",
  BRAND: "Brand",
  SEASON: "Season",
  PRODUCT_FITTING: "Product Fitting",
  PRODUCT_TYPE: "Product Type",
  DESIGN: "Design",
  DESIGN_PATTERN: "Design Pattern",
  PATTERN: "Pattern",
  CATEGORY: "Garment Category",
  SUPPLIER_CATEGORY: "Supplier Category",
  FABRIC_GSM: "Fabric GSM",
  FABRIC_DYE_TYPE: "Fabric Dye Type",
  FABRIC_DYE: "Fabric Dye",
  FABRIC_WEAVE_TYPE: "Fabric Weave Type",
  FABRIC_WIDTH: "Fabric Width",
  FABRIC_COMPOSITION: "Fabric Composition",
  DEPARTMENT: "Department",
  DESIGNATION: "Designation",
  EMPLOYEE_CATEGORY: "Employee Category",
  SHIFT_MASTER: "Shift Master",
  HOLIDAY_MASTER: "Holiday Master",
  PRODUCTION_STAGE: "Production Stage",
  PRODUCTION_LINE: "Production Line",
  MACHINE: "Machine",
  SALES_AGENT: "Sales Agent",
  COST_MASTER: "Cost Master",
  PAYMENT_TYPE: "Payment Type",
  BANK_ACCOUNT: "Bank Account",
  MATERIAL: "Raw Material",
  WAREHOUSE: "Warehouse",
  WAREHOUSE_LOCATION: "Warehouse Location",
  EMPLOYEE: "Employee",
};

interface ValidationReport {
  totalRows: number;
  validCount: number;
  errors: { rowNumber: number; reason: string }[];
}

interface CommitResult {
  batchId: string;
  jobId: string;
}

interface BatchStatus {
  id: string;
  status: "PENDING" | "VALIDATING" | "QUEUED" | "PROCESSING" | "COMPLETED" | "FAILED" | "UNDONE";
  totalRows: number;
  importedCount: number;
  skippedCount: number;
  hasFailedRows: boolean;
  jobProgress: { processed: number; total: number } | null;
}

interface BatchHistoryRow {
  id: string;
  importType: BulkImportMasterType;
  fileName: string;
  totalRows: number;
  importedCount: number;
  skippedCount: number;
  status: BatchStatus["status"];
  createdAt: string;
  createdBy: { fullName: string } | null;
  // listImportBatches() deliberately strips the raw failedRowsJson blob out
  // of the list response (privacy/payload-size reasons) and exposes this
  // boolean instead — see import.service.ts's own mapping.
  hasFailedRows: boolean;
}

async function readJson(res: Response) {
  const body = await res.json().catch(() => null);
  if (!res.ok) throw new Error(body?.error?.message ?? "Request failed.");
  return body;
}

/**
 * Super Admin only — the parent AdminTabs.tsx doesn't even render this tab's
 * button unless canManage is true, so nobody without real access ever sees
 * this panel exists; every API call this panel makes is separately, fully
 * re-gated server-side (administration/create) regardless.
 */
export function AdminBulkImportPanel() {
  const [masterType, setMasterType] = useState<BulkImportMasterType>(BULK_IMPORT_DEPENDENCY_ORDER[0]);
  const [file, setFile] = useState<File | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [isValidating, setIsValidating] = useState(false);
  const [validation, setValidation] = useState<ValidationReport | null>(null);
  const [isCommitting, setIsCommitting] = useState(false);
  const [commit, setCommit] = useState<CommitResult | null>(null);
  const [batchStatus, setBatchStatus] = useState<BatchStatus | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [history, setHistory] = useState<BatchHistoryRow[] | null>(null);
  const [historyError, setHistoryError] = useState<string | null>(null);
  const [pendingUndoId, setPendingUndoId] = useState<string | null>(null);
  const [undoBusy, setUndoBusy] = useState(false);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const loadHistory = () => {
    fetch("/api/v1/admin/bulk-import/batches?pageSize=50")
      .then(readJson)
      .then((body) => setHistory(body.data))
      .catch((e) => setHistoryError(e instanceof Error ? e.message : "Failed to load import history."));
  };

  useEffect(() => {
    loadHistory();
  }, []);

  useEffect(() => {
    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, []);

  const resetUpload = () => {
    setFile(null);
    setValidation(null);
    setCommit(null);
    setBatchStatus(null);
    setError(null);
    if (fileInputRef.current) fileInputRef.current.value = "";
    if (pollRef.current) {
      clearInterval(pollRef.current);
      pollRef.current = null;
    }
  };

  const handleMasterTypeChange = (value: BulkImportMasterType) => {
    setMasterType(value);
    resetUpload();
  };

  const runValidation = async (selectedFile: File) => {
    setFile(selectedFile);
    setValidation(null);
    setCommit(null);
    setBatchStatus(null);
    setError(null);
    setIsValidating(true);
    try {
      const formData = new FormData();
      formData.append("file", selectedFile);
      const res = await fetch(`/api/v1/admin/bulk-import/${masterType}/validate`, { method: "POST", body: formData });
      const body = await readJson(res);
      setValidation(body.data);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Validation failed.");
    } finally {
      setIsValidating(false);
    }
  };

  const confirmImport = async () => {
    if (!file) return;
    setIsCommitting(true);
    setError(null);
    try {
      const formData = new FormData();
      formData.append("file", file);
      const res = await fetch(`/api/v1/admin/bulk-import/${masterType}/commit`, { method: "POST", body: formData });
      const body = await readJson(res);
      const result: CommitResult = body.data;
      setCommit(result);

      pollRef.current = setInterval(async () => {
        try {
          const statusRes = await fetch(`/api/v1/admin/bulk-import/batches/${result.batchId}/status`);
          const statusBody = await readJson(statusRes);
          const status: BatchStatus = statusBody.data;
          setBatchStatus(status);
          if (status.status === "COMPLETED" || status.status === "FAILED") {
            if (pollRef.current) clearInterval(pollRef.current);
            pollRef.current = null;
            loadHistory();
          }
        } catch {
          // Transient poll failure — the interval just tries again next tick.
        }
      }, 1500);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Import failed to start.");
    } finally {
      setIsCommitting(false);
    }
  };

  const confirmUndo = async () => {
    if (!pendingUndoId) return;
    setUndoBusy(true);
    try {
      const res = await fetch(`/api/v1/admin/bulk-import/batches/${pendingUndoId}/undo`, { method: "POST" });
      await readJson(res);
      loadHistory();
    } catch (e) {
      setHistoryError(e instanceof Error ? e.message : "Undo failed.");
    } finally {
      setUndoBusy(false);
      setPendingUndoId(null);
    }
  };

  const onDrop = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setIsDragging(false);
    const dropped = e.dataTransfer.files?.[0];
    if (dropped) runValidation(dropped);
  };

  const progressPercent = batchStatus?.jobProgress
    ? Math.round((batchStatus.jobProgress.processed / Math.max(1, batchStatus.jobProgress.total)) * 100)
    : null;

  return (
    <div className="space-y-8">
      <div>
        <h2 className="text-sm font-semibold text-zinc-900 dark:text-zinc-50">Bulk Master Data Import</h2>
        <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">
          Onboard a new company&apos;s master data from Excel or CSV. Import in this order — each type may
          depend on the ones before it: Customers/Vendors → Products/Styles → Product Variants → Opening
          Stock → Chart of Accounts.
        </p>
      </div>

      <div className="space-y-4 rounded-lg border border-zinc-200 p-4 dark:border-zinc-800">
        <div className="flex flex-wrap items-end gap-3">
          <div>
            <label className="mb-1 block text-xs font-medium text-zinc-500 dark:text-zinc-400">Master Type</label>
            <select
              value={masterType}
              onChange={(e) => handleMasterTypeChange(e.target.value as BulkImportMasterType)}
              className="rounded-md border border-zinc-300 bg-white px-2 py-1.5 text-sm dark:border-zinc-700 dark:bg-zinc-800"
            >
              {BULK_IMPORT_DEPENDENCY_ORDER.map((t) => (
                <option key={t} value={t}>
                  {MASTER_TYPE_LABELS[t]}
                </option>
              ))}
            </select>
          </div>
          <a
            href={`/api/v1/admin/bulk-import/templates/${masterType}?format=xlsx`}
            className="rounded-md bg-zinc-100 px-3 py-1.5 text-sm font-medium text-zinc-700 hover:bg-zinc-200 dark:bg-zinc-800 dark:text-zinc-200 dark:hover:bg-zinc-700"
          >
            Download Template (.xlsx)
          </a>
          <a
            href={`/api/v1/admin/bulk-import/templates/${masterType}?format=csv`}
            className="rounded-md bg-zinc-100 px-3 py-1.5 text-sm font-medium text-zinc-700 hover:bg-zinc-200 dark:bg-zinc-800 dark:text-zinc-200 dark:hover:bg-zinc-700"
          >
            Download Template (.csv)
          </a>
        </div>

        {error && <p className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700 dark:bg-red-500/10 dark:text-red-300">{error}</p>}

        {!commit && (
          <div
            onDragOver={(e) => {
              e.preventDefault();
              setIsDragging(true);
            }}
            onDragLeave={() => setIsDragging(false)}
            onDrop={onDrop}
            className={`rounded-lg border-2 border-dashed p-6 text-center text-sm transition-colors ${
              isDragging ? "border-indigo-500 bg-indigo-50 dark:bg-indigo-500/10" : "border-zinc-300 dark:border-zinc-700"
            }`}
          >
            <p className="mb-2 text-zinc-600 dark:text-zinc-300">Drag and drop a .xlsx or .csv file here, or</p>
            <input
              ref={fileInputRef}
              type="file"
              accept=".csv,.xlsx,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
              onChange={(e) => {
                const selected = e.target.files?.[0];
                if (selected) runValidation(selected);
              }}
              className="mx-auto block w-fit text-sm text-zinc-600 file:mr-3 file:rounded-md file:border-0 file:bg-indigo-600 file:px-3 file:py-1.5 file:text-sm file:font-medium file:text-white hover:file:bg-indigo-500 dark:text-zinc-300"
            />
            {isValidating && <p className="mt-2 text-zinc-500 dark:text-zinc-400">Validating…</p>}
          </div>
        )}

        {validation && !commit && (
          <div className="space-y-3">
            <p className="text-sm text-zinc-700 dark:text-zinc-300">
              <span className="font-medium">{file?.name}</span> — {validation.totalRows} row(s) found:{" "}
              <span className="font-semibold text-emerald-600 dark:text-emerald-400">{validation.validCount} valid</span>
              {validation.errors.length > 0 && (
                <>
                  {" "}
                  / <span className="font-semibold text-red-600 dark:text-red-400">{validation.errors.length} invalid</span>
                </>
              )}
              .
            </p>

            {validation.errors.length > 0 && (
              <div className="max-h-64 overflow-y-auto rounded-md border border-zinc-200 dark:border-zinc-800">
                <table className="min-w-full divide-y divide-zinc-200 text-xs dark:divide-zinc-800">
                  <thead className="bg-zinc-50 dark:bg-zinc-900">
                    <tr>
                      <th className="px-2 py-1.5 text-left font-medium text-zinc-500">Row #</th>
                      <th className="px-2 py-1.5 text-left font-medium text-zinc-500">Reason</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-zinc-100 dark:divide-zinc-800">
                    {validation.errors.map((e) => (
                      <tr key={e.rowNumber}>
                        <td className="px-2 py-1.5 text-zinc-700 dark:text-zinc-300">{e.rowNumber}</td>
                        <td className="px-2 py-1.5 text-red-600 dark:text-red-400">{e.reason}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            <div className="flex items-center gap-3">
              <button
                type="button"
                onClick={resetUpload}
                className="rounded-md bg-zinc-100 px-3 py-1.5 text-sm font-medium text-zinc-700 dark:bg-zinc-800 dark:text-zinc-200"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={validation.validCount === 0 || isCommitting}
                onClick={confirmImport}
                className="rounded-md bg-indigo-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-indigo-500 disabled:opacity-50"
              >
                {isCommitting ? "Starting import…" : `Confirm Import (${validation.validCount} row${validation.validCount === 1 ? "" : "s"})`}
              </button>
            </div>
          </div>
        )}

        {commit && (
          <div className="space-y-3">
            {batchStatus?.status !== "COMPLETED" && batchStatus?.status !== "FAILED" && (
              <div>
                <p className="mb-1.5 text-sm text-zinc-700 dark:text-zinc-300">
                  Importing in the background{batchStatus?.jobProgress ? ` — ${batchStatus.jobProgress.processed} of ${batchStatus.jobProgress.total} row(s) processed` : "…"}
                </p>
                <div className="h-2 w-full overflow-hidden rounded-full bg-zinc-200 dark:bg-zinc-800">
                  <div
                    className="h-2 rounded-full bg-indigo-600 transition-all"
                    style={{ width: progressPercent !== null ? `${progressPercent}%` : "15%" }}
                  />
                </div>
              </div>
            )}

            {(batchStatus?.status === "COMPLETED" || batchStatus?.status === "FAILED") && (
              <div className="space-y-2">
                <p className="text-sm text-zinc-700 dark:text-zinc-300">
                  Import finished — <span className="font-semibold text-emerald-600 dark:text-emerald-400">{batchStatus.importedCount}</span> of{" "}
                  {batchStatus.totalRows} row(s) imported
                  {batchStatus.skippedCount > 0 && (
                    <>
                      , <span className="font-semibold text-amber-600 dark:text-amber-400">{batchStatus.skippedCount} skipped</span>
                    </>
                  )}
                  .
                </p>
                {batchStatus.hasFailedRows && (
                  <a
                    href={`/api/v1/admin/bulk-import/batches/${commit.batchId}/error-log`}
                    className="text-sm font-medium text-indigo-600 hover:underline dark:text-indigo-400"
                  >
                    Download error log →
                  </a>
                )}
                <div>
                  <button
                    type="button"
                    onClick={resetUpload}
                    className="rounded-md bg-zinc-100 px-3 py-1.5 text-sm font-medium text-zinc-700 dark:bg-zinc-800 dark:text-zinc-200"
                  >
                    Import another file
                  </button>
                </div>
              </div>
            )}
          </div>
        )}
      </div>

      <div>
        <h3 className="mb-2 text-sm font-semibold text-zinc-900 dark:text-zinc-50">Import History</h3>
        {historyError && <p className="text-sm text-red-600 dark:text-red-400">{historyError}</p>}
        {!history && !historyError && <p className="text-sm text-zinc-500 dark:text-zinc-400">Loading…</p>}
        {history && history.length === 0 && <p className="text-sm text-zinc-500 dark:text-zinc-400">No bulk imports yet.</p>}
        {history && history.length > 0 && (
          <div className="overflow-x-auto rounded-lg border border-zinc-200 dark:border-zinc-800">
            <table className="min-w-full divide-y divide-zinc-200 text-sm dark:divide-zinc-800">
              <thead className="bg-zinc-50 dark:bg-zinc-900">
                <tr>
                  <th className="px-3 py-2 text-left font-medium text-zinc-500">Type</th>
                  <th className="px-3 py-2 text-left font-medium text-zinc-500">File</th>
                  <th className="px-3 py-2 text-left font-medium text-zinc-500">Rows</th>
                  <th className="px-3 py-2 text-left font-medium text-zinc-500">Status</th>
                  <th className="px-3 py-2 text-left font-medium text-zinc-500">By</th>
                  <th className="px-3 py-2 text-left font-medium text-zinc-500">Date</th>
                  <th className="px-3 py-2 text-left font-medium text-zinc-500">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-100 dark:divide-zinc-800">
                {history.map((b) => (
                  <tr key={b.id}>
                    <td className="px-3 py-2 text-zinc-700 dark:text-zinc-300">{MASTER_TYPE_LABELS[b.importType] ?? b.importType}</td>
                    <td className="px-3 py-2 text-zinc-700 dark:text-zinc-300">{b.fileName}</td>
                    <td className="px-3 py-2 text-zinc-700 dark:text-zinc-300">
                      {b.importedCount}/{b.totalRows}
                      {b.skippedCount > 0 && <span className="text-amber-600 dark:text-amber-400"> ({b.skippedCount} skipped)</span>}
                    </td>
                    <td className="px-3 py-2 text-zinc-700 dark:text-zinc-300">{b.status}</td>
                    <td className="px-3 py-2 text-zinc-700 dark:text-zinc-300">{b.createdBy?.fullName ?? "—"}</td>
                    <td className="px-3 py-2 text-zinc-500 dark:text-zinc-400">{new Date(b.createdAt).toLocaleString()}</td>
                    <td className="px-3 py-2">
                      <div className="flex items-center gap-3">
                        {b.hasFailedRows && (
                          <a
                            href={`/api/v1/admin/bulk-import/batches/${b.id}/error-log`}
                            className="text-xs font-medium text-indigo-600 hover:underline dark:text-indigo-400"
                          >
                            Error log
                          </a>
                        )}
                        {b.status === "COMPLETED" && (
                          <button
                            type="button"
                            onClick={() => setPendingUndoId(b.id)}
                            className="text-xs font-medium text-red-600 hover:underline dark:text-red-400"
                          >
                            Undo
                          </button>
                        )}
                        {b.status === "UNDONE" && <span className="text-xs text-zinc-400">Undone</span>}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <ConfirmModal
        open={pendingUndoId !== null}
        title="Undo this import batch?"
        message="Every record this batch created will be deactivated (soft-deactivated, not deleted). This cannot be undone a second time."
        confirmLabel="Undo Batch"
        isDangerous
        isBusy={undoBusy}
        onConfirm={confirmUndo}
        onCancel={() => setPendingUndoId(null)}
      />
    </div>
  );
}
