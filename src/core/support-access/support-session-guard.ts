import type { SupportAccessMode } from "@prisma/client";
import { prisma } from "@/core/db/client";
import { MODULES, permissionKey, type Action, type Module } from "@/config/rbac";

/**
 * Live validity of a customer-approved support session (Platform SaaS
 * Phase 2, PLAT-011/012/014). Every check is done against the database on
 * every call — never trusted from the JWT — so a customer's Revoke, the
 * session's expiry, a suspended company, or a deactivated platform operator
 * take effect on the very next request.
 */

export interface LiveSupportSession {
  id: string;
  requestId: string;
  companyId: string;
  companyName: string;
  platformUserId: string;
  platformUserName: string;
  proxyUserId: string;
  mode: SupportAccessMode;
  expiresAt: Date;
  writeStatus: string;
}

const SESSION_SELECT = {
  id: true,
  requestId: true,
  companyId: true,
  platformUserId: true,
  proxyUserId: true,
  mode: true,
  expiresAt: true,
  revokedAt: true,
  endedAt: true,
  writeStatus: true,
  request: { select: { status: true } },
  company: { select: { name: true, isActive: true } },
  platformUser: { select: { fullName: true, status: true } },
} as const;

type SessionRow = {
  id: string;
  requestId: string;
  companyId: string;
  platformUserId: string;
  proxyUserId: string;
  mode: SupportAccessMode;
  expiresAt: Date;
  revokedAt: Date | null;
  endedAt: Date | null;
  writeStatus: string;
  request: { status: string };
  company: { name: string; isActive: boolean };
  platformUser: { fullName: string; status: string };
};

/** Only the fields that decide whether a session is live. */
export type SupportSessionLiveness = Pick<SessionRow, "revokedAt" | "endedAt" | "expiresAt"> & {
  request: { status: string };
  company: { isActive: boolean };
  platformUser: { status: string };
};

export function isSupportSessionLive(row: SupportSessionLiveness, now = new Date()): boolean {
  return (
    !row.revokedAt &&
    !row.endedAt &&
    row.expiresAt.getTime() > now.getTime() &&
    row.request.status === "APPROVED" &&
    row.company.isActive &&
    row.platformUser.status === "ACTIVE"
  );
}

function toLive(row: SessionRow): LiveSupportSession {
  return {
    id: row.id,
    requestId: row.requestId,
    companyId: row.companyId,
    companyName: row.company.name,
    platformUserId: row.platformUserId,
    platformUserName: row.platformUser.fullName,
    proxyUserId: row.proxyUserId,
    mode: row.mode,
    expiresAt: row.expiresAt,
    writeStatus: row.writeStatus,
  };
}

export async function getLiveSupportSession(sessionId: string): Promise<LiveSupportSession | null> {
  const row = await prisma.supportAccessSession.findUnique({ where: { id: sessionId }, select: SESSION_SELECT });
  return row && isSupportSessionLive(row) ? toLive(row) : null;
}

/** The live session a proxy user is currently acting under, if any. */
export async function getLiveSupportSessionForProxyUser(proxyUserId: string): Promise<LiveSupportSession | null> {
  const rows = await prisma.supportAccessSession.findMany({
    where: { proxyUserId, revokedAt: null, endedAt: null, expiresAt: { gt: new Date() } },
    select: SESSION_SELECT,
    orderBy: { startedAt: "desc" },
    take: 1,
  });
  const row = rows[0];
  return row && isSupportSessionLive(row) ? toLive(row) : null;
}

// ---------------------------------------------------------------------------
// What a support session may do (PLAT-012/013)
// ---------------------------------------------------------------------------

/** Read-only (the default): look and print. Export deliberately excluded —
 * support must not take bulk copies of customer data out of the system. */
export const SUPPORT_READ_ACTIONS: readonly Action[] = ["view", "view_all", "print"];

/** Added only after the customer separately approves write access. Never
 * approve/post/delete/reject/override — those stay with the customer's own
 * staff (financial postings and approvals must not be made by support). */
export const SUPPORT_WRITE_ACTIONS: readonly Action[] = ["create", "edit", "cancel", "scan"];

/** Modules support can only ever read, even in a write session — support
 * must never change who can access the customer's ERP or its settings. */
export const SUPPORT_READ_ONLY_MODULES: readonly Module[] = [
  "administration_users",
  "administration_roles",
  "administration_settings",
];

export function supportPermissionKeys(mode: SupportAccessMode): Set<string> {
  const keys = new Set<string>();
  for (const mod of MODULES) {
    for (const action of SUPPORT_READ_ACTIONS) keys.add(permissionKey(mod, action));
    if (mode === "READ_WRITE" && !SUPPORT_READ_ONLY_MODULES.includes(mod)) {
      for (const action of SUPPORT_WRITE_ACTIONS) keys.add(permissionKey(mod, action));
    }
  }
  return keys;
}

// ---------------------------------------------------------------------------
// Request filtering for support sessions (used by the proxy)
// ---------------------------------------------------------------------------

/** API paths a support session may call in any mode: sign-in/out and its own
 * support-session controls (status, end, request write access). */
export function isSupportControlPath(pathname: string): boolean {
  return pathname.startsWith("/api/auth/") || pathname.startsWith("/api/v1/support-session/");
}

const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

/** PLAT-012: in a read-only session every state-changing API call is refused. */
export function isMethodAllowedForSupport(mode: SupportAccessMode, method: string, pathname: string): boolean {
  if (SAFE_METHODS.has(method.toUpperCase())) return true;
  if (isSupportControlPath(pathname)) return true;
  return mode === "READ_WRITE";
}
