"use client";

import { Breadcrumb } from "@/components/ui/Breadcrumb";
import { DataTable } from "@/components/ui/DataTable";
import { downloadCsvFile } from "@/lib/csv";
import { IMPORT_COLUMNS, type ImportBatchTypeValue } from "@/modules/import/import.schema";

const IMPORT_TYPE_LABELS: Record<ImportBatchTypeValue, string> = {
  LEAD: "Leads",
  DEAL: "Deals",
  CAMPAIGN_DAILY_METRIC: "Campaign Daily Metrics",
};

interface ImportBatchRow {
  id: string;
  importType: ImportBatchTypeValue;
  fileName: string;
  totalRows: number;
  importedCount: number;
  skippedCount: number;
  hasFailedRows: boolean;
  createdAt: string;
  createdBy: { fullName: string } | null;
}

interface FailedRow {
  rowNumber: number;
  data: Record<string, string>;
  reason: string;
}

async function downloadFailedRows(row: ImportBatchRow) {
  const res = await fetch(`/api/v1/imports/${row.id}`);
  const body = await res.json();
  if (!res.ok) return;
  const failedRows: FailedRow[] = body.data.failedRowsJson ?? [];
  const columns = IMPORT_COLUMNS[row.importType];
  const header = ["Row #", "Reason", ...columns.map((c) => c.label)];
  const csvRows = failedRows.map((f) => [String(f.rowNumber), f.reason, ...columns.map((c) => f.data[c.key] ?? "")]);
  downloadCsvFile(`${row.importType.toLowerCase()}-import-failed-rows.csv`, header, csvRows);
}

export default function ImportHistoryPage() {
  return (
    <div className="space-y-4">
      <Breadcrumb items={[{ label: "Dashboard", href: "/dashboard" }, { label: "Import History" }]} />
      <div>
        <h1 className="text-lg font-semibold text-zinc-900 dark:text-zinc-50">Import History</h1>
        <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">
          Every CSV import run — Leads, Deals, and Campaign Daily Metrics — with a summary of what was imported, skipped, and
          why. Start a new import from the Leads, Deals, or Campaigns page.
        </p>
      </div>

      <DataTable<ImportBatchRow>
        fetchUrl="/api/v1/imports"
        searchPlaceholder="Search by file name…"
        columns={[
          { key: "createdAt", header: "Date", render: (row) => new Date(row.createdAt).toLocaleString() },
          { key: "importType", header: "Type", render: (row) => IMPORT_TYPE_LABELS[row.importType] ?? row.importType },
          { key: "fileName", header: "File Name" },
          { key: "totalRows", header: "Total" },
          { key: "importedCount", header: "Imported" },
          { key: "skippedCount", header: "Skipped" },
          { key: "createdBy", header: "Imported By", render: (row) => row.createdBy?.fullName ?? "—" },
          {
            key: "hasFailedRows",
            header: "Failed Rows",
            render: (row) =>
              row.hasFailedRows ? (
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    downloadFailedRows(row);
                  }}
                  className="text-xs font-medium text-indigo-600 hover:underline dark:text-indigo-400"
                >
                  Download →
                </button>
              ) : (
                "—"
              ),
          },
        ]}
      />
    </div>
  );
}
