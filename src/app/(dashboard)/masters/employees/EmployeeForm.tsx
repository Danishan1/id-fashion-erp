"use client";

import { useEffect, useState, type FormEvent } from "react";
import { FormField, textInputClass } from "@/components/ui/FormField";

export interface EmployeeFormValues {
  employeeCode: string;
  fullName: string;
  departmentId: string;
  shiftId: string;
  designationId: string;
  employeeCategoryId: string;
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
  employeeCategoryId: "",
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
  departmentId: string | null;
}

interface EmployeeOption {
  id: string;
  fullName: string;
  employeeCode: string;
}

interface EmployeeCategoryOption {
  id: string;
  name: string;
}

interface EmployeeFormProps {
  initialValues?: EmployeeFormValues;
  submitUrl: string;
  method: "POST" | "PATCH";
  onSuccess: () => void;
  onCancel: () => void;
  /** Excluded from the "Reports To" options — an employee can't report to themselves. Undefined on create (nothing to exclude yet). */
  excludeEmployeeId?: string;
}

export function EmployeeForm({ initialValues, submitUrl, method, onSuccess, onCancel, excludeEmployeeId }: EmployeeFormProps) {
  const [values, setValues] = useState<EmployeeFormValues>(initialValues ?? EMPTY_VALUES);
  const [departments, setDepartments] = useState<Department[]>([]);
  const [shifts, setShifts] = useState<Shift[]>([]);
  const [designations, setDesignations] = useState<Designation[]>([]);
  const [employeeCategories, setEmployeeCategories] = useState<EmployeeCategoryOption[]>([]);
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
    fetch("/api/v1/employee-categories?pageSize=200")
      .then((res) => res.json())
      .then((body) => setEmployeeCategories(body.data ?? []))
      .catch(() => setEmployeeCategories([]));
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

  // Department-wise: a designation tied to a specific department only shows
  // once that department is selected; designations with no department
  // (departmentId null, e.g. "General Manager") are always available.
  const visibleDesignations = designations.filter((d) => !d.departmentId || d.departmentId === values.departmentId);

  const selectDepartment = (departmentId: string) => {
    const currentDesignation = designations.find((d) => d.id === values.designationId);
    // Clear a now-out-of-scope designation rather than silently keeping a
    // stale cross-department selection — same "don't let a selection
    // outlive the context it depended on" fix already applied to Sales
    // Order's own Style-scoped Sample picker.
    const designationStillValid = !currentDesignation?.departmentId || currentDesignation.departmentId === departmentId;
    setValues({ ...values, departmentId, designationId: designationStillValid ? values.designationId : "" });
  };

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

    onSuccess();
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
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
            onChange={(e) => selectDepartment(e.target.value)}
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
            {visibleDesignations.map((d) => (
              <option key={d.id} value={d.id}>
                {d.name}
              </option>
            ))}
          </select>
          {!values.departmentId && designations.some((d) => d.departmentId) && (
            <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">
              Only showing designations not tied to a specific department — pick a Department above to also see
              its own designations.
            </p>
          )}
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

      <div className="grid grid-cols-2 gap-4">
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
        <FormField label="Employee Category" htmlFor="employeeCategoryId">
          <select
            id="employeeCategoryId"
            value={values.employeeCategoryId}
            onChange={(e) => setValues({ ...values, employeeCategoryId: e.target.value })}
            className={textInputClass()}
          >
            <option value="">— None —</option>
            {employeeCategories.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </FormField>
      </div>

      <div className="grid grid-cols-2 gap-4">
        <FormField label="Phone" htmlFor="phone">
          <input
            id="phone"
            type="tel"
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

      <div className="flex justify-end gap-3 pt-2">
        <button
          type="button"
          onClick={onCancel}
          className="rounded-md border border-zinc-300 px-3 py-1.5 text-sm text-zinc-700 hover:bg-zinc-50 dark:border-zinc-700 dark:text-zinc-200 dark:hover:bg-zinc-800"
        >
          Cancel
        </button>
        <button
          type="submit"
          disabled={isSubmitting}
          className="rounded-md bg-indigo-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-indigo-500 disabled:opacity-60"
        >
          {isSubmitting ? "Saving…" : "Save"}
        </button>
      </div>
    </form>
  );
}
