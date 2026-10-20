"use client";

import { useState, useMemo } from "react";
import { Breadcrumb } from "@/components/ui/Breadcrumb";
import { Modal } from "@/components/ui/Modal";
import { formatDate } from "@/lib/date-format";
import type { AuditAction } from "@prisma/client";

export interface AuditLogItem {
  id: string;
  companyId: string;
  companyName: string;
  tableName: string;
  recordId: string;
  action: AuditAction;
  oldValues: any;
  newValues: any;
  ipAddress: string | null;
  performedAt: string;
  operator: {
    name: string;
    email: string;
    role: string;
    isPlatform: boolean;
  } | null;
}

interface PlatformAuditLogsClientProps {
  initialLogs: AuditLogItem[];
  totalCount: number;
}

const ACTION_BADGES: Record<string, string> = {
  CREATE: "bg-emerald-100 text-emerald-800 dark:bg-emerald-950/70 dark:text-emerald-300",
  UPDATE: "bg-blue-100 text-blue-800 dark:bg-blue-950/70 dark:text-blue-300",
  APPROVE: "bg-emerald-100 text-emerald-800 dark:bg-emerald-950/70 dark:text-emerald-300",
  REJECT: "bg-rose-100 text-rose-800 dark:bg-rose-950/70 dark:text-rose-300",
  POST: "bg-indigo-100 text-indigo-800 dark:bg-indigo-950/70 dark:text-indigo-300",
  CANCEL: "bg-zinc-100 text-zinc-800 dark:bg-zinc-800 dark:text-zinc-300",
  DELETE: "bg-red-100 text-red-800 dark:bg-red-950/70 dark:text-red-300",
};

