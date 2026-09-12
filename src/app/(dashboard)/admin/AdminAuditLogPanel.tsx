"use client";

import { useEffect, useState } from "react";
import { Modal } from "@/components/ui/Modal";
import { textInputClass } from "@/components/ui/FormField";
import { SearchableSelect } from "@/components/ui/SearchableSelect";

interface AuditLogRow {
  id: string;
  tableName: string;
  recordId: string;
  action: "CREATE" | "UPDATE" | "APPROVE" | "REJECT" | "POST" | "CANCEL" | "DELETE";
  oldValues: Record<string, unknown> | null;
  newValues: Record<string, unknown> | null;
  performedAt: string;
  user: { id: string; fullName: string; email: string } | null;
}

interface UserRef {
  id: string;
  fullName: string;
}

interface ListResponse {
  data: AuditLogRow[];
  meta: { page: number; pageSize: number; totalCount: number; totalPages: number };
}

// A fixed backend enum (AuditAction has exactly these 7 values) — not a
// master table, so hardcoding it here matches how other fixed enums (e.g.
// SampleStatus labels) are handled elsewhere in this codebase.
const ACTIONS = ["CREATE", "UPDATE", "APPROVE", "REJECT", "POST", "CANCEL", "DELETE"] as const;

const ACTION_BADGE_CLASSES: Record<string, string> = {
  CREATE: "bg-emerald-50 text-emerald-700 dark:bg-emerald-500/10 dark:text-emerald-300",
  UPDATE: "bg-blue-50 text-blue-700 dark:bg-blue-500/10 dark:text-blue-300",
  APPROVE: "bg-indigo-50 text-indigo-700 dark:bg-indigo-500/10 dark:text-indigo-300",
  POST: "bg-indigo-50 text-indigo-700 dark:bg-indigo-500/10 dark:text-indigo-300",
  REJECT: "bg-red-50 text-red-700 dark:bg-red-500/10 dark:text-red-300",
  CANCEL: "bg-red-50 text-red-700 dark:bg-red-500/10 dark:text-red-300",
  DELETE: "bg-red-50 text-red-700 dark:bg-red-500/10 dark:text-red-300",
};

