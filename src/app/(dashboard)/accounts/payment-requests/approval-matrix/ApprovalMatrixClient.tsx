"use client";

import { useCallback, useEffect, useState } from "react";
import { Breadcrumb } from "@/components/ui/Breadcrumb";
import { ConfirmModal } from "@/components/ui/ConfirmModal";
import { Modal } from "@/components/ui/Modal";
import { ToggleSwitch } from "@/components/ui/ToggleSwitch";
import { formatCurrency } from "@/lib/currency";
import {
  PAYMENT_REQUEST_TYPES,
  PAYMENT_REQUEST_TYPE_DEFS,
  type PaymentRequestTypeKey,
} from "@/modules/accounts/payment-requests/request-type-registry";
import { ApprovalRuleForm, type ApprovalRuleRow } from "./ApprovalRuleForm";

export function ApprovalMatrixClient({ canEdit }: { canEdit: boolean }) {
  const [rules, setRules] = useState<ApprovalRuleRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState<ApprovalRuleRow | "new" | null>(null);
  const [toggling, setToggling] = useState<ApprovalRuleRow | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(() => {
    fetch("/api/v1/payment-requests/approval-rules")
      .then(async (res) => {
        const body = await res.json().catch(() => null);
        if (!res.ok) throw new Error(body?.error?.message ?? "Could not load the approval matrix.");
        setRules(body.data);
      })
      .catch((e: Error) => setError(e.message));
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const toggle = async () => {
    if (!toggling) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/v1/payment-requests/approval-rules/${toggling.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ isActive: !toggling.isActive }),
      });
      const body = await res.json().catch(() => null);
      if (!res.ok) setError(body?.error?.message ?? "Could not change the rule.");
      else load();
    } finally {
      setBusy(false);
      setToggling(null);
    }
  };

  const typesWithRules = PAYMENT_REQUEST_TYPES.filter((t) => rules?.some((r) => r.requestType === t));

  return (
    <div className="space-y-4">
      <div>
        <Breadcrumb
          items={[
            { label: "Accounts", href: "/accounts" },
            { label: "Payment Requests", href: "/accounts/payment-requests" },
            { label: "Approval Matrix" },
          ]}
        />
        <div className="mt-2 flex flex-wrap items-center justify-between gap-3">
          <h1 className="text-lg font-semibold text-zinc-900 dark:text-zinc-50">Approval Matrix</h1>
          {canEdit && (
            <button
              type="button"
              onClick={() => setEditing("new")}
              className="rounded-md bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-500"
            >
              New Rule
            </button>
          )}
        </div>
        <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">
          Decide who approves each payment request type, by branch and amount, in up to 3 levels, or send it straight
          to the accountant. A type with no rule goes to anyone with the Approve permission (Salary goes straight to the
          accountant). Changing a rule never changes requests already raised.
        </p>
      </div>

      {error && <p className="text-sm text-red-600 dark:text-red-400">{error}</p>}
      {rules === null && !error && <p className="text-sm text-zinc-500">Loading…</p>}
      {rules?.length === 0 && (
        <p className="rounded-md border border-dashed border-zinc-300 p-6 text-center text-sm text-zinc-500 dark:border-zinc-700">
          No rules yet — every request uses the default routing.
        </p>
      )}

      {typesWithRules.map((type) => (
        <section key={type} className="rounded-lg border border-zinc-200 dark:border-zinc-800">
          <h2 className="border-b border-zinc-200 px-4 py-2 text-sm font-semibold text-zinc-900 dark:border-zinc-800 dark:text-zinc-50">
            {PAYMENT_REQUEST_TYPE_DEFS[type as PaymentRequestTypeKey].label}
          </h2>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-left text-xs uppercase text-zinc-500">
                <tr>
                  <th className="px-4 py-2">Branch</th>
                  <th className="px-4 py-2">Amount</th>
                  <th className="px-4 py-2">Routing</th>
                  <th className="px-4 py-2">Approvers</th>
                  <th className="px-4 py-2">Approver may pay</th>
                  <th className="px-4 py-2">Active</th>
                  {canEdit && <th className="px-4 py-2" />}
                </tr>
              </thead>
              <tbody>
                {rules!
                  .filter((r) => r.requestType === type)
                  .map((rule) => (
                    <tr key={rule.id} className="border-t border-zinc-100 align-top dark:border-zinc-800">
                      <td className="px-4 py-2">{rule.branch?.name ?? "All branches"}</td>
                      <td className="whitespace-nowrap px-4 py-2">
                        ₹{formatCurrency(rule.minAmount)} – {rule.maxAmount === null ? "no limit" : `₹${formatCurrency(rule.maxAmount)}`}
                      </td>
                      <td className="px-4 py-2">
                        {rule.routing === "DIRECT_TO_ACCOUNTANT" ? "Direct to accountant" : `${rule.approvalLevels} level(s)`}
                      </td>
                      <td className="px-4 py-2">
                        {rule.routing === "DIRECT_TO_ACCOUNTANT"
                          ? "—"
                          : Array.from({ length: rule.approvalLevels }, (_, i) => i + 1).map((level) => (
                              <div key={level}>
                                <span className="text-zinc-500">L{level}:</span>{" "}
                                {rule.approvers
                                  .filter((a) => a.level === level)
                                  .map((a) => (a.role ? `Role ${a.role.name}` : a.user?.fullName))
                                  .join(", ")}
                              </div>
                            ))}
                      </td>
                      <td className="px-4 py-2">{rule.approverMayPay ? "Yes" : "No"}</td>
                      <td className="px-4 py-2">
                        <ToggleSwitch checked={rule.isActive} disabled={!canEdit} onToggle={() => setToggling(rule)} />
                      </td>
                      {canEdit && (
                        <td className="px-4 py-2 text-right">
                          <button type="button" onClick={() => setEditing(rule)} className="text-indigo-600 hover:text-indigo-500">
                            Edit
                          </button>
                        </td>
                      )}
                    </tr>
                  ))}
              </tbody>
            </table>
          </div>
        </section>
      ))}

      <Modal
        open={editing !== null}
        onClose={() => setEditing(null)}
        title={editing === "new" ? "New approval rule" : "Edit approval rule"}
        maxWidthClass="max-w-3xl"
      >
        {editing !== null && (
          <ApprovalRuleForm
            key={editing === "new" ? "new" : editing.id}
            initial={editing === "new" ? undefined : editing}
            onCancel={() => setEditing(null)}
            onSaved={() => {
              setEditing(null);
              load();
            }}
          />
        )}
      </Modal>

      <ConfirmModal
        open={toggling !== null}
        title={toggling?.isActive ? "Deactivate rule?" : "Activate rule?"}
        message={
          toggling?.isActive
            ? "New requests will no longer use this rule. Requests already raised keep their approvers."
            : "New requests in this amount range will use this rule."
        }
        confirmLabel={toggling?.isActive ? "Deactivate" : "Activate"}
        isDangerous={toggling?.isActive}
        isBusy={busy}
        onCancel={() => setToggling(null)}
        onConfirm={toggle}
      />
    </div>
  );
}
