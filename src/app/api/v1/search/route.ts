import { NextRequest, NextResponse } from "next/server";
import { requireSession, handleApiError } from "@/lib/api-route";
import { searchGlobal } from "@/modules/search/global-search.service";

/**
 * Topbar Global Search. Deliberately gated on `requireSession()` alone, with
 * no single `PermissionService.assert(..., "view")` at this route level —
 * unlike a normal single-module list endpoint, this one spans ten different
 * RBAC modules, and `searchGlobal()` itself decides which of them a given
 * user may even query (via `getViewableModules`), skipping the rest before
 * ever running their query. Same "no one module to gate on, real scoping
 * happens inside" shape as `/api/v1/branches`/`/api/v1/submodule-visibility`.
 */
export async function GET(req: NextRequest) {
  try {
    const session = await requireSession();
    const term = req.nextUrl.searchParams.get("q") ?? "";
    const result = await searchGlobal({ userId: session.user.id, companyId: session.user.companyId }, term);
    return NextResponse.json({ data: result });
  } catch (error) {
    return handleApiError(error);
  }
}
