import { randomBytes } from "node:crypto";
import type { PlatformUserRole, Prisma, SupportEventActorType } from "@prisma/client";
import { prisma } from "@/core/db/client";
import { BusinessRuleError } from "@/core/errors/BusinessRuleError";
import { PermissionService } from "@/core/rbac/PermissionService";
import {
  ACCESS_CODE_TTL_MINUTES,
  EXCHANGE_TOKEN_TTL_SECONDS,
  MAX_CODE_ATTEMPTS,
  MAX_SUPPORT_SESSION_MINUTES,
  WRITE_CODE_TTL_MINUTES,
  generateExchangeToken,
  generateVerificationCode,
  hashExchangeToken,
  hashVerificationCode,
  verificationCodeMatches,
} from "@/core/support-access/codes";
import { recordSupportEventInTx, verifySupportEventChain } from "@/core/support-access/support-events";
import { getLiveSupportSession, isSupportSessionLive } from "@/core/support-access/support-session-guard";
import type { CreateSupportRequestInput } from "./support-access.schema";

/**
 * Customer-approved support access (Platform SaaS Phase 2, PLAT-008..015).
 *
 * Flow:
 *  1. A platform operator requests access to one company, with a reason and
 *     a duration (max 2 hours). A 6-digit code is shown to the operator ONCE.
 *  2. The operator gives the code to the customer (phone/email). The
 *     customer's company Super Admin enters it on Administration → Support
 *     Access to approve — proving the request they approve is the one the
 *     person they're talking to raised. They can also reject it.
 *  3. Approval starts a read-only support session. The operator opens it from
 *     the platform portal; inside the ERP they act as the company's
 *     "Support — <operator>" proxy user, which has no roles of its own.
 *  4. Write access needs a second request with a justification and a second
 *     code the customer must enter.
 *  5. The customer can revoke at any time; the session also ends on expiry.
 * Every step, and every page/API request made in the session, is written to
 * the tamper-evident support event log.
 */

const REQUESTER_ROLES: PlatformUserRole[] = ["PLATFORM_SUPER_ADMIN", "SUPPORT_AGENT"];

export interface PlatformActor {
  platformUserId: string;
  role: PlatformUserRole;
}

export interface TenantActor {
  userId: string;
  companyId: string;
}

type Tx = Prisma.TransactionClient;

function minutesFromNow(minutes: number): Date {
  return new Date(Date.now() + minutes * 60_000);
}

function event(
  tx: Tx,
  requestId: string,
  eventType: string,
  actorType: SupportEventActorType,
  actorId: string | null,
  detail?: Prisma.InputJsonValue
) {
  return recordSupportEventInTx(tx, { requestId, eventType, actorType, actorId, detail: detail ?? null });
}

/** Pending requests whose code has run out are marked EXPIRED (lazily, on read). */
async function expireStalePendingRequests(where: Prisma.SupportAccessRequestWhereInput) {
  const stale = await prisma.supportAccessRequest.findMany({
    where: { ...where, status: "PENDING", codeExpiresAt: { lte: new Date() } },
    select: { id: true },
  });
  for (const { id } of stale) {
    await prisma.$transaction(async (tx) => {
      const updated = await tx.supportAccessRequest.updateMany({
        where: { id, status: "PENDING" },
        data: { status: "EXPIRED" },
      });
      if (updated.count === 1) await event(tx, id, "REQUEST_EXPIRED", "SYSTEM", null);
    });
  }
}

// ---------------------------------------------------------------------------
// Platform side (PLAT-009)
// ---------------------------------------------------------------------------

function assertCanRequest(actor: PlatformActor) {
  if (!REQUESTER_ROLES.includes(actor.role)) {
    throw new BusinessRuleError("PERMISSION_DENIED", "Your platform role can't request support access.");
  }
}

