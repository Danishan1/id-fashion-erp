import { NextRequest, NextResponse } from "next/server";
import { requireSession, handleApiError } from "@/lib/api-route";
import { PermissionService } from "@/core/rbac/PermissionService";
import { parseListQuery, buildListMeta } from "@/lib/list-query";
import { createProjectSchema } from "@/modules/ai-designer/ai-designer.schema";
import { createProject, listProjects } from "@/modules/ai-designer/ai-designer.service";

const VALID_CREATION_MODES = new Set(["STANDARD", "SKETCH"]);

export async function GET(req: NextRequest) {
  try {
    const session = await requireSession();
    await PermissionService.assert(session.user.id, "ai_designer", "view");

    const query = parseListQuery(req.nextUrl.searchParams, "createdAt");
    const creationModeParam = req.nextUrl.searchParams.get("creationMode");
    const creationMode = creationModeParam && VALID_CREATION_MODES.has(creationModeParam) ? (creationModeParam as "STANDARD" | "SKETCH") : undefined;
    const { data, totalCount } = await listProjects(session.user.companyId, query, creationMode);

    return NextResponse.json({ data, meta: buildListMeta(totalCount, query.page, query.pageSize) });
  } catch (error) {
    return handleApiError(error);
  }
}

export async function POST(req: NextRequest) {
  try {
    const session = await requireSession();
    await PermissionService.assert(session.user.id, "ai_designer", "create");

    const input = createProjectSchema.parse(await req.json());
    const project = await createProject(
      { companyId: session.user.companyId, userId: session.user.id, branchId: session.user.defaultBranchId },
      input
    );

    return NextResponse.json({ data: project }, { status: 201 });
  } catch (error) {
    return handleApiError(error);
  }
}
