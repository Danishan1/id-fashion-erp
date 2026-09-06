import { NextRequest, NextResponse } from "next/server";
import { requireSession, handleApiError } from "@/lib/api-route";
import { PermissionService } from "@/core/rbac/PermissionService";
import { parseListQuery, buildListMeta } from "@/lib/list-query";
import { aiGarmentProjectSchema } from "@/modules/ai-garment-flow/ai-garment-project.schema";
import { createAiGarmentProject, listAiGarmentProjects } from "@/modules/ai-garment-flow/ai-garment-project.service";

export async function GET(req: NextRequest) {
  try {
    const session = await requireSession();
    await PermissionService.assert(session.user.id, "ai_garment_flow", "view");

    const query = parseListQuery(req.nextUrl.searchParams, "createdAt");
    const params = req.nextUrl.searchParams;
    const { data, totalCount } = await listAiGarmentProjects(session.user.companyId, query, {
      status: (params.get("status") as never) || undefined,
      sourceType: (params.get("sourceType") as never) || undefined,
      customerId: params.get("customerId") || undefined,
      brandId: params.get("brandId") || undefined,
      seasonId: params.get("seasonId") || undefined,
      categoryId: params.get("categoryId") || undefined,
      createdByUserId: params.get("createdByUserId") || undefined,
    });

    return NextResponse.json({ data, meta: buildListMeta(totalCount, query.page, query.pageSize) });
  } catch (error) {
    return handleApiError(error);
  }
}

export async function POST(req: NextRequest) {
  try {
    const session = await requireSession();
    await PermissionService.assert(session.user.id, "ai_garment_flow", "create");

    const input = aiGarmentProjectSchema.parse(await req.json());
    const project = await createAiGarmentProject(
      { companyId: session.user.companyId, userId: session.user.id, branchId: session.user.defaultBranchId },
      input
    );

    return NextResponse.json({ data: project }, { status: 201 });
  } catch (error) {
    return handleApiError(error);
  }
}
