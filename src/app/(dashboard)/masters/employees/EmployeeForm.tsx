"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState, type FormEvent } from "react";
import { FormField, textInputClass } from "@/components/ui/FormField";

export interface EmployeeFormValues {
  employeeCode: string;
  fullName: string;
  departmentId: string;
  designation: string;
  phone: string;
  email: string;
  joinDate: string;
  isActive: boolean;
}

const EMPTY_VALUES: EmployeeFormValues = {
  employeeCode: "",
  fullName: "",
  departmentId: "",
  designation: "",
  phone: "",
  email: "",
  joinDate: "",
  isActive: true,
};

interface Department {
  id: string;
  name: string;
}

interface EmployeeFormProps {
  initialValues?: EmployeeFormValues;
  submitUrl: string;
  method: "POST" | "PATCH";
  redirectTo: string;
}

export function EmployeeForm({ initialValues, submitUrl, method, redirectTo }: EmployeeFormProps) {
  const router = useRouter();
  const [values, setValues] = useState<EmployeeFormValues>(initialValues ?? EMPTY_VALUES);
  const [departments, setDepartments] = useState<Department[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  useEffect(() => {
    fetch("/api/v1/departments?pageSize=200")
      .then((res) => res.json())
      .then((body) => setDepartments(body.data ?? []))
      .catch(() => setDepartments([]));
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
        <FormField label="Designation" htmlFor="designation">
          <input
            id="designation"
            value={values.designation}
            onChange={(e) => setValues({ ...values, designation: e.target.value })}
            className={textInputClass()}
          />
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
