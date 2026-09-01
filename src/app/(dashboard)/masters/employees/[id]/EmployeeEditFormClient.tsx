"use client";

import { useRouter } from "next/navigation";
import { EmployeeForm, type EmployeeFormValues } from "../EmployeeForm";

interface EmployeeEditFormClientProps {
  id: string;
  initialValues: EmployeeFormValues;
}

/** Thin router-navigation wrapper — EmployeeForm itself is navigation-agnostic (onSuccess/onCancel callbacks) so it can be reused identically inside the Employees list's "Add Employee" modal. */
export function EmployeeEditFormClient({ id, initialValues }: EmployeeEditFormClientProps) {
  const router = useRouter();

  const goToList = () => {
    router.push("/masters/employees");
    router.refresh();
  };

  return (
    <EmployeeForm
      initialValues={initialValues}
      submitUrl={`/api/v1/employees/${id}`}
      method="PATCH"
      excludeEmployeeId={id}
      onSuccess={goToList}
      onCancel={goToList}
    />
  );
}
