"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { Breadcrumb } from "@/components/ui/Breadcrumb";
import { Button } from "@/components/ui/Button";
import { ConfirmModal } from "@/components/ui/ConfirmModal";
import { FormField, textInputClass } from "@/components/ui/FormField";
import { Modal } from "@/components/ui/Modal";
import { apiJson, Card, ErrorText, fmtDateTime, Pill } from "../../attendance/_shared/attendance-ui";

interface Advance {
  id: string;
  employee: { id: string; employeeCode: string; fullName: string };
  amount: number;
  installments: number;
  installmentAmount: number;
  reason: string;
  createdAt: string;
  paymentRequest: { id: string; requestNumber: string; status: string; rejectionReason: string | null };
  status: "PENDING_APPROVAL" | "APPROVED" | "REJECTED" | "CANCELLED" | "RECOVERING" | "RECOVERED";
  recovered: number;
  remaining: number;
  recoveries: { amount: number; year: number; month: number }[];
}

interface ListResponse {
  canSeeAll: boolean;
  hasEmployee: boolean;
  advances: Advance[];
}

const STATUS: Record<Advance["status"], { label: string; tone: "amber" | "blue" | "red" | "zinc" | "purple" | "green" }> = {
  PENDING_APPROVAL: { label: "Waiting for approval", tone: "amber" },
  APPROVED: { label: "Approved — to be paid", tone: "blue" },
  REJECTED: { label: "Rejected", tone: "red" },
  CANCELLED: { label: "Cancelled", tone: "zinc" },
  RECOVERING: { label: "Paid — recovering", tone: "purple" },
  RECOVERED: { label: "Recovered", tone: "green" },
};

const money = (v: number) => `₹${v.toLocaleString("en-IN", { maximumFractionDigits: 2 })}`;
const monthName = (y: number, m: number) => new Date(Date.UTC(y, m - 1, 1)).toLocaleDateString("en-IN", { month: "short", year: "numeric", timeZone: "UTC" });
const newKey = () => (typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : `${Date.now()}-${Math.random()}`);

