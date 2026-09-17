"use client";

import { useEffect, useState } from "react";
import { FormField, textInputClass } from "@/components/ui/FormField";
import { Modal } from "@/components/ui/Modal";
import { ToggleSwitch } from "@/components/ui/ToggleSwitch";
import { RowAction } from "@/components/ui/RowAction";
import { EditIcon } from "@/components/ui/icons";

type PayType = "FIXED_SALARY" | "PIECE_RATE" | null;

interface EmployeeRow {
  id: string;
  employeeCode: string;
  fullName: string;
  isActive: boolean;
  payType: PayType;
  fixedMonthlySalary: string | null;
  pieceRatePerUnit: string | null;
  travelAllowance: string | null;
  dearnessAllowance: string | null;
  selfEntryEnabled: boolean;
}

const PAY_TYPE_LABELS: Record<Exclude<PayType, null>, string> = {
  FIXED_SALARY: "Fixed Salary",
  PIECE_RATE: "Piece Rate",
};

async function parseErrorMessage(res: Response, fallback: string) {
  const body = await res.json().catch(() => null);
  return body?.error?.message ?? fallback;
}

/**
 * Worker pay-config (storage only — no payroll calculation/payslip, see
 * CLAUDE.md's worker self-entry feature notes) and the per-employee
 * self-entry toggle, in one place per the user's explicit ask for "ek admin
 * ka setting page ho jaha se admin ... worker ki salary TA DA" manage kar
 * sake. Both write through the existing PATCH /api/v1/employees/:id — no new
 * backend module needed, this panel is purely a focused view over fields
 * already on the Employee master.
 */
