import { NextResponse } from "next/server";
import type { Action } from "@/config/rbac";
import { PermissionService } from "@/core/rbac/PermissionService";
import { handleApiError, requireSession } from "@/lib/api-route";
import { hrmsModuleList, type HrmsModules } from "./hrms-scope";

export interface HrmsRouteActor {
  companyId: string;
  userId: string;
  branchId: string | null;
}

/**
 * Shared wrapper for the attendance-module API routes: session, one
 * permission check, the handler, and the standard error envelope.
 * `modules` and `actions` may each list several — the caller needs any one
 * action on any one module (an API shared by several screens lists them all).
 */
export async function hrmsRoute(
  modules: HrmsModules,
  actions: Action | Action[],
  run: (actor: HrmsRouteActor) => Promise<unknown>,
  status = 200
) {
  try {
    const session = await requireSession();
    const list = Array.isArray(actions) ? actions : [actions];
    const moduleList = hrmsModuleList(modules);
    let allowed = false;
    outer: for (const mod of moduleList) {
      for (const action of list) {
        if (await PermissionService.can(session.user.id, mod, action)) {
          allowed = true;
          break outer;
        }
      }
    }
    if (!allowed) await PermissionService.assert(session.user.id, moduleList[0], list[0]);
    const data = await run({ companyId: session.user.companyId, userId: session.user.id, branchId: session.user.defaultBranchId ?? null });
    if (data instanceof Response) return data;
    return NextResponse.json({ data }, { status });
  } catch (error) {
    return handleApiError(error);
  }
}
