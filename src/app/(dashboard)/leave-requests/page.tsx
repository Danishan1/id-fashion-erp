import { notFound } from "next/navigation";
import { auth } from "@/core/auth/auth";
import { PermissionService } from "@/core/rbac/PermissionService";
import { LeaveRequestsListClient } from "./LeaveRequestsListClient";

export default async function LeaveRequestsPage() {
  const session = await auth();
  const userId = session!.user.id;
  await PermissionService.assert(userId, "hrms_leave", "view").catch(() => notFound());
  const [canApprove, canReject, canViewAll] = await Promise.all([
    PermissionService.can(userId, "hrms_leave", "approve"),
    PermissionService.can(userId, "hrms_leave", "reject"),
    PermissionService.can(userId, "hrms_leave", "view_all"),
  ]);
  return <LeaveRequestsListClient canApprove={canApprove} canReject={canReject} canManageTeam={canApprove || canReject || canViewAll} />;
}
