"use client";

import { useState } from "react";
import { Modal } from "@/components/ui/Modal";
import { ConfirmModal } from "@/components/ui/ConfirmModal";
import { ToggleSwitch } from "@/components/ui/ToggleSwitch";
import { FormField, textInputClass } from "@/components/ui/FormField";
import { SearchableSelect } from "@/components/ui/SearchableSelect";

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
  branchRoles: Array<{ id: string; role: RoleRef; branch: { id: string; name: string } }>;
  employeeId: string | null;
  employee: { id: string; fullName: string; employeeCode: string } | null;
}

interface EmployeeOption {
  id: string;
  fullName: string;
  employeeCode: string;
}

const EMPTY_FORM = { email: "", fullName: "", password: "", phone: "", branchId: "", roleId: "", employeeId: "" };

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
  const [search, setSearch] = useState("");
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [form, setForm] = useState(EMPTY_FORM);
  const [error, setError] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [branches, setBranches] = useState<BranchRef[]>([]);
  const [roles, setRoles] = useState<RoleRef[]>([]);
  const [employees, setEmployees] = useState<EmployeeOption[]>([]);
  const [pendingToggle, setPendingToggle] = useState<UserRow | null>(null);
  const [resetTarget, setResetTarget] = useState<UserRow | null>(null);
  const [resetPassword, setResetPassword] = useState("");
  const [resetError, setResetError] = useState<string | null>(null);
  const [isResetting, setIsResetting] = useState(false);

  const [editTarget, setEditTarget] = useState<UserRow | null>(null);
  const [editForm, setEditForm] = useState({ fullName: "", email: "", phone: "", employeeId: "" });
  const [editError, setEditError] = useState<string | null>(null);
  const [isEditSaving, setIsEditSaving] = useState(false);

  const [rolesTarget, setRolesTarget] = useState<UserRow | null>(null);
  const [rolesError, setRolesError] = useState<string | null>(null);
  const [isRolesSaving, setIsRolesSaving] = useState(false);
  const [newRoleBranchId, setNewRoleBranchId] = useState("");
  const [newRoleId, setNewRoleId] = useState("");

  async function ensureBranchesAndRoles() {
    if (branches.length > 0 && roles.length > 0 && employees.length > 0) return;
    const [branchRes, roleRes, employeeRes] = await Promise.all([
      fetch("/api/v1/branches"),
      fetch("/api/v1/roles"),
      fetch("/api/v1/employees?pageSize=500"),
    ]);
    const [branchBody, roleBody, employeeBody] = await Promise.all([branchRes.json(), roleRes.json(), employeeRes.json()]);
    setBranches(branchBody.data ?? []);
    setRoles(roleBody.data ?? []);
    setEmployees(employeeBody.data ?? []);
  }

  async function openModal() {
    setError(null);
    setForm(EMPTY_FORM);
    setIsModalOpen(true);
    await ensureBranchesAndRoles();
  }

  async function openEdit(user: UserRow) {
    setEditTarget(user);
    setEditForm({ fullName: user.fullName, email: user.email, phone: "", employeeId: user.employeeId ?? "" });
    setEditError(null);
    await ensureBranchesAndRoles();
  }

  async function handleEditSave() {
    if (!editTarget) return;
    setIsEditSaving(true);
    setEditError(null);
    try {
      const res = await fetch(`/api/v1/administration/users/${editTarget.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ fullName: editForm.fullName, email: editForm.email, employeeId: editForm.employeeId }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error?.message ?? "Failed to update user");
      setUsers((prev) => prev.map((u) => (u.id === editTarget.id ? { ...u, ...body.data } : u)));
      setEditTarget(null);
    } catch (e) {
      setEditError(e instanceof Error ? e.message : "Failed to update user");
    } finally {
      setIsEditSaving(false);
    }
  }

  async function openRolesModal(user: UserRow) {
    setRolesTarget(user);
    setRolesError(null);
    setNewRoleBranchId("");
    setNewRoleId("");
    await ensureBranchesAndRoles();
  }

  async function handleAddRole() {
    if (!rolesTarget || !newRoleBranchId || !newRoleId) return;
    setIsRolesSaving(true);
    setRolesError(null);
    try {
      const res = await fetch(`/api/v1/administration/users/${rolesTarget.id}/branch-roles`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ branchId: newRoleBranchId, roleId: newRoleId }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error?.message ?? "Failed to add role");
      setUsers((prev) => prev.map((u) => (u.id === rolesTarget.id ? body.data : u)));
      setRolesTarget(body.data);
      setNewRoleBranchId("");
      setNewRoleId("");
    } catch (e) {
      setRolesError(e instanceof Error ? e.message : "Failed to add role");
    } finally {
      setIsRolesSaving(false);
    }
  }

  async function handleRemoveRole(branchRoleId: string) {
    if (!rolesTarget) return;
    setIsRolesSaving(true);
    setRolesError(null);
    try {
      const res = await fetch(`/api/v1/administration/users/${rolesTarget.id}/branch-roles/${branchRoleId}`, { method: "DELETE" });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error?.message ?? "Failed to remove role");
      setUsers((prev) => prev.map((u) => (u.id === rolesTarget.id ? body.data : u)));
      setRolesTarget(body.data);
    } catch (e) {
      setRolesError(e instanceof Error ? e.message : "Failed to remove role");
    } finally {
      setIsRolesSaving(false);
    }
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

  // Excludes employees already linked to a DIFFERENT user (server-side
  // re-validates regardless, via user-admin.service.ts's assertEmployeeLinkable —
  // this is purely to keep the picker from offering a doomed choice). The
  // edit target's own currently-linked employee stays selectable so re-saving
  // the form without changing it doesn't silently drop it from the list.
  function linkableEmployees(currentUserId?: string) {
    const linkedElsewhere = new Set(users.filter((u) => u.employeeId && u.id !== currentUserId).map((u) => u.employeeId));
    return employees.filter((e) => !linkedElsewhere.has(e.id));
  }

  const term = search.trim().toLowerCase();
  const filteredUsers = term
    ? users.filter((u) =>
        [u.fullName, u.email, u.status, u.defaultBranch?.name ?? "", u.branchRoles.map((br) => br.role.name).join(" ")]
          .join(" ")
          .toLowerCase()
          .includes(term)
      )
    : users;

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-3">
        <input
          type="text"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search…"
          className={`${textInputClass()} max-w-xs`}
        />
        {canManage && (
          <button
            type="button"
            onClick={openModal}
            className="shrink-0 rounded-md bg-indigo-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-indigo-500"
          >
            + New User
          </button>
        )}
      </div>

      <div className="overflow-x-auto rounded-lg border border-zinc-200 dark:border-zinc-800">
        <table className="min-w-full divide-y divide-zinc-200 text-sm dark:divide-zinc-800">
          <thead className="bg-zinc-50 dark:bg-zinc-900">
            <tr>
              <th className="px-3 py-2 text-left font-medium text-zinc-500">Name</th>
              <th className="px-3 py-2 text-left font-medium text-zinc-500">Email</th>
              <th className="px-3 py-2 text-left font-medium text-zinc-500">Role(s)</th>
              <th className="px-3 py-2 text-left font-medium text-zinc-500">Branch</th>
              <th className="px-3 py-2 text-left font-medium text-zinc-500">Employee</th>
              <th className="px-3 py-2 text-left font-medium text-zinc-500">Status</th>
              {canManage && <th className="px-3 py-2 text-left font-medium text-zinc-500">Active</th>}
              {canManage && <th className="px-3 py-2 text-left font-medium text-zinc-500">Actions</th>}
            </tr>
          </thead>
          <tbody className="divide-y divide-zinc-100 dark:divide-zinc-800">
            {filteredUsers.length === 0 && (
              <tr>
                <td colSpan={canManage ? 8 : 6} className="px-3 py-4 text-center text-zinc-400">
                  No users match your search.
                </td>
              </tr>
            )}
            {filteredUsers.map((u) => (
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
                <td className="px-3 py-2 text-zinc-600 dark:text-zinc-400">
                  {u.employee ? `${u.employee.fullName} (${u.employee.employeeCode})` : "—"}
                </td>
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
                  <td className="space-x-3 whitespace-nowrap px-3 py-2">
                    <button type="button" onClick={() => openEdit(u)} className="text-sm text-indigo-600 hover:underline dark:text-indigo-400">
                      Edit
                    </button>
                    <button type="button" onClick={() => openRolesModal(u)} className="text-sm text-indigo-600 hover:underline dark:text-indigo-400">
                      Roles
                    </button>
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
            <input id="phone" type="tel" className={textInputClass()} value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} />
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
          <FormField label="Link to Employee (optional)" htmlFor="employeeId">
            <SearchableSelect
              id="employeeId"
              value={form.employeeId}
              onChange={(employeeId) => setForm({ ...form, employeeId })}
              options={linkableEmployees().map((e) => ({ id: e.id, label: e.fullName, sublabel: e.employeeCode }))}
              placeholder="Search employee…"
            />
            <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">
              Required for a worker to use self-entry (Log My Progress) — leave blank for office/management logins.
            </p>
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

      <Modal
        open={!!resetTarget}
        onClose={() => setResetTarget(null)}
        title={`Reset Password — ${resetTarget?.fullName ?? ""}`}
      >
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

      <Modal open={!!editTarget} onClose={() => setEditTarget(null)} title={`Edit User — ${editTarget?.fullName ?? ""}`}>
        <div className="space-y-3">
          {editError && <p className="text-sm text-red-600 dark:text-red-400">{editError}</p>}
          <FormField label="Full Name" htmlFor="editFullName" required>
            <input
              id="editFullName"
              className={textInputClass()}
              value={editForm.fullName}
              onChange={(e) => setEditForm({ ...editForm, fullName: e.target.value })}
            />
          </FormField>
          <FormField label="Email" htmlFor="editEmail" required>
            <input
              id="editEmail"
              type="email"
              className={textInputClass()}
              value={editForm.email}
              onChange={(e) => setEditForm({ ...editForm, email: e.target.value })}
            />
          </FormField>
          <FormField label="Link to Employee (optional)" htmlFor="editEmployeeId">
            <SearchableSelect
              id="editEmployeeId"
              value={editForm.employeeId}
              onChange={(employeeId) => setEditForm({ ...editForm, employeeId })}
              options={linkableEmployees(editTarget?.id).map((e) => ({ id: e.id, label: e.fullName, sublabel: e.employeeCode }))}
              placeholder="Search employee…"
            />
            <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">
              Required for a worker to use self-entry (Log My Progress) — leave blank for office/management logins.
            </p>
          </FormField>
          <div className="flex justify-end gap-3 pt-2">
            <button
              type="button"
              onClick={() => setEditTarget(null)}
              className="rounded-md border border-zinc-300 px-3 py-1.5 text-sm text-zinc-700 hover:bg-zinc-50 dark:border-zinc-700 dark:text-zinc-200 dark:hover:bg-zinc-800"
            >
              Cancel
            </button>
            <button
              type="button"
              disabled={isEditSaving || !editForm.fullName || !editForm.email}
              onClick={handleEditSave}
              className="rounded-md bg-indigo-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-indigo-500 disabled:opacity-60"
            >
              {isEditSaving ? "Saving…" : "Save"}
            </button>
          </div>
        </div>
      </Modal>

      <Modal open={!!rolesTarget} onClose={() => setRolesTarget(null)} title={`Roles — ${rolesTarget?.fullName ?? ""}`} maxWidthClass="max-w-lg">
        <div className="space-y-3">
          {rolesError && <p className="text-sm text-red-600 dark:text-red-400">{rolesError}</p>}
          <div className="space-y-1">
            {rolesTarget?.branchRoles.map((br) => (
              <div key={br.id} className="flex items-center justify-between rounded-md border border-zinc-200 px-3 py-2 text-sm dark:border-zinc-800">
                <span>
                  {br.role.name} <span className="text-zinc-400">on</span> {br.branch.name}
                </span>
                <button
                  type="button"
                  disabled={isRolesSaving}
                  onClick={() => handleRemoveRole(br.id)}
                  className="text-xs text-red-600 hover:underline disabled:opacity-50 dark:text-red-400"
                >
                  Remove
                </button>
              </div>
            ))}
            {rolesTarget?.branchRoles.length === 0 && <p className="text-sm text-zinc-400">No role assignments.</p>}
          </div>

          <div className="border-t border-zinc-200 pt-3 dark:border-zinc-800">
            <p className="mb-2 text-sm font-medium text-zinc-700 dark:text-zinc-300">Add a role</p>
            <div className="flex gap-2">
              <select className={textInputClass()} value={newRoleBranchId} onChange={(e) => setNewRoleBranchId(e.target.value)}>
                <option value="">Branch…</option>
                {branches.map((b) => (
                  <option key={b.id} value={b.id}>
                    {b.name}
                  </option>
                ))}
              </select>
              <select className={textInputClass()} value={newRoleId} onChange={(e) => setNewRoleId(e.target.value)}>
                <option value="">Role…</option>
                {roles.map((r) => (
                  <option key={r.id} value={r.id}>
                    {r.name}
                  </option>
                ))}
              </select>
              <button
                type="button"
                disabled={isRolesSaving || !newRoleBranchId || !newRoleId}
                onClick={handleAddRole}
                className="shrink-0 rounded-md bg-indigo-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-indigo-500 disabled:opacity-60"
              >
                Add
              </button>
            </div>
          </div>

          <div className="flex justify-end pt-2">
            <button
              type="button"
              onClick={() => setRolesTarget(null)}
              className="rounded-md border border-zinc-300 px-3 py-1.5 text-sm text-zinc-700 hover:bg-zinc-50 dark:border-zinc-700 dark:text-zinc-200 dark:hover:bg-zinc-800"
            >
              Close
            </button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
