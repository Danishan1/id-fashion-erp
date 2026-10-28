"use client";

import { useEffect, useMemo, useState } from "react";
import { Breadcrumb } from "@/components/ui/Breadcrumb";
import { Button } from "@/components/ui/Button";
import { FormField, textInputClass } from "@/components/ui/FormField";
import { apiJson, Card, ErrorText, Pill } from "../../../attendance/_shared/attendance-ui";

interface Statutory {
  id: string;
  title: string;
  employerRate: string | number;
  employeeRate: string | number;
  maxLimit: string | number | null;
  isActive: boolean;
}

interface Component {
  kind: "ALLOWANCE" | "DEDUCTION";
  title: string;
  amount: number | string;
}

interface SetupResponse {
  employee: { id: string; employeeCode: string; fullName: string; department: string | null; designation: string | null };
  configured: boolean;
  setup: {
    baseMonthlySalary: number;
    pfSettingId: string | null;
    esicSettingId: string | null;
    panNumber: string | null;
    uanNumber: string | null;
    esicNumber: string | null;
    tdsAmount: number;
    surchargeAmount: number;
    educationCess: number;
    lateFeeInterest: number;
    overtimeRatePerHour: number | null;
    bankName: string | null;
    bankAccountNumber: string | null;
    bankIfsc: string | null;
    bankBranch: string | null;
    components: Component[];
  };
}

type Form = Record<
  | "baseMonthlySalary"
  | "pfSettingId"
  | "esicSettingId"
  | "panNumber"
  | "uanNumber"
  | "esicNumber"
  | "tdsAmount"
  | "surchargeAmount"
  | "educationCess"
  | "lateFeeInterest"
  | "overtimeRatePerHour"
  | "bankName"
  | "bankAccountNumber"
  | "bankIfsc"
  | "bankBranch",
  string
>;

const SUGGESTED_ALLOWANCES = ["HRA", "Conveyance", "Medical", "Special Allowance"];
const SUGGESTED_DEDUCTIONS = ["LIC", "RDS", "Professional Tax"];

const n = (v: string | number | null | undefined) => {
  const x = Number(v);
  return Number.isFinite(x) ? x : 0;
};
const money = (v: number) => {
  const r = Math.round(v * 100) / 100;
  const text = `₹${Math.abs(r).toLocaleString("en-IN", { maximumFractionDigits: 2 })}`;
  return r < 0 ? `− ${text}` : text;
};
const str = (v: string | number | null | undefined) => (v === null || v === undefined ? "" : String(v));

