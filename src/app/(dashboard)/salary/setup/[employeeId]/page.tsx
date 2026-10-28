import { notFound } from "next/navigation";
import { auth } from "@/core/auth/auth";
import { PermissionService } from "@/core/rbac/PermissionService";
import { EmployeeSalarySetupForm } from "./EmployeeSalarySetupForm";

export default async function EmployeeSalarySetupPage({ params }: { params: Promise<{ employeeId: string }> }) {
  const session = await auth();
  await PermissionService.assert(session!.user.id, "hrms_salary_setup", "view").catch(() => notFound());
  const canEdit = await PermissionService.can(session!.user.id, "hrms_salary_setup", "edit");
  const { employeeId } = await params;

  return <EmployeeSalarySetupForm key={employeeId} employeeId={employeeId} canEdit={canEdit} />;
}
