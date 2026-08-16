import { NextResponse } from "next/server";
import { auth } from "@/core/auth/auth";
import { BusinessRuleError, toErrorResponse } from "@/core/errors/BusinessRuleError";

/**
 * Every API route handler should call this first, then wrap its body in
 * try/catch(handleApiError) — keeps the "who is calling, are they allowed"
 * check and the structured-error contract consistent across all modules.
 */
export async function requireSession() {
  const session = await auth();
  if (!session?.user) {
    throw new BusinessRuleError("PERMISSION_DENIED", "Sign in required.");
  }
  return session;
}

export function handleApiError(error: unknown): NextResponse {
  const { status, body } = toErrorResponse(error);
  return NextResponse.json(body, { status });
}
