import { notFound } from "next/navigation";
import { auth } from "@/core/auth/auth";
import { PermissionService } from "@/core/rbac/PermissionService";
import { ApprovalsClient } from "./ApprovalsClient";

export default async function ProgressApprovalsPage() {
  const session = await auth();
  await PermissionService.assert(session!.user.id, "production", "approve").catch(() => notFound());

  return <ApprovalsClient />;
}
