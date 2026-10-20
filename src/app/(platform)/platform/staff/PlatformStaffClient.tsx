"use client";

import { useState } from "react";
import { Breadcrumb } from "@/components/ui/Breadcrumb";
import { Modal } from "@/components/ui/Modal";
import { ConfirmModal } from "@/components/ui/ConfirmModal";
import { EyeIcon, EyeOffIcon } from "@/components/ui/icons";
import { formatDate } from "@/lib/date-format";

export interface PlatformStaffItem {
  id: string;
  email: string;
  fullName: string;
  role: "PLATFORM_SUPER_ADMIN" | "SUPPORT_AGENT" | "BILLING_ADMIN";
  status: "ACTIVE" | "SUSPENDED" | "LOCKED";
  lastLoginAt: string | null;
  createdAt: string;
}

const ROLE_LABELS: Record<string, string> = {
  PLATFORM_SUPER_ADMIN: "Platform Super Admin",
  SUPPORT_AGENT: "Support Agent",
  BILLING_ADMIN: "Billing Admin",
};

const ROLE_BADGES: Record<string, string> = {
  PLATFORM_SUPER_ADMIN: "bg-purple-100 text-purple-800 dark:bg-purple-950/70 dark:text-purple-300",
  SUPPORT_AGENT: "bg-emerald-100 text-emerald-800 dark:bg-emerald-950/70 dark:text-emerald-300",
  BILLING_ADMIN: "bg-amber-100 text-amber-800 dark:bg-amber-950/70 dark:text-amber-300",
};

