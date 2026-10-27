"use client";

import { useEffect, useState, type FormEvent } from "react";
import { FormField, textInputClass } from "@/components/ui/FormField";
import {
  PAYMENT_REQUEST_TYPES,
  PAYMENT_REQUEST_TYPE_DEFS,
  type PaymentRequestTypeKey,
} from "@/modules/accounts/payment-requests/request-type-registry";

export interface ApprovalRuleRow {
  id: string;
  requestType: PaymentRequestTypeKey;
  branchId: string | null;
  branch: { id: string; name: string } | null;
  minAmount: string;
  maxAmount: string | null;
  routing: "APPROVAL_THEN_PAY" | "DIRECT_TO_ACCOUNTANT";
  approvalLevels: number;
  approverMayPay: boolean;
  isActive: boolean;
  approvers: {
    level: number;
    roleId: string | null;
    userId: string | null;
    role: { id: string; name: string } | null;
    user: { id: string; fullName: string } | null;
  }[];
}

interface Lookup {
  id: string;
  name: string;
}

type LevelPick = { roleIds: string[]; userIds: string[] };

interface Props {
  initial?: ApprovalRuleRow;
  onCancel: () => void;
  onSaved: () => void;
}

export function ApprovalRuleForm({ initial, onCancel, onSaved }: Props) {
  const [branches, setBranches] = useState<Lookup[]>([]);
  const [roles, setRoles] = useState<Lookup[]>([]);
  const [users, setUsers] = useState<Lookup[]>([]);

  const [requestType, setRequestType] = useState<PaymentRequestTypeKey>(initial?.requestType ?? "SUPPLIER_ON_ACCOUNT");
  const [branchId, setBranchId] = useState(initial?.branchId ?? "");
  const [minAmount, setMinAmount] = useState(initial ? String(Number(initial.minAmount)) : "0");
  const [maxAmount, setMaxAmount] = useState(initial?.maxAmount === null || !initial ? "" : String(Number(initial.maxAmount)));
  const [routing, setRouting] = useState(initial?.routing ?? "APPROVAL_THEN_PAY");
  const [levels, setLevels] = useState(initial?.approvalLevels ?? 1);
  const [approverMayPay, setApproverMayPay] = useState(initial?.approverMayPay ?? false);
  const [picks, setPicks] = useState<LevelPick[]>(() =>
    [1, 2, 3].map((level) => ({
      roleIds: initial?.approvers.filter((a) => a.level === level && a.roleId).map((a) => a.roleId!) ?? [],
      userIds: initial?.approvers.filter((a) => a.level === level && a.userId).map((a) => a.userId!) ?? [],
    }))
  );
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    const get = (url: string) => fetch(url).then((r) => (r.ok ? r.json() : { data: [] }));
    get("/api/v1/branches").then((b) => setBranches(b.data ?? []));
    get("/api/v1/roles").then((b) => setRoles((b.data ?? []).filter((r: Lookup) => r.name !== "EXTERNAL_UNIT_USER")));
    get("/api/v1/users").then((b) => setUsers((b.data ?? []).map((u: { id: string; fullName: string }) => ({ id: u.id, name: u.fullName }))));
  }, []);

  const toggle = (level: number, key: keyof LevelPick, id: string) =>
    setPicks((prev) =>
      prev.map((p, i) =>
        i === level - 1 ? { ...p, [key]: p[key].includes(id) ? p[key].filter((x) => x !== id) : [...p[key], id] } : p
      )
    );

  const direct = routing === "DIRECT_TO_ACCOUNTANT";

  const submit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (saving) return;
    setSaving(true);
    setError(null);
    const approvers = direct
      ? []
      : picks.slice(0, levels).flatMap((p, i) => [
          ...p.roleIds.map((roleId) => ({ level: i + 1, roleId })),
          ...p.userIds.map((userId) => ({ level: i + 1, userId })),
        ]);
    try {
      const res = await fetch(
        initial ? `/api/v1/payment-requests/approval-rules/${initial.id}` : "/api/v1/payment-requests/approval-rules",
        {
          method: initial ? "PUT" : "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            requestType,
            branchId,
            minAmount: Number(minAmount || 0),
            maxAmount: maxAmount === "" ? "" : Number(maxAmount),
            routing,
            approvalLevels: direct ? 1 : levels,
            approverMayPay,
            approvers,
          }),
        }
      );
      const body = await res.json().catch(() => null);
      if (!res.ok) {
        setError(body?.error?.message ?? "Could not save the rule.");
        return;
      }
      onSaved();
    } catch {
      setError("Network error — please try again.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <form onSubmit={submit} className="space-y-4">
      <div className="grid gap-4 sm:grid-cols-2">
        <FormField label="Request type" htmlFor="requestType" required>
          <select
            id="requestType"
            value={requestType}
            onChange={(e) => setRequestType(e.target.value as PaymentRequestTypeKey)}
            className={textInputClass()}
          >
            {PAYMENT_REQUEST_TYPES.map((t) => (
              <option key={t} value={t}>
                {PAYMENT_REQUEST_TYPE_DEFS[t].label}
              </option>
            ))}
          </select>
        </FormField>
        <FormField label="Branch" htmlFor="branchId">
          <select id="branchId" value={branchId} onChange={(e) => setBranchId(e.target.value)} className={textInputClass()}>
            <option value="">All branches</option>
            {branches.map((b) => (
              <option key={b.id} value={b.id}>
                {b.name}
              </option>
            ))}
          </select>
        </FormField>
        <FormField label="Amount from (₹)" htmlFor="minAmount" required>
          <input
            id="minAmount"
            type="number"
            min="0"
            step="0.01"
            required
            value={minAmount}
            onChange={(e) => setMinAmount(e.target.value)}
            className={textInputClass()}
          />
        </FormField>
        <FormField label="Amount up to (₹, not included — empty = no limit)" htmlFor="maxAmount">
          <input
            id="maxAmount"
            type="number"
            min="0"
            step="0.01"
            value={maxAmount}
            onChange={(e) => setMaxAmount(e.target.value)}
            className={textInputClass()}
          />
        </FormField>
      </div>

      <fieldset className="space-y-2">
        <legend className="text-sm font-medium text-zinc-700 dark:text-zinc-300">Routing</legend>
        <label className="flex items-center gap-2 text-sm">
          <input type="radio" checked={!direct} onChange={() => setRouting("APPROVAL_THEN_PAY")} />
          Needs approval, then the accountant pays
        </label>
        <label className="flex items-center gap-2 text-sm">
          <input type="radio" checked={direct} onChange={() => setRouting("DIRECT_TO_ACCOUNTANT")} />
          Straight to the accountant (no approver)
        </label>
      </fieldset>

      {!direct && (
        <>
          <div className="flex flex-wrap items-center gap-4">
            <FormField label="Approval levels" htmlFor="levels">
              <select id="levels" value={levels} onChange={(e) => setLevels(Number(e.target.value))} className={textInputClass()}>
                {[1, 2, 3].map((n) => (
                  <option key={n} value={n}>
                    {n}
                  </option>
                ))}
              </select>
            </FormField>
            <label className="mt-5 flex items-center gap-2 text-sm">
              <input type="checkbox" checked={approverMayPay} onChange={(e) => setApproverMayPay(e.target.checked)} />
              An approver may also pay this request
            </label>
          </div>

          <div className="grid gap-3 md:grid-cols-3">
            {Array.from({ length: levels }, (_, i) => i + 1).map((level) => (
              <div key={level} className="rounded-md border border-zinc-200 p-3 dark:border-zinc-800">
                <p className="text-sm font-medium text-zinc-900 dark:text-zinc-50">Level {level} approvers</p>
                <p className="mt-2 text-xs uppercase text-zinc-500">Roles</p>
                <div className="max-h-32 overflow-y-auto">
                  {roles.map((r) => (
                    <label key={r.id} className="flex items-center gap-2 text-sm">
                      <input type="checkbox" checked={picks[level - 1].roleIds.includes(r.id)} onChange={() => toggle(level, "roleIds", r.id)} />
                      {r.name}
                    </label>
                  ))}
                </div>
                <p className="mt-2 text-xs uppercase text-zinc-500">Users</p>
                <div className="max-h-32 overflow-y-auto">
                  {users.map((u) => (
                    <label key={u.id} className="flex items-center gap-2 text-sm">
                      <input type="checkbox" checked={picks[level - 1].userIds.includes(u.id)} onChange={() => toggle(level, "userIds", u.id)} />
                      {u.name}
                    </label>
                  ))}
                </div>
              </div>
            ))}
          </div>
          <p className="text-xs text-zinc-500">
            A role means everyone holding it. Approvers still need the Payment Requests &quot;Approve&quot; permission, can&apos;t
            approve their own request, and can&apos;t approve two levels of the same request.
          </p>
        </>
      )}

      {error && <p className="text-sm text-red-600 dark:text-red-400">{error}</p>}

      <div className="flex justify-end gap-2">
        <button type="button" onClick={onCancel} className="rounded-md border border-zinc-300 px-4 py-2 text-sm text-zinc-700 dark:border-zinc-700 dark:text-zinc-200">
          Cancel
        </button>
        <button
          type="submit"
          disabled={saving}
          className="rounded-md bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-500 disabled:opacity-60"
        >
          {saving ? "Saving…" : "Save Rule"}
        </button>
      </div>
    </form>
  );
}
