"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { Breadcrumb } from "@/components/ui/Breadcrumb";
import { textInputClass } from "@/components/ui/FormField";
import { SimpleLookupManager } from "@/components/ui/SimpleLookupManager";
import { apiJson, Card, ErrorText, Pill, Tabs } from "../../attendance/_shared/attendance-ui";

interface SetupRow {
  employeeId: string;
  employeeCode: string;
  fullName: string;
  department: string | null;
  designation: string | null;
  configured: boolean;
  base: number | null;
  gross: number | null;
  fixedDeductions: number | null;
  pf: string | null;
  esic: string | null;
}

type Tab = "employees" | "pf" | "esic";

const money = (v: number | null) => (v === null ? "—" : `₹${v.toLocaleString("en-IN", { maximumFractionDigits: 2 })}`);

const STATUTORY_FIELDS = [
  { key: "title", label: "Title", required: true },
  { key: "employerRate", label: "Employer %", type: "number" as const, required: true },
  { key: "employeeRate", label: "Employee %", type: "number" as const, required: true },
  { key: "maxLimit", label: "Wage ceiling (₹, optional)", type: "number" as const },
];

/**
 * Salary Management → Salary Setup (slice 1, 2026-10-28): each employee's
 * base salary, allowances, deductions, PF/ESIC, TDS and bank details, plus the
 * PF and ESIC rate masters.
 */
export function SalarySetupClient({ canEdit }: { canEdit: boolean }) {
  const [tab, setTab] = useState<Tab>("employees");

  return (
    <div className="space-y-6">
      <Breadcrumb items={[{ label: "Dashboard", href: "/dashboard" }, { label: "Salary Setup" }]} />
      <div>
        <h1 className="text-lg font-semibold text-zinc-900 dark:text-zinc-50">Salary Setup</h1>
        <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">
          Set each employee&apos;s monthly salary structure. The salary run uses these figures with the month&apos;s attendance.
          {!canEdit && " You have view-only access."}
        </p>
      </div>
      <Tabs
        tabs={[
          { id: "employees", label: "Employees" },
          { id: "pf", label: "PF Settings" },
          { id: "esic", label: "ESIC Settings" },
        ]}
        value={tab}
        onChange={setTab}
      />
      {tab === "employees" && <EmployeesTab />}
      {tab === "pf" && (
        <Card>
          <p className="mb-3 text-sm text-zinc-500 dark:text-zinc-400">Employee PF % is applied on base salary, up to the wage ceiling if one is set.</p>
          <SimpleLookupManager fetchUrl="/api/v1/salary/pf-settings" entityLabel="PF Setting" fields={STATUTORY_FIELDS} />
        </Card>
      )}
      {tab === "esic" && (
        <Card>
          <p className="mb-3 text-sm text-zinc-500 dark:text-zinc-400">Employee ESIC % is applied on base salary plus allowances, up to the wage ceiling if one is set.</p>
          <SimpleLookupManager fetchUrl="/api/v1/salary/esic-settings" entityLabel="ESIC Setting" fields={STATUTORY_FIELDS} />
        </Card>
      )}
    </div>
  );
}

function EmployeesTab() {
  const [rows, setRows] = useState<SetupRow[] | null>(null);
  const [search, setSearch] = useState("");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    apiJson<SetupRow[]>("/api/v1/salary/employee-setups")
      .then(setRows)
      .catch((e: Error) => setError(e.message));
  }, []);

  const term = search.trim().toLowerCase();
  const visible = (rows ?? []).filter(
    (r) => !term || r.fullName.toLowerCase().includes(term) || r.employeeCode.toLowerCase().includes(term) || (r.department ?? "").toLowerCase().includes(term)
  );
  const pending = (rows ?? []).filter((r) => !r.configured).length;

  return (
    <Card
      title={rows ? `${rows.length} employees${pending ? ` · ${pending} not set up` : ""}` : "Employees"}
      actions={<input className={`${textInputClass()} w-64`} placeholder="Search name, code or department" value={search} onChange={(e) => setSearch(e.target.value)} />}
    >
      <ErrorText message={error} />
      {!rows && !error && <p className="text-sm text-zinc-500">Loading…</p>}
      {rows && (
        <div className="overflow-x-auto">
          <table className="min-w-full text-sm">
            <thead>
              <tr className="border-b border-zinc-200 text-left text-xs uppercase text-zinc-500 dark:border-zinc-800">
                <th className="px-3 py-2">Employee</th>
                <th className="px-3 py-2">Department</th>
                <th className="px-3 py-2 text-right">Base</th>
                <th className="px-3 py-2 text-right">Gross</th>
                <th className="px-3 py-2 text-right">Fixed deductions</th>
                <th className="px-3 py-2">PF / ESIC</th>
                <th className="px-3 py-2">Status</th>
                <th className="px-3 py-2" />
              </tr>
            </thead>
            <tbody>
              {visible.map((r) => (
                <tr key={r.employeeId} className="border-b border-zinc-100 dark:border-zinc-800">
                  <td className="px-3 py-2">
                    <div className="font-medium text-zinc-900 dark:text-zinc-100">{r.fullName}</div>
                    <div className="text-xs text-zinc-500">
                      {r.employeeCode}
                      {r.designation ? ` · ${r.designation}` : ""}
                    </div>
                  </td>
                  <td className="px-3 py-2">{r.department ?? "—"}</td>
                  <td className="px-3 py-2 text-right">{money(r.base)}</td>
                  <td className="px-3 py-2 text-right">{money(r.gross)}</td>
                  <td className="px-3 py-2 text-right">{money(r.fixedDeductions)}</td>
                  <td className="px-3 py-2 text-xs">{[r.pf, r.esic].filter(Boolean).join(" / ") || "—"}</td>
                  <td className="px-3 py-2">{r.configured ? <Pill tone="green">Set up</Pill> : <Pill tone="amber">Not set up</Pill>}</td>
                  <td className="px-3 py-2 text-right">
                    <Link href={`/salary/setup/${r.employeeId}`} className="font-medium text-indigo-600 hover:text-indigo-500">
                      {r.configured ? "Edit" : "Set up"}
                    </Link>
                  </td>
                </tr>
              ))}
              {visible.length === 0 && (
                <tr>
                  <td colSpan={8} className="px-3 py-6 text-center text-zinc-500">
                    {rows.length === 0 ? "No active employees." : "No employees match your search."}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  );
}
