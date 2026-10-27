import { notFound } from "next/navigation";
import { auth } from "@/core/auth/auth";
import { PermissionService } from "@/core/rbac/PermissionService";
import { LeaveBalancesClient } from "./LeaveBalancesClient";

export default async function LeaveBalancesPage() {
  const session = await auth();
  const userId = session!.user.id;
  await PermissionService.assert(userId, "hrms_leave_balances", "view").catch(() => notFound());
  const canEdit = await PermissionService.can(userId, "hrms_leave_balances", "edit");
  return <LeaveBalancesClient canEdit={canEdit} />;
}
