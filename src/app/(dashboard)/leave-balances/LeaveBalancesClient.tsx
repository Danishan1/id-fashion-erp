"use client";

import { useCallback, useEffect, useState } from "react";
import { Breadcrumb } from "@/components/ui/Breadcrumb";
import { Button } from "@/components/ui/Button";
import { ConfirmModal } from "@/components/ui/ConfirmModal";
import { FormField, textInputClass } from "@/components/ui/FormField";
import { Modal } from "@/components/ui/Modal";
import { SearchableSelect } from "@/components/ui/SearchableSelect";
import { apiJson, Card, ErrorText, Pill, todayIst } from "../attendance/_shared/attendance-ui";
import { useScopedEmployees } from "../attendance/_shared/useScopedEmployees";

interface BalanceRow {
  id: string;
  year: number;
  month: number;
  allocated: number;
  used: number;
  remaining: number;
  carryForward: number;
  available: number;
  isAdjusted: boolean;
  employee: { id: string; fullName: string; employeeCode: string };
  leaveType: { id: string; name: string; allocationType: string; quotaPerPeriod: number };
}

export function LeaveBalancesClient({ canEdit }: { canEdit: boolean }) {
  const { options } = useScopedEmployees();
  const [month, setMonth] = useState(() => todayIst().slice(0, 7));
  const [employeeId, setEmployeeId] = useState("");
  const [rows, setRows] = useState<BalanceRow[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [editing, setEditing] = useState<BalanceRow | null>(null);
  const [confirmCredit, setConfirmCredit] = useState(false);

  const load = useCallback(() => {
    const qs = new URLSearchParams({ month });
    if (employeeId) qs.set("employeeId", employeeId);
    apiJson<BalanceRow[]>(`/api/v1/leave-balances?${qs}`)
      .then((r) => {
        setRows(r);
        setError(null);
      })
      .catch((e) => setError(e.message));
  }, [month, employeeId]);
  useEffect(() => {
    load();
  }, [load]);

  const credit = async () => {
    setConfirmCredit(false);
    try {
      const r = await apiJson<{ created: number; employees: number }>("/api/v1/leave-balances/credit", { method: "POST", body: JSON.stringify({ month }) });
      setMessage(`Monthly credit done for ${month}: ${r.created} new balance(s) across ${r.employees} employee(s).`);
      load();
    } catch (e) {
      setError((e as Error).message);
    }
  };

  return (
    <div className="space-y-4">
      <Breadcrumb items={[{ label: "Dashboard", href: "/dashboard" }, { label: "Leave Balances" }]} />
      <div className="flex flex-wrap items-end justify-between gap-2">
        <div>
          <h1 className="text-lg font-semibold text-zinc-900 dark:text-zinc-50">Leave Balances</h1>
          <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">
            Each month: <b>this month</b> = quota credited for the month, <b>carried</b> = unused leave from earlier months. Leave is taken from this month first, then carried.
          </p>
        </div>
        {canEdit && (
          <Button variant="secondary" size="xs" onClick={() => setConfirmCredit(true)}>
            Run monthly credit
          </Button>
        )}
      </div>
      <div className="flex flex-wrap gap-2">
        <input type="month" className={`${textInputClass()} max-w-[12rem]`} value={month} onChange={(e) => e.target.value && setMonth(e.target.value)} />
        <div className="w-64">
          <SearchableSelect options={options} value={employeeId} onChange={setEmployeeId} placeholder="All employees" emptyOptionLabel="All employees" />
        </div>
      </div>
      <ErrorText message={error} />
      {message && <p className="rounded-md bg-emerald-50 px-3 py-2 text-sm text-emerald-800 dark:bg-emerald-950 dark:text-emerald-200">{message}</p>}
      <Card>
        <div className="overflow-x-auto">
          <table className="min-w-full divide-y divide-zinc-200 text-sm dark:divide-zinc-800">
            <thead>
              <tr className="text-left text-xs font-medium uppercase text-zinc-500">
                <th className="px-2 py-2">Employee</th>
                <th className="px-2 py-2">Leave type</th>
                <th className="px-2 py-2 text-right">Allocated</th>
                <th className="px-2 py-2 text-right">Used</th>
                <th className="px-2 py-2 text-right">This month</th>
                <th className="px-2 py-2 text-right">Carried</th>
                <th className="px-2 py-2 text-right">Available</th>
                {canEdit && <th className="px-2 py-2" />}
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-100 dark:divide-zinc-800">
              {rows.length === 0 && (
                <tr>
                  <td colSpan={8} className="px-2 py-6 text-center text-zinc-500">
                    No balances. Add leave types with a quota first.
                  </td>
                </tr>
              )}
              {rows.map((r) => (
                <tr key={r.id}>
                  <td className="px-2 py-2">
                    <div className="font-medium">{r.employee.fullName}</div>
                    <div className="text-xs text-zinc-500">{r.employee.employeeCode}</div>
                  </td>
                  <td className="px-2 py-2">
                    {r.leaveType.name} {r.isAdjusted && <Pill tone="amber">Adjusted</Pill>}
                  </td>
                  <td className="px-2 py-2 text-right tabular-nums">{r.allocated}</td>
                  <td className="px-2 py-2 text-right tabular-nums">{r.used}</td>
                  <td className="px-2 py-2 text-right tabular-nums">{r.remaining}</td>
                  <td className="px-2 py-2 text-right tabular-nums">{r.carryForward}</td>
                  <td className="px-2 py-2 text-right font-semibold tabular-nums">{r.available}</td>
                  {canEdit && (
                    <td className="px-2 py-2 text-right">
                      <button type="button" className="text-sm font-medium text-indigo-600 hover:text-indigo-500" onClick={() => setEditing(r)}>
                        Adjust
                      </button>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
      <Modal open={editing !== null} onClose={() => setEditing(null)} title={editing ? `Adjust — ${editing.employee.fullName}, ${editing.leaveType.name}` : ""}>
        {editing && (
          <AdjustForm
            key={editing.id}
            row={editing}
            onClose={() => setEditing(null)}
            onDone={() => {
              setEditing(null);
              load();
            }}
          />
        )}
      </Modal>
      <ConfirmModal
        open={confirmCredit}
        title={`Credit leave for ${month}?`}
        message="Creates this month's balance for every active employee and leave type that doesn't have one yet. Existing balances are not changed."
        confirmLabel="Run"
        onConfirm={credit}
        onCancel={() => setConfirmCredit(false)}
      />
    </div>
  );
}

function AdjustForm({ row, onClose, onDone }: { row: BalanceRow; onClose: () => void; onDone: () => void }) {
  const [allocated, setAllocated] = useState(String(row.allocated));
  const [remaining, setRemaining] = useState(String(row.remaining));
  const [carry, setCarry] = useState(String(row.carryForward));
  const [error, setError] = useState<string | null>(null);

  const save = async () => {
    try {
      await apiJson(`/api/v1/leave-balances/${row.id}`, { method: "PATCH", body: JSON.stringify({ allocated: Number(allocated), remaining: Number(remaining), carryForward: Number(carry) }) });
      onDone();
    } catch (e) {
      setError((e as Error).message);
    }
  };

  return (
    <div className="space-y-3">
      <ErrorText message={error} />
      <div className="grid grid-cols-3 gap-3">
        <FormField label="Allocated" htmlFor="adj-alloc">
          <input id="adj-alloc" type="number" min={0} step="0.25" className={textInputClass()} value={allocated} onChange={(e) => setAllocated(e.target.value)} />
        </FormField>
        <FormField label="This month" htmlFor="adj-rem">
          <input id="adj-rem" type="number" min={0} step="0.25" className={textInputClass()} value={remaining} onChange={(e) => setRemaining(e.target.value)} />
        </FormField>
        <FormField label="Carried" htmlFor="adj-carry">
          <input id="adj-carry" type="number" min={0} step="0.25" className={textInputClass()} value={carry} onChange={(e) => setCarry(e.target.value)} />
        </FormField>
      </div>
      <p className="text-xs text-zinc-500">Later months&apos; carried leave is updated automatically by the same difference.</p>
      <div className="flex justify-end gap-2">
        <Button variant="secondary" onClick={onClose}>
          Cancel
        </Button>
        <Button onClick={save}>Save</Button>
      </div>
    </div>
  );
}
