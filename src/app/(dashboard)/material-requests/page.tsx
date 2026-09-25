import { notFound } from "next/navigation";
import { auth } from "@/core/auth/auth";
import { PermissionService } from "@/core/rbac/PermissionService";
import { MaterialRequestsListClient } from "./MaterialRequestsListClient";

export default async function MaterialRequestsListPage() {
  const session = await auth();
  await PermissionService.assert(session!.user.id, "material_request", "view").catch(() => notFound());

  return <MaterialRequestsListClient />;
}
