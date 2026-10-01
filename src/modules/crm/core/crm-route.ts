import { NextResponse, type NextRequest } from "next/server";
import type { Action } from "@/config/rbac";
import { PermissionService } from "@/core/rbac/PermissionService";
import { handleApiError, requireSession } from "@/lib/api-route";
import { buildListMeta, type ListQuery } from "@/lib/list-query";
import type { CrmActor } from "./crm-actor";

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
 *
 * Uses the existing ERP permission module "crm" — the CRM never defines its own
 * permission system. Finer-grained modules can be split out later.
 */
export function crmRoute<P extends Record<string, string> = Record<string, never>>(
  action: Action,
  handler: (ctx: CrmRouteContext<P>) => Promise<Response>
) {
  return async (req: NextRequest, context: { params: Promise<P> }): Promise<Response> => {
    try {
      const session = await requireSession();
      await PermissionService.assert(session.user.id, "crm", action);
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
