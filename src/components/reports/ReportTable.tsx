"use client";

import Link from "next/link";
import type { ReportColumn } from "@/core/reports/report-types";
import { formatDate } from "@/lib/date-format";

function formatCellValue(value: unknown, type?: ReportColumn["type"]): string {
  if (value === null || value === undefined || value === "") return "—";
  if (type === "date") {
    const d = value instanceof Date ? value : new Date(String(value));
    return Number.isNaN(d.getTime()) ? String(value) : formatDate(d);
  }
  if (type === "currency") return `₹${Number(value).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  if (type === "percent") return `${Number(value).toFixed(2)}%`;
  if (type === "number") return Number(value).toLocaleString("en-IN");
  return String(value);
}

export interface ReportTableProps {
  columns: ReportColumn[];
  rows: Record<string, unknown>[];
  totals?: Record<string, unknown>;
  /** Builds a drill-down href for a row given the column's linkTo key, e.g. { salesOrder: (row) => `/sales-orders/${row.salesOrderId}` } */
  linkBuilders?: Record<string, (row: Record<string, unknown>) => string | undefined>;
  emptyMessage?: string;
}

export function ReportTable({ columns, rows, totals, linkBuilders, emptyMessage = "No data for the selected filters." }: ReportTableProps) {
  if (rows.length === 0) {
    return <p className="rounded-md border border-dashed border-zinc-300 px-4 py-8 text-center text-sm text-zinc-500 dark:border-zinc-700">{emptyMessage}</p>;
  }

  return (
    <div className="overflow-x-auto rounded-lg border border-zinc-200 dark:border-zinc-800">
      <table className="min-w-full divide-y divide-zinc-200 text-sm dark:divide-zinc-800">
        <thead className="bg-zinc-50 dark:bg-zinc-900">
          <tr>
            {columns.map((col) => (
              <th
                key={col.key}
                className={`whitespace-nowrap px-3 py-2 font-medium text-zinc-500 ${
                  col.align === "right" ? "text-right" : col.align === "center" ? "text-center" : "text-left"
                }`}
              >
                {col.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-zinc-100 dark:divide-zinc-800">
          {rows.map((row, index) => (
            <tr key={index} className="hover:bg-zinc-50 dark:hover:bg-zinc-800/50">
              {columns.map((col) => {
                const linkBuilder = col.linkTo ? linkBuilders?.[col.linkTo] : undefined;
                const href = linkBuilder?.(row);
                const content = formatCellValue(row[col.key], col.type);
                return (
                  <td
                    key={col.key}
                    className={`whitespace-nowrap px-3 py-2 text-zinc-700 dark:text-zinc-300 ${
                      col.align === "right" ? "text-right" : col.align === "center" ? "text-center" : "text-left"
                    }`}
                  >
                    {href ? (
                      <Link href={href} className="font-medium text-indigo-600 hover:underline dark:text-indigo-400">
                        {content}
                      </Link>
                    ) : (
                      content
                    )}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
        {totals ? (
          <tfoot className="border-t-2 border-zinc-200 bg-zinc-50 font-semibold dark:border-zinc-700 dark:bg-zinc-900">
            <tr>
              {columns.map((col) => (
                <td
                  key={col.key}
                  className={`whitespace-nowrap px-3 py-2 text-zinc-900 dark:text-zinc-50 ${
                    col.align === "right" ? "text-right" : col.align === "center" ? "text-center" : "text-left"
                  }`}
                >
                  {col.key in totals ? formatCellValue(totals[col.key], col.type) : ""}
                </td>
              ))}
            </tr>
          </tfoot>
        ) : null}
      </table>
    </div>
  );
}
