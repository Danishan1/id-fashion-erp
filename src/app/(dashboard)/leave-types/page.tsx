import { notFound } from "next/navigation";
import { auth } from "@/core/auth/auth";
import { PermissionService } from "@/core/rbac/PermissionService";
import { LeaveTypesClient } from "./LeaveTypesClient";

export default async function LeaveTypesPage() {
  const session = await auth();
  await PermissionService.assert(session!.user.id, "hrms_leave", "view").catch(() => notFound());

  return <LeaveTypesClient />;
}
