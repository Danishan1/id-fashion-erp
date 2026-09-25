import { NextResponse } from "next/server";
import { requireSession, handleApiError } from "@/lib/api-route";
import { getSubmoduleVisibilityMap } from "@/core/submodule-visibility/SubmoduleVisibilityService";

// Cross-cutting, no-module-gated lookup -- same pattern as /api/v1/branches
// and /api/v1/currencies. Every authenticated user filling a Goods
// Receipt/Sampling/Material Request form needs this to know which fields
// to show, regardless of their "administration_settings" grant.
export async function GET() {
  try {
    const session = await requireSession();
    const map = await getSubmoduleVisibilityMap(session.user.companyId);
    return NextResponse.json({ data: map });
  } catch (error) {
    return handleApiError(error);
  }
}
