import { notFound } from "next/navigation";
import { auth } from "@/core/auth/auth";
import { PermissionService } from "@/core/rbac/PermissionService";
import { SalaryHistoryClient } from "./SalaryHistoryClient";

export default async function SalaryHistoryPage() {
  const session = await auth();
  await PermissionService.assert(session!.user.id, "hrms_salary_history", "view").catch(() => notFound());
  const canExport = await PermissionService.can(session!.user.id, "hrms_salary_history", "export");
  return <SalaryHistoryClient canExport={canExport} />;
}
