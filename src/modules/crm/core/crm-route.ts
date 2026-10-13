import { NextResponse, type NextRequest } from "next/server";
import type { Action, Module } from "@/config/rbac";
import { PermissionService } from "@/core/rbac/PermissionService";
import { handleApiError, requireSession } from "@/lib/api-route";
import { buildListMeta, type ListQuery } from "@/lib/list-query";
import type { CrmActor } from "./crm-actor";
// Phase 18: after-commit kick so workflows react within seconds (best-effort, see the file).
import "../workflows/workflow-kick";

/** "crm" for records, "crm_settings" for configuration screens. */
export type CrmPermission = Action | { module: Extract<Module, "crm" | "crm_settings">; action: Action };

export interface CrmRouteContext<P> {
  req: NextRequest;
  actor: CrmActor;
  params: P;
}

/**
 * Wraps a CRM API route handler with the ERP's standard checks, in the same
 * order every other module uses: live session check → `crm.<action>`
 * permission → handler → structured error mapping (`handleApiError`).
 *
 *   export const GET = crmRoute("view", async ({ req, actor }) => { ... });
 *   export const PATCH = crmRoute<{ id: string }>("edit", async ({ params, actor }) => { ... });
 *   export const POST = crmRoute({ module: "crm_settings", action: "edit" }, async (...) => { ... });
 *
 * Uses the existing ERP permission module "crm" — the CRM never defines its own
 * permission system. Finer-grained modules can be split out later.
 */
export function crmRoute<P extends Record<string, string | string[]> = Record<string, never>>(
  permission: CrmPermission,
  handler: (ctx: CrmRouteContext<P>) => Promise<Response>

) {
  return async (req: NextRequest, context: { params: Promise<P> }): Promise<Response> => {
    try {
      const session = await requireSession();
      const { module, action } = typeof permission === "string" ? { module: "crm" as const, action: permission } : permission;
      await PermissionService.assert(session.user.id, module, action);
      const params = context?.params ? await context.params : ({} as P);
      const actor: CrmActor = {
        companyId: session.user.companyId,
        userId: session.user.id,
        branchId: session.user.defaultBranchId ?? null,
      };
      return await handler({ req, actor, params });
    } catch (error) {
      return handleApiError(error);
    }
  };
}

/** Standard list response: `{ data, meta }`. */
export function crmListResponse<T>(data: T[], totalCount: number, query: ListQuery) {
  return NextResponse.json({ data, meta: buildListMeta(totalCount, query.page, query.pageSize) });
}
