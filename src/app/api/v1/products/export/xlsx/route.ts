import { NextRequest, NextResponse } from "next/server";
import { requireSession, handleApiError } from "@/lib/api-route";
import { PermissionService } from "@/core/rbac/PermissionService";
import { buildXlsxBuffer, xlsxResponseHeaders } from "@/lib/xlsx";
import { listProducts } from "@/modules/products/product.service";
import { EXPORT_ROW_CAP_EXCEL as EXPORT_ROW_CAP } from "@/core/reports/constants";

// listProducts()'s return type resolves too widely for TS to statically see
// the repository's own `include` (a pre-existing quirk of the
// `Omit<FindManyArgs, "where"> & spread` repository pattern used throughout
// this codebase — every other current caller passes the result straight to
// `NextResponse.json()` without accessing these fields at the type level,
// so this is the first caller to actually hit it). The fields below are
// confirmed present at runtime by `ProductRepository.findManyStyles`'s own
// `include` — asserting the real shape here, not inventing new data.
interface ProductExportRow {
  styleCode: string;
  styleName: string;
  category: { name: string } | null;
  season: { name: string } | null;
  brand: { name: string } | null;
  productType: { name: string } | null;
  productFitting: { name: string } | null;
  isActive: boolean;
  _count: { variants: number };
}

export async function GET(req: NextRequest) {
  try {
    const session = await requireSession();
    await PermissionService.assert(session.user.id, "masters_core", "export");

    const params = req.nextUrl.searchParams;
    const isActiveParam = params.get("isActive");

    const { data } = await listProducts(
      session.user.companyId,
      { page: 1, pageSize: EXPORT_ROW_CAP, skip: 0, take: EXPORT_ROW_CAP, search: params.get("search") || undefined, sortBy: "styleName", sortOrder: "asc" },
      {
        categoryId: params.get("categoryId") || undefined,
        seasonId: params.get("seasonId") || undefined,
        brandId: params.get("brandId") || undefined,
        productTypeId: params.get("productTypeId") || undefined,
        productFittingId: params.get("productFittingId") || undefined,
        isActive: isActiveParam === null ? undefined : isActiveParam === "true",
      }
    );

    const buffer = await buildXlsxBuffer(
      "Styles",
      [
        { header: "Style Code", key: "styleCode" },
        { header: "Style Name", key: "styleName", width: 30 },
        { header: "Category", key: "category" },
        { header: "Season", key: "season" },
        { header: "Brand", key: "brand" },
        { header: "Product Type", key: "productType" },
        { header: "Fitting", key: "productFitting" },
        { header: "Variants", key: "variants", type: "number" },
        { header: "Status", key: "status" },
      ],
      (data as unknown as ProductExportRow[]).map((p) => ({
        styleCode: p.styleCode,
        styleName: p.styleName,
        category: p.category?.name ?? "",
        season: p.season?.name ?? "",
        brand: p.brand?.name ?? "",
        productType: p.productType?.name ?? "",
        productFitting: p.productFitting?.name ?? "",
        variants: p._count.variants,
        status: p.isActive ? "Active" : "Inactive",
      }))
    );

    return new NextResponse(new Uint8Array(buffer), { headers: xlsxResponseHeaders("styles.xlsx") });
  } catch (error) {
    return handleApiError(error);
  }
}