export async function createSupportRequest(actor: PlatformActor, input: CreateSupportRequestInput) {
  assertCanRequest(actor);
  if (input.durationMinutes > MAX_SUPPORT_SESSION_MINUTES) {
    throw new BusinessRuleError("VALIDATION_ERROR", `Support sessions are limited to ${MAX_SUPPORT_SESSION_MINUTES} minutes.`);
  }
  const company = await prisma.company.findUnique({ where: { id: input.companyId }, select: { id: true, name: true, isActive: true } });
  if (!company) throw new BusinessRuleError("NOT_FOUND", "Company not found.");
  if (!company.isActive) {
    throw new BusinessRuleError("VALIDATION_ERROR", "This company is suspended — support access can't be requested.");
  }

  await expireStalePendingRequests({ companyId: company.id, platformUserId: actor.platformUserId });
  const open = await prisma.supportAccessRequest.findFirst({
    where: { companyId: company.id, platformUserId: actor.platformUserId, status: "PENDING" },
    select: { id: true },
  });
  if (open) {
    throw new BusinessRuleError(
      "VALIDATION_ERROR",
      "You already have a pending request for this company. Cancel it before creating a new one."
    );
  }

  const code = generateVerificationCode();
  const request = await prisma.$transaction(async (tx) => {
    const created = await tx.supportAccessRequest.create({
      data: {
        companyId: company.id,
        platformUserId: actor.platformUserId,
        reason: input.reason,
        durationMinutes: input.durationMinutes,
        // Real hash is set below — it's bound to the row's own id.
        codeHash: "pending",
        codeExpiresAt: minutesFromNow(ACCESS_CODE_TTL_MINUTES),
      },
    });
    const updated = await tx.supportAccessRequest.update({
      where: { id: created.id },
      data: { codeHash: hashVerificationCode("access", created.id, code) },
    });
    await event(tx, created.id, "REQUEST_CREATED", "PLATFORM_USER", actor.platformUserId, {
      reason: input.reason,
      durationMinutes: input.durationMinutes,
    });
    return updated;
  });

  return {
    request: { id: request.id, companyName: company.name, status: request.status, codeExpiresAt: request.codeExpiresAt },
    /** Shown to the operator once; only its hash is stored. */
    code,
  };
}

export async function cancelSupportRequest(actor: PlatformActor, requestId: string) {
  const request = await prisma.supportAccessRequest.findUnique({ where: { id: requestId } });
  if (!request || request.platformUserId !== actor.platformUserId) {
    throw new BusinessRuleError("NOT_FOUND", "Support request not found.");
  }
  await prisma.$transaction(async (tx) => {
    const updated = await tx.supportAccessRequest.updateMany({
      where: { id: requestId, status: "PENDING" },
      data: { status: "CANCELLED" },
    });
    if (updated.count !== 1) {
      throw new BusinessRuleError("INVALID_STATE_TRANSITION", "Only a pending request can be cancelled.");
    }
    await event(tx, requestId, "REQUEST_CANCELLED", "PLATFORM_USER", actor.platformUserId);
  });
}