export function EmployeeSalarySetupForm({ employeeId, canEdit }: { employeeId: string; canEdit: boolean }) {
  const [data, setData] = useState<SetupResponse | null>(null);
  const [form, setForm] = useState<Form | null>(null);
  const [components, setComponents] = useState<Component[]>([]);
  const [pf, setPf] = useState<Statutory[]>([]);
  const [esic, setEsic] = useState<Statutory[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [savedAt, setSavedAt] = useState<string | null>(null);

  useEffect(() => {
    Promise.all([
      apiJson<SetupResponse>(`/api/v1/salary/employee-setups/${employeeId}`),
      apiJson<Statutory[]>("/api/v1/salary/pf-settings"),
      apiJson<Statutory[]>("/api/v1/salary/esic-settings"),
    ])
      .then(([d, p, e]) => {
        const s = d.setup;
        setData(d);
        setPf(p);
        setEsic(e);
        setComponents(s.components);
        setForm({
          baseMonthlySalary: str(s.baseMonthlySalary),
          pfSettingId: s.pfSettingId ?? "",
          esicSettingId: s.esicSettingId ?? "",
          panNumber: s.panNumber ?? "",
          uanNumber: s.uanNumber ?? "",
          esicNumber: s.esicNumber ?? "",
          tdsAmount: str(s.tdsAmount),
          surchargeAmount: str(s.surchargeAmount),
          educationCess: str(s.educationCess),
          lateFeeInterest: str(s.lateFeeInterest),
          overtimeRatePerHour: str(s.overtimeRatePerHour),
          bankName: s.bankName ?? "",
          bankAccountNumber: s.bankAccountNumber ?? "",
          bankIfsc: s.bankIfsc ?? "",
          bankBranch: s.bankBranch ?? "",
        });
      })
      .catch((e: Error) => setError(e.message));
  }, [employeeId]);

  // Indicative full-month figures (no attendance yet): same rules the salary run uses.
  const preview = useMemo(() => {
    if (!form) return null;
    const base = n(form.baseMonthlySalary);
    const allowances = components.filter((c) => c.kind === "ALLOWANCE").reduce((s, c) => s + n(c.amount), 0);
    const deductions = components.filter((c) => c.kind === "DEDUCTION").reduce((s, c) => s + n(c.amount), 0);
    const pfRow = pf.find((p) => p.id === form.pfSettingId);
    const esicRow = esic.find((p) => p.id === form.esicSettingId);
    const cap = (wage: number, row?: Statutory) => (row && row.maxLimit !== null && row.maxLimit !== "" ? Math.min(wage, n(row.maxLimit)) : wage);
    const pfAmt = pfRow ? (n(pfRow.employeeRate) / 100) * cap(base, pfRow) : 0;
    const esicAmt = esicRow ? (n(esicRow.employeeRate) / 100) * cap(base + allowances, esicRow) : 0;
    const taxes = n(form.tdsAmount) + n(form.surchargeAmount) + n(form.educationCess) + n(form.lateFeeInterest);
    const gross = base + allowances;
    return { gross, pfAmt, esicAmt, deductions, taxes, net: Math.max(0, gross - pfAmt - esicAmt - deductions - taxes) };
  }, [form, components, pf, esic]);

  if (error && !data) return <ErrorText message={error} />;
  if (!data || !form || !preview) return <p className="text-sm text-zinc-500">Loading…</p>;

  const set = (key: keyof Form) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => setForm({ ...form, [key]: e.target.value });
  const input = (key: keyof Form, label: string, props: React.InputHTMLAttributes<HTMLInputElement> = {}, required = false) => (
    <FormField label={label} htmlFor={key} required={required}>
      <input id={key} className={textInputClass()} value={form[key]} onChange={set(key)} disabled={!canEdit} {...props} />
    </FormField>
  );
  const statutorySelect = (key: "pfSettingId" | "esicSettingId", label: string, rows: Statutory[]) => (
    <FormField label={label} htmlFor={key}>
      <select id={key} className={textInputClass()} value={form[key]} onChange={set(key)} disabled={!canEdit}>
        <option value="">Not applicable</option>
        {rows
          .filter((r) => r.isActive || r.id === form[key])
          .map((r) => (
            <option key={r.id} value={r.id}>
              {r.title} — employee {n(r.employeeRate)}% / employer {n(r.employerRate)}%{r.isActive ? "" : " (inactive)"}
            </option>
          ))}
      </select>
    </FormField>
  );

  const updateComponent = (i: number, patch: Partial<Component>) => setComponents(components.map((c, j) => (j === i ? { ...c, ...patch } : c)));
  const addComponent = (kind: Component["kind"]) => setComponents([...components, { kind, title: "", amount: "" }]);

  async function save() {
    if (!form) return;
    setSaving(true);
    setError(null);
    try {
      const payload = { ...form, components: components.map((c) => ({ kind: c.kind, title: c.title, amount: c.amount === "" ? 0 : c.amount })) };
      const d = await apiJson<SetupResponse>(`/api/v1/salary/employee-setups/${employeeId}`, { method: "PUT", body: JSON.stringify(payload) });
      setData(d);
      setComponents(d.setup.components);
      setSavedAt(new Date().toLocaleTimeString("en-IN"));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSaving(false);
    }
  }

  const componentRows = (kind: Component["kind"]) => (
    <div className="space-y-2">
      {components.map((c, i) =>
        c.kind !== kind ? null : (
          <div key={i} className="flex gap-2">
            <input
              className={textInputClass()}
              placeholder="Title"
              list={`suggest-${kind}`}
              value={c.title}
              onChange={(e) => updateComponent(i, { title: e.target.value })}
              disabled={!canEdit}
            />
            <input
              className={`${textInputClass()} w-40`}
              type="number"
              min={0}
              step="0.01"
              placeholder="Amount"
              value={c.amount}
              onChange={(e) => updateComponent(i, { amount: e.target.value })}
              disabled={!canEdit}
            />
            {canEdit && (
              <Button variant="secondary" size="xs" onClick={() => setComponents(components.filter((_, j) => j !== i))}>
                Remove
              </Button>
            )}
          </div>
        )
      )}
      <datalist id={`suggest-${kind}`}>
        {(kind === "ALLOWANCE" ? SUGGESTED_ALLOWANCES : SUGGESTED_DEDUCTIONS).map((t) => (
          <option key={t} value={t} />
        ))}
      </datalist>
      {canEdit && (
        <Button variant="secondary" size="xs" onClick={() => addComponent(kind)}>
          + Add {kind === "ALLOWANCE" ? "allowance" : "deduction"}
        </Button>
      )}
    </div>
  );

  const e = data.employee;
  return (
    <div className="space-y-6">
      <Breadcrumb items={[{ label: "Dashboard", href: "/dashboard" }, { label: "Salary Setup", href: "/salary/setup" }, { label: e.fullName }]} />
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-lg font-semibold text-zinc-900 dark:text-zinc-50">
            {e.fullName} <span className="text-sm font-normal text-zinc-500">{e.employeeCode}</span>
          </h1>
          <p className="text-sm text-zinc-500">{[e.designation, e.department].filter(Boolean).join(" · ") || "—"}</p>
        </div>
        {data.configured ? <Pill tone="green">Set up</Pill> : <Pill tone="amber">Not set up — values below are prefilled from the employee master</Pill>}
      </div>

      <ErrorText message={error} />

      <div className="grid gap-6 lg:grid-cols-3">
        <div className="space-y-6 lg:col-span-2">
          <Card title="Salary">
            <div className="grid gap-4 sm:grid-cols-2">
              {input("baseMonthlySalary", "Base monthly salary (₹)", { type: "number", min: 0, step: "0.01" }, true)}
              {input("overtimeRatePerHour", "Overtime rate per hour (₹)", { type: "number", min: 0, step: "0.01" })}
              {statutorySelect("pfSettingId", "PF", pf)}
              {statutorySelect("esicSettingId", "ESIC", esic)}
            </div>
          </Card>
          <Card title="Allowances (fixed per month)">{componentRows("ALLOWANCE")}</Card>
          <Card title="Deductions (fixed per month)">{componentRows("DEDUCTION")}</Card>
          <Card title="Tax (flat per month)">
            <div className="grid gap-4 sm:grid-cols-2">
              {input("tdsAmount", "TDS (₹)", { type: "number", min: 0, step: "0.01" })}
              {input("surchargeAmount", "Surcharge (₹)", { type: "number", min: 0, step: "0.01" })}
              {input("educationCess", "Education cess (₹)", { type: "number", min: 0, step: "0.01" })}
              {input("lateFeeInterest", "Interest on late fees (₹)", { type: "number", min: 0, step: "0.01" })}
            </div>
          </Card>
          <Card title="Statutory IDs and bank">
            <div className="grid gap-4 sm:grid-cols-2">
              {input("panNumber", "PAN", { placeholder: "ABCDE1234F", maxLength: 10 })}
              {input("uanNumber", "PF UAN")}
              {input("esicNumber", "ESIC number")}
              {input("bankName", "Bank name")}
              {input("bankAccountNumber", "Account number", { inputMode: "numeric" })}
              {input("bankIfsc", "IFSC", { placeholder: "SBIN0001234", maxLength: 11 })}
              {input("bankBranch", "Branch / city")}
            </div>
          </Card>
        </div>

        <div className="space-y-4">
          <Card title="Full-month estimate">
            <dl className="space-y-2 text-sm">
              {(
                [
                  ["Gross (base + allowances)", preview.gross],
                  ["PF (employee)", -preview.pfAmt],
                  ["ESIC (employee)", -preview.esicAmt],
                  ["Other deductions", -preview.deductions],
                  ["TDS and other tax", -preview.taxes],
                ] as const
              ).map(([label, v]) => (
                <div key={label} className="flex justify-between">
                  <dt className="text-zinc-500">{label}</dt>
                  <dd>{money(v)}</dd>
                </div>
              ))}
              <div className="flex justify-between border-t border-zinc-200 pt-2 font-semibold dark:border-zinc-800">
                <dt>Net (full attendance)</dt>
                <dd>{money(preview.net)}</dd>
              </div>
            </dl>
            <p className="mt-3 text-xs text-zinc-500">The actual salary depends on the month&apos;s attendance, overtime, advance installments and arrears.</p>
          </Card>
          {canEdit && (
            <div className="flex items-center gap-3">
              <Button onClick={save} isLoading={saving}>
                Save setup
              </Button>
              {savedAt && <span className="text-xs text-emerald-600">Saved at {savedAt}</span>}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
