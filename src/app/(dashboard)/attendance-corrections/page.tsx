import { notFound } from "next/navigation";
import { auth } from "@/core/auth/auth";
import { PermissionService } from "@/core/rbac/PermissionService";
import { AttendanceCorrectionsListClient } from "./AttendanceCorrectionsListClient";

export default async function AttendanceCorrectionsPage() {
  const session = await auth();
  const userId = session!.user.id;
  await PermissionService.assert(userId, "hrms_attendance_regularization", "view").catch(() => notFound());
  const [canApprove, canReject, canViewAll] = await Promise.all([
    PermissionService.can(userId, "hrms_attendance_regularization", "approve"),
    PermissionService.can(userId, "hrms_attendance_regularization", "reject"),
    PermissionService.can(userId, "hrms_attendance_regularization", "view_all"),
  ]);
  return <AttendanceCorrectionsListClient canApprove={canApprove} canReject={canReject} canManageTeam={canApprove || canReject || canViewAll} />;
}
