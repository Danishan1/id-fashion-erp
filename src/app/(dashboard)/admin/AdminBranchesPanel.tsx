"use client";

import { useEffect, useState } from "react";
import { Modal } from "@/components/ui/Modal";
import { ToggleSwitch } from "@/components/ui/ToggleSwitch";
import { ConfirmModal } from "@/components/ui/ConfirmModal";
import { FormField, textInputClass } from "@/components/ui/FormField";
import { RowAction } from "@/components/ui/RowAction";
import { EditIcon } from "@/components/ui/icons";

const BRANCH_TYPES = ["FACTORY", "OFFICE", "WAREHOUSE"] as const;

interface BranchRow {
  id: string;
  code: string;
  name: string;
  type: (typeof BRANCH_TYPES)[number];
  addressJson: { line1?: string } | null;
  isActive: boolean;
}

const EMPTY_FORM = { code: "", name: "", type: "OFFICE" as (typeof BRANCH_TYPES)[number], addressLine: "" };

export function AdminBranchesPanel({ canManage }: { canManage: boolean }) {
  const [branches, setBranches] = useState<BranchRow[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [modalTarget, setModalTarget] = useState<BranchRow | "new" | null>(null);
  const [form, setForm] = useState(EMPTY_FORM);
  const [error, setError] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [pendingToggle, setPendingToggle] = useState<BranchRow | null>(null);

  function reload() {
    setIsLoading(true);
    fetch("/api/v1/administration/branches")
      .then((res) => res.json())
      .then((body) => setBranches(body.data ?? []))
      .finally(() => setIsLoading(false));
  }

  useEffect(() => {
    const timeout = setTimeout(() => reload(), 0);
    return () => clearTimeout(timeout);
  }, []);

  function openNew() {
    setModalTarget("new");
    setForm(EMPTY_FORM);
    setError(null);
  }

  function openEdit(branch: BranchRow) {
    setModalTarget(branch);
    setForm({ code: branch.code, name: branch.name, type: branch.type, addressLine: branch.addressJson?.line1 ?? "" });
    setError(null);
  }

  async function handleSave() {
    setIsSaving(true);
    setError(null);
    try {
      const isNew = modalTarget === "new";
      const url = isNew ? "/api/v1/administration/branches" : `/api/v1/administration/branches/${(modalTarget as BranchRow).id}`;
      const res = await fetch(url, {
        method: isNew ? "POST" : "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error?.message ?? "Failed to save branch");
      setModalTarget(null);
      reload();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to save branch");
    } finally {
      setIsSaving(false);
    }
  }

  async function handleToggleConfirm() {
    if (!pendingToggle) return;
    const res = await fetch(`/api/v1/administration/branches/${pendingToggle.id}/status`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ isActive: !pendingToggle.isActive }),
    });
    if (res.ok) reload();
    setPendingToggle(null);
  }

  return (
    <div className="space-y-3">
      {canManage && (
        <div className="flex justify-end">
          <button type="button" onClick={openNew} className="rounded-md bg-indigo-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-indigo-500">
            + New Branch
          </button>
        </div>
      )}

      <div className="overflow-x-auto rounded-lg border border-zinc-200 dark:border-zinc-800">
        <table className="min-w-full divide-y divide-zinc-200 text-sm dark:divide-zinc-800">
          <thead className="bg-zinc-50 dark:bg-zinc-900">
            <tr>
              <th className="px-3 py-2 text-left font-medium text-zinc-500">Code</th>
              <th className="px-3 py-2 text-left font-medium text-zinc-500">Name</th>
              <th className="px-3 py-2 text-left font-medium text-zinc-500">Type</th>
              <th className="px-3 py-2 text-left font-medium text-zinc-500">Address</th>
              {canManage && <th className="px-3 py-2 text-left font-medium text-zinc-500">Active</th>}
              {canManage && <th className="px-3 py-2 text-left font-medium text-zinc-500">Actions</th>}
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
            {!isLoading &&
              branches.map((b) => (
                <tr key={b.id}>
                  <td className="px-3 py-2 font-mono text-xs text-zinc-500">{b.code}</td>
                  <td className="px-3 py-2 text-zinc-900 dark:text-zinc-100">{b.name}</td>
                  <td className="px-3 py-2 text-zinc-600 dark:text-zinc-400">{b.type}</td>
                  <td className="px-3 py-2 text-zinc-600 dark:text-zinc-400">{b.addressJson?.line1 ?? "—"}</td>
                  {canManage && (
                    <td className="px-3 py-2">
                      <ToggleSwitch checked={b.isActive} onToggle={() => setPendingToggle(b)} />
                    </td>
                  )}
                  {canManage && (
                    <td className="px-3 py-2">
                      <RowAction icon={<EditIcon />} label="Edit" onClick={() => openEdit(b)} />
                    </td>
                  )}
                </tr>
              ))}
          </tbody>
        </table>
      </div>

      <Modal open={!!modalTarget} onClose={() => setModalTarget(null)} title={modalTarget === "new" ? "New Branch" : "Edit Branch"}>
        <div className="space-y-3">
          {error && <p className="text-sm text-red-600 dark:text-red-400">{error}</p>}
          <FormField label="Code" htmlFor="branchCode" required>
            <input id="branchCode" className={textInputClass()} value={form.code} onChange={(e) => setForm({ ...form, code: e.target.value })} />
          </FormField>
          <FormField label="Name" htmlFor="branchName" required>
            <input id="branchName" className={textInputClass()} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
          </FormField>
          <FormField label="Type" htmlFor="branchType" required>
            <select
              id="branchType"
              className={textInputClass()}
              value={form.type}
              onChange={(e) => setForm({ ...form, type: e.target.value as (typeof BRANCH_TYPES)[number] })}
            >
              {BRANCH_TYPES.map((t) => (
                <option key={t} value={t}>
                  {t}
                </option>
              ))}
            </select>
          </FormField>
          <FormField label="Address" htmlFor="branchAddress">
            <input id="branchAddress" className={textInputClass()} value={form.addressLine} onChange={(e) => setForm({ ...form, addressLine: e.target.value })} />
          </FormField>
          <div className="flex justify-end gap-3 pt-2">
            <button
              type="button"
              onClick={() => setModalTarget(null)}
              className="rounded-md border border-zinc-300 px-3 py-1.5 text-sm text-zinc-700 hover:bg-zinc-50 dark:border-zinc-700 dark:text-zinc-200 dark:hover:bg-zinc-800"
            >
              Cancel
            </button>
            <button
              type="button"
              disabled={isSaving || !form.code || !form.name}
              onClick={handleSave}
              className="rounded-md bg-indigo-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-indigo-500 disabled:opacity-60"
            >
              {isSaving ? "Saving…" : "Save"}
            </button>
          </div>
        </div>
      </Modal>

      <ConfirmModal
        open={!!pendingToggle}
        title={pendingToggle?.isActive ? "Deactivate branch?" : "Reactivate branch?"}
        message={`"${pendingToggle?.name}" will ${pendingToggle?.isActive ? "no longer" : "again"} be selectable for new records.`}
        isDangerous={!!pendingToggle?.isActive}
        confirmLabel={pendingToggle?.isActive ? "Deactivate" : "Reactivate"}
        onConfirm={handleToggleConfirm}
        onCancel={() => setPendingToggle(null)}
      />
    </div>
  );
}
