import { NextRequest, NextResponse } from "next/server";
import { requireSession, handleApiError } from "@/lib/api-route";
import { PermissionService } from "@/core/rbac/PermissionService";
import { updateProductDesignAttributeSchema } from "@/modules/ai-designer/ai-designer-attribute-master.schema";
import { updateProductDesignAttribute } from "@/modules/ai-designer/ai-designer-attribute-master.service";

interface RouteContext {
  params: Promise<{ id: string }>;
}

export async function PATCH(req: NextRequest, { params }: RouteContext) {
  try {
    const session = await requireSession();
    await PermissionService.assert(session.user.id, "ai_designer", "edit");

    const { id } = await params;
    const input = updateProductDesignAttributeSchema.parse(await req.json());
    const attribute = await updateProductDesignAttribute({ companyId: session.user.companyId, userId: session.user.id }, id, input);

    return NextResponse.json({ data: attribute });
  } catch (error) {
    return handleApiError(error);
  }
}
