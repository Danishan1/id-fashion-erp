import { notFound } from "next/navigation";
import { auth } from "@/core/auth/auth";
import { PermissionService } from "@/core/rbac/PermissionService";
import { ApprovalMatrixClient } from "./ApprovalMatrixClient";

export default async function ApprovalMatrixPage() {
  const session = await auth();
  const userId = session!.user.id;
  await PermissionService.assert(userId, "payment_request_settings", "view").catch(() => notFound());
  const canEdit = await PermissionService.can(userId, "payment_request_settings", "edit");

  return <ApprovalMatrixClient canEdit={canEdit} />;
}