/** A Platform Super Admin sees every request; other operators see their own. */
export async function listPlatformSupportRequests(actor: PlatformActor) {
  const scope: Prisma.SupportAccessRequestWhereInput =
    actor.role === "PLATFORM_SUPER_ADMIN" ? {} : { platformUserId: actor.platformUserId };
  await expireStalePendingRequests(scope);
  const rows = await prisma.supportAccessRequest.findMany({
    where: scope,
    orderBy: { createdAt: "desc" },
    take: 100,
    select: {
      id: true,
      reason: true,
      durationMinutes: true,
      status: true,
      codeExpiresAt: true,
      rejectionReason: true,
      createdAt: true,
      decidedAt: true,
      platformUserId: true,
      company: { select: { id: true, name: true, isActive: true } },
      platformUser: { select: { fullName: true, status: true } },
      decidedBy: { select: { fullName: true } },
      session: {
        select: {
          id: true,
          mode: true,
          startedAt: true,
          expiresAt: true,
          revokedAt: true,
          endedAt: true,
          writeStatus: true,
          request: { select: { status: true } },
          company: { select: { name: true, isActive: true } },
          platformUser: { select: { fullName: true, status: true } },
        },
      },
    },
  });
  return rows.map((row) => ({
    id: row.id,
    reason: row.reason,
    durationMinutes: row.durationMinutes,
    status: row.status,
    codeExpiresAt: row.codeExpiresAt,
    rejectionReason: row.rejectionReason,
    createdAt: row.createdAt,
    decidedAt: row.decidedAt,
    company: row.company,
    requestedBy: row.platformUser.fullName,
    isOwn: row.platformUserId === actor.platformUserId,
    decidedBy: row.decidedBy?.fullName ?? null,
    session: row.session
      ? {
          id: row.session.id,
          mode: row.session.mode,
          startedAt: row.session.startedAt,
          expiresAt: row.session.expiresAt,
          revokedAt: row.session.revokedAt,
          endedAt: row.session.endedAt,
          writeStatus: row.session.writeStatus,
          isLive: isSupportSessionLive(row.session),
        }
      : null,
  }));
}

/**
 * PLAT-011: a short-lived, single-use token the operator's browser exchanges
 * for a support-session sign-in. Only the operator who raised the request
 * can open its session, and only while it's live.
 */
export async function createSupportSessionExchangeToken(actor: PlatformActor, requestId: string) {
  assertCanRequest(actor);
  const session = await prisma.supportAccessSession.findUnique({ where: { requestId }, select: { id: true, platformUserId: true } });
  if (!session || session.platformUserId !== actor.platformUserId) {
    throw new BusinessRuleError("NOT_FOUND", "No approved support session found for this request.");
  }
  const live = await getLiveSupportSession(session.id);
  if (!live) throw new BusinessRuleError("INVALID_STATE_TRANSITION", "This support session has ended or expired.");

  const token = generateExchangeToken();
  await prisma.supportAccessSession.update({
    where: { id: session.id },
    data: {
      exchangeTokenHash: hashExchangeToken(token),
      exchangeTokenExpiresAt: new Date(Date.now() + EXCHANGE_TOKEN_TTL_SECONDS * 1000),
    },
  });
  return { token };
}

// ---------------------------------------------------------------------------
// Customer side (PLAT-010, PLAT-013, PLAT-014)
// ---------------------------------------------------------------------------

/** Only the customer company's own Super Admin decides on support access. */
export async function isCompanySupportAdmin(actor: TenantActor): Promise<boolean> {
  const count = await prisma.userBranchRole.count({
    where: {
      userId: actor.userId,
      role: { name: "SUPER_ADMIN", companyId: actor.companyId },
      user: { companyId: actor.companyId, supportForPlatformUserId: null, status: "ACTIVE" },
    },
  });
  return count > 0;
}

async function assertCompanySupportAdmin(actor: TenantActor) {
  if (!(await isCompanySupportAdmin(actor))) {
    throw new BusinessRuleError("PERMISSION_DENIED", "Only your company's Super Admin can manage support access.");
  }
}

