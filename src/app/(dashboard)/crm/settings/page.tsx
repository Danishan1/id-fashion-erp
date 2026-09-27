import { notFound } from "next/navigation";
import { auth } from "@/core/auth/auth";
import { PermissionService } from "@/core/rbac/PermissionService";
import { CrmSettingsClient } from "./CrmSettingsClient";

export default async function CrmSettingsPage() {
  const session = await auth();
  await PermissionService.assert(session!.user.id, "crm", "view", { sessionIssuedAt: session!.user.sessionIssuedAt }).catch(() => notFound());

  return <CrmSettingsClient />;
}
