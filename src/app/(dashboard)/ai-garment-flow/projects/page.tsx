import { notFound } from "next/navigation";
import { auth } from "@/core/auth/auth";
import { PermissionService } from "@/core/rbac/PermissionService";
import { AiGarmentProjectsListClient } from "./AiGarmentProjectsListClient";

export default async function AiGarmentProjectsListPage() {
  const session = await auth();
  await PermissionService.assert(session!.user.id, "ai_garment_flow", "view").catch(() => notFound());

  return <AiGarmentProjectsListClient />;
}
