"use client";

import { useState } from "react";
import Link from "next/link";
import { Modal } from "@/components/ui/Modal";
import { ConfirmModal } from "@/components/ui/ConfirmModal";
import { ToggleSwitch } from "@/components/ui/ToggleSwitch";
import { SubscriptionPanel, type PlanOption, type SubscriptionData } from "./SubscriptionPanel";

interface CompanyDetail {
  company: {
    id: string;
    name: string;
    legalName: string | null;
    taxRegistrationNo: string | null;
    baseCurrencyCode: string;
    fiscalYearStartMonth: number;
    isActive: boolean;
    suspendedAt: string | null;
    suspensionReason: string | null;
    suspendedBy: string | null;
    createdAt: string;
  };
  stats: {
    totalUsers: number;
    activeUsers: number;
    lastLoginAt: string | null;
    branches: number;
    customers: number;
    suppliers: number;
    styles: number;
    salesOrders: number;
    productionOrders: number;
    dispatches: number;
    attachments: number;
    storageBytes: number;
    supportRequests: number;
    liveSupportSessions: number;
  };
  modules: { key: string; label: string; description: string; isEnabled: boolean; inPlan: boolean; override: boolean | null }[];
}

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

function fmt(iso: string | null): string {
  return iso ? new Date(iso).toLocaleString("en-IN", { timeZone: "Asia/Kolkata" }) : "—";
}

function fmtBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 ** 2) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 ** 3) return `${(bytes / 1024 ** 2).toFixed(1)} MB`;
  return `${(bytes / 1024 ** 3).toFixed(2)} GB`;
}

