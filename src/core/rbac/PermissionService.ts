import { prisma } from "@/core/db/client";
import { MODULES, permissionKey, type Module, type Action } from "@/config/rbac";

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

  /**
   * The set of ProductionStage ids this user is allowed to see/act on, or
   * `null` meaning unrestricted (every stage). A user's roles are unioned:
   * if ANY held role has zero rows in `RoleProductionStageAccess` (the
   * default for every pre-existing role), that role is itself unrestricted
   * and wins outright — holding one additional narrow role (e.g. a QC
   * checkpoint scoped to one stage) must never silently shrink what an
   * otherwise-unrestricted Production Manager can already see. Only when
   * EVERY held role is individually restricted does the result become the
   * union of their allowed stages. A user holding no role at all sees
   * nothing (an empty Set, not null) — matches the fact they'd already fail
   * every ordinary permission check too.
   */
  async getAllowedProductionStageIds(userId: string): Promise<Set<string> | null> {
    const user = await this.loadLiveUserState(userId);
    if (user?.isPlatformAdmin) return null;

    const userBranchRoles = await prisma.userBranchRole.findMany({ where: { userId }, select: { roleId: true } });
    if (userBranchRoles.length === 0) return new Set();

    const roleIds = [...new Set(userBranchRoles.map((ubr) => ubr.roleId))];
    const restrictions = await prisma.roleProductionStageAccess.findMany({
      where: { roleId: { in: roleIds } },
      select: { roleId: true, productionStageId: true },
    });

    const restrictedRoleIds = new Set(restrictions.map((r) => r.roleId));
    const hasUnrestrictedRole = roleIds.some((id) => !restrictedRoleIds.has(id));
    if (hasUnrestrictedRole) return null;

    return new Set(restrictions.map((r) => r.productionStageId));
  }

  /**
   * Identical union/"any unrestricted role wins" semantics as
   * getAllowedProductionStageIds() just above, applied to RoleBranchAccess
   * instead of RoleProductionStageAccess -- a Role with zero
   * RoleBranchAccess rows is unrestricted (this user's held role sees every
   * branch in the company); a user holding ANY unrestricted role gets
   * `null` (full access) outright, regardless of other, narrower roles they
   * also hold; only when EVERY held role is individually restricted does
   * the result become the union of their allowed branch sets. A platform
   * admin always gets `null`. A user with no role at all gets an empty Set
   * (sees no branch's data), matching that they'd already fail every
   * ordinary permission check too.
   */
  async getAllowedBranchIds(userId: string): Promise<Set<string> | null> {
    const user = await this.loadLiveUserState(userId);
    if (user?.isPlatformAdmin) return null;

    const userBranchRoles = await prisma.userBranchRole.findMany({ where: { userId }, select: { roleId: true } });
    if (userBranchRoles.length === 0) return new Set();

    const roleIds = [...new Set(userBranchRoles.map((ubr) => ubr.roleId))];
    const restrictions = await prisma.roleBranchAccess.findMany({
      where: { roleId: { in: roleIds } },
      select: { roleId: true, branchId: true },
    });

    const restrictedRoleIds = new Set(restrictions.map((r) => r.roleId));
    const hasUnrestrictedRole = roleIds.some((id) => !restrictedRoleIds.has(id));
    if (hasUnrestrictedRole) return null;

    return new Set(restrictions.map((r) => r.branchId));
  }

  /**
   * The single Supplier this user's login is scoped to, or `null` for an
   * ordinary internal user with no such restriction (every pre-existing
   * user). Unlike getAllowedBranchIds/getAllowedProductionStageIds this is
   * NOT a role-level union — User.supplierId is a direct, 1:1 identity fact
   * (the same shape as User.employeeId), so there is nothing to union across
   * multiple roles: this account genuinely IS that vendor's own login.
   * Uncached (matches loadLiveUserState's live-check discipline) — a cheap
   * single-column lookup. A platform admin never has a supplierId set in
   * practice, but if one somehow were, it would still apply — this account
   * IS that vendor's login and should never see other suppliers'/other
   * companies' production data regardless of any other flag.
   */
  async getAllowedSupplierId(userId: string): Promise<string | null> {
    const user = await prisma.user.findUnique({ where: { id: userId }, select: { supplierId: true } });
    return user?.supplierId ?? null;
  }

  /**
   * The set of modules this user holds `view` on — drives which sidebar
   * sections/links actually render, so a narrowly-scoped custom role (e.g.
   * a floor-only "Cutting Supervisor") doesn't see nav entries for modules
   * it has no access to at all. `"all"` for a platform admin (mirrors
   * `can()`'s own bypass) and for a suspended/nonexistent user this
   * returns an empty Set (they're being signed out anyway; an empty nav is
   * the correct — not broken — state to render in that instant).
   */
  async getViewableModules(userId: string): Promise<Set<Module> | "all"> {
    return this.getModulesWithAction(userId, "view");
  }

  /**
   * Generalization of getViewableModules() for a non-"view" action — added
   * so a sidebar nav leaf can require a specific action (e.g. "Pending
   * Approvals" needs production.approve, not just production.view) instead
   * of only ever checking plain module visibility. See navigation.ts's
   * `requiredAction` field and filterNavSections() (RBAC audit, 2026-09-24).
   */
  async getModulesWithAction(userId: string, action: Action): Promise<Set<Module> | "all"> {
    const user = await this.loadLiveUserState(userId);
    if (!user || user.status !== "ACTIVE") return new Set();
    if (user.isPlatformAdmin) return "all";

    const keys = await this.loadPermissionKeys(userId);
    const matching = new Set<Module>();
    for (const mod of MODULES) {
      if (keys.has(permissionKey(mod, action))) matching.add(mod);
    }
    return matching;
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
