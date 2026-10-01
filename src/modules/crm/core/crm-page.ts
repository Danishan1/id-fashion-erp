import { notFound } from "next/navigation";
import { auth } from "@/core/auth/auth";
import { PermissionService } from "@/core/rbac/PermissionService";
import type { CrmActor } from "./crm-actor";

export interface CrmPagePermissions {
  create: boolean;
  edit: boolean;
  viewAll: boolean;
  settings: boolean;
  settingsEdit: boolean;
}

/**
 * Server-component helper for CRM pages: the actor (same shape the API routes
 * build) plus the permission flags the page needs to show or hide actions.
 * The flags only drive the UI — every action is enforced again by its route.
 */
export async function getCrmPageContext(): Promise<{ actor: CrmActor; permissions: CrmPagePermissions }> {
  const session = await auth();
  if (!session?.user?.id) notFound();
  const userId = session.user.id;
  const [create, edit, viewAll, settings, settingsEdit] = await Promise.all([
    PermissionService.can(userId, "crm", "create"),
    PermissionService.can(userId, "crm", "edit"),
    PermissionService.can(userId, "crm", "view_all"),
    PermissionService.can(userId, "crm_settings", "view"),
    PermissionService.can(userId, "crm_settings", "edit"),
  ]);
  return {
    actor: { companyId: session.user.companyId, userId, branchId: session.user.defaultBranchId ?? null },
    permissions: { create, edit, viewAll, settings, settingsEdit },
  };
}