export function PlatformCompanyDetailClient({
  initialDetail,
  initialSubscription,
  plans,
  canManageBilling,
  canManage,
  canRequestSupport,
}: {
  initialDetail: CompanyDetail;
  initialSubscription: SubscriptionData;
  plans: PlanOption[];
  canManageBilling: boolean;
  canManage: boolean;
  canRequestSupport: boolean;
}) {
  const [detail, setDetail] = useState(initialDetail);
  const [editOpen, setEditOpen] = useState(false);
  const [suspendOpen, setSuspendOpen] = useState(false);
  const [activateOpen, setActivateOpen] = useState(false);
  const [moduleToToggle, setModuleToToggle] = useState<CompanyDetail["modules"][number] | null>(null);
  const [form, setForm] = useState({
    name: detail.company.name,
    legalName: detail.company.legalName ?? "",
    taxRegistrationNo: detail.company.taxRegistrationNo ?? "",
    fiscalYearStartMonth: detail.company.fiscalYearStartMonth,
  });
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const { company, stats } = detail;

  async function reload() {
    const res = await fetch(`/api/v1/platform/companies/${company.id}`, { cache: "no-store" });
    if (res.ok) setDetail((await res.json()).data);
  }

  async function send(url: string, method: string, body?: object): Promise<boolean> {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(url, {
        method,
        headers: { "content-type": "application/json" },
        body: body ? JSON.stringify(body) : undefined,
      });
      if (!res.ok) {
        const json = await res.json().catch(() => null);
        setError(json?.error?.message ?? "Something went wrong.");
        return false;
      }
      await reload();
      return true;
    } finally {
      setBusy(false);
    }
  }

  async function saveDetails() {
    if (await send(`/api/v1/platform/companies/${company.id}`, "PATCH", form)) setEditOpen(false);
  }

  async function suspend() {
    if (await send(`/api/v1/platform/companies/${company.id}/suspend`, "POST", { reason })) {
      setSuspendOpen(false);
      setReason("");
    }
  }

  async function activate() {
    if (await send(`/api/v1/platform/companies/${company.id}/activate`, "POST")) setActivateOpen(false);
  }

  async function resetModule(packageKey: string) {
    await send(`/api/v1/platform/companies/${company.id}/modules?packageKey=${packageKey}`, "DELETE");
  }

  async function toggleModule() {
    if (!moduleToToggle) return;
    const ok = await send(`/api/v1/platform/companies/${company.id}/modules`, "PUT", {
      packageKey: moduleToToggle.key,
      isEnabled: !moduleToToggle.isEnabled,
    });
    if (ok) setModuleToToggle(null);
  }

  const statCards: [string, string | number][] = [
    ["Active users", `${stats.activeUsers} / ${stats.totalUsers}`],
    ["Last login", fmt(stats.lastLoginAt)],
    ["Branches", stats.branches],
    ["Customers", stats.customers],
    ["Suppliers", stats.suppliers],
    ["Styles", stats.styles],
    ["Sales orders", stats.salesOrders],
    ["Production orders", stats.productionOrders],
    ["Dispatches", stats.dispatches],
    ["Files stored", `${stats.attachments} (${fmtBytes(stats.storageBytes)})`],
    ["Support requests", stats.supportRequests],
    ["Live support sessions", stats.liveSupportSessions],
  ];

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-lg font-semibold text-zinc-900 dark:text-zinc-50">{company.name}</h1>
            <span
              className={`rounded-full px-2 py-0.5 text-xs font-medium ${
                company.isActive
                  ? "bg-green-100 text-green-700 dark:bg-green-500/10 dark:text-green-400"
                  : "bg-red-100 text-red-700 dark:bg-red-500/10 dark:text-red-400"
              }`}
            >
              {company.isActive ? "Active" : "Suspended"}
            </span>
          </div>
          <p className="mt-1 text-sm text-zinc-500">Customer since {fmt(company.createdAt)}</p>
        </div>
        <div className="flex flex-wrap gap-2">
          {canRequestSupport && company.isActive && (
            <Link
              href={`/platform/support?companyId=${company.id}`}
              className="rounded-md border border-zinc-300 px-3 py-1.5 text-sm text-zinc-700 hover:bg-zinc-100 dark:border-zinc-700 dark:text-zinc-200 dark:hover:bg-zinc-800"
            >
              Request support access
            </Link>
          )}
          {canManage && company.isActive && (
            <button
              type="button"
              onClick={() => {
                setError(null);
                setSuspendOpen(true);
              }}
              className="rounded-md bg-red-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-red-500"
            >
              Suspend company
            </button>
          )}
          {canManage && !company.isActive && (
            <button
              type="button"
              onClick={() => {
                setError(null);
                setActivateOpen(true);
              }}
              className="rounded-md bg-green-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-green-500"
            >
              Reactivate company
            </button>
          )}
        </div>
      </div>

      {!company.isActive && (
        <div className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-800 dark:border-red-900 dark:bg-red-950 dark:text-red-200">
          Suspended {fmt(company.suspendedAt)}
          {company.suspendedBy ? ` by ${company.suspendedBy}` : ""}. Its users can&apos;t sign in or use the ERP.
          {company.suspensionReason && (
            <div className="mt-1">
              <span className="font-medium">Reason:</span> {company.suspensionReason}
            </div>
          )}
        </div>
      )}

      <section className="rounded-lg border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold text-zinc-900 dark:text-zinc-50">Details</h2>
          {canManage && (
            <button
              type="button"
              onClick={() => {
                setError(null);
                setForm({
                  name: company.name,
                  legalName: company.legalName ?? "",
                  taxRegistrationNo: company.taxRegistrationNo ?? "",
                  fiscalYearStartMonth: company.fiscalYearStartMonth,
                });
                setEditOpen(true);
              }}
              className="text-sm text-indigo-600 hover:underline"
            >
              Edit
            </button>
          )}
        </div>
        <dl className="mt-3 grid grid-cols-1 gap-3 text-sm sm:grid-cols-2 lg:grid-cols-4">
          <div>
            <dt className="text-zinc-500">Legal name</dt>
            <dd className="text-zinc-900 dark:text-zinc-100">{company.legalName ?? "—"}</dd>
          </div>
          <div>
            <dt className="text-zinc-500">Tax registration no.</dt>
            <dd className="text-zinc-900 dark:text-zinc-100">{company.taxRegistrationNo ?? "—"}</dd>
          </div>
          <div>
            <dt className="text-zinc-500">Base currency</dt>
            <dd className="text-zinc-900 dark:text-zinc-100">{company.baseCurrencyCode}</dd>
          </div>
          <div>
            <dt className="text-zinc-500">Fiscal year starts</dt>
            <dd className="text-zinc-900 dark:text-zinc-100">{MONTHS[company.fiscalYearStartMonth - 1]}</dd>
          </div>
        </dl>
      </section>

      <section className="space-y-2">
        <h2 className="text-sm font-semibold text-zinc-900 dark:text-zinc-50">Usage</h2>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
          {statCards.map(([label, value]) => (
            <div key={label} className="rounded-lg border border-zinc-200 bg-white p-3 dark:border-zinc-800 dark:bg-zinc-900">
              <div className="text-xs text-zinc-500">{label}</div>
              <div className="mt-1 text-sm font-semibold text-zinc-900 dark:text-zinc-50">{value}</div>
            </div>
          ))}
        </div>
      </section>

      <SubscriptionPanel
        companyId={company.id}
        initialData={initialSubscription}
        plans={plans}
        canManageBilling={canManageBilling}
        onChanged={reload}
      />

      <section className="rounded-lg border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-900">
        <div className="border-b border-zinc-200 p-4 dark:border-zinc-800">
          <h2 className="text-sm font-semibold text-zinc-900 dark:text-zinc-50">Modules</h2>
          <p className="mt-1 text-sm text-zinc-500">
            A module that&apos;s off disappears from this company&apos;s menu and every page and API in it is refused,
            whatever roles its users hold. The company&apos;s plan decides which modules are on; a switch here overrides the
            plan for this company only. Dashboard, Masters, Sales Orders and Administration are always on. Turning a
            module off never deletes data — turning it back on restores everything.
          </p>
        </div>
        <ul>
          {detail.modules.map((m) => (
            <li
              key={m.key}
              className="flex items-center justify-between gap-4 border-b border-zinc-100 px-4 py-3 last:border-0 dark:border-zinc-800"
            >
              <div>
                <div className="text-sm font-medium text-zinc-900 dark:text-zinc-50">{m.label}</div>
                <div className="text-xs text-zinc-500">{m.description}</div>
                <div className="mt-1 flex items-center gap-2 text-xs">
                  {m.override === null ? (
                    <span className="text-zinc-500">{m.inPlan ? "Included in plan" : "Not in plan"}</span>
                  ) : (
                    <>
                      <span className="rounded-full bg-amber-100 px-2 py-0.5 font-medium text-amber-800 dark:bg-amber-500/10 dark:text-amber-300">
                        Override — plan says {m.inPlan ? "on" : "off"}
                      </span>
                      {canManage && (
                        <button
                          type="button"
                          disabled={busy}
                          onClick={() => resetModule(m.key)}
                          className="text-indigo-600 hover:underline disabled:opacity-60"
                        >
                          Use plan default
                        </button>
                      )}
                    </>
                  )}
                </div>
              </div>
              <ToggleSwitch
                checked={m.isEnabled}
                disabled={!canManage || busy}
                onToggle={() => {
                  setError(null);
                  setModuleToToggle(m);
                }}
                label={m.isEnabled ? `Turn off ${m.label}` : `Turn on ${m.label}`}
              />
            </li>
          ))}
        </ul>
      </section>

      <Modal open={editOpen} onClose={() => setEditOpen(false)} title="Edit company details">
        <div className="space-y-3 text-sm">
          {(
            [
              ["name", "Company name"],
              ["legalName", "Legal name"],
              ["taxRegistrationNo", "Tax registration no."],
            ] as const
          ).map(([key, label]) => (
            <label key={key} className="block">
              <span className="text-zinc-600 dark:text-zinc-300">{label}</span>
              <input
                value={form[key]}
                onChange={(e) => setForm({ ...form, [key]: e.target.value })}
                className="mt-1 w-full rounded-md border border-zinc-300 px-3 py-2 dark:border-zinc-700 dark:bg-zinc-900"
              />
            </label>
          ))}
          <label className="block">
            <span className="text-zinc-600 dark:text-zinc-300">Fiscal year starts</span>
            <select
              value={form.fiscalYearStartMonth}
              onChange={(e) => setForm({ ...form, fiscalYearStartMonth: Number(e.target.value) })}
              className="mt-1 w-full rounded-md border border-zinc-300 px-3 py-2 dark:border-zinc-700 dark:bg-zinc-900"
            >
              {MONTHS.map((month, i) => (
                <option key={month} value={i + 1}>
                  {month}
                </option>
              ))}
            </select>
          </label>
          {error && <p className="text-red-600">{error}</p>}
          <div className="flex justify-end gap-2">
            <button type="button" onClick={() => setEditOpen(false)} className="rounded-md border border-zinc-300 px-3 py-1.5">
              Cancel
            </button>
            <button
              type="button"
              disabled={busy || !form.name.trim()}
              onClick={saveDetails}
              className="rounded-md bg-indigo-600 px-3 py-1.5 text-white disabled:opacity-60"
            >
              Save
            </button>
          </div>
        </div>
      </Modal>

      <Modal open={suspendOpen} onClose={() => setSuspendOpen(false)} title={`Suspend ${company.name}`}>
        <div className="space-y-3 text-sm">
          <p className="text-zinc-600 dark:text-zinc-300">
            Every user of this company loses access on their next click and can&apos;t sign in until you reactivate it.
            Any live support session ends too. No data is deleted.
          </p>
          <textarea
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            rows={3}
            placeholder="Reason (kept with the company and in the audit log)"
            className="w-full rounded-md border border-zinc-300 px-3 py-2 dark:border-zinc-700 dark:bg-zinc-900"
          />
          {error && <p className="text-red-600">{error}</p>}
          <div className="flex justify-end gap-2">
            <button type="button" onClick={() => setSuspendOpen(false)} className="rounded-md border border-zinc-300 px-3 py-1.5">
              Cancel
            </button>
            <button
              type="button"
              disabled={busy || reason.trim().length < 5}
              onClick={suspend}
              className="rounded-md bg-red-600 px-3 py-1.5 text-white disabled:opacity-60"
            >
              Suspend
            </button>
          </div>
        </div>
      </Modal>

      <ConfirmModal
        open={activateOpen}
        title={`Reactivate ${company.name}?`}
        message={error ?? "Its users can sign in and use the ERP again straight away."}
        confirmLabel="Reactivate"
        isBusy={busy}
        onConfirm={activate}
        onCancel={() => setActivateOpen(false)}
      />

      <ConfirmModal
        open={!!moduleToToggle}
        title={moduleToToggle?.isEnabled ? `Turn off ${moduleToToggle?.label}?` : `Turn on ${moduleToToggle?.label}?`}
        message={
          error ??
          (moduleToToggle?.isEnabled
            ? "It disappears from this company's menu and its pages and APIs are refused for every user. Data is kept."
            : "It reappears for users whose roles allow it, with all existing data.")
        }
        confirmLabel={moduleToToggle?.isEnabled ? "Turn off" : "Turn on"}
        isDangerous={moduleToToggle?.isEnabled}
        isBusy={busy}
        onConfirm={toggleModule}
        onCancel={() => setModuleToToggle(null)}
      />
    </div>
  );
}
