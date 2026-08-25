import { NextResponse } from "next/server";
import { auth } from "@/core/auth/auth";
import { prisma } from "@/core/db/client";
import { BusinessRuleError, toErrorResponse } from "@/core/errors/BusinessRuleError";
import { initRequestContext, setRequestActor } from "@/core/logging/requestContext";

/**
 * Every API route handler should call this first, then wrap its body in
 * try/catch(handleApiError) — keeps the "who is calling, are they allowed"
 * check and the structured-error contract consistent across all modules.
 *
 * Re-checks the user's live DB status on every call rather than trusting the
 * JWT alone — a handful of routes are gated on session presence only, with no
 * follow-up PermissionService call (self-scoped/reference-data lookups), so
 * this is the one place that guarantees a suspended user's session stops
 * working everywhere, not just on routes that happen to assert a permission.
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
  const user = await prisma.user.findUnique({ where: { id: session.user.id }, select: { status: true } });
  if (!user || user.status !== "ACTIVE") {
    throw new BusinessRuleError("PERMISSION_DENIED", "Your account is no longer active. Please sign in again.");
  }
  setRequestActor(session.user.id, session.user.companyId);
  return session;
}

export function handleApiError(error: unknown): NextResponse {
  const { status, body } = toErrorResponse(error);
  return NextResponse.json(body, { status });
}
