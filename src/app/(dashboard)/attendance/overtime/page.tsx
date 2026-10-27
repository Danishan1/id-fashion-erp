import { notFound } from "next/navigation";
import { auth } from "@/core/auth/auth";
import { PermissionService } from "@/core/rbac/PermissionService";
import { OvertimeClient } from "./OvertimeClient";

export default async function OvertimePage() {
  const session = await auth();
  const userId = session!.user.id;
  const [canApprove, canReject] = await Promise.all([
    PermissionService.can(userId, "hrms_attendance_overtime", "approve"),
    PermissionService.can(userId, "hrms_attendance_overtime", "reject"),
  ]);
  if (!canApprove && !canReject) notFound();
  return <OvertimeClient canApprove={canApprove} canReject={canReject} />;
}
