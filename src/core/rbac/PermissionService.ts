import { prisma } from "@/core/db/client";
import { permissionKey, type Module, type Action } from "@/config/rbac";

export interface ResourceContext {
  /** userId of whoever created the record being acted on — enables self-approval checks. */
  createdBy?: string;
}

const SELF_APPROVAL_GUARDED_ACTIONS: Action[] = ["approve", "post"];

class PermissionServiceImpl {
  private cache = new Map<string, Set<string>>();

  /** Clear the in-process permission cache — call after any role/permission mutation. */
  invalidate(userId?: string) {
    if (userId) {
      this.cache.delete(userId);
    } else {
      this.cache.clear();
    }
  }

  private async loadPermissionKeys(userId: string): Promise<Set<string>> {
    const cached = this.cache.get(userId);
    if (cached) return cached;

    const userBranchRoles = await prisma.userBranchRole.findMany({
      where: { userId },
      include: {
        role: {
          include: { rolePermissions: { include: { permission: true } } },
        },
      },
    });

    const keys = new Set<string>();
    for (const ubr of userBranchRoles) {
      for (const rp of ubr.role.rolePermissions) {
        keys.add(rp.permission.key);
      }
    }

    this.cache.set(userId, keys);
    return keys;
  }

  private async hasRole(userId: string, roleName: string): Promise<boolean> {
    const count = await prisma.userBranchRole.count({
      where: { userId, role: { name: roleName } },
    });
    return count > 0;
  }

  /**
   * Deliberately uncached and re-checked on every call — JWT sessions are
   * stateless, so nothing else in the request path re-validates a user's
   * live status after their token was issued. Without this, suspending a
   * user (e.g. offboarding, incident response) would leave their existing
   * session cookie fully functional for up to the JWT's own maxAge, since a
   * status change touches no permission/role row this class's own cache
   * keys on. A tiny extra by-primary-key lookup per permission check is the
   * accepted cost of making "suspend" actually take effect immediately.
   */
  private async isUserActive(userId: string): Promise<boolean> {
    const user = await prisma.user.findUnique({ where: { id: userId }, select: { status: true } });
    return user?.status === "ACTIVE";
  }

  /**
   * Server-side permission check — never trust client state for this.
   * When `resourceContext.createdBy` is supplied for an approve/post action,
   * self-approval is denied unless the user holds SUPER_ADMIN.
   */
  async can(
    userId: string,
    module: Module,
    action: Action,
    resourceContext?: ResourceContext
  ): Promise<boolean> {
    if (!(await this.isUserActive(userId))) return false;

    if (
      resourceContext?.createdBy &&
      resourceContext.createdBy === userId &&
      SELF_APPROVAL_GUARDED_ACTIONS.includes(action)
    ) {
      const isSuperAdmin = await this.hasRole(userId, "SUPER_ADMIN");
      if (!isSuperAdmin) return false;
    }

    const keys = await this.loadPermissionKeys(userId);
    return keys.has(permissionKey(module, action));
  }

  /** Throws BusinessRuleError("PERMISSION_DENIED") if the check fails — use in route handlers/services. */
  async assert(
    userId: string,
    module: Module,
    action: Action,
    resourceContext?: ResourceContext
  ): Promise<void> {
    const { BusinessRuleError } = await import("@/core/errors/BusinessRuleError");
    const allowed = await this.can(userId, module, action, resourceContext);
    if (!allowed) {
      throw new BusinessRuleError(
        "PERMISSION_DENIED",
        `You do not have permission to ${action} in ${module}.`,
        { module, action }
      );
    }
  }
}

export const PermissionService = new PermissionServiceImpl();
