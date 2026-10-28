import { notFound } from "next/navigation";
import { auth } from "@/core/auth/auth";
import { PermissionService } from "@/core/rbac/PermissionService";
import { SalaryAttendanceListClient } from "./SalaryAttendanceListClient";

export default async function SalaryAttendancePage() {
  const session = await auth();
  await PermissionService.assert(session!.user.id, "hrms_salary_attendance", "view").catch(() => notFound());
  return <SalaryAttendanceListClient />;
}
