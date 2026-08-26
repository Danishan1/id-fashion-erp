"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState, type FormEvent } from "react";
import { FormField, textInputClass } from "@/components/ui/FormField";

export interface EmployeeFormValues {
  employeeCode: string;
  fullName: string;
  departmentId: string;
  shiftId: string;
  designationId: string;
  reportsToId: string;
  phone: string;
  email: string;
  joinDate: string;
  isActive: boolean;
}

const EMPTY_VALUES: EmployeeFormValues = {
  employeeCode: "",
  fullName: "",
  departmentId: "",
  shiftId: "",
  designationId: "",
  reportsToId: "",
  phone: "",
  email: "",
  joinDate: "",
  isActive: true,
};

interface Department {
  id: string;
  name: string;
}

interface Shift {
  id: string;
  name: string;
  startTime: string;
}

interface Designation {
  id: string;
  name: string;
}

interface EmployeeOption {
  id: string;
  fullName: string;
  employeeCode: string;
}

interface EmployeeFormProps {
  initialValues?: EmployeeFormValues;
  submitUrl: string;
  method: "POST" | "PATCH";
  redirectTo: string;
  /** Excluded from the "Reports To" options — an employee can't report to themselves. Undefined on create (nothing to exclude yet). */
  excludeEmployeeId?: string;
}

export function EmployeeForm({ initialValues, submitUrl, method, redirectTo, excludeEmployeeId }: EmployeeFormProps) {
  const router = useRouter();
  const [values, setValues] = useState<EmployeeFormValues>(initialValues ?? EMPTY_VALUES);
  const [departments, setDepartments] = useState<Department[]>([]);
  const [shifts, setShifts] = useState<Shift[]>([]);
  const [designations, setDesignations] = useState<Designation[]>([]);
  const [managers, setManagers] = useState<EmployeeOption[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  useEffect(() => {
    fetch("/api/v1/departments?pageSize=200")
      .then((res) => res.json())
      .then((body) => setDepartments(body.data ?? []))
      .catch(() => setDepartments([]));
    fetch("/api/v1/shift-masters?pageSize=200")
      .then((res) => res.json())
      .then((body) => setShifts(body.data ?? []))
      .catch(() => setShifts([]));
    fetch("/api/v1/designations")
      .then((res) => res.json())
      .then((body) => setDesignations(body.data ?? []))
      .catch(() => setDesignations([]));
    fetch("/api/v1/employees?pageSize=500")
      .then((res) => res.json())
      .then((body) => setManagers(body.data ?? []))
      .catch(() => setManagers([]));
  }, []);

  useEffect(() => {
    if (initialValues) return;
    fetch("/api/v1/employees/next-code")
      .then((res) => res.json())
      .then((body) => {
        if (body?.data?.code) {
          setValues((prev) => (prev.employeeCode ? prev : { ...prev, employeeCode: body.data.code }));
        }
      })
      .catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (isSubmitting) return;
    setIsSubmitting(true);
    setError(null);

    const res = await fetch(submitUrl, {
      method,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(values),
    });

    setIsSubmitting(false);

    if (!res.ok) {
      const body = await res.json().catch(() => null);
      setError(body?.error?.message ?? "Failed to save employee.");
      return;
    }

    router.push(redirectTo);
    router.refresh();
  };

  return (
    <form onSubmit={handleSubmit} className="max-w-xl space-y-4">
      <div className="grid grid-cols-2 gap-4">
        <FormField label="Employee Code" htmlFor="employeeCode" required>
          <input
            id="employeeCode"
            required
            value={values.employeeCode}
            onChange={(e) => setValues({ ...values, employeeCode: e.target.value })}
            className={textInputClass()}
          />
        </FormField>
        <FormField label="Department" htmlFor="departmentId">
          <select
            id="departmentId"
            value={values.departmentId}
            onChange={(e) => setValues({ ...values, departmentId: e.target.value })}
            className={textInputClass()}
          >
            <option value="">— None —</option>
            {departments.map((d) => (
              <option key={d.id} value={d.id}>
                {d.name}
              </option>
            ))}
          </select>
        </FormField>
      </div>

      <FormField label="Full Name" htmlFor="fullName" required>
        <input
          id="fullName"
          required
          value={values.fullName}
          onChange={(e) => setValues({ ...values, fullName: e.target.value })}
          className={textInputClass()}
        />
      </FormField>

      <div className="grid grid-cols-2 gap-4">
        <FormField label="Designation" htmlFor="designationId">
          <select
            id="designationId"
            value={values.designationId}
            onChange={(e) => setValues({ ...values, designationId: e.target.value })}
            className={textInputClass()}
          >
            <option value="">— None —</option>
            {designations.map((d) => (
              <option key={d.id} value={d.id}>
                {d.name}
              </option>
            ))}
          </select>
        </FormField>
        <FormField label="Join Date" htmlFor="joinDate">
          <input
            id="joinDate"
            type="date"
            value={values.joinDate}
            onChange={(e) => setValues({ ...values, joinDate: e.target.value })}
            className={textInputClass()}
          />
        </FormField>
      </div>

      <FormField label="Reports To" htmlFor="reportsToId">
        <select
          id="reportsToId"
          value={values.reportsToId}
          onChange={(e) => setValues({ ...values, reportsToId: e.target.value })}
          className={textInputClass()}
        >
          <option value="">— None —</option>
          {managers
            .filter((m) => m.id !== excludeEmployeeId)
            .map((m) => (
              <option key={m.id} value={m.id}>
                {m.fullName} ({m.employeeCode})
              </option>
            ))}
        </select>
      </FormField>

      <FormField label="Shift" htmlFor="shiftId">
        <select id="shiftId" value={values.shiftId} onChange={(e) => setValues({ ...values, shiftId: e.target.value })} className={textInputClass()}>
          <option value="">— None —</option>
          {shifts.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name} ({s.startTime})
            </option>
          ))}
        </select>
      </FormField>

      <div className="grid grid-cols-2 gap-4">
        <FormField label="Phone" htmlFor="phone">
          <input
            id="phone"
            value={values.phone}
            onChange={(e) => setValues({ ...values, phone: e.target.value })}
            className={textInputClass()}
          />
        </FormField>
        <FormField label="Email" htmlFor="email">
          <input
            id="email"
            type="email"
            value={values.email}
            onChange={(e) => setValues({ ...values, email: e.target.value })}
            className={textInputClass()}
          />
        </FormField>
      </div>

      <label className="flex items-center gap-2 text-sm text-zinc-700 dark:text-zinc-300">
        <input
          type="checkbox"
          checked={values.isActive}
          onChange={(e) => setValues({ ...values, isActive: e.target.checked })}
        />
        Active
      </label>

      {error && <p className="text-sm text-red-600 dark:text-red-400">{error}</p>}

      <div className="flex gap-3">
        <button
          type="submit"
          disabled={isSubmitting}
          className="rounded-md bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-500 disabled:opacity-60"
        >
          {isSubmitting ? "Saving…" : "Save"}
        </button>
        <button
          type="button"
          onClick={() => router.push(redirectTo)}
          className="rounded-md border border-zinc-300 px-4 py-2 text-sm text-zinc-700 dark:border-zinc-700 dark:text-zinc-200"
        >
          Cancel
        </button>
      </div>
    </form>
  );
}
