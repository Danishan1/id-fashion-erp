import { prisma } from "@/core/db/client";
import { MODULES, permissionKey, type Module, type Action } from "@/config/rbac";
import { EntitlementService } from "@/core/entitlements/EntitlementService";
import { computeSubscriptionStatus, isActionAllowedWhileReadOnly } from "@/core/subscriptions/subscription-state";
import {
  getLiveSupportSessionForProxyUser,
  supportPermissionKeys,
} from "@/core/support-access/support-session-guard";

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

  /**
   * A company's support proxy user (Platform SaaS Phase 2) holds no roles.
   * Its permissions come only from the customer-approved support session it
   * is currently acting under — read-only by default, read/write only after
   * the customer approved write access — and are never cached, so a revoke,
   * expiry or write approval applies on the very next check. Returns null
   * for an ordinary user.
   */
  private async loadSupportPermissionKeys(userId: string, isSupportProxy: boolean): Promise<Set<string> | null> {
    if (!isSupportProxy) return null;
    const live = await getLiveSupportSessionForProxyUser(userId);
    return live ? supportPermissionKeys(live.mode) : new Set();
  }

  private async loadPermissionKeys(userId: string, isSupportProxy = false): Promise<Set<string>> {
    const supportKeys = await this.loadSupportPermissionKeys(userId, isSupportProxy);
    if (supportKeys) return supportKeys;

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
   * Also returns `passwordChangedAt` and the company's `isActive` in the same
   * query, so the session-staleness and suspended-company checks need no
   * second round-trip.
   *
   * Only ever looks in the tenant `users` table, so a platform operator's id
   * (platform_users) is never found here and gets no permission at all
   * (Platform SaaS Phase 1, PLAT-004).
   */
  private async loadLiveUserState(
    userId: string
  ): Promise<{
    status: string;
    passwordChangedAt: Date | null;
    companyId: string;
    companyActive: boolean;
    isSupportProxy: boolean;
    subscriptionReadOnly: boolean;
  } | null> {
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: {
        status: true,
        companyId: true,
        passwordChangedAt: true,
        supportForPlatformUserId: true,
        company: {
          select: { isActive: true, subscription: { select: { isTrial: true, currentPeriodEndsAt: true } } },
        },
      },
    });
    if (!user) return null;
    return {
      status: user.status,
      passwordChangedAt: user.passwordChangedAt,
      companyId: user.companyId,
      companyActive: user.company?.isActive ?? false,
      isSupportProxy: !!user.supportForPlatformUserId,
      // Phase 4 (PLAT-024/025): grace period and expired archive are read-only.
      subscriptionReadOnly: computeSubscriptionStatus(user.company?.subscription).readOnly,
    };
  }

  /** null = not a support proxy user; otherwise whether its support session is live. */
  private async supportProxyIsLive(userId: string): Promise<boolean | null> {
    const user = await prisma.user.findUnique({ where: { id: userId }, select: { supportForPlatformUserId: true } });
    if (!user?.supportForPlatformUserId) return null;
    return !!(await getLiveSupportSessionForProxyUser(userId));
  }

  /** Active user in an active (not suspended) company. */
  private isUsable(user: { status: string; companyActive: boolean } | null): boolean {
    return !!user && user.status === "ACTIVE" && user.companyActive;
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
    return (await this.evaluate(userId, module, action, resourceContext)) === "ALLOWED";
  }

  private async evaluate(
    userId: string,
    module: Module,
    action: Action,
    resourceContext?: ResourceContext
  ): Promise<"ALLOWED" | "DENIED" | "MODULE_NOT_ENABLED" | "SUBSCRIPTION_READ_ONLY"> {
    const user = await this.loadLiveUserState(userId);
    if (!user || !this.isUsable(user)) return "DENIED";
    if (
      resourceContext?.sessionIssuedAt !== undefined &&
      user.passwordChangedAt &&
      resourceContext.sessionIssuedAt * 1000 < user.passwordChangedAt.getTime()
    ) {
      return "DENIED";
    }

    // Platform SaaS Phase 3 (PLAT-019): a module the platform turned off for
    // this company is refused for everyone in it, whatever their roles.
    if (!(await EntitlementService.isModuleEnabled(user.companyId, module))) return "MODULE_NOT_ENABLED";

    // Phase 4 (PLAT-024/025): once the subscription period has ended (7-day
    // grace, then the expired archive) the company is read-only for everyone:
    // view, print and export still work, nothing can be created or changed.
    if (user.subscriptionReadOnly && !isActionAllowedWhileReadOnly(action)) return "SUBSCRIPTION_READ_ONLY";

    // No universal bypass of any kind (PLAT-004, 2026-10-13): every user,
    // including a company's own Super Admin, gets exactly what their roles
    // grant. The old `isPlatformAdmin` "full access to any company" bypass
    // is gone; platform operators are no longer tenant users at all.

    if (
      resourceContext?.createdBy &&
      resourceContext.createdBy === userId &&
      SELF_APPROVAL_GUARDED_ACTIONS.includes(action)
    ) {
      const isSuperAdmin = await this.hasRole(userId, "SUPER_ADMIN");
      if (!isSuperAdmin) return "DENIED";
    }

    const keys = await this.loadPermissionKeys(userId, user.isSupportProxy);
    return keys.has(permissionKey(module, action)) ? "ALLOWED" : "DENIED";
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
    // A live support session sees every stage (it can only read unless the
    // customer approved write access); an ended one sees nothing.
    const supportLive = await this.supportProxyIsLive(userId);
    if (supportLive !== null) return supportLive ? null : new Set();

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
   * the result become the union of their allowed branch sets. A user with no
   * role at all gets an empty Set (sees no branch's data), matching that
   * they'd already fail every ordinary permission check too.
   */
  async getAllowedBranchIds(userId: string): Promise<Set<string> | null> {
    const supportLive = await this.supportProxyIsLive(userId);
    if (supportLive !== null) return supportLive ? null : new Set();

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
   * The single Contractor this user's login is scoped to, or `null` for an
   * ordinary internal user with no such restriction (every pre-existing
   * user). Unlike getAllowedBranchIds/getAllowedProductionStageIds this is
   * NOT a role-level union — User.contractorId is a direct, 1:1 identity fact
   * (the same shape as User.employeeId), so there is nothing to union across
   * multiple roles: this account genuinely IS that vendor's own login.
   * Uncached (matches loadLiveUserState's live-check discipline) — a cheap
   * single-column lookup. A platform admin never has a contractorId set in
   * practice, but if one somehow were, it would still apply — this account
   * IS that vendor's login and should never see other contractors'/other
   * companies' production data regardless of any other flag.
   */
  async getAllowedContractorId(userId: string): Promise<string | null> {
    const user = await prisma.user.findUnique({ where: { id: userId }, select: { contractorId: true } });
    return user?.contractorId ?? null;
  }

  /**
   * The set of modules this user holds `view` on — drives which sidebar
   * sections/links actually render, so a narrowly-scoped custom role (e.g.
   * a floor-only "Cutting Supervisor") doesn't see nav entries for modules
   * it has no access to at all. For a suspended/nonexistent user (or one
   * whose company is suspended) this returns an empty Set — an empty nav is
   * the correct, not broken, state to render in that instant.
   */
  async getViewableModules(userId: string): Promise<Set<Module>> {
    return this.getModulesWithAction(userId, "view");
  }

  /**
   * Generalization of getViewableModules() for a non-"view" action — added
   * so a sidebar nav leaf can require a specific action (e.g. "Pending
   * Approvals" needs production.approve, not just production.view) instead
   * of only ever checking plain module visibility. See navigation.ts's
   * `requiredAction` field and filterNavSections() (RBAC audit, 2026-09-24).
   */
  async getModulesWithAction(userId: string, action: Action): Promise<Set<Module>> {
    const user = await this.loadLiveUserState(userId);
    if (!user || !this.isUsable(user)) return new Set();

    if (user.subscriptionReadOnly && !isActionAllowedWhileReadOnly(action)) return new Set();

    const keys = await this.loadPermissionKeys(userId, user.isSupportProxy);
    const disabled = await EntitlementService.getDisabledModules(user.companyId);
    const matching = new Set<Module>();
    for (const mod of MODULES) {
      if (!disabled.has(mod) && keys.has(permissionKey(mod, action))) matching.add(mod);
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
    const result = await this.evaluate(userId, module, action, resourceContext);
    if (result === "MODULE_NOT_ENABLED") {
      throw new BusinessRuleError(
        "MODULE_NOT_ENABLED",
        "This module isn't enabled for your company. Contact your administrator or the platform team.",
        { module }
      );
    }
    if (result === "SUBSCRIPTION_READ_ONLY") {
      throw new BusinessRuleError(
        "SUBSCRIPTION_READ_ONLY",
        "Your company's subscription has ended, so the ERP is read-only: you can view, print and export, but not add or change anything. Ask your administrator to renew.",
        { module, action }
      );
    }
    if (result !== "ALLOWED") {
      throw new BusinessRuleError(
        "PERMISSION_DENIED",
        `You do not have permission to ${action} in ${module}.`,
        { module, action }
      );
    }
  }
}

// Next.js/Turbopack can bundle this module separately per runtime "layer"
// (Server Components vs. Route Handlers) — each layer then gets its OWN
// copy of `new PermissionServiceImpl()`, with its own independent `cache`
// Map. Every permission-mutating action in this app (role edits, user
// status/role changes, branch/stage-restriction changes) calls
// `PermissionService.invalidate()` from a Route Handler — with two separate
// instances, that clears only the Route Handler layer's own copy, leaving
// the Server Component layer (the Sidebar's `getViewableModules()`, and
// every page that calls `.assert()`/`.can()` directly, e.g.
// `admin/roles/[id]/page.tsx`) permanently stale until the whole dev server
// restarts. Confirmed live (2026-09-25): after editing a role's permissions,
// a fresh API route call correctly reflected the new state while the
// Sidebar and a Server-Component-gated detail page for the SAME user kept
// showing the pre-edit permission set indefinitely, across repeated
// reloads. Fixed with the exact same `globalThis`-backed singleton pattern
// already used for the Prisma client (src/core/db/client.ts) — guarantees
// one shared instance (and one shared cache) regardless of which layer's
// copy of this module a given call site actually imports. Deliberately not
// scoped to non-production only (unlike the Prisma client's own guard,
// which exists for an unrelated serverless-cold-start concern) — the
// cross-layer duplication this fixes is a build-time bundling
// characteristic, not a dev-mode-only HMR artifact.
const globalForPermissionService = globalThis as unknown as { __permissionService?: PermissionServiceImpl };

export const PermissionService = globalForPermissionService.__permissionService ?? new PermissionServiceImpl();
globalForPermissionService.__permissionService = PermissionService;
