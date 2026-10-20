import { NextResponse } from "next/server";
import type { PlatformUserRole } from "@prisma/client";
import { auth } from "@/core/auth/auth";
import { prisma } from "@/core/db/client";
import { BusinessRuleError, toErrorResponse } from "@/core/errors/BusinessRuleError";
import { initRequestContext, setRequestActor } from "@/core/logging/requestContext";
import { getLiveSupportSession, type LiveSupportSession } from "@/core/support-access/support-session-guard";

export const ACCOUNT_SUSPENDED_MESSAGE = "Your company's account is suspended. Please contact support.";
export const SUPPORT_SESSION_ENDED_MESSAGE = "This support session has ended, expired or been revoked by the customer.";

/**
 * Every customer-ERP API route handler should call this first, then wrap its
 * body in try/catch(handleApiError) — keeps the "who is calling, are they
 * allowed" check and the structured-error contract consistent across all
 * modules.
 *
 * Re-checks the user's live DB status on every call rather than trusting the
 * JWT alone — a handful of routes are gated on session presence only, with no
 * follow-up PermissionService call (self-scoped/reference-data lookups), so
 * this is the one place that guarantees a suspended user's session stops
 * working everywhere, not just on routes that happen to assert a permission.
 *
 * Platform SaaS Phase 1:
 *  - Platform-operator sessions are refused here (PLAT-004) — they belong to
 *    no company and can't use customer ERP routes; they use
 *    requirePlatformSession() routes only.
 *  - A suspended company (companies.is_active = false) is refused with
 *    ACCOUNT_SUSPENDED (PLAT-006), checked live in the same query.
 *
 * Also the one near-universal chokepoint this app has for tagging every log
 * line for the rest of this request with a correlation ID and, once known,
 * the acting user/company — see requestContext.ts for why.
 */
export async function requireSession() {
  initRequestContext();
  const session = await auth();
  if (!session?.user) {
    throw new BusinessRuleError("PERMISSION_DENIED", "Sign in required.");
  }
  if (session.user.userType === "PLATFORM") {
    throw new BusinessRuleError("PERMISSION_DENIED", "Platform accounts can't access customer ERP data.");
  }
  // PLAT-011/014: a support session works only while the customer-approved
  // session is live — revocation and expiry take effect on the next call.
  if (session.user.userType === "SUPPORT") {
    const live = session.user.supportSessionId ? await getLiveSupportSession(session.user.supportSessionId) : null;
    if (!live || live.proxyUserId !== session.user.id || live.companyId !== session.user.companyId) {
      throw new BusinessRuleError("PERMISSION_DENIED", SUPPORT_SESSION_ENDED_MESSAGE);
    }
  }
  const user = await prisma.user.findUnique({
    where: { id: session.user.id },
    select: { status: true, passwordChangedAt: true, company: { select: { isActive: true } } },
  });
  if (!user || user.status !== "ACTIVE") {
    throw new BusinessRuleError("PERMISSION_DENIED", "Your account is no longer active. Please sign in again.");
  }
  if (!user.company.isActive) {
    throw new BusinessRuleError("ACCOUNT_SUSPENDED", ACCOUNT_SUSPENDED_MESSAGE);
  }
  // Same reasoning as the status check above — a session issued before the
  // account's password was last changed/reset must stop working immediately,
  // not silently keep working for the rest of its 30-day JWT lifetime.
  if (user.passwordChangedAt && session.user.sessionIssuedAt * 1000 < user.passwordChangedAt.getTime()) {
    throw new BusinessRuleError("PERMISSION_DENIED", "Your password was changed. Please sign in again.");
  }
  setRequestActor(session.user.id, session.user.companyId);
  return session;
}

/**
 * For routes that return global reference data (e.g., /api/v1/currencies) that
 * both customer tenant users AND platform operators need to access.
 */
export async function requireAnySession() {
  initRequestContext();
  const session = await auth();
  if (!session?.user) {
    throw new BusinessRuleError("PERMISSION_DENIED", "Sign in required.");
  }
  if (session.user.userType === "PLATFORM") {
    const platformUser = await prisma.platformUser.findUnique({
      where: { id: session.user.id },
      select: { status: true, passwordChangedAt: true },
    });
    if (!platformUser || platformUser.status !== "ACTIVE") {
      throw new BusinessRuleError("PERMISSION_DENIED", "Your account is no longer active. Please sign in again.");
    }
    if (platformUser.passwordChangedAt && session.user.sessionIssuedAt * 1000 < platformUser.passwordChangedAt.getTime()) {
      throw new BusinessRuleError("PERMISSION_DENIED", "Your password was changed. Please sign in again.");
    }
    return session;
  }
  return requireSession();
}

/**
 * For /api/v1/platform/** routes only (PLAT-002). Requires a platform-operator
 * session and re-checks the platform_users row live (status, password change,
 * and — when `roles` is given — the role), never trusting the JWT alone.
 * Tenant sessions are refused, whatever role they hold in their own company.
 */
export async function requirePlatformSession(roles?: PlatformUserRole[]) {
  initRequestContext();
  const session = await auth();
  if (!session?.user || session.user.userType !== "PLATFORM") {
    throw new BusinessRuleError("PERMISSION_DENIED", "Platform administrator access required.");
  }
  const platformUser = await prisma.platformUser.findUnique({
    where: { id: session.user.id },
    select: { status: true, role: true, passwordChangedAt: true },
  });
  if (!platformUser || platformUser.status !== "ACTIVE") {
    throw new BusinessRuleError("PERMISSION_DENIED", "Your account is no longer active. Please sign in again.");
  }
  if (platformUser.passwordChangedAt && session.user.sessionIssuedAt * 1000 < platformUser.passwordChangedAt.getTime()) {
    throw new BusinessRuleError("PERMISSION_DENIED", "Your password was changed. Please sign in again.");
  }
  if (roles && !roles.includes(platformUser.role)) {
    throw new BusinessRuleError("PERMISSION_DENIED", "Your platform role doesn't allow this action.");
  }
  return { session, platformUser: { id: session.user.id, role: platformUser.role } };
}

/**
 * For /api/v1/support-session/** routes only (Phase 2): the support session's
 * own controls (status, request write access, end). Requires a SUPPORT
 * session whose customer-approved session is still live.
 */
export async function requireSupportSession(): Promise<{ live: LiveSupportSession }> {
  initRequestContext();
  const session = await auth();
  if (!session?.user || session.user.userType !== "SUPPORT" || !session.user.supportSessionId) {
    throw new BusinessRuleError("PERMISSION_DENIED", "Support session required.");
  }
  const live = await getLiveSupportSession(session.user.supportSessionId);
  if (!live || live.proxyUserId !== session.user.id) {
    throw new BusinessRuleError("PERMISSION_DENIED", SUPPORT_SESSION_ENDED_MESSAGE);
  }
  setRequestActor(session.user.id, live.companyId);
  return { live };
}

export function handleApiError(error: unknown): NextResponse {
  const { status, body } = toErrorResponse(error);
  return NextResponse.json(body, { status });
}
