import type { NextRequest } from "next/server";
import type { Action, Module } from "@/config/rbac";
import { PermissionService } from "@/core/rbac/PermissionService";
import { handleApiError, requireSession } from "@/lib/api-route";
import type { SalesActor } from "./enquiries/sales-enquiry.service";

export interface SalesMarketingRouteContext<P> {
  req: NextRequest;
  actor: SalesActor;
  params: P;
}

/**
 * Wraps a Sales & Marketing API route: live session → `<module>.<action>`
 * (`sales_marketing` unless a module is given, e.g. `sales_quotations`)
 * → handler → structured error mapping. Same order as every other module
 * (and as crmRoute, which this mirrors).
 */
export function salesMarketingRoute<P extends Record<string, string | string[]> = Record<string, never>>(
  permission: Action | { module: Extract<Module, "sales_marketing" | "sales_quotations">; action: Action },
  handler: (ctx: SalesMarketingRouteContext<P>) => Promise<Response>
) {
  return async (req: NextRequest, context: { params: Promise<P> }): Promise<Response> => {
    try {
      const session = await requireSession();
      const { module, action } = typeof permission === "string" ? { module: "sales_marketing" as const, action: permission } : permission;
      await PermissionService.assert(session.user.id, module, action);
      const params = context?.params ? await context.params : ({} as P);
      const actor: SalesActor = {
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
