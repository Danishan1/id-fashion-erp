import { notFound } from "next/navigation";
import { auth } from "@/core/auth/auth";
import { PermissionService } from "@/core/rbac/PermissionService";
import { SalaryAdvancesClient } from "./SalaryAdvancesClient";

export default async function SalaryAdvancesPage() {
  const session = await auth();
  await PermissionService.assert(session!.user.id, "hrms_salary_advance", "view").catch(() => notFound());
  const canRequest = await PermissionService.can(session!.user.id, "hrms_salary_advance", "create");
  return <SalaryAdvancesClient canRequest={canRequest} />;
}
