import { NextRequest, NextResponse } from "next/server";
import { requireSession, handleApiError } from "@/lib/api-route";
import { PermissionService } from "@/core/rbac/PermissionService";
import { parseListQuery, buildListMeta } from "@/lib/list-query";
import { productSchema } from "@/modules/products/product.schema";
import { listProducts, createProduct } from "@/modules/products/product.service";

export async function GET(req: NextRequest) {
  try {
    const session = await requireSession();
    await PermissionService.assert(session.user.id, "masters_core", "view");

    const query = parseListQuery(req.nextUrl.searchParams, "styleName");
    const params = req.nextUrl.searchParams;
    const isActiveParam = params.get("isActive");
    const { data, totalCount } = await listProducts(session.user.companyId, query, {
      categoryId: params.get("categoryId") || undefined,
      seasonId: params.get("seasonId") || undefined,
      brandId: params.get("brandId") || undefined,
      productTypeId: params.get("productTypeId") || undefined,
      productFittingId: params.get("productFittingId") || undefined,
      isActive: isActiveParam === null ? undefined : isActiveParam === "true",
    });

    return NextResponse.json({ data, meta: buildListMeta(totalCount, query.page, query.pageSize) });
  } catch (error) {
    return handleApiError(error);
  }
}

export async function POST(req: NextRequest) {
  try {
    const session = await requireSession();
    await PermissionService.assert(session.user.id, "masters_core", "create");

    const input = productSchema.parse(await req.json());
    const product = await createProduct({ companyId: session.user.companyId, userId: session.user.id }, input);

    return NextResponse.json({ data: product }, { status: 201 });
  } catch (error) {
    return handleApiError(error);
  }
}
