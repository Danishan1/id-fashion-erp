"use client";

import { useState } from "react";
import type { SystemHealthReport } from "@/modules/platform/platform-system-health.service";

interface PlatformSystemHealthClientProps {
  initialReport: SystemHealthReport;
}

export function PlatformSystemHealthClient({ initialReport }: PlatformSystemHealthClientProps) {
  const [report, setReport] = useState<SystemHealthReport>(initialReport);
  const [refreshing, setRefreshing] = useState(false);
  const [lastRefreshedAt, setLastRefreshedAt] = useState<Date>(new Date(initialReport.timestamp));

  async function handleRefresh() {
    setRefreshing(true);
    try {
      const res = await fetch("/api/v1/platform/system-health");
      if (res.ok) {
        const json = await res.json();
        if (json.data) {
          setReport(json.data);
          setLastRefreshedAt(new Date());
        }
      }
    } catch {
      // Keep previous report on failure
    } finally {
      setRefreshing(false);
    }
  }

  const formatUptime = (seconds: number) => {
    const days = Math.floor(seconds / 86400);
    const hrs = Math.floor((seconds % 86400) / 3600);
    const mins = Math.floor((seconds % 3600) / 60);
    const secs = seconds % 60;
    const parts = [];
    if (days > 0) parts.push(`${days}d`);
    if (hrs > 0) parts.push(`${hrs}h`);
    if (mins > 0) parts.push(`${mins}m`);
    parts.push(`${secs}s`);
    return parts.join(" ");
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <div className="flex items-center gap-3">
            <h1 className="text-2xl font-bold tracking-tight text-zinc-900 dark:text-zinc-50">
              Platform System Health & Telemetry
            </h1>
            <span
              className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-semibold ${
                report.status === "HEALTHY"
                  ? "bg-emerald-100 text-emerald-800 dark:bg-emerald-950/60 dark:text-emerald-400"
                  : report.status === "WARNING"
                  ? "bg-amber-100 text-amber-800 dark:bg-amber-950/60 dark:text-amber-400"
                  : "bg-red-100 text-red-800 dark:bg-red-950/60 dark:text-red-400"
              }`}
            >
              {report.status}
            </span>
          </div>
          <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">
            Real-time diagnostics across database connectivity, background job queues, and Node.js server performance.
          </p>
        </div>

        <div className="flex items-center gap-3">
          <span className="text-xs text-zinc-500 dark:text-zinc-400">
            Updated {lastRefreshedAt.toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit", second: "2-digit" })}
          </span>
          <button
            type="button"
            onClick={handleRefresh}
            disabled={refreshing}
            className="inline-flex items-center gap-2 rounded-lg bg-indigo-600 px-4 py-2 text-sm font-semibold text-white shadow-sm hover:bg-indigo-500 disabled:opacity-50"
          >
            <svg
              className={`h-4 w-4 ${refreshing ? "animate-spin" : ""}`}
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"
              />
            </svg>
            {refreshing ? "Checking..." : "Run Live Ping"}
          </button>
        </div>
      </div>

      {/* Primary Status Banner */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {/* Database Status */}
        <div className="rounded-xl border border-zinc-200 bg-white p-5 shadow-sm dark:border-zinc-800 dark:bg-zinc-900">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold uppercase tracking-wider text-zinc-500">PostgreSQL Primary</span>
            <span
              className={`inline-block h-2.5 w-2.5 rounded-full ${
                report.database.status === "HEALTHY"
                  ? "bg-emerald-500 ring-4 ring-emerald-100 dark:ring-emerald-950"
                  : report.database.status === "DEGRADED"
                  ? "bg-amber-500 ring-4 ring-amber-100 dark:ring-amber-950"
                  : "bg-red-500 ring-4 ring-red-100 dark:ring-red-950"
              }`}
            />
          </div>
          <div className="mt-3">
            <div className="text-2xl font-bold text-zinc-900 dark:text-zinc-50">
              {report.database.status === "DOWN" ? "Offline" : `${report.database.latencyMs} ms`}
            </div>
            <p className="mt-1 text-xs text-zinc-500">
              {report.database.status === "HEALTHY"
                ? "Query latency within healthy bounds"
                : report.database.error || "Latency degraded (>500ms)"}
            </p>
          </div>
        </div>

        {/* Process Memory */}
        <div className="rounded-xl border border-zinc-200 bg-white p-5 shadow-sm dark:border-zinc-800 dark:bg-zinc-900">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold uppercase tracking-wider text-zinc-500">Memory RSS / Heap</span>
            <span className="text-xs font-semibold text-indigo-600 dark:text-indigo-400">Node Runtime</span>
          </div>
          <div className="mt-3">
            <div className="text-2xl font-bold text-zinc-900 dark:text-zinc-50">
              {report.process.memory.heapUsedMb} MB
            </div>
            <p className="mt-1 text-xs text-zinc-500">
              Heap Total: {report.process.memory.heapTotalMb} MB · RSS: {report.process.memory.rssMb} MB
            </p>
          </div>
        </div>

        {/* System Uptime */}
        <div className="rounded-xl border border-zinc-200 bg-white p-5 shadow-sm dark:border-zinc-800 dark:bg-zinc-900">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold uppercase tracking-wider text-zinc-500">Server Uptime</span>
            <span className="text-xs font-medium text-zinc-500">{report.process.environment}</span>
          </div>
          <div className="mt-3">
            <div className="text-2xl font-bold text-zinc-900 dark:text-zinc-50">
              {formatUptime(report.process.uptimeSeconds)}
            </div>
            <p className="mt-1 text-xs text-zinc-500">
              {report.process.nodeVersion} on {report.process.platform}
            </p>
          </div>
        </div>

        {/* Total Tenancy Volume */}
        <div className="rounded-xl border border-zinc-200 bg-white p-5 shadow-sm dark:border-zinc-800 dark:bg-zinc-900">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold uppercase tracking-wider text-zinc-500">Platform Tenancy</span>
            <span className="text-xs font-semibold text-emerald-600 dark:text-emerald-400">
              {report.database.activeCompanies} Active
            </span>
          </div>
          <div className="mt-3">
            <div className="text-2xl font-bold text-zinc-900 dark:text-zinc-50">
              {report.database.totalCompanies} Companies
            </div>
            <p className="mt-1 text-xs text-zinc-500">
              {report.database.totalUsers} registered staff accounts
            </p>
          </div>
        </div>
      </div>

      {/* Multi-Queue Status */}
      <div className="rounded-xl border border-zinc-200 bg-white p-6 shadow-sm dark:border-zinc-800 dark:bg-zinc-900">
        <h2 className="text-base font-semibold text-zinc-900 dark:text-zinc-50">
          Background Workers & Queue Health (BullMQ / Redis)
        </h2>
        <p className="mt-1 text-xs text-zinc-500">
          Monitors asynchronous workers processing platform billing cron jobs, renewal emails, and bulk enterprise imports.
        </p>

        <div className="mt-4 overflow-x-auto">
          <table className="min-w-full divide-y divide-zinc-200 text-left text-sm dark:divide-zinc-800">
            <thead className="bg-zinc-50 text-xs font-semibold uppercase text-zinc-500 dark:bg-zinc-950">
              <tr>
                <th className="px-4 py-3">Queue Name</th>
                <th className="px-4 py-3">Status</th>
                <th className="px-4 py-3 text-right">Waiting</th>
                <th className="px-4 py-3 text-right">Active</th>
                <th className="px-4 py-3 text-right">Completed</th>
                <th className="px-4 py-3 text-right">Failed</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-200 dark:divide-zinc-800">
              {report.queues.map((q) => (
                <tr key={q.name} className="hover:bg-zinc-50 dark:hover:bg-zinc-800/50">
                  <td className="px-4 py-3 font-mono text-xs font-medium text-zinc-900 dark:text-zinc-200">
                    {q.name}
                  </td>
                  <td className="px-4 py-3">
                    <span
                      className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${
                        q.status === "ONLINE"
                          ? "bg-emerald-100 text-emerald-800 dark:bg-emerald-950/60 dark:text-emerald-400"
                          : q.status === "NOT_CONFIGURED"
                          ? "bg-zinc-100 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300"
                          : "bg-red-100 text-red-800 dark:bg-red-950/60 dark:text-red-400"
                      }`}
                    >
                      {q.status}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-right font-medium text-zinc-900 dark:text-zinc-100">{q.waiting}</td>
                  <td className="px-4 py-3 text-right font-medium text-indigo-600 dark:text-indigo-400">{q.active}</td>
                  <td className="px-4 py-3 text-right font-medium text-emerald-600 dark:text-emerald-400">{q.completed}</td>
                  <td className="px-4 py-3 text-right font-medium text-red-600 dark:text-red-400">{q.failed}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Database Global Volume Statistics */}
      <div className="rounded-xl border border-zinc-200 bg-white p-6 shadow-sm dark:border-zinc-800 dark:bg-zinc-900">
        <h2 className="text-base font-semibold text-zinc-900 dark:text-zinc-50">
          Global Multi-Tenant Database Metrics
        </h2>
        <p className="mt-1 text-xs text-zinc-500">
          Aggregate volume across all tenant schema partitions and activity records.
        </p>

        <div className="mt-4 grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-6">
          <div className="rounded-lg bg-zinc-50 p-4 dark:bg-zinc-950">
            <span className="text-xs text-zinc-500">Total Tenants</span>
            <div className="mt-1 text-xl font-bold text-zinc-900 dark:text-zinc-100">
              {report.database.totalCompanies}
            </div>
          </div>
          <div className="rounded-lg bg-zinc-50 p-4 dark:bg-zinc-950">
            <span className="text-xs text-zinc-500">Active Tenants</span>
            <div className="mt-1 text-xl font-bold text-emerald-600 dark:text-emerald-400">
              {report.database.activeCompanies}
            </div>
          </div>
          <div className="rounded-lg bg-zinc-50 p-4 dark:bg-zinc-950">
            <span className="text-xs text-zinc-500">Registered Users</span>
            <div className="mt-1 text-xl font-bold text-indigo-600 dark:text-indigo-400">
              {report.database.totalUsers}
            </div>
          </div>
          <div className="rounded-lg bg-zinc-50 p-4 dark:bg-zinc-950">
            <span className="text-xs text-zinc-500">Sales Orders</span>
            <div className="mt-1 text-xl font-bold text-zinc-900 dark:text-zinc-100">
              {report.database.totalSalesOrders}
            </div>
          </div>
          <div className="rounded-lg bg-zinc-50 p-4 dark:bg-zinc-950">
            <span className="text-xs text-zinc-500">Production Orders</span>
            <div className="mt-1 text-xl font-bold text-zinc-900 dark:text-zinc-100">
              {report.database.totalProductionOrders}
            </div>
          </div>
          <div className="rounded-lg bg-zinc-50 p-4 dark:bg-zinc-950">
            <span className="text-xs text-zinc-500">Audit Trail Events</span>
            <div className="mt-1 text-xl font-bold text-zinc-900 dark:text-zinc-100">
              {report.database.totalAuditLogs}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