export async function listCompanySupportAccess(actor: TenantActor) {
  await assertCompanySupportAdmin(actor);
  await expireStalePendingRequests({ companyId: actor.companyId });
  const rows = await prisma.supportAccessRequest.findMany({
    where: { companyId: actor.companyId },
    orderBy: { createdAt: "desc" },
    take: 100,
    select: {
      id: true,
      reason: true,
      durationMinutes: true,
      status: true,
      codeExpiresAt: true,
      failedAttempts: true,
      rejectionReason: true,
      createdAt: true,
      decidedAt: true,
      platformUser: { select: { fullName: true, email: true, status: true } },
      decidedBy: { select: { fullName: true } },
      session: {
        select: {
          id: true,
          mode: true,
          startedAt: true,
          expiresAt: true,
          revokedAt: true,
          endedAt: true,
          lastAccessedAt: true,
          writeStatus: true,
          writeJustification: true,
          writeCodeExpiresAt: true,
          writeRequestedAt: true,
          request: { select: { status: true } },
          company: { select: { name: true, isActive: true } },
          platformUser: { select: { fullName: true, status: true } },
          revokedBy: { select: { fullName: true } },
          writeDecidedBy: { select: { fullName: true } },
        },
      },
    },
  });
  return rows.map((row) => {
    const session = row.session;
    return {
      id: row.id,
      reason: row.reason,
      durationMinutes: row.durationMinutes,
      status: row.status,
      codeExpiresAt: row.codeExpiresAt,
      attemptsLeft: Math.max(0, MAX_CODE_ATTEMPTS - row.failedAttempts),
      rejectionReason: row.rejectionReason,
      createdAt: row.createdAt,
      decidedAt: row.decidedAt,
      requestedBy: { name: row.platformUser.fullName, email: row.platformUser.email },
      decidedBy: row.decidedBy?.fullName ?? null,
      session: session
        ? {
            id: session.id,
            mode: session.mode,
            startedAt: session.startedAt,
            expiresAt: session.expiresAt,
            revokedAt: session.revokedAt,
            revokedBy: session.revokedBy?.fullName ?? null,
            endedAt: session.endedAt,
            lastAccessedAt: session.lastAccessedAt,
            writeStatus: session.writeStatus,
            writeJustification: session.writeJustification,
            writeCodeExpiresAt: session.writeCodeExpiresAt,
            writeRequestedAt: session.writeRequestedAt,
            writeDecidedBy: session.writeDecidedBy?.fullName ?? null,
            isLive: isSupportSessionLive(session),
          }
        : null,
    };
  });
}

/** Pending items the company's Super Admin should act on (drives the banner). */
export async function countPendingSupportItems(actor: TenantActor): Promise<number> {
  if (!(await isCompanySupportAdmin(actor))) return 0;
  const now = new Date();
  const [requests, writeRequests] = await Promise.all([
    prisma.supportAccessRequest.count({ where: { companyId: actor.companyId, status: "PENDING", codeExpiresAt: { gt: now } } }),
    prisma.supportAccessSession.count({
      where: {
        companyId: actor.companyId,
        writeStatus: "PENDING",
        writeCodeExpiresAt: { gt: now },
        revokedAt: null,
        endedAt: null,
        expiresAt: { gt: now },
      },
    }),
  ]);
  return requests + writeRequests;
}

/** One proxy user per (company, operator), reused across sessions. */
async function upsertProxyUserInTx(tx: Tx, companyId: string, platformUserId: string) {
  const operator = await tx.platformUser.findUniqueOrThrow({ where: { id: platformUserId }, select: { fullName: true } });
  const fullName = `Support — ${operator.fullName}`;
  const existing = await tx.user.findUnique({
    where: { companyId_supportForPlatformUserId: { companyId, supportForPlatformUserId: platformUserId } },
    select: { id: true },
  });
  if (existing) {
    return tx.user.update({ where: { id: existing.id }, data: { fullName, status: "ACTIVE" }, select: { id: true } });
  }
  return tx.user.create({
    data: {
      companyId,
      supportForPlatformUserId: platformUserId,
      email: `support.${platformUserId}.${companyId}@support.invalid`,
      // Not a bcrypt hash — can never match a password. The proxy user can
      // also never sign in at /login (authenticateTenantUser refuses it).
      passwordHash: `!support-proxy:${randomBytes(16).toString("hex")}`,
      fullName,
      status: "ACTIVE",
    },
    select: { id: true },
  });
}

