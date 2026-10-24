import { NextResponse } from "next/server";
import type { Action } from "@/config/rbac";
import { PermissionService } from "@/core/rbac/PermissionService";
import { handleApiError, requireSession } from "@/lib/api-route";
import type { HrmsModule } from "./hrms-scope";

export interface HrmsRouteActor {
  companyId: string;
  userId: string;
  branchId: string | null;
}

/**
 * Shared wrapper for the attendance-module API routes: session, one
 * permission check, the handler, and the standard error envelope.
 * `actions` may list several — the caller needs any one of them.
 */
export async function hrmsRoute(
  module: HrmsModule,
  actions: Action | Action[],
  run: (actor: HrmsRouteActor) => Promise<unknown>,
  status = 200
) {
  try {
    const session = await requireSession();
    const list = Array.isArray(actions) ? actions : [actions];
    let allowed = false;
    for (const action of list) {
      if (await PermissionService.can(session.user.id, module, action)) {
        allowed = true;
        break;
      }
    }
    if (!allowed) await PermissionService.assert(session.user.id, module, list[0]);
    const data = await run({ companyId: session.user.companyId, userId: session.user.id, branchId: session.user.defaultBranchId ?? null });
    if (data instanceof Response) return data;
    return NextResponse.json({ data }, { status });
  } catch (error) {
    return handleApiError(error);
  }
}
