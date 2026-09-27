import { NextRequest, NextResponse } from "next/server";
import { requireSession, handleApiError } from "@/lib/api-route";
import { PermissionService } from "@/core/rbac/PermissionService";
import { createNewDesignSchema } from "@/modules/ai-designer/new-design.schema";
import { createNewDesignProject } from "@/modules/ai-designer/new-design.service";

/** Starts a 4-step New Design project (Step 1's tab choice: Fabric / Garment / Sketch). */
export async function POST(req: NextRequest) {
  try {
    const session = await requireSession();
    await PermissionService.assert(session.user.id, "ai_designer", "create");
    const input = createNewDesignSchema.parse(await req.json());
    const project = await createNewDesignProject(
      { companyId: session.user.companyId, userId: session.user.id, branchId: session.user.defaultBranchId },
      input
    );
    return NextResponse.json({ data: project }, { status: 201 });
  } catch (error) {
    return handleApiError(error);
  }
}