export function AdminWorkerSettingsPanel({ canManage }: { canManage: boolean }) {
  const [employees, setEmployees] = useState<EmployeeRow[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);
  const [togglingId, setTogglingId] = useState<string | null>(null);

  const [payTarget, setPayTarget] = useState<EmployeeRow | null>(null);
  const [payForm, setPayForm] = useState({
    payType: "" as Exclude<PayType, null> | "",
    fixedMonthlySalary: "",
    pieceRatePerUnit: "",
    travelAllowance: "",
    dearnessAllowance: "",
  });
  const [payError, setPayError] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);

  useEffect(() => {
    fetch("/api/v1/employees?pageSize=500")
      .then(async (res) => {
        if (!res.ok) {
          setLoadError(await parseErrorMessage(res, "Unable to load employees."));
          return;
        }
        setLoadError(null);
        const body = await res.json();
        setEmployees(body.data ?? []);
      })
      .catch(() => setLoadError("Unable to load employees."));
  }, [refreshKey]);

  async function toggleSelfEntry(emp: EmployeeRow) {
    setTogglingId(emp.id);
    await fetch(`/api/v1/employees/${emp.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ selfEntryEnabled: !emp.selfEntryEnabled }),
    });
    setTogglingId(null);
    setRefreshKey((k) => k + 1);
  }

  function openPayModal(emp: EmployeeRow) {
    setPayTarget(emp);
    setPayForm({
      payType: emp.payType ?? "",
      fixedMonthlySalary: emp.fixedMonthlySalary ?? "",
      pieceRatePerUnit: emp.pieceRatePerUnit ?? "",
      travelAllowance: emp.travelAllowance ?? "",
      dearnessAllowance: emp.dearnessAllowance ?? "",
    });
    setPayError(null);
  }

  async function savePay() {
    if (!payTarget) return;
    setIsSaving(true);
    setPayError(null);
    const res = await fetch(`/api/v1/employees/${payTarget.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        payType: payForm.payType || undefined,
        fixedMonthlySalary: payForm.fixedMonthlySalary === "" ? undefined : Number(payForm.fixedMonthlySalary),
        pieceRatePerUnit: payForm.pieceRatePerUnit === "" ? undefined : Number(payForm.pieceRatePerUnit),
        travelAllowance: payForm.travelAllowance === "" ? undefined : Number(payForm.travelAllowance),
        dearnessAllowance: payForm.dearnessAllowance === "" ? undefined : Number(payForm.dearnessAllowance),
      }),
    });
    if (!res.ok) {
      setPayError(await parseErrorMessage(res, "Failed to save pay configuration."));
      setIsSaving(false);
      return;
    }
    setIsSaving(false);
    setPayTarget(null);
    setRefreshKey((k) => k + 1);
  }

  return (
    <div className="space-y-3">
      <p className="text-sm text-zinc-500 dark:text-zinc-400">
        Per-employee pay basis (Fixed Salary or Piece Rate), TA/DA — storage only, not a payroll run — and whether this
        worker logs their own daily progress (subject to Supervisor approval) or a Supervisor logs it for them.
      </p>

      {loadError && (
        <div className="rounded-md border border-red-300 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-500/30 dark:bg-red-500/10 dark:text-red-300">
          {loadError}
        </div>
      )}

      {!loadError && (
        <div className="overflow-x-auto rounded-lg border border-zinc-200 dark:border-zinc-800">
          <table className="min-w-full divide-y divide-zinc-200 text-sm dark:divide-zinc-800">
            <thead className="bg-zinc-50 dark:bg-zinc-900">
              <tr>
                <th className="px-3 py-2 text-left font-medium text-zinc-500">Employee</th>
                <th className="px-3 py-2 text-left font-medium text-zinc-500">Pay Type</th>
                <th className="px-3 py-2 text-left font-medium text-zinc-500">Rate</th>
                <th className="px-3 py-2 text-left font-medium text-zinc-500">TA</th>
                <th className="px-3 py-2 text-left font-medium text-zinc-500">DA</th>
                <th className="px-3 py-2 text-left font-medium text-zinc-500">Self-Entry</th>
                {canManage && <th className="px-3 py-2 text-left font-medium text-zinc-500">Actions</th>}
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-100 dark:divide-zinc-800">
              {employees.map((e) => (
                <tr key={e.id}>
                  <td className="px-3 py-2 text-zinc-900 dark:text-zinc-100">
                    {e.fullName} <span className="text-xs text-zinc-400">({e.employeeCode})</span>
                  </td>
                  <td className="px-3 py-2 text-zinc-600 dark:text-zinc-400">{e.payType ? PAY_TYPE_LABELS[e.payType] : "—"}</td>
                  <td className="px-3 py-2 text-zinc-600 dark:text-zinc-400">
                    {e.payType === "FIXED_SALARY" && (e.fixedMonthlySalary ?? "—")}
                    {e.payType === "PIECE_RATE" && (e.pieceRatePerUnit ?? "—")}
                    {!e.payType && "—"}
                  </td>
                  <td className="px-3 py-2 text-zinc-600 dark:text-zinc-400">{e.travelAllowance ?? "—"}</td>
                  <td className="px-3 py-2 text-zinc-600 dark:text-zinc-400">{e.dearnessAllowance ?? "—"}</td>
                  <td className="px-3 py-2">
                    <ToggleSwitch
                      checked={e.selfEntryEnabled}
                      disabled={!canManage || togglingId === e.id}
                      onToggle={() => toggleSelfEntry(e)}
                    />
                  </td>
                  {canManage && (
                    <td className="px-3 py-2">
                      <RowAction icon={<EditIcon />} label="Edit Pay Config" onClick={() => openPayModal(e)} />
                    </td>
                  )}
                </tr>
              ))}
              {employees.length === 0 && (
                <tr>
                  <td colSpan={canManage ? 7 : 6} className="px-3 py-4 text-center text-sm text-zinc-500 dark:text-zinc-400">
                    No employees found.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}

      <Modal open={!!payTarget} onClose={() => setPayTarget(null)} title={`Pay Config — ${payTarget?.fullName ?? ""}`}>
        <div className="space-y-3">
          {payError && <p className="text-sm text-red-600 dark:text-red-400">{payError}</p>}
          <FormField label="Pay Type" htmlFor="payType">
            <select
              id="payType"
              className={textInputClass()}
              value={payForm.payType}
              onChange={(e) => setPayForm({ ...payForm, payType: e.target.value as Exclude<PayType, null> | "" })}
            >
              <option value="">— Not set —</option>
              <option value="FIXED_SALARY">Fixed Salary</option>
              <option value="PIECE_RATE">Piece Rate</option>
            </select>
          </FormField>
          {payForm.payType === "FIXED_SALARY" && (
            <FormField label="Fixed Monthly Salary" htmlFor="fixedMonthlySalary">
              <input
                id="fixedMonthlySalary"
                type="number"
                min={0}
                step="0.01"
                className={textInputClass()}
                value={payForm.fixedMonthlySalary}
                onChange={(e) => setPayForm({ ...payForm, fixedMonthlySalary: e.target.value })}
              />
            </FormField>
          )}
          {payForm.payType === "PIECE_RATE" && (
            <FormField label="Piece Rate Per Unit" htmlFor="pieceRatePerUnit">
              <input
                id="pieceRatePerUnit"
                type="number"
                min={0}
                step="0.0001"
                className={textInputClass()}
                value={payForm.pieceRatePerUnit}
                onChange={(e) => setPayForm({ ...payForm, pieceRatePerUnit: e.target.value })}
              />
            </FormField>
          )}
          <div className="grid grid-cols-2 gap-3">
            <FormField label="Travel Allowance (TA)" htmlFor="travelAllowance">
              <input
                id="travelAllowance"
                type="number"
                min={0}
                step="0.01"
                className={textInputClass()}
                value={payForm.travelAllowance}
                onChange={(e) => setPayForm({ ...payForm, travelAllowance: e.target.value })}
              />
            </FormField>
            <FormField label="Dearness Allowance (DA)" htmlFor="dearnessAllowance">
              <input
                id="dearnessAllowance"
                type="number"
                min={0}
                step="0.01"
                className={textInputClass()}
                value={payForm.dearnessAllowance}
                onChange={(e) => setPayForm({ ...payForm, dearnessAllowance: e.target.value })}
              />
            </FormField>
          </div>
          <div className="flex justify-end gap-3 pt-2">
            <button
              type="button"
              onClick={() => setPayTarget(null)}
              className="rounded-md border border-zinc-300 px-3 py-1.5 text-sm text-zinc-700 hover:bg-zinc-50 dark:border-zinc-700 dark:text-zinc-200 dark:hover:bg-zinc-800"
            >
              Cancel
            </button>
            <button
              type="button"
              disabled={isSaving}
              onClick={savePay}
              className="rounded-md bg-indigo-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-indigo-500 disabled:opacity-60"
            >
              {isSaving ? "Saving…" : "Save"}
            </button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
