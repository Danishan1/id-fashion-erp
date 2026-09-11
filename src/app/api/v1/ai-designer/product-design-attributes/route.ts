import { NextRequest, NextResponse } from "next/server";
import { requireSession, handleApiError } from "@/lib/api-route";
import { PermissionService } from "@/core/rbac/PermissionService";
import { createProductDesignAttributeSchema } from "@/modules/ai-designer/ai-designer-attribute-master.schema";
import { createProductDesignAttribute, listProductDesignAttributes } from "@/modules/ai-designer/ai-designer-attribute-master.service";

/** Masters -> AI Design -> Product Design. */
export async function GET() {
  try {
    const session = await requireSession();
    await PermissionService.assert(session.user.id, "ai_designer", "view");

    const data = await listProductDesignAttributes(session.user.companyId);
    return NextResponse.json({ data });
  } catch (error) {
    return handleApiError(error);
  }
}

export async function POST(req: NextRequest) {
  try {
    const session = await requireSession();
    await PermissionService.assert(session.user.id, "ai_designer", "create");

    const input = createProductDesignAttributeSchema.parse(await req.json());
    const attribute = await createProductDesignAttribute({ companyId: session.user.companyId, userId: session.user.id }, input);

    return NextResponse.json({ data: attribute }, { status: 201 });
  } catch (error) {
    return handleApiError(error);
  }
}
