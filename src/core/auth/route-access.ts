/**
 * Which part of the app a signed-in identity may use (Platform SaaS Phase 1,
 * PLAT-002/003). Edge-safe, no imports — called from the middleware's
 * `authorized` callback (auth.config.ts) on every page request.
 *
 *  - Customer (tenant) users get the ERP and never the /platform portal.
 *  - Platform operators get only the /platform portal, never the customer ERP.
 *
 * API routes are excluded from the middleware; they enforce the same split
 * server-side via requireSession() / requirePlatformSession() (api-route.ts).
 */

export type UserType = "TENANT" | "PLATFORM" | "SUPPORT";

export const TENANT_LOGIN_PATH = "/login";
export const PLATFORM_LOGIN_PATH = "/platform/login";
export const TENANT_HOME_PATH = "/dashboard";
export const PLATFORM_HOME_PATH = "/platform";
/** Shown when a support session is revoked, expired or ended (Phase 2). */
export const SUPPORT_ENDED_PATH = "/support-ended";
/** Where a user with a temporary password is sent until they change it (P2). */
export const ACCOUNT_PATH = "/account";
export const FORCED_PASSWORD_CHANGE_PATH = "/account?changePassword=required";

export type RouteDecision =
  | { kind: "allow" }
  | { kind: "redirect"; to: string }
  /** Not signed in on a customer page — let NextAuth send them to its sign-in page (/login). */
  | { kind: "require-tenant-login" };

export function isPlatformPath(pathname: string): boolean {
  return pathname === PLATFORM_HOME_PATH || pathname.startsWith(`${PLATFORM_HOME_PATH}/`);
}

/**
 * `userType` undefined means signed out. A session issued before this
 * change has no userType claim; it can only have come from the tenant login,
 * so it's treated as TENANT.
 */
export function decideRouteAccess(
  pathname: string,
  signedIn: boolean,
  userType: UserType | undefined,
  mustChangePassword = false
): RouteDecision {
  const onPlatformPath = isPlatformPath(pathname);

  // Reachable in any state: a support session may already be gone by the
  // time the browser lands here.
  if (pathname === SUPPORT_ENDED_PATH) return { kind: "allow" };

  if (!signedIn) {
    if (pathname === TENANT_LOGIN_PATH || pathname === PLATFORM_LOGIN_PATH) return { kind: "allow" };
    if (onPlatformPath) {
      return { kind: "redirect", to: `${PLATFORM_LOGIN_PATH}?callbackUrl=${encodeURIComponent(pathname)}` };
    }
    return { kind: "require-tenant-login" };
  }

  const type: UserType = userType ?? "TENANT";

  if (type === "PLATFORM") {
    if (pathname === PLATFORM_LOGIN_PATH) return { kind: "redirect", to: PLATFORM_HOME_PATH };
    // Platform staff never see the customer ERP (PLAT-004 — access to a
    // tenant comes only through a customer-approved support session, Phase 2).
    if (!onPlatformPath) return { kind: "redirect", to: PLATFORM_HOME_PATH };
    return { kind: "allow" };
  }

  // SUPPORT: a platform operator inside one company's ERP through a
  // customer-approved session. ERP pages only — never the platform portal
  // (their platform login was replaced by this session). The proxy re-checks
  // the support session live on every request.
  if (type === "SUPPORT") {
    if (pathname === TENANT_LOGIN_PATH) return { kind: "redirect", to: TENANT_HOME_PATH };
    if (pathname === PLATFORM_LOGIN_PATH) return { kind: "allow" };
    if (onPlatformPath) return { kind: "redirect", to: TENANT_HOME_PATH };
    return { kind: "allow" };
  }

  // TENANT
  // P2: a temporary password (new login from Employee Master, or an admin
  // reset) must be changed first -- every ERP page goes to /account until then.
  if (mustChangePassword) {
    if (pathname === ACCOUNT_PATH || pathname === PLATFORM_LOGIN_PATH) return { kind: "allow" };
    return { kind: "redirect", to: FORCED_PASSWORD_CHANGE_PATH };
  }
  if (pathname === TENANT_LOGIN_PATH) return { kind: "redirect", to: TENANT_HOME_PATH };
  // A customer may open the platform login page (to sign in as a platform
  // operator instead), but never any other platform page.
  if (pathname === PLATFORM_LOGIN_PATH) return { kind: "allow" };
  if (onPlatformPath) return { kind: "redirect", to: TENANT_HOME_PATH };
  return { kind: "allow" };
}
