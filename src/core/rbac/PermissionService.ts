import { prisma } from "@/core/db/client";
import { permissionKey, type Module, type Action } from "@/config/rbac";

export interface ResourceContext {
  /** userId of whoever created the record being acted on — enables self-approval checks. */
  createdBy?: string;
  /**
   * Unix seconds the caller's session/JWT was issued (session.user.sessionIssuedAt).
   * Optional — most callers go through requireSession() first (src/lib/api-route.ts),
   * which already performs this exact check independently and throws before this
   * function is ever reached, so passing it here would be redundant for them.
   * This is for the handful of Server Component pages that call
   * PermissionService.assert() directly without requireSession() — omitting it
   * simply skips the staleness check for that one call, it never widens access.
   */
  sessionIssuedAt?: number;
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
   * Also returns `passwordChangedAt` in the same query so the optional
   * session-staleness check below needs no second round-trip.
   */
  private async loadLiveUserState(
    userId: string
  ): Promise<{ status: string; passwordChangedAt: Date | null; isPlatformAdmin: boolean } | null> {
    return prisma.user.findUnique({
      where: { id: userId },
      select: { status: true, passwordChangedAt: true, isPlatformAdmin: true },
    });
  }

  /**
   * Server-side permission check — never trust client state for this.
   * When `resourceContext.createdBy` is supplied for an approve/post action,
   * self-approval is denied unless the user holds SUPER_ADMIN. When
   * `resourceContext.sessionIssuedAt` is supplied, a session issued before
   * the user's last password change/reset is denied — the same guarantee
   * requireSession() already provides independently for the ~285 routes
   * that call it first; this extends the identical guarantee to the handful
   * of Server Component pages that call this function directly.
   */
  async can(
    userId: string,
    module: Module,
    action: Action,
    resourceContext?: ResourceContext
  ): Promise<boolean> {
    const user = await this.loadLiveUserState(userId);
    if (!user || user.status !== "ACTIVE") return false;
    if (
      resourceContext?.sessionIssuedAt !== undefined &&
      user.passwordChangedAt &&
      resourceContext.sessionIssuedAt * 1000 < user.passwordChangedAt.getTime()
    ) {
      return false;
    }

    // A platform administrator gets full, unrestricted access to whichever
    // company their own session is currently scoped to (session.user.companyId,
    // switchable via the sidebar's company switcher) — every module/action,
    // including self-approval. Company-scoping itself is enforced entirely at
    // the service/repository layer via actor.companyId sourced from
    // session.user.companyId, never by this class, so this bypass is exactly
    // what makes "switch active company" grant real access rather than just
    // changing which company's data queries happen to filter by. Re-verified
    // live from the DB on every call (loadLiveUserState is deliberately
    // uncached), never trusted from the JWT alone — same discipline `status`/
    // `passwordChangedAt` already use just above.
    if (user.isPlatformAdmin) return true;

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