/** Salary Management → Advance Salary (slice 5). */
export function SalaryAdvancesClient({ canRequest }: { canRequest: boolean }) {
  const [data, setData] = useState<ListResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ amount: "", installments: "1", reason: "", requestKey: newKey() });
  const [formError, setFormError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [cancelTarget, setCancelTarget] = useState<Advance | null>(null);
  const [search, setSearch] = useState("");

  const load = useCallback(() => {
    apiJson<ListResponse>("/api/v1/salary/advances")
      .then((d) => {
        setData(d);
        setError(null);
      })
      .catch((e: Error) => setError(e.message));
  }, []);
  useEffect(load, [load]);

  async function submit() {
    setBusy(true);
    setFormError(null);
    try {
      await apiJson("/api/v1/salary/advances", { method: "POST", body: JSON.stringify(form) });
      setOpen(false);
      setForm({ amount: "", installments: "1", reason: "", requestKey: newKey() });
      load();
    } catch (e) {
      setFormError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function cancel(a: Advance) {
    try {
      await apiJson(`/api/v1/salary/advances/${a.id}/cancel`, { method: "POST", body: "{}" });
      load();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setCancelTarget(null);
    }
  }

  const perInstallment = Number(form.amount) > 0 && Number(form.installments) > 0 ? Math.ceil((Number(form.amount) / Number(form.installments)) * 100) / 100 : null;
  const term = search.trim().toLowerCase();
  const rows = (data?.advances ?? []).filter((a) => !term || a.employee.fullName.toLowerCase().includes(term) || a.employee.employeeCode.toLowerCase().includes(term) || a.paymentRequest.requestNumber.toLowerCase().includes(term));

  return (
    <div className="space-y-6">
      <Breadcrumb items={[{ label: "Dashboard", href: "/dashboard" }, { label: "Advance Salary" }]} />
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-lg font-semibold text-zinc-900 dark:text-zinc-50">Advance Salary</h1>
          <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">
            Ask for an advance against your salary. It goes to Accounts for approval and payment, then is recovered from your salary in installments.
          </p>
        </div>
        <div className="flex gap-2">
          {data?.canSeeAll && <input className={`${textInputClass()} w-56`} placeholder="Search name, code or request" value={search} onChange={(e) => setSearch(e.target.value)} />}
          {canRequest && data?.hasEmployee && <Button onClick={() => setOpen(true)}>Request advance</Button>}
        </div>
      </div>

      <ErrorText message={error} />
      {data && !data.hasEmployee && !data.canSeeAll && <p className="text-sm text-amber-700">Your login is not linked to an employee, so there is nothing to show here.</p>}

      <Card title={data?.canSeeAll ? "All advances" : "My advances"}>
        {!data && !error && <p className="text-sm text-zinc-500">Loading…</p>}
        {data && rows.length === 0 && <p className="text-sm text-zinc-500">No advance salary requests yet.</p>}
        {data && rows.length > 0 && (
          <div className="overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead>
                <tr className="border-b border-zinc-200 text-left text-xs uppercase text-zinc-500 dark:border-zinc-800">
                  {data.canSeeAll && <th className="px-2 py-2">Employee</th>}
                  <th className="px-2 py-2">Request</th>
                  <th className="px-2 py-2 text-right">Amount</th>
                  <th className="px-2 py-2 text-right">Installment</th>
                  <th className="px-2 py-2 text-right">Recovered</th>
                  <th className="px-2 py-2 text-right">Left</th>
                  <th className="px-2 py-2">Status</th>
                  <th className="px-2 py-2">Reason</th>
                  <th className="px-2 py-2" />
                </tr>
              </thead>
              <tbody>
                {rows.map((a) => (
                  <tr key={a.id} className="border-b border-zinc-100 align-top dark:border-zinc-800">
                    {data.canSeeAll && (
                      <td className="px-2 py-2">
                        {a.employee.fullName} <span className="text-xs text-zinc-500">{a.employee.employeeCode}</span>
                      </td>
                    )}
                    <td className="px-2 py-2">
                      <Link href={`/accounts/payment-requests/${a.paymentRequest.id}`} className="font-medium text-indigo-600 hover:text-indigo-500">
                        {a.paymentRequest.requestNumber}
                      </Link>
                      <div className="text-xs text-zinc-500">{fmtDateTime(a.createdAt)}</div>
                    </td>
                    <td className="px-2 py-2 text-right tabular-nums">{money(a.amount)}</td>
                    <td className="px-2 py-2 text-right tabular-nums">
                      {money(a.installmentAmount)} <span className="text-xs text-zinc-500">× {a.installments}</span>
                    </td>
                    <td className="px-2 py-2 text-right tabular-nums" title={a.recoveries.map((r) => `${monthName(r.year, r.month)}: ${money(r.amount)}`).join("\n") || undefined}>
                      {money(a.recovered)}
                    </td>
                    <td className="px-2 py-2 text-right tabular-nums">{a.status === "RECOVERING" || a.status === "RECOVERED" ? money(a.remaining) : "—"}</td>
                    <td className="px-2 py-2">
                      <Pill tone={STATUS[a.status].tone}>{STATUS[a.status].label}</Pill>
                      {a.paymentRequest.rejectionReason && <div className="mt-1 text-xs text-red-600">{a.paymentRequest.rejectionReason}</div>}
                    </td>
                    <td className="max-w-56 px-2 py-2 text-xs text-zinc-600 dark:text-zinc-400">{a.reason}</td>
                    <td className="px-2 py-2 text-right">
                      {a.status === "PENDING_APPROVAL" && canRequest && !data.canSeeAll && (
                        <button type="button" className="text-red-600 hover:text-red-500" onClick={() => setCancelTarget(a)}>
                          Cancel
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <Modal open={open} onClose={() => setOpen(false)} title="Request advance salary">
        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <FormField label="Amount (₹)" htmlFor="adv-amount" required>
              <input id="adv-amount" type="number" min={1} step="0.01" className={textInputClass()} value={form.amount} onChange={(e) => setForm({ ...form, amount: e.target.value })} />
            </FormField>
            <FormField label="Recover in (months)" htmlFor="adv-inst" required>
              <input id="adv-inst" type="number" min={1} max={24} step={1} className={textInputClass()} value={form.installments} onChange={(e) => setForm({ ...form, installments: e.target.value })} />
            </FormField>
          </div>
          {perInstallment !== null && <p className="text-xs text-zinc-500">About {money(perInstallment)} will be deducted from each salary after it is paid.</p>}
          <FormField label="Reason" htmlFor="adv-reason" required>
            <textarea id="adv-reason" rows={3} className={textInputClass()} value={form.reason} onChange={(e) => setForm({ ...form, reason: e.target.value })} />
          </FormField>
          <ErrorText message={formError} />
          <div className="flex justify-end gap-2">
            <Button variant="secondary" onClick={() => setOpen(false)}>
              Close
            </Button>
            <Button onClick={submit} isLoading={busy} disabled={!(Number(form.amount) > 0) || form.reason.trim().length < 3}>
              Send request
            </Button>
          </div>
        </div>
      </Modal>

      <ConfirmModal
        open={Boolean(cancelTarget)}
        title="Cancel this advance request?"
        message={cancelTarget ? `${cancelTarget.paymentRequest.requestNumber} for ${money(cancelTarget.amount)} will be cancelled.` : ""}
        confirmLabel="Cancel request"
        isDangerous
        onConfirm={() => cancelTarget && cancel(cancelTarget)}
        onCancel={() => setCancelTarget(null)}
      />
    </div>
  );
}
