"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Modal } from "@/components/ui/Modal";
import { FormField, textInputClass } from "@/components/ui/FormField";

interface RoleRow {
  id: string;
  name: string;
  description: string | null;
  isSystemRole: boolean;
  permissionCount: number;
  userCount: number;
}

export function AdminRolesPanel({ canManage }: { canManage: boolean }) {
  const [roles, setRoles] = useState<RoleRow[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [form, setForm] = useState({ name: "", description: "" });
  const [error, setError] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);

  function reload() {
    setIsLoading(true);
    fetch("/api/v1/administration/roles")
      .then((res) => res.json())
      .then((body) => setRoles(body.data ?? []))
      .finally(() => setIsLoading(false));
  }

  useEffect(() => {
    const timeout = setTimeout(() => reload(), 0);
    return () => clearTimeout(timeout);
  }, []);

  function openNew() {
    setForm({ name: "", description: "" });
    setError(null);
    setIsModalOpen(true);
  }

  async function handleCreate() {
    setIsSaving(true);
    setError(null);
    try {
      const res = await fetch("/api/v1/administration/roles", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error?.message ?? "Failed to create role");
      setIsModalOpen(false);
      reload();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to create role");
    } finally {
      setIsSaving(false);
    }
  }

  return (
    <div className="space-y-3">
      {canManage && (
        <div className="flex justify-end">
          <button type="button" onClick={openNew} className="rounded-md bg-indigo-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-indigo-500">
            + New Role
          </button>
        </div>
      )}

      <div className="overflow-x-auto rounded-lg border border-zinc-200 dark:border-zinc-800">
        <table className="min-w-full divide-y divide-zinc-200 text-sm dark:divide-zinc-800">
          <thead className="bg-zinc-50 dark:bg-zinc-900">
            <tr>
              <th className="px-3 py-2 text-left font-medium text-zinc-500">Name</th>
              <th className="px-3 py-2 text-left font-medium text-zinc-500">Description</th>
              <th className="px-3 py-2 text-left font-medium text-zinc-500">Permissions</th>
              <th className="px-3 py-2 text-left font-medium text-zinc-500">Users</th>
              <th className="px-3 py-2 text-left font-medium text-zinc-500"></th>
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
              roles.map((r) => (
                <tr key={r.id}>
                  <td className="px-3 py-2 text-zinc-900 dark:text-zinc-100">
                    {r.name}
                    {r.isSystemRole && (
                      <span className="ml-2 rounded-full bg-zinc-100 px-2 py-0.5 text-xs text-zinc-500 dark:bg-zinc-800 dark:text-zinc-400">System</span>
                    )}
                  </td>
                  <td className="px-3 py-2 text-zinc-600 dark:text-zinc-400">{r.description ?? "—"}</td>
                  <td className="px-3 py-2 text-zinc-600 dark:text-zinc-400">{r.permissionCount}</td>
                  <td className="px-3 py-2 text-zinc-600 dark:text-zinc-400">{r.userCount}</td>
                  <td className="px-3 py-2 text-right">
                    <Link href={`/admin/roles/${r.id}`} className="text-sm text-indigo-600 hover:underline dark:text-indigo-400">
                      {r.isSystemRole ? "View Permissions" : "Manage Permissions"}
                    </Link>
                  </td>
                </tr>
              ))}
          </tbody>
        </table>
      </div>

      <Modal open={isModalOpen} onClose={() => setIsModalOpen(false)} title="New Role">
        <div className="space-y-3">
          {error && <p className="text-sm text-red-600 dark:text-red-400">{error}</p>}
          <FormField label="Name" htmlFor="roleName" required>
            <input id="roleName" className={textInputClass()} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
          </FormField>
          <FormField label="Description" htmlFor="roleDescription">
            <input
              id="roleDescription"
              className={textInputClass()}
              value={form.description}
              onChange={(e) => setForm({ ...form, description: e.target.value })}
            />
          </FormField>
          <div className="flex justify-end gap-3 pt-2">
            <button
              type="button"
              onClick={() => setIsModalOpen(false)}
              className="rounded-md border border-zinc-300 px-3 py-1.5 text-sm text-zinc-700 hover:bg-zinc-50 dark:border-zinc-700 dark:text-zinc-200 dark:hover:bg-zinc-800"
            >
              Cancel
            </button>
            <button
              type="button"
              disabled={isSaving || !form.name}
              onClick={handleCreate}
              className="rounded-md bg-indigo-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-indigo-500 disabled:opacity-60"
            >
              {isSaving ? "Creating…" : "Create Role"}
            </button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
