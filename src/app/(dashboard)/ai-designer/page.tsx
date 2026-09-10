import { notFound } from "next/navigation";
import { auth } from "@/core/auth/auth";
import { PermissionService } from "@/core/rbac/PermissionService";
import { AiDesignerListClient } from "./AiDesignerListClient";

export default async function AiDesignerDashboardPage() {
  const session = await auth();
  await PermissionService.assert(session!.user.id, "ai_designer", "view").catch(() => notFound());

  return <AiDesignerListClient />;
}
