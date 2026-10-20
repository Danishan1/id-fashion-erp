"use client";

import { useEffect, useState } from "react";
import { FormField, textInputClass } from "@/components/ui/FormField";

export interface EmployeeLoginValues {
  roleId: string;
  branchId: string;
}

interface Option {
  id: string;
  name: string;
}

/**
 * P2: Role + Branch for a new ERP login created from the Employee Master.
 * Defaults to the PRODUCTION_WORKER role and the first branch. The password is
 * always the temporary one and must be changed at first sign-in -- it is never
 * shown or typed here.
 */
export function EmployeeLoginFields({
  value,
  onChange,
}: {
  value: EmployeeLoginValues;
  onChange: (value: EmployeeLoginValues) => void;
}) {
  const [roles, setRoles] = useState<Option[]>([]);
  const [branches, setBranches] = useState<Option[]>([]);

  useEffect(() => {
    let cancelled = false;
    Promise.all([
      fetch("/api/v1/roles").then((r) => (r.ok ? r.json() : { data: [] })),
      fetch("/api/v1/branches").then((r) => (r.ok ? r.json() : { data: [] })),
    ])
      .then(([roleBody, branchBody]) => {
        if (cancelled) return;
        const roleList: Option[] = roleBody.data ?? [];
        const branchList: Option[] = branchBody.data ?? [];
        setRoles(roleList);
        setBranches(branchList);
        onChange({
          roleId: value.roleId || roleList.find((r) => r.name === "PRODUCTION_WORKER")?.id || "",
          branchId: value.branchId || branchList[0]?.id || "",
        });
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
    // Load once; defaults only fill empty fields.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="grid grid-cols-2 gap-4">
      <FormField label="Login Role" htmlFor="loginRoleId" required>
        <select
          id="loginRoleId"
          required
          value={value.roleId}
          onChange={(e) => onChange({ ...value, roleId: e.target.value })}
          className={textInputClass()}
        >
          <option value="">— Select —</option>
          {roles.map((r) => (
            <option key={r.id} value={r.id}>
              {r.name}
            </option>
          ))}
        </select>
      </FormField>
      <FormField label="Login Branch" htmlFor="loginBranchId" required>
        <select
          id="loginBranchId"
          required
          value={value.branchId}
          onChange={(e) => onChange({ ...value, branchId: e.target.value })}
          className={textInputClass()}
        >
          <option value="">— Select —</option>
          {branches.map((b) => (
            <option key={b.id} value={b.id}>
              {b.name}
            </option>
          ))}
        </select>
      </FormField>
      <p className="col-span-2 text-xs text-zinc-500 dark:text-zinc-400">
        The username is the employee&apos;s email. A temporary password is issued and must be changed at first
        sign-in — tell the employee in person.
      </p>
    </div>
  );
}
