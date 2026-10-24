import { notFound } from "next/navigation";
import { auth } from "@/core/auth/auth";
import { PermissionService } from "@/core/rbac/PermissionService";
import { OutdoorPunchesClient } from "./OutdoorPunchesClient";

export default async function OutdoorPunchesPage() {
  const session = await auth();
  const userId = session!.user.id;
  const [canApprove, canReject] = await Promise.all([
    PermissionService.can(userId, "hrms_attendance", "approve"),
    PermissionService.can(userId, "hrms_attendance", "reject"),
  ]);
  if (!canApprove && !canReject) notFound();
  return <OutdoorPunchesClient canApprove={canApprove} canReject={canReject} />;
}
