"use client";

import { useRef, useState } from "react";
import { Modal } from "@/components/ui/Modal";
import { downloadCsvFile, parseCsv } from "@/lib/csv";
import { IMPORT_COLUMNS, type ImportBatchTypeValue } from "@/modules/import/import.schema";

interface ImportRowFailure {
  rowNumber: number;
  data: Record<string, string>;
  reason: string;
}

interface RunImportResult {
  totalRows: number;
  importedCount: number;
  skippedCount: number;
  failedRows: ImportRowFailure[];
}

interface CsvImportModalProps {
  open: boolean;
  onClose: () => void;
  importType: ImportBatchTypeValue;
  title: string;
  /** Called once, right after a successful import call — lets the caller refresh its own list. */
  onImported?: () => void;
}

/**
 * The caller MUST remount this component on every open (e.g. `key={openCount}`,
 * bumped in the same click handler that sets `open` to true) — same
 * remount-via-key convention already established by FilePreviewModal's own
 * zoom/rotate reset, rather than an effect that calls setState on `open`.
 */

type Step = "upload" | "map" | "preview" | "result";

function normalizeHeader(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]/g, "");
}

export function CsvImportModal({ open, onClose, importType, title, onImported }: CsvImportModalProps) {
  const columns = IMPORT_COLUMNS[importType];
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [step, setStep] = useState<Step>("upload");
  const [fileName, setFileName] = useState("");
  const [csvHeaders, setCsvHeaders] = useState<string[]>([]);
  const [csvRows, setCsvRows] = useState<string[][]>([]);
  const [mapping, setMapping] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [result, setResult] = useState<RunImportResult | null>(null);

  const downloadTemplate = () => {
    downloadCsvFile(`${importType.toLowerCase()}-import-template.csv`, columns.map((c) => c.label), []);
  };

  const handleFile = async (file: File) => {
    setError(null);
    const text = await file.text();
    const parsed = parseCsv(text);
    if (parsed.length < 1) {
      setError("The file appears to be empty.");
      return;
    }
    const [headerRow, ...dataRows] = parsed;
    if (dataRows.length === 0) {
      setError("The file has a header row but no data rows.");
      return;
    }

    const guessed: Record<string, string> = {};
    for (const col of columns) {
      const normalizedKey = normalizeHeader(col.key);
      const normalizedLabel = normalizeHeader(col.label.split("(")[0]);
      const match = headerRow.find((h) => {
        // Strip a trailing parenthetical on the header side too, so a file
        // re-uploaded from "Download a blank template" (whose headers are
        // the full labels, parenthetical hint included) auto-maps every
        // column — the common round-trip this feature exists to support.
        const normalizedHeader = normalizeHeader(h);
        const normalizedHeaderStripped = normalizeHeader(h.split("(")[0]);
        return normalizedHeader === normalizedKey || normalizedHeaderStripped === normalizedLabel || normalizedHeader === normalizedLabel;
      });
      if (match) guessed[col.key] = match;
    }

    setFileName(file.name);
    setCsvHeaders(headerRow);
    setCsvRows(dataRows);
    setMapping(guessed);
    setStep("map");
  };

  const canProceedFromMapping = columns.filter((c) => c.required).every((c) => !!mapping[c.key]);

  const buildRows = (): Record<string, string>[] => {
    const activeMapping = Object.entries(mapping).filter(([, header]) => header);
    return csvRows.map((row) => {
      const obj: Record<string, string> = {};
      for (const [key, header] of activeMapping) {
        const idx = csvHeaders.indexOf(header);
        obj[key] = idx >= 0 ? (row[idx] ?? "") : "";
      }
      return obj;
    });
  };

  const submit = async () => {
    setIsSubmitting(true);
    setError(null);
    try {
      const res = await fetch("/api/v1/imports", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ importType, fileName, rows: buildRows() }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body?.error?.message ?? "Import failed.");
      setResult(body.data);
      setStep("result");
      onImported?.();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setIsSubmitting(false);
    }
  };

  const downloadFailedRows = () => {
    if (!result) return;
    const header = ["Row #", "Reason", ...columns.map((c) => c.label)];
    const rows = result.failedRows.map((f) => [String(f.rowNumber), f.reason, ...columns.map((c) => f.data[c.key] ?? "")]);
    downloadCsvFile(`${importType.toLowerCase()}-import-failed-rows.csv`, header, rows);
  };

  return (
    <Modal open={open} onClose={onClose} title={title} maxWidthClass="max-w-2xl">
      {error && (
        <p className="mb-3 rounded-md bg-red-50 px-3 py-2 text-sm text-red-700 dark:bg-red-500/10 dark:text-red-300">{error}</p>
      )}

      {step === "upload" && (
        <div className="space-y-3">
          <p className="text-sm text-zinc-600 dark:text-zinc-300">
            Upload a CSV file. You&apos;ll map its columns to the required fields on the next step.
          </p>
          <button type="button" onClick={downloadTemplate} className="text-sm font-medium text-indigo-600 hover:underline dark:text-indigo-400">
            Download a blank template →
          </button>
          <input
            ref={fileInputRef}
            type="file"
            accept=".csv,text/csv"
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) handleFile(file);
            }}
            className="block w-full text-sm text-zinc-600 file:mr-3 file:rounded-md file:border-0 file:bg-indigo-600 file:px-3 file:py-1.5 file:text-sm file:font-medium file:text-white hover:file:bg-indigo-500 dark:text-zinc-300"
          />
        </div>
      )}

      {step === "map" && (
        <div className="space-y-3">
          <p className="text-sm text-zinc-600 dark:text-zinc-300">
            <span className="font-medium">{fileName}</span> — {csvRows.length} data row{csvRows.length === 1 ? "" : "s"} found. Map each field
            below to a column from your file.
          </p>
          <div className="max-h-80 space-y-2 overflow-y-auto">
            {columns.map((col) => (
              <div key={col.key} className="flex items-center gap-3">
                <label className="w-56 shrink-0 text-sm text-zinc-700 dark:text-zinc-300">
                  {col.label}
                  {col.required && <span className="text-red-500"> *</span>}
                </label>
                <select
                  value={mapping[col.key] ?? ""}
                  onChange={(e) => setMapping((prev) => ({ ...prev, [col.key]: e.target.value }))}
                  className="w-full rounded-md border border-zinc-300 bg-white px-2 py-1.5 text-sm dark:border-zinc-700 dark:bg-zinc-800"
                >
                  <option value="">— Not mapped —</option>
                  {csvHeaders.map((h) => (
                    <option key={h} value={h}>
                      {h}
                    </option>
                  ))}
                </select>
              </div>
            ))}
          </div>
          <div className="flex justify-between pt-2">
            <button type="button" onClick={() => setStep("upload")} className="text-sm text-zinc-500 hover:underline">
              ← Back
            </button>
            <button
              type="button"
              disabled={!canProceedFromMapping}
              onClick={() => setStep("preview")}
              className="rounded-md bg-indigo-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-indigo-500 disabled:opacity-50"
            >
              Preview →
            </button>
          </div>
        </div>
      )}

      {step === "preview" && (
        <div className="space-y-3">
          <p className="text-sm text-zinc-600 dark:text-zinc-300">
            Previewing the first {Math.min(5, csvRows.length)} of {csvRows.length} row(s). Nothing is saved yet.
          </p>
          <div className="overflow-x-auto rounded-md border border-zinc-200 dark:border-zinc-800">
            <table className="min-w-full divide-y divide-zinc-200 text-xs dark:divide-zinc-800">
              <thead className="bg-zinc-50 dark:bg-zinc-900">
                <tr>
                  {columns.map((c) => (
                    <th key={c.key} className="px-2 py-1.5 text-left font-medium text-zinc-500">
                      {c.label}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-100 dark:divide-zinc-800">
                {buildRows()
                  .slice(0, 5)
                  .map((row, i) => (
                    <tr key={i}>
                      {columns.map((c) => (
                        <td key={c.key} className="px-2 py-1.5 text-zinc-700 dark:text-zinc-300">
                          {row[c.key] || "—"}
                        </td>
                      ))}
                    </tr>
                  ))}
              </tbody>
            </table>
          </div>
          <div className="flex justify-between pt-2">
            <button type="button" onClick={() => setStep("map")} className="text-sm text-zinc-500 hover:underline">
              ← Back
            </button>
            <button
              type="button"
              disabled={isSubmitting}
              onClick={submit}
              className="rounded-md bg-indigo-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-indigo-500 disabled:opacity-60"
            >
              {isSubmitting ? "Importing…" : `Import ${csvRows.length} Row${csvRows.length === 1 ? "" : "s"}`}
            </button>
          </div>
        </div>
      )}

      {step === "result" && result && (
        <div className="space-y-3">
          <p className="text-sm text-zinc-700 dark:text-zinc-300">
            Imported <span className="font-semibold text-emerald-600 dark:text-emerald-400">{result.importedCount}</span> of{" "}
            {result.totalRows} row(s).{" "}
            {result.skippedCount > 0 && (
              <span className="font-semibold text-amber-600 dark:text-amber-400">{result.skippedCount} skipped.</span>
            )}
          </p>
          {result.failedRows.length > 0 && (
            <>
              <div className="max-h-64 overflow-y-auto rounded-md border border-zinc-200 dark:border-zinc-800">
                <table className="min-w-full divide-y divide-zinc-200 text-xs dark:divide-zinc-800">
                  <thead className="bg-zinc-50 dark:bg-zinc-900">
                    <tr>
                      <th className="px-2 py-1.5 text-left font-medium text-zinc-500">Row #</th>
                      <th className="px-2 py-1.5 text-left font-medium text-zinc-500">Reason</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-zinc-100 dark:divide-zinc-800">
                    {result.failedRows.map((f) => (
                      <tr key={f.rowNumber}>
                        <td className="px-2 py-1.5 text-zinc-700 dark:text-zinc-300">{f.rowNumber}</td>
                        <td className="px-2 py-1.5 text-red-600 dark:text-red-400">{f.reason}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <button type="button" onClick={downloadFailedRows} className="text-sm font-medium text-indigo-600 hover:underline dark:text-indigo-400">
                Download failed rows as CSV →
              </button>
            </>
          )}
          <div className="flex justify-end pt-2">
            <button type="button" onClick={onClose} className="rounded-md bg-zinc-100 px-3 py-1.5 text-sm font-medium text-zinc-700 dark:bg-zinc-800 dark:text-zinc-200">
              Close
            </button>
          </div>
        </div>
      )}
    </Modal>
  );
}
