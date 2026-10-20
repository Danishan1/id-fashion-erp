import { prisma } from "@/core/db/client";
import { normalizeEmail } from "@/lib/email";
import { verifyPassword } from "@/core/auth/password";
import { assertNotLockedOut, clearAttempts, recordFailedAttempt } from "@/core/auth/rateLimiter";
import type { PlatformUserRole } from "@prisma/client";
import { hashExchangeToken } from "@/core/support-access/codes";
import { recordSupportEvent } from "@/core/support-access/support-events";
import { getLiveSupportSession } from "@/core/support-access/support-session-guard";

/**
 * The two sign-in checks behind auth.ts's two NextAuth providers, kept here
 * (not inline in auth.ts) so they can be unit-tested without NextAuth.
 *
 * Both keep the "return null on any failure" contract — a lockout, a wrong
 * password, a suspended account and a suspended company all look identical
 * to the caller, so the login page never leaks which one it was.
 */

export interface TenantSignIn {
  id: string;
  email: string;
  name: string;
  userType: "TENANT";
  companyId: string;
  defaultBranchId: string | null;
  /** P2: still on a temporary password -- may only change it. */
  mustChangePassword: boolean;
}

export interface PlatformSignIn {
  id: string;
  email: string;
  name: string;
  userType: "PLATFORM";
  platformRole: PlatformUserRole;
}

export async function authenticateTenantUser(rawEmail: string, password: string): Promise<TenantSignIn | null> {
  // P2: emails are stored lower-case; match case-insensitively at sign-in
  // (and key the lockout counter the same way, so case can't dodge it).
  const email = normalizeEmail(rawEmail);
  try {
    assertNotLockedOut(email);
  } catch {
    return null;
  }

  const include = { company: { select: { isActive: true } } } as const;
  // Exact (lower-case) match first; a row saved before P2 may still be
  // mixed-case, so fall back to a case-insensitive match for it.
  const user =
    (await prisma.user.findUnique({ where: { email }, include })) ??
    (await prisma.user.findFirst({ where: { email: { equals: email, mode: "insensitive" } }, include, orderBy: { createdAt: "asc" } }));
  // PLAT-006: users of a suspended company can't sign in either.
  // PLAT-011: a support proxy user never signs in here — only through a
  // customer-approved support session (the "support-session" provider).
  if (!user || user.status !== "ACTIVE" || !user.company.isActive || user.supportForPlatformUserId) {
    recordFailedAttempt(email);
    return null;
  }

  if (!(await verifyPassword(password, user.passwordHash))) {
    recordFailedAttempt(email);
    return null;
  }

  clearAttempts(email);
  await prisma.user.update({ where: { id: user.id }, data: { lastLoginAt: new Date() } });

  return {
    id: user.id,
    email: user.email,
    name: user.fullName,
    userType: "TENANT",
    companyId: user.companyId,
    defaultBranchId: user.defaultBranchId,
    mustChangePassword: user.mustChangePassword,
  };
}

export async function authenticatePlatformUser(email: string, password: string): Promise<PlatformSignIn | null> {
  // Separate lockout bucket from the tenant login for the same email address.
  const limiterKey = `platform:${email}`;
  try {
    assertNotLockedOut(limiterKey);
  } catch {
    return null;
  }

  const user = await prisma.platformUser.findUnique({ where: { email } });
  if (!user || user.status !== "ACTIVE") {
    recordFailedAttempt(limiterKey);
    return null;
  }

  if (!(await verifyPassword(password, user.passwordHash))) {
    recordFailedAttempt(limiterKey);
    return null;
  }

  clearAttempts(limiterKey);
  await prisma.platformUser.update({ where: { id: user.id }, data: { lastLoginAt: new Date() } });

  return { id: user.id, email: user.email, name: user.fullName, userType: "PLATFORM", platformRole: user.role };
}

export interface SupportSignIn {
  id: string;
  email: string;
  name: string;
  userType: "SUPPORT";
  companyId: string;
  defaultBranchId: null;
  supportSessionId: string;
}

/**
 * PLAT-011: exchanges the single-use token the platform portal issued for a
 * support-session sign-in. The resulting session acts as the company's
 * "Support — <operator>" proxy user and carries the support session id; every
 * later request re-checks that session live (revocation, expiry, company and
 * operator status). The token is consumed atomically, so it works only once.
 */
export async function authenticateSupportSession(token: string): Promise<SupportSignIn | null> {
  const tokenHash = hashExchangeToken(token);
  const session = await prisma.supportAccessSession.findUnique({
    where: { exchangeTokenHash: tokenHash },
    select: { id: true, requestId: true, platformUserId: true, exchangeTokenExpiresAt: true },
  });
  if (!session || !session.exchangeTokenExpiresAt || session.exchangeTokenExpiresAt.getTime() <= Date.now()) {
    return null;
  }
  const consumed = await prisma.supportAccessSession.updateMany({
    where: { id: session.id, exchangeTokenHash: tokenHash },
    data: { exchangeTokenHash: null, exchangeTokenExpiresAt: null, lastAccessedAt: new Date() },
  });
  if (consumed.count !== 1) return null;

  const live = await getLiveSupportSession(session.id);
  if (!live) return null;

  const proxy = await prisma.user.findUnique({
    where: { id: live.proxyUserId },
    select: { id: true, email: true, fullName: true, status: true },
  });
  if (!proxy || proxy.status !== "ACTIVE") return null;

  await prisma.user.update({ where: { id: proxy.id }, data: { lastLoginAt: new Date() } });
  await recordSupportEvent({
    requestId: session.requestId,
    eventType: "SESSION_OPENED",
    actorType: "PLATFORM_USER",
    actorId: session.platformUserId,
  });

  return {
    id: proxy.id,
    email: proxy.email,
    name: proxy.fullName,
    userType: "SUPPORT",
    companyId: live.companyId,
    defaultBranchId: null,
    supportSessionId: live.id,
  };
}