async function recordFailedCode(
  kind: "access" | "write",
  id: string,
  requestId: string,
  actor: TenantActor,
  attemptsSoFar: number
): Promise<never> {
  const attempts = attemptsSoFar + 1;
  const locked = attempts >= MAX_CODE_ATTEMPTS;
  await prisma.$transaction(async (tx) => {
    if (kind === "access") {
      await tx.supportAccessRequest.update({
        where: { id },
        data: { failedAttempts: { increment: 1 }, ...(locked ? { status: "LOCKED" } : {}) },
      });
    } else {
      await tx.supportAccessSession.update({
        where: { id },
        data: { writeFailedAttempts: { increment: 1 }, ...(locked ? { writeStatus: "LOCKED" } : {}) },
      });
    }
    const prefix = kind === "access" ? "REQUEST" : "WRITE";
    await event(tx, requestId, `${prefix}_CODE_FAILED`, "TENANT_USER", actor.userId, { attempts });
    if (locked) await event(tx, requestId, `${prefix}_LOCKED`, "SYSTEM", null);
  });
  if (locked) {
    throw new BusinessRuleError(
      "INVALID_STATE_TRANSITION",
      "Too many incorrect codes. This request is now locked — support must raise a new one."
    );
  }
  throw new BusinessRuleError(
    "VALIDATION_ERROR",
    `Incorrect code. ${MAX_CODE_ATTEMPTS - attempts} attempt(s) left.`
  );
}

export async function approveSupportRequest(actor: TenantActor, requestId: string, code: string) {
  await assertCompanySupportAdmin(actor);
  const request = await prisma.supportAccessRequest.findFirst({ where: { id: requestId, companyId: actor.companyId } });
  if (!request) throw new BusinessRuleError("NOT_FOUND", "Support request not found.");
  if (request.status === "PENDING" && request.codeExpiresAt.getTime() <= Date.now()) {
    await expireStalePendingRequests({ id: requestId });
    throw new BusinessRuleError("INVALID_STATE_TRANSITION", "This request's code has expired. Ask support for a new request.");
  }
  if (request.status !== "PENDING") {
    throw new BusinessRuleError("INVALID_STATE_TRANSITION", `This request is ${request.status.toLowerCase()} and can't be approved.`);
  }
  if (!verificationCodeMatches("access", request.id, code, request.codeHash)) {
    return recordFailedCode("access", request.id, request.id, actor, request.failedAttempts);
  }

  const session = await prisma.$transaction(async (tx) => {
    const updated = await tx.supportAccessRequest.updateMany({
      where: { id: request.id, status: "PENDING" },
      data: { status: "APPROVED", decidedByUserId: actor.userId, decidedAt: new Date() },
    });
    if (updated.count !== 1) {
      throw new BusinessRuleError("INVALID_STATE_TRANSITION", "This request was already decided.");
    }
    const proxy = await upsertProxyUserInTx(tx, request.companyId, request.platformUserId);
    const created = await tx.supportAccessSession.create({
      data: {
        requestId: request.id,
        companyId: request.companyId,
        platformUserId: request.platformUserId,
        proxyUserId: proxy.id,
        mode: "READ_ONLY",
        expiresAt: minutesFromNow(Math.min(request.durationMinutes, MAX_SUPPORT_SESSION_MINUTES)),
      },
      select: { id: true, expiresAt: true, mode: true },
    });
    await event(tx, request.id, "REQUEST_APPROVED", "TENANT_USER", actor.userId, {
      sessionId: created.id,
      mode: created.mode,
      expiresAt: created.expiresAt.toISOString(),
    });
    return created;
  });
  return session;
}

export async function rejectSupportRequest(actor: TenantActor, requestId: string, reason?: string) {
  await assertCompanySupportAdmin(actor);
  const request = await prisma.supportAccessRequest.findFirst({ where: { id: requestId, companyId: actor.companyId }, select: { id: true } });
  if (!request) throw new BusinessRuleError("NOT_FOUND", "Support request not found.");
  await prisma.$transaction(async (tx) => {
    const updated = await tx.supportAccessRequest.updateMany({
      where: { id: requestId, status: "PENDING" },
      data: { status: "REJECTED", decidedByUserId: actor.userId, decidedAt: new Date(), rejectionReason: reason || null },
    });
    if (updated.count !== 1) {
      throw new BusinessRuleError("INVALID_STATE_TRANSITION", "Only a pending request can be rejected.");
    }
    await event(tx, requestId, "REQUEST_REJECTED", "TENANT_USER", actor.userId, { reason: reason || null });
  });
}

