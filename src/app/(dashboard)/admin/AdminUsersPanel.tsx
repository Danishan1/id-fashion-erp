"use client";

import { useState } from "react";
import { Modal } from "@/components/ui/Modal";
import { ConfirmModal } from "@/components/ui/ConfirmModal";
import { ToggleSwitch } from "@/components/ui/ToggleSwitch";
import { FormField, textInputClass } from "@/components/ui/FormField";

interface RoleRef {
  id: string;
  name: string;
}
interface BranchRef {
  id: string;
  code: string;
  name: string;
}
interface UserRow {
  id: string;
  email: string;
  fullName: string;
  status: "ACTIVE" | "SUSPENDED" | "LOCKED";
  defaultBranch: { id: string; name: string } | null;
  branchRoles: Array<{ role: RoleRef; branch: { id: string; name: string } }>;
}

const EMPTY_FORM = { email: "", fullName: "", password: "", phone: "", branchId: "", roleId: "" };

export function AdminUsersPanel({
  initialUsers,
  canManage,
  currentUserId,
}: {
  initialUsers: UserRow[];
  canManage: boolean;
  currentUserId: string;
}) {
  const [users, setUsers] = useState(initialUsers);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [form, setForm] = useState(EMPTY_FORM);
  const [error, setError] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [branches, setBranches] = useState<BranchRef[]>([]);
  const [roles, setRoles] = useState<RoleRef[]>([]);
  const [pendingToggle, setPendingToggle] = useState<UserRow | null>(null);
  const [resetTarget, setResetTarget] = useState<UserRow | null>(null);
  const [resetPassword, setResetPassword] = useState("");
  const [resetError, setResetError] = useState<string | null>(null);
  const [isResetting, setIsResetting] = useState(false);

  async function openModal() {
    setError(null);
    setForm(EMPTY_FORM);
    setIsModalOpen(true);
    const [branchRes, roleRes] = await Promise.all([fetch("/api/v1/branches"), fetch("/api/v1/roles")]);
    const [branchBody, roleBody] = await Promise.all([branchRes.json(), roleRes.json()]);
    setBranches(branchBody.data ?? []);
    setRoles(roleBody.data ?? []);
  }

  async function handleCreate() {
    setIsSaving(true);
    setError(null);
    try {
      const res = await fetch("/api/v1/administration/users", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error?.message ?? "Failed to create user");
      setUsers((prev) => [body.data, ...prev]);
      setIsModalOpen(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to create user");
    } finally {
      setIsSaving(false);
    }
  }

  async function handleToggleConfirm() {
    if (!pendingToggle) return;
    const nextStatus = pendingToggle.status === "ACTIVE" ? "SUSPENDED" : "ACTIVE";
    const res = await fetch(`/api/v1/administration/users/${pendingToggle.id}/status`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status: nextStatus }),
    });
    if (res.ok) {
      setUsers((prev) => prev.map((u) => (u.id === pendingToggle.id ? { ...u, status: nextStatus } : u)));
    }
    setPendingToggle(null);
  }

  function openReset(user: UserRow) {
    setResetTarget(user);
    setResetPassword("");
    setResetError(null);
  }

  async function handleResetPassword() {
    if (!resetTarget) return;
    setIsResetting(true);
    setResetError(null);
    try {
      const res = await fetch(`/api/v1/administration/users/${resetTarget.id}/reset-password`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ newPassword: resetPassword }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => null);
        throw new Error(body?.error?.message ?? "Failed to reset password");
      }
      setResetTarget(null);
    } catch (e) {
      setResetError(e instanceof Error ? e.message : "Failed to reset password");
    } finally {
      setIsResetting(false);
    }
  }

  return (
    <div className="space-y-3">
      {canManage && (
        <div className="flex justify-end">
          <button
            type="button"
            onClick={openModal}
            className="rounded-md bg-indigo-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-indigo-500"
          >
            + New User
          </button>
        </div>
      )}

      <div className="overflow-x-auto rounded-lg border border-zinc-200 dark:border-zinc-800">
        <table className="min-w-full divide-y divide-zinc-200 text-sm dark:divide-zinc-800">
          <thead className="bg-zinc-50 dark:bg-zinc-900">
            <tr>
              <th className="px-3 py-2 text-left font-medium text-zinc-500">Name</th>
              <th className="px-3 py-2 text-left font-medium text-zinc-500">Email</th>
              <th className="px-3 py-2 text-left font-medium text-zinc-500">Role(s)</th>
              <th className="px-3 py-2 text-left font-medium text-zinc-500">Branch</th>
              <th className="px-3 py-2 text-left font-medium text-zinc-500">Status</th>
              {canManage && <th className="px-3 py-2 text-left font-medium text-zinc-500">Active</th>}
              {canManage && <th className="px-3 py-2 text-left font-medium text-zinc-500">Actions</th>}
            </tr>
          </thead>
          <tbody className="divide-y divide-zinc-100 dark:divide-zinc-800">
            {users.map((u) => (
              <tr key={u.id}>
                <td className="px-3 py-2 text-zinc-900 dark:text-zinc-100">
                  {u.fullName}
                  {u.id === currentUserId && <span className="ml-1 text-xs text-zinc-400">(you)</span>}
                </td>
                <td className="px-3 py-2 text-zinc-600 dark:text-zinc-400">{u.email}</td>
                <td className="px-3 py-2 text-zinc-600 dark:text-zinc-400">
                  {u.branchRoles.map((br) => br.role.name).join(", ") || "—"}
                </td>
                <td className="px-3 py-2 text-zinc-600 dark:text-zinc-400">{u.defaultBranch?.name ?? "—"}</td>
                <td className="px-3 py-2 text-zinc-600 dark:text-zinc-400">{u.status}</td>
                {canManage && (
                  <td className="px-3 py-2">
                    <ToggleSwitch
                      checked={u.status === "ACTIVE"}
                      disabled={u.id === currentUserId}
                      onToggle={() => setPendingToggle(u)}
                    />
                  </td>
                )}
                {canManage && (
                  <td className="px-3 py-2">
                    <button
                      type="button"
                      onClick={() => openReset(u)}
                      className="text-sm text-indigo-600 hover:underline dark:text-indigo-400"
                    >
                      Reset Password
                    </button>
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <Modal open={isModalOpen} onClose={() => setIsModalOpen(false)} title="New User" maxWidthClass="max-w-lg">
        <div className="space-y-3">
          {error && <p className="text-sm text-red-600 dark:text-red-400">{error}</p>}
          <FormField label="Full Name" htmlFor="fullName" required>
            <input
              id="fullName"
              className={textInputClass()}
              value={form.fullName}
              onChange={(e) => setForm({ ...form, fullName: e.target.value })}
            />
          </FormField>
          <FormField label="Email" htmlFor="email" required>
            <input
              id="email"
              type="email"
              className={textInputClass()}
              value={form.email}
              onChange={(e) => setForm({ ...form, email: e.target.value })}
            />
          </FormField>
          <FormField label="Password" htmlFor="password" required>
            <input
              id="password"
              type="password"
              className={textInputClass()}
              value={form.password}
              onChange={(e) => setForm({ ...form, password: e.target.value })}
            />
          </FormField>
          <FormField label="Phone" htmlFor="phone">
            <input id="phone" className={textInputClass()} value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} />
          </FormField>
          <FormField label="Branch" htmlFor="branchId" required>
            <select id="branchId" className={textInputClass()} value={form.branchId} onChange={(e) => setForm({ ...form, branchId: e.target.value })}>
              <option value="">— Select —</option>
              {branches.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.name} ({b.code})
                </option>
              ))}
            </select>
          </FormField>
          <FormField label="Role" htmlFor="roleId" required>
            <select id="roleId" className={textInputClass()} value={form.roleId} onChange={(e) => setForm({ ...form, roleId: e.target.value })}>
              <option value="">— Select —</option>
              {roles.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.name}
                </option>
              ))}
            </select>
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
              disabled={isSaving || !form.email || !form.fullName || !form.password || !form.branchId || !form.roleId}
              onClick={handleCreate}
              className="rounded-md bg-indigo-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-indigo-500 disabled:opacity-60"
            >
              {isSaving ? "Creating…" : "Create User"}
            </button>
          </div>
        </div>
      </Modal>

      <ConfirmModal
        open={!!pendingToggle}
        title={pendingToggle?.status === "ACTIVE" ? "Suspend user?" : "Reactivate user?"}
        message={
          pendingToggle?.status === "ACTIVE"
            ? `"${pendingToggle?.fullName}" will no longer be able to sign in.`
            : `"${pendingToggle?.fullName}" will be able to sign in again.`
        }
        isDangerous={pendingToggle?.status === "ACTIVE"}
        confirmLabel={pendingToggle?.status === "ACTIVE" ? "Suspend" : "Reactivate"}
        onConfirm={handleToggleConfirm}
        onCancel={() => setPendingToggle(null)}
      />

      <Modal open={!!resetTarget} onClose={() => setResetTarget(null)} title={`Reset Password — ${resetTarget?.fullName ?? ""}`}>
        <div className="space-y-3">
          <p className="text-sm text-zinc-500 dark:text-zinc-400">
            Sets a new password directly — no current password is required, and any of this user&apos;s existing
            sessions will stop working immediately.
          </p>
          {resetError && <p className="text-sm text-red-600 dark:text-red-400">{resetError}</p>}
          <FormField label="New Password" htmlFor="resetPassword" required>
            <input
              id="resetPassword"
              type="password"
              minLength={8}
              className={textInputClass()}
              value={resetPassword}
              onChange={(e) => setResetPassword(e.target.value)}
            />
          </FormField>
          <div className="flex justify-end gap-3 pt-2">
            <button
              type="button"
              onClick={() => setResetTarget(null)}
              className="rounded-md border border-zinc-300 px-3 py-1.5 text-sm text-zinc-700 hover:bg-zinc-50 dark:border-zinc-700 dark:text-zinc-200 dark:hover:bg-zinc-800"
            >
              Cancel
            </button>
            <button
              type="button"
              disabled={isResetting || resetPassword.length < 8}
              onClick={handleResetPassword}
              className="rounded-md bg-indigo-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-indigo-500 disabled:opacity-60"
            >
              {isResetting ? "Resetting…" : "Reset Password"}
            </button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
