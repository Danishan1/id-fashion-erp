import { NextRequest, NextResponse } from "next/server";
import { requireSession, handleApiError } from "@/lib/api-route";
import { PermissionService } from "@/core/rbac/PermissionService";
import { parseListQuery, buildListMeta } from "@/lib/list-query";
import { materialSchema } from "@/modules/products/product.schema";
import { listMaterials, createMaterial } from "@/modules/products/product.service";

export async function GET(req: NextRequest) {
  try {
    const session = await requireSession();
    await PermissionService.assert(session.user.id, "masters", "view");

    const query = parseListQuery(req.nextUrl.searchParams, "styleName");
    const { data, totalCount } = await listMaterials(session.user.companyId, query);

    return NextResponse.json({ data, meta: buildListMeta(totalCount, query.page, query.pageSize) });
  } catch (error) {
    return handleApiError(error);
  }
}

export async function POST(req: NextRequest) {
  try {
    const session = await requireSession();
    await PermissionService.assert(session.user.id, "masters", "create");

    const input = materialSchema.parse(await req.json());
    const material = await createMaterial({ companyId: session.user.companyId, userId: session.user.id }, input);

    return NextResponse.json({ data: material }, { status: 201 });
  } catch (error) {
    return handleApiError(error);
  }
}