function humanizeTableName(tableName: string): string {
  return tableName.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

const EMPTY_FILTERS = { tableName: "", action: "", userId: "", recordId: "", dateFrom: "", dateTo: "" };

export function AdminAuditLogPanel() {
  const [tables, setTables] = useState<string[]>([]);
  const [users, setUsers] = useState<UserRef[]>([]);
  const [draft, setDraft] = useState(EMPTY_FILTERS);
  const [applied, setApplied] = useState(EMPTY_FILTERS);
  const [page, setPage] = useState(1);
  const [result, setResult] = useState<ListResponse | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<AuditLogRow | null>(null);

  useEffect(() => {
    Promise.all([fetch("/api/v1/administration/audit-log/tables"), fetch("/api/v1/users")])
      .then(async ([tablesRes, usersRes]) => {
        const [tablesBody, usersBody] = await Promise.all([tablesRes.json(), usersRes.json()]);
        setTables(tablesBody.data ?? []);
        setUsers(usersBody.data ?? []);
      })
      .catch(() => {
        // Filter dropdowns simply stay empty — the table itself still loads.
      });
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    const timeout = setTimeout(async () => {
      setIsLoading(true);
      setError(null);
      try {
        const params = new URLSearchParams({ page: String(page), pageSize: "25" });
        if (applied.tableName) params.set("tableName", applied.tableName);
        if (applied.action) params.set("action", applied.action);
        if (applied.userId) params.set("userId", applied.userId);
        if (applied.recordId) params.set("recordId", applied.recordId);
        if (applied.dateFrom) params.set("dateFrom", applied.dateFrom);
        if (applied.dateTo) params.set("dateTo", applied.dateTo);

        const res = await fetch(`/api/v1/administration/audit-log?${params.toString()}`, { signal: controller.signal });
        const body = await res.json();
        if (!res.ok) throw new Error(body?.error?.message ?? "Failed to load audit log");
        setResult(body);
      } catch (err) {
        if ((err as Error).name !== "AbortError") setError((err as Error).message);
      } finally {
        setIsLoading(false);
      }
    }, 0);

    return () => {
      clearTimeout(timeout);
      controller.abort();
    };
  }, [page, applied]);

  function applyFilters() {
    setPage(1);
    setApplied(draft);
  }

  function clearFilters() {
    setDraft(EMPTY_FILTERS);
    setPage(1);
    setApplied(EMPTY_FILTERS);
  }

  const activeFilterCount = Object.values(applied).filter(Boolean).length;

  return (
    <div className="space-y-3">
      <div className="rounded-lg border border-zinc-200 p-3 dark:border-zinc-800">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-6">
          <div>
            <label className="block text-xs font-medium text-zinc-500 dark:text-zinc-400">Table</label>
            <select
              className={textInputClass()}
              value={draft.tableName}
              onChange={(e) => setDraft({ ...draft, tableName: e.target.value })}
            >
              <option value="">All tables</option>
              {tables.map((t) => (
                <option key={t} value={t}>
                  {humanizeTableName(t)}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-xs font-medium text-zinc-500 dark:text-zinc-400">Action</label>
            <select className={textInputClass()} value={draft.action} onChange={(e) => setDraft({ ...draft, action: e.target.value })}>
              <option value="">All actions</option>
              {ACTIONS.map((a) => (
                <option key={a} value={a}>
                  {a}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-xs font-medium text-zinc-500 dark:text-zinc-400">User</label>
            <SearchableSelect
              value={draft.userId}
              onChange={(userId) => setDraft({ ...draft, userId })}
              options={users.map((u) => ({ id: u.id, label: u.fullName }))}
              placeholder="All users"
              emptyOptionLabel="All users"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-zinc-500 dark:text-zinc-400">Record ID</label>
            <input
              className={textInputClass()}
              placeholder="Exact ID"
              value={draft.recordId}
              onChange={(e) => setDraft({ ...draft, recordId: e.target.value })}
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-zinc-500 dark:text-zinc-400">From</label>
            <input type="date" className={textInputClass()} value={draft.dateFrom} onChange={(e) => setDraft({ ...draft, dateFrom: e.target.value })} />
          </div>
          <div>
            <label className="block text-xs font-medium text-zinc-500 dark:text-zinc-400">To</label>
            <input type="date" className={textInputClass()} value={draft.dateTo} onChange={(e) => setDraft({ ...draft, dateTo: e.target.value })} />
          </div>
        </div>
        <div className="mt-3 flex justify-end gap-2">
          <button
            type="button"
            onClick={clearFilters}
            className="rounded-md border border-zinc-300 px-3 py-1.5 text-sm text-zinc-700 hover:bg-zinc-50 dark:border-zinc-700 dark:text-zinc-200 dark:hover:bg-zinc-800"
          >
            Clear All
          </button>
          <button
            type="button"
            onClick={applyFilters}
            className="rounded-md bg-indigo-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-indigo-500"
          >
            Apply Filters{activeFilterCount > 0 ? ` (${activeFilterCount})` : ""}
          </button>
        </div>
      </div>

      {error && <p className="text-sm text-red-600 dark:text-red-400">{error}</p>}

      <div className="overflow-x-auto rounded-lg border border-zinc-200 dark:border-zinc-800">
        <table className="min-w-full divide-y divide-zinc-200 text-sm dark:divide-zinc-800">
          <thead className="bg-zinc-50 dark:bg-zinc-900">
            <tr>
              <th className="px-3 py-2 text-left font-medium text-zinc-500">When</th>
              <th className="px-3 py-2 text-left font-medium text-zinc-500">User</th>
              <th className="px-3 py-2 text-left font-medium text-zinc-500">Action</th>
              <th className="px-3 py-2 text-left font-medium text-zinc-500">Table</th>
              <th className="px-3 py-2 text-left font-medium text-zinc-500">Record ID</th>
              <th className="px-3 py-2 text-left font-medium text-zinc-500"></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-zinc-100 dark:divide-zinc-800">
            {isLoading && (
              <tr>
                <td colSpan={6} className="px-3 py-4 text-center text-zinc-400">
                  Loading…
                </td>
              </tr>
            )}
            {!isLoading && result?.data.length === 0 && (
              <tr>
                <td colSpan={6} className="px-3 py-4 text-center text-zinc-400">
                  No audit log entries match these filters.
                </td>
              </tr>
            )}
            {!isLoading &&
              result?.data.map((log) => (
                <tr key={log.id}>
                  <td className="whitespace-nowrap px-3 py-2 text-zinc-600 dark:text-zinc-400">
                    {new Date(log.performedAt).toLocaleString()}
                  </td>
                  <td className="px-3 py-2 text-zinc-900 dark:text-zinc-100">{log.user?.fullName ?? "System"}</td>
                  <td className="px-3 py-2">
                    <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${ACTION_BADGE_CLASSES[log.action] ?? ""}`}>
                      {log.action}
                    </span>
                  </td>
                  <td className="px-3 py-2 text-zinc-600 dark:text-zinc-400">{humanizeTableName(log.tableName)}</td>
                  <td className="px-3 py-2 font-mono text-xs text-zinc-400" title={log.recordId}>
                    {log.recordId.slice(0, 8)}…
                  </td>
                  <td className="px-3 py-2 text-right">
                    <button type="button" onClick={() => setSelected(log)} className="text-sm text-indigo-600 hover:underline dark:text-indigo-400">
                      View
                    </button>
                  </td>
                </tr>
              ))}
          </tbody>
        </table>
      </div>

      {result && (
        <div className="flex items-center justify-between text-sm text-zinc-500 dark:text-zinc-400">
          <span>{result.meta.totalCount} entries found</span>
          <div className="flex gap-2">
            <button
              type="button"
              disabled={page <= 1}
              onClick={() => setPage((p) => p - 1)}
              className="rounded-md border border-zinc-300 px-3 py-1 disabled:opacity-40 dark:border-zinc-700"
            >
              Prev
            </button>
            <span>
              Page {result.meta.page} of {result.meta.totalPages}
            </span>
            <button
              type="button"
              disabled={page >= result.meta.totalPages}
              onClick={() => setPage((p) => p + 1)}
              className="rounded-md border border-zinc-300 px-3 py-1 disabled:opacity-40 dark:border-zinc-700"
            >
              Next
            </button>
          </div>
        </div>
      )}

      <Modal open={!!selected} onClose={() => setSelected(null)} title="Audit Log Entry" maxWidthClass="max-w-2xl">
        {selected && (
          <div className="space-y-3 text-sm">
            <dl className="grid grid-cols-2 gap-2 text-zinc-600 dark:text-zinc-400">
              <dt className="font-medium text-zinc-500">When</dt>
              <dd>{new Date(selected.performedAt).toLocaleString()}</dd>
              <dt className="font-medium text-zinc-500">User</dt>
              <dd>{selected.user ? `${selected.user.fullName} (${selected.user.email})` : "System"}</dd>
              <dt className="font-medium text-zinc-500">Action</dt>
              <dd>{selected.action}</dd>
              <dt className="font-medium text-zinc-500">Table</dt>
              <dd>{humanizeTableName(selected.tableName)}</dd>
              <dt className="font-medium text-zinc-500">Record ID</dt>
              <dd className="font-mono text-xs">{selected.recordId}</dd>
            </dl>
            <div>
              <p className="font-medium text-zinc-500">Previous Values</p>
              <pre className="mt-1 max-h-48 overflow-auto rounded-md bg-zinc-50 p-2 text-xs dark:bg-zinc-800">
                {selected.oldValues ? JSON.stringify(selected.oldValues, null, 2) : "—"}
              </pre>
            </div>
            <div>
              <p className="font-medium text-zinc-500">New Values</p>
              <pre className="mt-1 max-h-48 overflow-auto rounded-md bg-zinc-50 p-2 text-xs dark:bg-zinc-800">
                {selected.newValues ? JSON.stringify(selected.newValues, null, 2) : "—"}
              </pre>
            </div>
            <div className="flex justify-end pt-2">
              <button
                type="button"
                onClick={() => setSelected(null)}
                className="rounded-md border border-zinc-300 px-4 py-2 text-sm text-zinc-700 hover:bg-zinc-50 dark:border-zinc-700 dark:text-zinc-200 dark:hover:bg-zinc-800"
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
