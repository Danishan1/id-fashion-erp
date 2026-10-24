import { notFound } from "next/navigation";
import { auth } from "@/core/auth/auth";
import { PermissionService } from "@/core/rbac/PermissionService";
import { SalarySheetClient } from "./SalarySheetClient";

export default async function SalarySheetPage() {
  const session = await auth();
  const userId = session!.user.id;
  await PermissionService.assert(userId, "hrms_attendance", "export").catch(() => notFound());
  const [canEdit, canViewAll] = await Promise.all([
    PermissionService.can(userId, "hrms_attendance", "edit"),
    PermissionService.can(userId, "hrms_attendance", "view_all"),
  ]);
  return <SalarySheetClient canFinalise={canEdit && canViewAll} />;
}
