import { auth } from "@/core/auth/auth";
import { PermissionService } from "@/core/rbac/PermissionService";

/** UI-only flags for the content screens; every action is checked again by its API route. */
export async function contentPermissions() {
  const session = await auth();
  const userId = session?.user?.id;
  if (!userId) return { create: false, edit: false, archive: false, approve: false, reject: false, crmView: false };
  const [create, edit, archive, approve, reject, crmView] = await Promise.all([
    PermissionService.can(userId, "marketing_content", "create"),
    PermissionService.can(userId, "marketing_content", "edit"),
    PermissionService.can(userId, "marketing_content", "delete"),
    PermissionService.can(userId, "marketing_content", "approve"),
    PermissionService.can(userId, "marketing_content", "reject"),
    PermissionService.can(userId, "crm", "view"),
  ]);
  return { create, edit, archive, approve, reject, crmView };
}
