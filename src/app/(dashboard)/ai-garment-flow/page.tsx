import { notFound } from "next/navigation";
import { auth } from "@/core/auth/auth";
import { PermissionService } from "@/core/rbac/PermissionService";
import { AiGarmentFlowDashboardClient } from "./AiGarmentFlowDashboardClient";

export default async function AiGarmentFlowDashboardPage() {
  const session = await auth();
  await PermissionService.assert(session!.user.id, "ai_garment_flow", "view").catch(() => notFound());

  return <AiGarmentFlowDashboardClient />;
}
