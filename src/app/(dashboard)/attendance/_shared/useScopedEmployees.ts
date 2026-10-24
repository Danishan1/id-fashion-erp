"use client";

import { useEffect, useState } from "react";
import type { SearchableSelectOption } from "@/components/ui/SearchableSelect";

export interface ScopedEmployee {
  id: string;
  employeeCode: string;
  fullName: string;
}

/** Employees the user can see in HRMS, as SearchableSelect options. */
export function useScopedEmployees() {
  const [employees, setEmployees] = useState<ScopedEmployee[]>([]);
  useEffect(() => {
    fetch("/api/v1/attendance/employees")
      .then((r) => (r.ok ? r.json() : { data: [] }))
      .then((b) => setEmployees(b.data ?? []))
      .catch(() => setEmployees([]));
  }, []);
  const options: SearchableSelectOption[] = employees.map((e) => ({ id: e.id, label: e.fullName, sublabel: e.employeeCode }));
  return { employees, options };
}