export function PlatformStaffClient({
  initialStaff,
  currentUserId,
}: {
  initialStaff: PlatformStaffItem[];
  currentUserId: string;
}) {
  const [staffList, setStaffList] = useState<PlatformStaffItem[]>(initialStaff);
  const [createOpen, setCreateOpen] = useState(false);
  const [editItem, setEditItem] = useState<PlatformStaffItem | null>(null);
  const [resetItem, setResetItem] = useState<PlatformStaffItem | null>(null);
  const [toggleItem, setToggleItem] = useState<{ item: PlatformStaffItem; targetStatus: "ACTIVE" | "SUSPENDED" } | null>(null);

  // Create Form State
  const [newEmail, setNewEmail] = useState("");
  const [newName, setNewName] = useState("");
  const [newRole, setNewRole] = useState<"PLATFORM_SUPER_ADMIN" | "SUPPORT_AGENT" | "BILLING_ADMIN">("SUPPORT_AGENT");
  const [newPassword, setNewPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);

  // Edit Role Form State
  const [editRole, setEditRole] = useState<"PLATFORM_SUPER_ADMIN" | "SUPPORT_AGENT" | "BILLING_ADMIN">("SUPPORT_AGENT");
  const [editName, setEditName] = useState("");

  // Reset Password State
  const [resetPassword, setResetPassword] = useState("");
  const [showResetPassword, setShowResetPassword] = useState(false);

  // Async states
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  async function reload() {
    const res = await fetch("/api/v1/platform/staff", { cache: "no-store" });
    if (res.ok) {
      const json = await res.json();
      setStaffList(json.data);
    }
  }

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/v1/platform/staff", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          email: newEmail,
          fullName: newName,
          role: newRole,
          password: newPassword,
        }),
      });
      if (!res.ok) {
        const json = await res.json().catch(() => null);
        setError(json?.error?.message ?? "Failed to create operator.");
        return;
      }
      setCreateOpen(false);
      setNewEmail("");
      setNewName("");
      setNewPassword("");
      await reload();
    } finally {
      setBusy(false);
    }
  }

  async function handleEdit(e: React.FormEvent) {
    e.preventDefault();
    if (!editItem) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/v1/platform/staff/${editItem.id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          fullName: editName,
          role: editRole,
        }),
      });
      if (!res.ok) {
        const json = await res.json().catch(() => null);
        setError(json?.error?.message ?? "Failed to update operator.");
        return;
      }
      setEditItem(null);
      await reload();
    } finally {
      setBusy(false);
    }
  }

  async function handleResetPassword(e: React.FormEvent) {
    e.preventDefault();
    if (!resetItem) return;
    setBusy(true);
    setError(null);
    setSuccess(null);
    try {
      const res = await fetch(`/api/v1/platform/staff/${resetItem.id}/reset-password`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ newPassword: resetPassword }),
      });
      if (!res.ok) {
        const json = await res.json().catch(() => null);
        setError(json?.error?.message ?? "Failed to reset password.");
        return;
      }
      setSuccess(`Password updated successfully for ${resetItem.email}`);
      setTimeout(() => {
        setResetItem(null);
        setResetPassword("");
        setSuccess(null);
      }, 1500);
      await reload();
    } finally {
      setBusy(false);
    }
  }

  async function handleToggleStatus() {
    if (!toggleItem) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/v1/platform/staff/${toggleItem.item.id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ status: toggleItem.targetStatus }),
      });
      if (!res.ok) {
        const json = await res.json().catch(() => null);
        setError(json?.error?.message ?? "Failed to update status.");
        return;
      }
      setToggleItem(null);
      await reload();
    } finally {
      setBusy(false);
    }
  }

  const superAdmins = staffList.filter((s) => s.role === "PLATFORM_SUPER_ADMIN").length;
  const supportAgents = staffList.filter((s) => s.role === "SUPPORT_AGENT").length;
  const billingAdmins = staffList.filter((s) => s.role === "BILLING_ADMIN").length;

  return (
    <div className="space-y-6">
      <Breadcrumb items={[{ label: "Platform", href: "/platform" }, { label: "Staff & Team" }]} />

      {/* Top Header */}
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-xl font-semibold text-zinc-900 dark:text-zinc-50">Platform Operators & Team</h1>
          <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">
            Manage who has access to the central SaaS platform, assign operator roles, and maintain internal security.
          </p>
        </div>
        <button
          type="button"
          onClick={() => {
            setError(null);
            setCreateOpen(true);
          }}
          className="inline-flex items-center gap-1.5 rounded-md bg-indigo-600 px-4 py-2 text-sm font-medium text-white shadow-sm hover:bg-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-500"
        >
          <span>+ Add Operator</span>
        </button>
      </div>

      {/* KPI Cards */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <div className="rounded-lg border border-zinc-200 bg-white p-3.5 shadow-sm dark:border-zinc-800 dark:bg-zinc-900">
          <div className="text-xs font-medium text-zinc-500 dark:text-zinc-400">Total Operators</div>
          <div className="mt-1 text-2xl font-semibold text-zinc-900 dark:text-zinc-50">{staffList.length}</div>
        </div>
        <div className="rounded-lg border border-zinc-200 bg-white p-3.5 shadow-sm dark:border-zinc-800 dark:bg-zinc-900">
          <div className="text-xs font-medium text-purple-600 dark:text-purple-400">Super Admins</div>
          <div className="mt-1 text-2xl font-semibold text-purple-600 dark:text-purple-400">{superAdmins}</div>
        </div>
        <div className="rounded-lg border border-zinc-200 bg-white p-3.5 shadow-sm dark:border-zinc-800 dark:bg-zinc-900">
          <div className="text-xs font-medium text-emerald-600 dark:text-emerald-400">Support Agents</div>
          <div className="mt-1 text-2xl font-semibold text-emerald-600 dark:text-emerald-400">{supportAgents}</div>
        </div>
        <div className="rounded-lg border border-zinc-200 bg-white p-3.5 shadow-sm dark:border-zinc-800 dark:bg-zinc-900">
          <div className="text-xs font-medium text-amber-600 dark:text-amber-400">Billing Admins</div>
          <div className="mt-1 text-2xl font-semibold text-amber-600 dark:text-amber-400">{billingAdmins}</div>
        </div>
      </div>

      {/* Staff Table */}
      <div className="overflow-x-auto rounded-lg border border-zinc-200 bg-white shadow-sm dark:border-zinc-800 dark:bg-zinc-900">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-zinc-200 bg-zinc-50/50 text-left text-xs uppercase tracking-wide text-zinc-500 dark:border-zinc-800 dark:bg-zinc-800/40 dark:text-zinc-400">
              <th className="px-4 py-3 font-medium">Operator</th>
              <th className="px-4 py-3 font-medium">Role</th>
              <th className="px-4 py-3 font-medium">Status</th>
              <th className="px-4 py-3 font-medium">Last Login</th>
              <th className="px-4 py-3 font-medium">Added On</th>
              <th className="px-4 py-3 font-medium text-right">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-zinc-100 dark:divide-zinc-800">
            {staffList.map((s) => {
              const isSelf = s.id === currentUserId;
              return (
                <tr key={s.id} className="transition-colors hover:bg-zinc-50/80 dark:hover:bg-zinc-800/50">
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-2">
                      <span className="font-medium text-zinc-900 dark:text-zinc-100">{s.fullName}</span>
                      {isSelf && (
                        <span className="rounded bg-indigo-50 px-1.5 py-0.5 text-[10px] font-semibold text-indigo-700 dark:bg-indigo-950 dark:text-indigo-300">
                          YOU
                        </span>
                      )}
                    </div>
                    <div className="text-xs text-zinc-500">{s.email}</div>
                  </td>
                  <td className="px-4 py-3">
                    <span className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ${ROLE_BADGES[s.role]}`}>
                      {ROLE_LABELS[s.role] ?? s.role}
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    <span
                      className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ${
                        s.status === "ACTIVE"
                          ? "bg-emerald-100 text-emerald-800 dark:bg-emerald-950/70 dark:text-emerald-300"
                          : "bg-red-100 text-red-800 dark:bg-red-950/70 dark:text-red-300"
                      }`}
                    >
                      {s.status}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-xs text-zinc-600 dark:text-zinc-400">
                    {s.lastLoginAt ? formatDate(s.lastLoginAt) : <span className="text-zinc-400">Never</span>}
                  </td>
                  <td className="px-4 py-3 text-xs text-zinc-500">{formatDate(s.createdAt)}</td>
                  <td className="px-4 py-3 text-right whitespace-nowrap text-xs">
                    <div className="flex items-center justify-end gap-1.5">
                      <button
                        type="button"
                        onClick={() => {
                          setEditItem(s);
                          setEditName(s.fullName);
                          setEditRole(s.role);
                          setError(null);
                        }}
                        className="rounded border border-zinc-200 px-2 py-1 text-zinc-700 hover:bg-zinc-100 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800"
                      >
                        Edit
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          setResetItem(s);
                          setResetPassword("");
                          setShowResetPassword(false);
                          setError(null);
                          setSuccess(null);
                        }}
                        className="rounded border border-zinc-200 px-2 py-1 text-indigo-600 hover:bg-indigo-50 dark:border-zinc-700 dark:text-indigo-400 dark:hover:bg-indigo-950/50"
                      >
                        Reset Password
                      </button>
                      {!isSelf && (
                        <button
                          type="button"
                          onClick={() =>
                            setToggleItem({
                              item: s,
                              targetStatus: s.status === "ACTIVE" ? "SUSPENDED" : "ACTIVE",
                            })
                          }
                          className={`rounded px-2 py-1 font-medium ${
                            s.status === "ACTIVE"
                              ? "text-red-600 hover:bg-red-50 dark:text-red-400 dark:hover:bg-red-950/50"
                              : "text-emerald-600 hover:bg-emerald-50 dark:text-emerald-400 dark:hover:bg-emerald-950/50"
                          }`}
                        >
                          {s.status === "ACTIVE" ? "Suspend" : "Activate"}
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* Create Operator Modal */}
      <Modal open={createOpen} onClose={() => !busy && setCreateOpen(false)} title="Add Platform Operator">
        <form onSubmit={handleCreate} className="space-y-4 text-sm">
          <p className="text-xs text-zinc-500">
            Create an internal staff account to manage companies, plans, or provide customer support.
          </p>

          <div>
            <label className="block text-xs font-medium text-zinc-700 dark:text-zinc-300">
              Full Name <span className="text-red-500">*</span>
            </label>
            <input
              type="text"
              required
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              placeholder="e.g. Rahul Sharma"
              className="mt-1 w-full rounded-md border border-zinc-300 px-3 py-1.5 text-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500 dark:border-zinc-700 dark:bg-zinc-900"
            />
          </div>

          <div>
            <label className="block text-xs font-medium text-zinc-700 dark:text-zinc-300">
              Work Email <span className="text-red-500">*</span>
            </label>
            <input
              type="email"
              required
              value={newEmail}
              onChange={(e) => setNewEmail(e.target.value)}
              placeholder="e.g. rahul@indradhar.com"
              className="mt-1 w-full rounded-md border border-zinc-300 px-3 py-1.5 text-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500 dark:border-zinc-700 dark:bg-zinc-900"
            />
          </div>

          <div>
            <label className="block text-xs font-medium text-zinc-700 dark:text-zinc-300">
              Platform Role <span className="text-red-500">*</span>
            </label>
            <select
              value={newRole}
              onChange={(e) => setNewRole(e.target.value as any)}
              className="mt-1 w-full rounded-md border border-zinc-300 px-3 py-1.5 text-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500 dark:border-zinc-700 dark:bg-zinc-900"
            >
              <option value="SUPPORT_AGENT">Support Agent (Can view companies, handle tickets & request proxy access)</option>
              <option value="BILLING_ADMIN">Billing Admin (Can manage plans, coupons, payments & subscriptions)</option>
              <option value="PLATFORM_SUPER_ADMIN">Platform Super Admin (Full platform management & operator controls)</option>
            </select>
          </div>

          <div>
            <label className="block text-xs font-medium text-zinc-700 dark:text-zinc-300">
              Temporary Password <span className="text-red-500">*</span>
            </label>
            <div className="relative mt-1">
              <input
                type={showPassword ? "text" : "password"}
                required
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                placeholder="At least 8 characters"
                className="w-full rounded-md border border-zinc-300 px-3 py-1.5 pr-10 text-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500 dark:border-zinc-700 dark:bg-zinc-900"
              />
              <button
                type="button"
                onClick={() => setShowPassword((prev) => !prev)}
                className="absolute inset-y-0 right-0 flex items-center pr-3 text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-200"
                tabIndex={-1}
              >
                {showPassword ? <EyeOffIcon /> : <EyeIcon />}
              </button>
            </div>
          </div>

          {error && <p className="text-xs font-medium text-red-600">{error}</p>}

          <div className="flex justify-end gap-2 pt-2">
            <button
              type="button"
              disabled={busy}
              onClick={() => setCreateOpen(false)}
              className="rounded-md border border-zinc-300 px-3 py-1.5 text-xs text-zinc-700 hover:bg-zinc-100 dark:border-zinc-700 dark:text-zinc-300"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={busy || !newName || !newEmail || newPassword.length < 8}
              className="rounded-md bg-indigo-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-indigo-500 disabled:opacity-50"
            >
              {busy ? "Creating..." : "Create Operator"}
            </button>
          </div>
        </form>
      </Modal>

      {/* Edit Operator Modal */}
      <Modal open={!!editItem} onClose={() => !busy && setEditItem(null)} title={`Edit ${editItem?.fullName ?? ""}`}>
        <form onSubmit={handleEdit} className="space-y-4 text-sm">
          <div>
            <label className="block text-xs font-medium text-zinc-700 dark:text-zinc-300">Full Name</label>
            <input
              type="text"
              required
              value={editName}
              onChange={(e) => setEditName(e.target.value)}
              className="mt-1 w-full rounded-md border border-zinc-300 px-3 py-1.5 text-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500 dark:border-zinc-700 dark:bg-zinc-900"
            />
          </div>

          <div>
            <label className="block text-xs font-medium text-zinc-700 dark:text-zinc-300">Platform Role</label>
            <select
              value={editRole}
              onChange={(e) => setEditRole(e.target.value as any)}
              className="mt-1 w-full rounded-md border border-zinc-300 px-3 py-1.5 text-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500 dark:border-zinc-700 dark:bg-zinc-900"
            >
              <option value="SUPPORT_AGENT">Support Agent</option>
              <option value="BILLING_ADMIN">Billing Admin</option>
              <option value="PLATFORM_SUPER_ADMIN">Platform Super Admin</option>
            </select>
          </div>

          {error && <p className="text-xs font-medium text-red-600">{error}</p>}

          <div className="flex justify-end gap-2 pt-2">
            <button
              type="button"
              disabled={busy}
              onClick={() => setEditItem(null)}
              className="rounded-md border border-zinc-300 px-3 py-1.5 text-xs text-zinc-700 hover:bg-zinc-100 dark:border-zinc-700 dark:text-zinc-300"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={busy || !editName.trim()}
              className="rounded-md bg-indigo-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-indigo-500 disabled:opacity-50"
            >
              {busy ? "Saving..." : "Save Changes"}
            </button>
          </div>
        </form>
      </Modal>

      {/* Reset Staff Password Modal */}
      <Modal open={!!resetItem} onClose={() => !busy && setResetItem(null)} title={`Reset Password for ${resetItem?.fullName ?? ""}`}>
        <form onSubmit={handleResetPassword} className="space-y-4 text-sm">
          <p className="text-xs text-zinc-500">
            Account: <span className="font-semibold text-zinc-800 dark:text-zinc-200">{resetItem?.email}</span>. Setting a new password will invalidate any existing platform session for this operator.
          </p>

          <div>
            <label className="block text-xs font-medium text-zinc-700 dark:text-zinc-300">
              New Password <span className="text-red-500">*</span>
            </label>
            <div className="relative mt-1">
              <input
                type={showResetPassword ? "text" : "password"}
                required
                value={resetPassword}
                onChange={(e) => setResetPassword(e.target.value)}
                placeholder="At least 8 characters"
                className="w-full rounded-md border border-zinc-300 px-3 py-1.5 pr-10 text-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500 dark:border-zinc-700 dark:bg-zinc-900"
              />
              <button
                type="button"
                onClick={() => setShowResetPassword((prev) => !prev)}
                className="absolute inset-y-0 right-0 flex items-center pr-3 text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-200"
                tabIndex={-1}
              >
                {showResetPassword ? <EyeOffIcon /> : <EyeIcon />}
              </button>
            </div>
          </div>

          {error && <p className="text-xs font-medium text-red-600">{error}</p>}
          {success && <p className="text-xs font-medium text-emerald-600">{success}</p>}

          <div className="flex justify-end gap-2 pt-2">
            <button
              type="button"
              disabled={busy}
              onClick={() => setResetItem(null)}
              className="rounded-md border border-zinc-300 px-3 py-1.5 text-xs text-zinc-700 hover:bg-zinc-100 dark:border-zinc-700 dark:text-zinc-300"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={busy || resetPassword.length < 8}
              className="rounded-md bg-indigo-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-indigo-500 disabled:opacity-50"
            >
              {busy ? "Saving..." : "Set Password"}
            </button>
          </div>
        </form>
      </Modal>

      {/* Confirm Suspend/Reactivate Modal */}
      <ConfirmModal
        open={!!toggleItem}
        title={
          toggleItem?.targetStatus === "SUSPENDED"
            ? `Suspend ${toggleItem?.item.fullName}?`
            : `Reactivate ${toggleItem?.item.fullName}?`
        }
        message={
          toggleItem?.targetStatus === "SUSPENDED"
            ? `This operator (${toggleItem?.item.email}) will immediately be locked out of the platform panel.`
            : `This operator (${toggleItem?.item.email}) will have their platform access restored.`
        }
        confirmLabel={toggleItem?.targetStatus === "SUSPENDED" ? "Suspend Operator" : "Activate Operator"}
        isDangerous={toggleItem?.targetStatus === "SUSPENDED"}
        isBusy={busy}
        onConfirm={handleToggleStatus}
        onCancel={() => setToggleItem(null)}
      />
    </div>
  );
}
