import NextAuth, { type NextAuthConfig, type Session } from "next-auth";
import type { NextRequest } from "next/server";
import { authConfig } from "@/core/auth/auth.config";
import { SUPPORT_ENDED_PATH } from "@/core/auth/route-access";
import { prisma } from "@/core/db/client";
import { recordSupportEvent } from "@/core/support-access/support-events";
import { getLiveSupportSession, isMethodAllowedForSupport } from "@/core/support-access/support-session-guard";
import { EntitlementService } from "@/core/entitlements/EntitlementService";
import { isPathDisabled, MODULE_UNAVAILABLE_PATH } from "@/core/entitlements/route-modules";

/**
 * Platform SaaS Phase 3 (PLAT-019): an ERP page whose module the platform
 * turned off for this company redirects to /module-unavailable. APIs are
 * refused separately by PermissionService (MODULE_NOT_ENABLED).
 */
async function entitlementGate(companyId: string, request: NextRequest): Promise<true | Response> {
  const pathname = request.nextUrl.pathname;
  if (pathname.startsWith("/api/") || pathname === MODULE_UNAVAILABLE_PATH) return true;
  const disabled = await EntitlementService.getDisabledModules(companyId);
  if (isPathDisabled(pathname, disabled)) {
    return Response.redirect(new URL(MODULE_UNAVAILABLE_PATH, request.nextUrl.origin));
  }
  return true;
}

const ACCOUNT_SUSPENDED_PATH = "/account-suspended";

// Pages a user of a suspended company may still open.
const SUSPENDED_ALLOWED_PATHS = new Set([ACCOUNT_SUSPENDED_PATH, "/login", "/platform/login"]);

/** The support banner polls this; logging each poll would only add noise. */
const SUPPORT_STATUS_PATH = "/api/v1/support-session/status";

function supportDenied(request: NextRequest, message: string, redirectTo?: string): Response {
  if (request.nextUrl.pathname.startsWith("/api/")) {
    return Response.json(
      { success: false, message, error: { code: "PERMISSION_DENIED", message } },
      { status: 403 }
    );
  }
  if (redirectTo) return Response.redirect(new URL(redirectTo, request.nextUrl.origin));
  return new Response(message, { status: 403, headers: { "content-type": "text/plain; charset=utf-8" } });
}

/**
 * Platform SaaS Phase 2 — every request made in a support session (page or
 * API) passes through here:
 *  - PLAT-011/014: the customer-approved session must still be live (not
 *    revoked, not expired, company active, operator active); otherwise the
 *    browser is sent to /support-ended and APIs get 403.
 *  - PLAT-012: a read-only session can't make any state-changing request.
 *  - PLAT-015: each request (allowed or refused) is written to the
 *    tamper-evident support event log.
 * Server-side guards (requireSession(), PermissionService) enforce the same
 * rules again independently.
 */
async function supportGate(user: Session["user"], request: NextRequest): Promise<true | Response> {
  const pathname = request.nextUrl.pathname;
  if (pathname === SUPPORT_ENDED_PATH || pathname.startsWith("/api/auth/")) return true;

  const live = user.supportSessionId ? await getLiveSupportSession(user.supportSessionId) : null;
  if (!live || live.proxyUserId !== user.id) {
    return supportDenied(request, "This support session has ended, expired or been revoked.", SUPPORT_ENDED_PATH);
  }

  const method = request.method.toUpperCase();
  const path = `${pathname}${request.nextUrl.search}`;
  const allowed = isMethodAllowedForSupport(live.mode, method, pathname);

  if (!(method === "GET" && pathname === SUPPORT_STATUS_PATH)) {
    await recordSupportEvent({
      requestId: live.requestId,
      eventType: allowed ? "ACCESS" : "ACCESS_DENIED",
      actorType: "PLATFORM_USER",
      actorId: live.platformUserId,
      method,
      path,
      detail: allowed ? null : { reason: "READ_ONLY_SESSION" },
    });
  }

  if (!allowed) {
    return supportDenied(
      request,
      "This support session is read-only. Request write access from the support banner to make changes."
    );
  }
  return entitlementGate(live.companyId, request);
}

/**
 * Same as authConfig's `authorized` (route-access.ts), plus:
 *  - PLAT-006: a tenant user whose company is suspended is sent to
 *    /account-suspended before any page renders. This has to happen here,
 *    not in the (dashboard) layout — the layout and the page render in
 *    parallel, so a layout-level redirect still streams the page's data in
 *    the response body.
 *  - Phase 2: support sessions are gated by supportGate() above, for pages
 *    and API calls alike.
 *
 * Proxy runs on the Node.js runtime in Next 16, so it can query the DB.
 */
const authorized: NonNullable<NextAuthConfig["callbacks"]>["authorized"] = async (params) => {
  const { auth, request } = params;
  const pathname = request.nextUrl.pathname;

  // API routes do their own auth (requireSession() and friends). The proxy
  // only adds the support-session gate for them.
  if (pathname.startsWith("/api/")) {
    return auth?.user?.userType === "SUPPORT" ? supportGate(auth.user, request) : true;
  }

  const decision = await authConfig.callbacks.authorized(params);
  if (decision !== true) return decision;

  const userId = auth?.user?.id;
  if (!userId || auth?.user?.userType === "PLATFORM") return true;
  if (auth?.user?.userType === "SUPPORT") return supportGate(auth.user, request);

  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { companyId: true, company: { select: { isActive: true } } },
  });
  const suspended = !!user && !user.company.isActive;

  if (suspended && !SUSPENDED_ALLOWED_PATHS.has(pathname)) {
    return Response.redirect(new URL(ACCOUNT_SUSPENDED_PATH, request.nextUrl.origin));
  }
  return user ? entitlementGate(user.companyId, request) : true;
};

export default NextAuth({ ...authConfig, callbacks: { ...authConfig.callbacks, authorized } }).auth;

export const config = {
  // API routes are included (minus NextAuth's own) so support sessions are
  // gated and logged there too; every other API request passes straight
  // through to the route's own guard.
  matcher: ["/((?!api/auth|_next/static|_next/image|favicon.ico).*)"],
};
