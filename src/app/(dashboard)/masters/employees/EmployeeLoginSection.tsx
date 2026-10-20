"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Modal } from "@/components/ui/Modal";
import { EmployeeLoginFields, type EmployeeLoginValues } from "./EmployeeLoginFields";

interface LinkedLogin {
  email: string;
  status: string;
  mustChangePassword: boolean;
}

/** P2: shows the employee's linked ERP login, or lets an admin create one. */
export function EmployeeLoginSection({
  employeeId,
  employeeEmail,
  employeeActive,
  login,
  canCreateLogin,
}: {
  employeeId: string;
  employeeEmail: string | null;
  employeeActive: boolean;
  login: LinkedLogin | null;
  canCreateLogin: boolean;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [values, setValues] = useState<EmployeeLoginValues>({ roleId: "", branchId: "" });
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const submit = async () => {
    if (saving) return;
    setSaving(true);
    setError(null);
    try {
      const res = await fetch(`/api/v1/employees/${employeeId}/create-login`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(values),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => null);
        setError(body?.error?.message ?? "Failed to create login.");
        return;
      }
      setOpen(false);
      router.refresh();
    } catch {
      setError("Could not reach the server. Check your connection and try again.");
    } finally {
      setSaving(false);
    }
  };

  let content: React.ReactNode;
  if (login) {
    content = (
      <p className="text-sm text-zinc-700 dark:text-zinc-200">
        {login.email} ·{" "}
        <span className={login.status === "ACTIVE" ? "text-green-700 dark:text-green-400" : "text-zinc-500"}>
          {login.status === "ACTIVE" ? "Active" : "Suspended"}
        </span>
        {login.mustChangePassword && <span className="text-amber-700 dark:text-amber-400"> · must change password</span>}
        <span className="text-zinc-500 dark:text-zinc-400"> — manage it in </span>
        <a href="/admin" className="text-indigo-600 hover:text-indigo-500">
          Admin → Users
        </a>
      </p>
    );
  } else if (!canCreateLogin) {
    content = <p className="text-sm text-zinc-500 dark:text-zinc-400">No login. Ask an administrator to create one.</p>;
  } else if (!employeeEmail) {
    content = (
      <p className="text-sm text-zinc-500 dark:text-zinc-400">No login. Add an email address to this employee to create one.</p>
    );
  } else if (!employeeActive) {
    content = <p className="text-sm text-zinc-500 dark:text-zinc-400">No login. Reactivate this employee to create one.</p>;
  } else {
    content = (
      <div className="flex items-center gap-3">
        <p className="text-sm text-zinc-500 dark:text-zinc-400">No login yet.</p>
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="rounded-md bg-indigo-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-indigo-500"
        >
          Create login
        </button>
      </div>
    );
  }

  return (
    <div className="max-w-xl">
      <h2 className="mb-3 text-sm font-semibold text-zinc-900 dark:text-zinc-50">ERP Login</h2>
      {content}

      <Modal open={open} onClose={() => setOpen(false)} title={`Create login for ${employeeEmail ?? ""}`} maxWidthClass="max-w-lg">
        <div className="space-y-4">
          <EmployeeLoginFields value={values} onChange={setValues} />
          {error && <p className="text-sm text-red-600 dark:text-red-400">{error}</p>}
          <div className="flex justify-end gap-3">
            <button
              type="button"
              onClick={() => setOpen(false)}
              className="rounded-md border border-zinc-300 px-3 py-1.5 text-sm text-zinc-700 hover:bg-zinc-50 dark:border-zinc-700 dark:text-zinc-200 dark:hover:bg-zinc-800"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={submit}
              disabled={saving || !values.roleId || !values.branchId}
              className="rounded-md bg-indigo-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-indigo-500 disabled:opacity-60"
            >
              {saving ? "Creating…" : "Create login"}
            </button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
