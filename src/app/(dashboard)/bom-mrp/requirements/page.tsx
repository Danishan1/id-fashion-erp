import { notFound } from "next/navigation";
import { auth } from "@/core/auth/auth";
import { PermissionService } from "@/core/rbac/PermissionService";
import { MaterialRequirementsClient } from "./MaterialRequirementsClient";

export default async function MaterialRequirementsPage() {
  const session = await auth();
  await PermissionService.assert(session!.user.id, "bom_mrp", "view").catch(() => notFound());

  return <MaterialRequirementsClient />;
}
