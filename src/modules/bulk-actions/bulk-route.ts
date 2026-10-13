import type { NextRequest } from "next/server";
import { BusinessRuleError } from "@/core/errors/BusinessRuleError";
import { handleApiError, requireSession } from "@/lib/api-route";
import type { BulkActor } from "./bulk-types";

/**
 * Route wrapper for the bulk engine's own endpoints: live session check +
 * structured errors. Permissions are not checked here because they depend on
 * the entity type / action / job — the service checks them (registry
 * permissions, entity view + admin permissions) for every call.
 */
export function bulkRoute<P extends Record<string, string | string[]> = Record<string, never>>(handler: (ctx: { req: NextRequest; actor: BulkActor; params: P }) => Promise<Response>) {
  return async (req: NextRequest, context: { params: Promise<P> }): Promise<Response> => {
    try {
      const session = await requireSession();
      const actor: BulkActor = { companyId: session.user.companyId, userId: session.user.id, branchId: session.user.defaultBranchId ?? null };
      const params = context?.params ? await context.params : ({} as P);
      return await handler({ req, actor, params });
    } catch (error) {
      return handleApiError(error);
    }
  };
}

export async function readJsonBody(req: Request): Promise<unknown> {
  const text = await req.text();
  if (!text) return {};
  if (text.length > 1_000_000) throw new BusinessRuleError("PAYLOAD_TOO_LARGE", "The request is too large. Use \"all matching the filter\" instead of sending ids.");
  try {
    return JSON.parse(text);
  } catch {
    throw new BusinessRuleError("VALIDATION_ERROR", "The request body is not valid JSON.");
  }
}