async function findCompanySession(actor: TenantActor, sessionId: string) {
  const session = await prisma.supportAccessSession.findFirst({ where: { id: sessionId, companyId: actor.companyId } });
  if (!session) throw new BusinessRuleError("NOT_FOUND", "Support session not found.");
  return session;
}

/** PLAT-014: instant revocation — the very next request in the session fails. */
export async function revokeSupportSession(actor: TenantActor, sessionId: string) {
  await assertCompanySupportAdmin(actor);
  const session = await findCompanySession(actor, sessionId);
  await prisma.$transaction(async (tx) => {
    const updated = await tx.supportAccessSession.updateMany({
      where: { id: session.id, revokedAt: null, endedAt: null },
      data: { revokedAt: new Date(), revokedByUserId: actor.userId, exchangeTokenHash: null, exchangeTokenExpiresAt: null },
    });
    if (updated.count !== 1) throw new BusinessRuleError("INVALID_STATE_TRANSITION", "This session has already ended.");
    await event(tx, session.requestId, "SESSION_REVOKED", "TENANT_USER", actor.userId);
  });
  PermissionService.invalidate(session.proxyUserId);
}

export async function approveWriteAccess(actor: TenantActor, sessionId: string, code: string) {
  await assertCompanySupportAdmin(actor);
  const session = await findCompanySession(actor, sessionId);
  if (!(await getLiveSupportSession(session.id))) {
    throw new BusinessRuleError("INVALID_STATE_TRANSITION", "This support session has ended.");
  }
  if (session.writeStatus !== "PENDING" || !session.writeCodeHash || !session.writeCodeExpiresAt) {
    throw new BusinessRuleError("INVALID_STATE_TRANSITION", "There's no pending write-access request for this session.");
  }
  if (session.writeCodeExpiresAt.getTime() <= Date.now()) {
    throw new BusinessRuleError("INVALID_STATE_TRANSITION", "The write-access code has expired. Support must request it again.");
  }
  if (!verificationCodeMatches("write", session.id, code, session.writeCodeHash)) {
    return recordFailedCode("write", session.id, session.requestId, actor, session.writeFailedAttempts);
  }
  await prisma.$transaction(async (tx) => {
    const updated = await tx.supportAccessSession.updateMany({
      where: { id: session.id, writeStatus: "PENDING" },
      data: {
        mode: "READ_WRITE",
        writeStatus: "APPROVED",
        writeDecidedAt: new Date(),
        writeDecidedByUserId: actor.userId,
        writeCodeHash: null,
      },
    });
    if (updated.count !== 1) throw new BusinessRuleError("INVALID_STATE_TRANSITION", "This write request was already decided.");
    await event(tx, session.requestId, "WRITE_APPROVED", "TENANT_USER", actor.userId);
  });
  PermissionService.invalidate(session.proxyUserId);
}

export async function rejectWriteAccess(actor: TenantActor, sessionId: string, reason?: string) {
  await assertCompanySupportAdmin(actor);
  const session = await findCompanySession(actor, sessionId);
  await prisma.$transaction(async (tx) => {
    const updated = await tx.supportAccessSession.updateMany({
      where: { id: session.id, writeStatus: "PENDING" },
      data: { writeStatus: "REJECTED", writeDecidedAt: new Date(), writeDecidedByUserId: actor.userId, writeCodeHash: null },
    });
    if (updated.count !== 1) throw new BusinessRuleError("INVALID_STATE_TRANSITION", "There's no pending write-access request.");
    await event(tx, session.requestId, "WRITE_REJECTED", "TENANT_USER", actor.userId, { reason: reason || null });
  });
}

