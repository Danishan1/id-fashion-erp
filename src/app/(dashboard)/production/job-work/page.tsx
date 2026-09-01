import { notFound } from "next/navigation";
import { auth } from "@/core/auth/auth";
import { PermissionService } from "@/core/rbac/PermissionService";
import { JobWorkOrdersListClient } from "./JobWorkOrdersListClient";

export default async function JobWorkOrderListPage() {
  const session = await auth();
  await PermissionService.assert(session!.user.id, "production", "view").catch(() => notFound());

  return <JobWorkOrdersListClient />;
}
