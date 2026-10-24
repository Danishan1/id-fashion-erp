import { notFound } from "next/navigation";
import { auth } from "@/core/auth/auth";
import { PermissionService } from "@/core/rbac/PermissionService";
import { AttendanceListClient } from "./AttendanceListClient";

export default async function AttendancePage() {
  const session = await auth();
  const userId = session!.user.id;
  await PermissionService.assert(userId, "hrms_attendance", "view").catch(() => notFound());
  const [canOverride, canEdit] = await Promise.all([
    PermissionService.can(userId, "hrms_attendance", "override"),
    PermissionService.can(userId, "hrms_attendance", "edit"),
  ]);
  return <AttendanceListClient canRecord={canOverride || canEdit} />;
}