export function PlatformAuditLogsClient({ initialLogs, totalCount }: PlatformAuditLogsClientProps) {
  const [logs] = useState<AuditLogItem[]>(initialLogs);
  const [selectedLog, setSelectedLog] = useState<AuditLogItem | null>(null);

  // Filters
  const [search, setSearch] = useState("");
  const [actionFilter, setActionFilter] = useState<string>("ALL");
  const [tableFilter, setTableFilter] = useState<string>("ALL");

  const uniqueTables = useMemo(() => {
    const s = new Set<string>();
    for (const log of logs) {
      if (log.tableName) s.add(log.tableName);
    }
    return Array.from(s).sort();
  }, [logs]);

  const filteredLogs = useMemo(() => {
    return logs.filter((log) => {
      if (actionFilter !== "ALL" && log.action !== actionFilter) return false;
      if (tableFilter !== "ALL" && log.tableName !== tableFilter) return false;

      if (search.trim()) {
        const q = search.toLowerCase().trim();
        const companyMatch = log.companyName.toLowerCase().includes(q);
        const tableMatch = log.tableName.toLowerCase().includes(q);
        const opMatch = log.operator
          ? log.operator.name.toLowerCase().includes(q) || log.operator.email.toLowerCase().includes(q)
          : false;
        const idMatch = log.recordId.toLowerCase().includes(q);
        if (!companyMatch && !tableMatch && !opMatch && !idMatch) return false;
      }

      return true;
    });
  }, [logs, actionFilter, tableFilter, search]);

  const stats = useMemo(() => {
    const creates = logs.filter((l) => l.action === "CREATE").length;
    const updates = logs.filter((l) => l.action === "UPDATE").length;
    const deletes = logs.filter((l) => l.action === "DELETE").length;
    const platformActions = logs.filter((l) => l.operator?.isPlatform).length;
    return { creates, updates, deletes, platformActions };
  }, [logs]);

  return (
    <div className="space-y-6">
      <Breadcrumb items={[{ label: "Platform", href: "/platform" }, { label: "Audit Logs" }]} />

      {/* Header */}
      <div>
        <h1 className="text-xl font-semibold text-zinc-900 dark:text-zinc-50">Platform Audit Trail</h1>
        <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">
          Immutable audit record of all administrative mutations, tenant provisioning, plan modifications, and security events.
        </p>
      </div>

      {/* KPI Cards */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <div className="rounded-lg border border-zinc-200 bg-white p-3.5 shadow-sm dark:border-zinc-800 dark:bg-zinc-900">
          <div className="text-xs font-medium text-zinc-500 dark:text-zinc-400">Total Recorded Events</div>
          <div className="mt-1 text-2xl font-semibold text-zinc-900 dark:text-zinc-50">{totalCount}</div>
        </div>
        <div className="rounded-lg border border-zinc-200 bg-white p-3.5 shadow-sm dark:border-zinc-800 dark:bg-zinc-900">
          <div className="text-xs font-medium text-purple-600 dark:text-purple-400">Platform Operator Actions</div>
          <div className="mt-1 text-2xl font-semibold text-purple-600 dark:text-purple-400">{stats.platformActions}</div>
        </div>
        <div className="rounded-lg border border-zinc-200 bg-white p-3.5 shadow-sm dark:border-zinc-800 dark:bg-zinc-900">
          <div className="text-xs font-medium text-blue-600 dark:text-blue-400">Modifications (Updates)</div>
          <div className="mt-1 text-2xl font-semibold text-blue-600 dark:text-blue-400">{stats.updates}</div>
        </div>
        <div className="rounded-lg border border-zinc-200 bg-white p-3.5 shadow-sm dark:border-zinc-800 dark:bg-zinc-900">
          <div className="text-xs font-medium text-emerald-600 dark:text-emerald-400">Creations</div>
          <div className="mt-1 text-2xl font-semibold text-emerald-600 dark:text-emerald-400">{stats.creates}</div>
        </div>
      </div>

      {/* Filters Bar */}
      <div className="grid grid-cols-1 gap-3 rounded-lg border border-zinc-200 bg-white p-4 shadow-sm sm:grid-cols-3 dark:border-zinc-800 dark:bg-zinc-900">
        <div>
          <label htmlFor="audit-search" className="block text-xs font-medium text-zinc-600 dark:text-zinc-300">
            Search
          </label>
          <input
            id="audit-search"
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search company, operator, table..."
            className="mt-1 w-full rounded-md border border-zinc-300 px-3 py-1.5 text-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-100"
          />
        </div>

        <div>
          <label htmlFor="audit-action-filter" className="block text-xs font-medium text-zinc-600 dark:text-zinc-300">
            Action
          </label>
          <select
            id="audit-action-filter"
            value={actionFilter}
            onChange={(e) => setActionFilter(e.target.value)}
            className="mt-1 w-full rounded-md border border-zinc-300 px-3 py-1.5 text-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-100"
          >
            <option value="ALL">All Actions</option>
            <option value="CREATE">CREATE</option>
            <option value="UPDATE">UPDATE</option>
            <option value="DELETE">DELETE</option>
          </select>
        </div>

        <div>
          <label htmlFor="audit-table-filter" className="block text-xs font-medium text-zinc-600 dark:text-zinc-300">
            Target Table
          </label>
          <select
            id="audit-table-filter"
            value={tableFilter}
            onChange={(e) => setTableFilter(e.target.value)}
            className="mt-1 w-full rounded-md border border-zinc-300 px-3 py-1.5 text-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-100"
          >
            <option value="ALL">All Tables</option>
            {uniqueTables.map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
          </select>
        </div>
      </div>

      {/* Audit Table */}
      <div className="overflow-x-auto rounded-lg border border-zinc-200 bg-white shadow-sm dark:border-zinc-800 dark:bg-zinc-900">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-zinc-200 bg-zinc-50/50 text-left text-xs uppercase tracking-wide text-zinc-500 dark:border-zinc-800 dark:bg-zinc-800/40 dark:text-zinc-400">
              <th className="px-4 py-3 font-medium">Timestamp</th>
              <th className="px-4 py-3 font-medium">Actor / Operator</th>
              <th className="px-4 py-3 font-medium">Company</th>
              <th className="px-4 py-3 font-medium">Entity / Table</th>
              <th className="px-4 py-3 font-medium">Action</th>
              <th className="px-4 py-3 font-medium text-right">Inspection</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-zinc-100 dark:divide-zinc-800">
            {filteredLogs.length === 0 ? (
              <tr>
                <td colSpan={6} className="px-4 py-10 text-center text-zinc-400">
                  No audit log entries matching criteria.
                </td>
              </tr>
            ) : (
              filteredLogs.map((log) => {
                const dateStr = new Date(log.performedAt).toLocaleString("en-IN", {
                  timeZone: "Asia/Kolkata",
                  dateStyle: "medium",
                  timeStyle: "short",
                });
                return (
                  <tr key={log.id} className="transition-colors hover:bg-zinc-50/80 dark:hover:bg-zinc-800/50">
                    <td className="px-4 py-3 text-xs text-zinc-600 dark:text-zinc-400 whitespace-nowrap">{dateStr}</td>
                    <td className="px-4 py-3">
                      {log.operator ? (
                        <div>
                          <div className="flex items-center gap-1.5 font-medium text-zinc-900 dark:text-zinc-100">
                            {log.operator.name}
                            {log.operator.isPlatform && (
                              <span className="rounded bg-purple-100 px-1.5 py-0.2 text-[10px] font-semibold text-purple-700 dark:bg-purple-950 dark:text-purple-300">
                                PLATFORM
                              </span>
                            )}
                          </div>
                          <div className="text-xs text-zinc-500">{log.operator.email}</div>
                        </div>
                      ) : (
                        <span className="text-zinc-400 text-xs">System / Automated</span>
                      )}
                    </td>
                    <td className="px-4 py-3 font-medium text-zinc-900 dark:text-zinc-100">{log.companyName}</td>
                    <td className="px-4 py-3 font-mono text-xs text-indigo-600 dark:text-indigo-400">{log.tableName}</td>
                    <td className="px-4 py-3">
                      <span className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ${ACTION_BADGES[log.action]}`}>
                        {log.action}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-right whitespace-nowrap text-xs">
                      <button
                        type="button"
                        onClick={() => setSelectedLog(log)}
                        className="rounded border border-zinc-200 px-2 py-1 text-indigo-600 hover:bg-indigo-50 dark:border-zinc-700 dark:text-indigo-400 dark:hover:bg-indigo-950/50"
                      >
                        Inspect Diff
                      </button>
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>

      {/* Inspect Diff Modal */}
      <Modal open={!!selectedLog} onClose={() => setSelectedLog(null)} title="Audit Log Inspector">
        {selectedLog && (
          <div className="space-y-4 text-xs">
            <div className="grid grid-cols-2 gap-2 rounded-lg bg-zinc-50 p-3 dark:bg-zinc-800/60">
              <div>
                <span className="text-zinc-500">Table:</span>{" "}
                <span className="font-semibold text-zinc-900 dark:text-zinc-100">{selectedLog.tableName}</span>
              </div>
              <div>
                <span className="text-zinc-500">Record ID:</span>{" "}
                <span className="font-mono text-zinc-700 dark:text-zinc-300">{selectedLog.recordId}</span>
              </div>
              <div>
                <span className="text-zinc-500">Action:</span>{" "}
                <span className={`font-semibold ${selectedLog.action === "DELETE" ? "text-red-600" : "text-emerald-600"}`}>
                  {selectedLog.action}
                </span>
              </div>
              <div>
                <span className="text-zinc-500">Company:</span>{" "}
                <span className="font-semibold text-zinc-900 dark:text-zinc-100">{selectedLog.companyName}</span>
              </div>
              {selectedLog.ipAddress && (
                <div>
                  <span className="text-zinc-500">IP Address:</span>{" "}
                  <span className="font-mono text-zinc-700 dark:text-zinc-300">{selectedLog.ipAddress}</span>
                </div>
              )}
            </div>

            <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
              <div>
                <h4 className="font-semibold text-zinc-700 dark:text-zinc-300 mb-1">Previous State (oldValues)</h4>
                <pre className="max-h-60 overflow-auto rounded border border-zinc-200 bg-zinc-50 p-2 font-mono text-[11px] text-zinc-800 dark:border-zinc-700 dark:bg-zinc-950 dark:text-zinc-200">
                  {selectedLog.oldValues ? JSON.stringify(selectedLog.oldValues, null, 2) : "null"}
                </pre>
              </div>
              <div>
                <h4 className="font-semibold text-zinc-700 dark:text-zinc-300 mb-1">New State (newValues)</h4>
                <pre className="max-h-60 overflow-auto rounded border border-zinc-200 bg-zinc-50 p-2 font-mono text-[11px] text-zinc-800 dark:border-zinc-700 dark:bg-zinc-950 dark:text-zinc-200">
                  {selectedLog.newValues ? JSON.stringify(selectedLog.newValues, null, 2) : "null"}
                </pre>
              </div>
            </div>

            <div className="flex justify-end pt-2">
              <button
                type="button"
                onClick={() => setSelectedLog(null)}
                className="rounded-md border border-zinc-300 px-3 py-1.5 text-xs text-zinc-700 hover:bg-zinc-100 dark:border-zinc-700 dark:text-zinc-300"
              >
                Close
              </button>
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
}
