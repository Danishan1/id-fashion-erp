import { notFound } from "next/navigation";
import { auth } from "@/core/auth/auth";
import { PermissionService } from "@/core/rbac/PermissionService";
import { SalarySetupClient } from "./SalarySetupClient";

export default async function SalarySetupPage() {
  const session = await auth();
  await PermissionService.assert(session!.user.id, "hrms_salary_setup", "view").catch(() => notFound());
  const canEdit = await PermissionService.can(session!.user.id, "hrms_salary_setup", "edit");

  return <SalarySetupClient canEdit={canEdit} />;
}
