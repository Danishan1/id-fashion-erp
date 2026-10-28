import { notFound } from "next/navigation";
import { auth } from "@/core/auth/auth";
import { PermissionService } from "@/core/rbac/PermissionService";
import { SalaryAttendanceDetailClient } from "./SalaryAttendanceDetailClient";

export default async function SalaryAttendanceDetailPage({ params, searchParams }: { params: Promise<{ employeeId: string }>; searchParams: Promise<{ month?: string }> }) {
  const session = await auth();
  await PermissionService.assert(session!.user.id, "hrms_salary_attendance", "view").catch(() => notFound());
  const canEdit = await PermissionService.can(session!.user.id, "hrms_salary_attendance", "edit");
  const { employeeId } = await params;
  const { month } = await searchParams;
  return <SalaryAttendanceDetailClient key={employeeId} employeeId={employeeId} initialMonth={month ?? null} canEdit={canEdit} />;
}