/** PLAT-015: the full event log for one request, with a chain-integrity check. */
export async function getSupportRequestEvents(actor: TenantActor, requestId: string) {
  await assertCompanySupportAdmin(actor);
  const request = await prisma.supportAccessRequest.findFirst({ where: { id: requestId, companyId: actor.companyId }, select: { id: true } });
  if (!request) throw new BusinessRuleError("NOT_FOUND", "Support request not found.");
  const [events, integrity] = await Promise.all([
    prisma.supportAccessEvent.findMany({
      where: { requestId },
      orderBy: { seq: "asc" },
      select: { seq: true, eventType: true, actorType: true, method: true, path: true, detail: true, createdAt: true },
    }),
    verifySupportEventChain(requestId),
  ]);
  return { events, integrity };
}

// ---------------------------------------------------------------------------
// Inside the support session (PLAT-013, PLAT-014)
// ---------------------------------------------------------------------------

async function requireLive(sessionId: string) {
  const live = await getLiveSupportSession(sessionId);
  if (!live) throw new BusinessRuleError("PERMISSION_DENIED", "This support session has ended.");
  return live;
}

export async function getSupportSessionStatus(sessionId: string) {
  const live = await requireLive(sessionId);
  const session = await prisma.supportAccessSession.findUniqueOrThrow({
    where: { id: sessionId },
    select: { writeStatus: true, writeCodeExpiresAt: true, writeJustification: true },
  });
  return {
    sessionId: live.id,
    companyName: live.companyName,
    operatorName: live.platformUserName,
    mode: live.mode,
    expiresAt: live.expiresAt,
    writeStatus: session.writeStatus,
    writeCodeExpiresAt: session.writeCodeExpiresAt,
  };
}

/** Returns the write code ONCE — the operator gives it to the customer. */
export async function requestWriteAccess(sessionId: string, justification: string) {
  const live = await requireLive(sessionId);
  if (live.mode === "READ_WRITE") throw new BusinessRuleError("INVALID_STATE_TRANSITION", "Write access is already approved.");
  if (live.writeStatus === "LOCKED") {
    throw new BusinessRuleError(
      "INVALID_STATE_TRANSITION",
      "Write access was locked after too many incorrect codes. Start a new support request."
    );
  }
  const code = generateVerificationCode();
  const expiresAt = minutesFromNow(WRITE_CODE_TTL_MINUTES);
  await prisma.$transaction(async (tx) => {
    await tx.supportAccessSession.update({
      where: { id: live.id },
      data: {
        writeStatus: "PENDING",
        writeJustification: justification,
        writeCodeHash: hashVerificationCode("write", live.id, code),
        writeCodeExpiresAt: expiresAt,
        writeFailedAttempts: 0,
        writeRequestedAt: new Date(),
        writeDecidedAt: null,
        writeDecidedByUserId: null,
      },
    });
    await event(tx, live.requestId, "WRITE_REQUESTED", "PLATFORM_USER", live.platformUserId, { justification });
  });
  return { code, expiresAt };
}

export async function endSupportSession(sessionId: string) {
  const session = await prisma.supportAccessSession.findUnique({ where: { id: sessionId } });
  if (!session) throw new BusinessRuleError("NOT_FOUND", "Support session not found.");
  await prisma.$transaction(async (tx) => {
    const updated = await tx.supportAccessSession.updateMany({
      where: { id: sessionId, endedAt: null, revokedAt: null },
      data: { endedAt: new Date(), exchangeTokenHash: null, exchangeTokenExpiresAt: null },
    });
    if (updated.count === 1) await event(tx, session.requestId, "SESSION_ENDED", "PLATFORM_USER", session.platformUserId);
  });
  PermissionService.invalidate(session.proxyUserId);
}
