import { NextRequest, NextResponse } from "next/server";
import { requireSession, handleApiError } from "@/lib/api-route";
import { PermissionService } from "@/core/rbac/PermissionService";
import { BusinessRuleError } from "@/core/errors/BusinessRuleError";
import { getEffectiveDesignAttributesForCategory } from "@/modules/ai-designer/ai-designer-attribute-master.service";

/** The wizard's own Product Design step — this company's real master rows for the category once any exist, else the built-in default. */
export async function GET(req: NextRequest) {
  try {
    const session = await requireSession();
    await PermissionService.assert(session.user.id, "ai_designer", "view");

    const category = req.nextUrl.searchParams.get("category");
    if (!category) throw new BusinessRuleError("VALIDATION_ERROR", "A category is required.");

    const data = await getEffectiveDesignAttributesForCategory(session.user.companyId, category);
    return NextResponse.json({ data });
  } catch (error) {
    return handleApiError(error);
  }
}
