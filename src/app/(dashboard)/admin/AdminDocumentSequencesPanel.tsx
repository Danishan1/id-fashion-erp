"use client";

import { useEffect, useState } from "react";

interface SequenceRow {
  id: string;
  documentType: string;
  prefix: string;
  fiscalYear: number;
  currentNumber: number;
  paddingLength: number;
  branchName: string | null;
  nextNumberPreview: string;
}

function humanize(value: string): string {
  return value.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

export function AdminDocumentSequencesPanel() {
  const [rows, setRows] = useState<SequenceRow[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    fetch("/api/v1/administration/document-sequences")
      .then((res) => res.json())
      .then((body) => setRows(body.data ?? []))
      .finally(() => setIsLoading(false));
  }, []);

  return (
    <div className="space-y-3">
      <p className="text-sm text-zinc-500 dark:text-zinc-400">
        Read-only — for troubleshooting a document number that looks unexpected. Master-code sequences (Customer, Supplier,
        Employee, Style, Material) show fiscal year 0, since those numbers deliberately never reset annually.
      </p>
      <div className="overflow-x-auto rounded-lg border border-zinc-200 dark:border-zinc-800">
        <table className="min-w-full divide-y divide-zinc-200 text-sm dark:divide-zinc-800">
          <thead className="bg-zinc-50 dark:bg-zinc-900">
            <tr>
              <th className="px-3 py-2 text-left font-medium text-zinc-500">Document Type</th>
              <th className="px-3 py-2 text-left font-medium text-zinc-500">Branch</th>
              <th className="px-3 py-2 text-left font-medium text-zinc-500">Fiscal Year</th>
              <th className="px-3 py-2 text-left font-medium text-zinc-500">Current Number</th>
              <th className="px-3 py-2 text-left font-medium text-zinc-500">Next Number</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-zinc-100 dark:divide-zinc-800">
            {isLoading && (
              <tr>
                <td colSpan={5} className="px-3 py-4 text-center text-zinc-400">
                  Loading…
                </td>
              </tr>
            )}
            {!isLoading &&
              rows.map((r) => (
                <tr key={r.id}>
                  <td className="px-3 py-2 text-zinc-900 dark:text-zinc-100">{humanize(r.documentType)}</td>
                  <td className="px-3 py-2 text-zinc-600 dark:text-zinc-400">{r.branchName ?? "Company-wide"}</td>
                  <td className="px-3 py-2 text-zinc-600 dark:text-zinc-400">{r.fiscalYear === 0 ? "— (never resets)" : r.fiscalYear}</td>
                  <td className="px-3 py-2 font-mono text-zinc-600 dark:text-zinc-400">{r.currentNumber}</td>
                  <td className="px-3 py-2 font-mono text-zinc-900 dark:text-zinc-100">{r.nextNumberPreview}</td>
                </tr>
              ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
