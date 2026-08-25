import { NextRequest, NextResponse } from "next/server";
import { requireSession, handleApiError } from "@/lib/api-route";
import { assertReportAccess } from "@/core/reports/permissions";
import { getReportConfig } from "@/modules/reports/registry";
import "@/modules/reports/all-reports";
import { BusinessRuleError } from "@/core/errors/BusinessRuleError";

function filtersFromSearchParams(searchParams: URLSearchParams): Record<string, string> {
  const filters: Record<string, string> = {};
  searchParams.forEach((value, key) => {
    if (value) filters[key] = value;
  });
  return filters;
}

export async function GET(req: NextRequest, { params }: { params: Promise<{ category: string; report: string }> }) {
  try {
    const { category, report } = await params;
    const session = await requireSession();

    const config = getReportConfig(category, report);
    if (!config) throw new BusinessRuleError("NOT_FOUND", "Report not found.", { category, report });

    await assertReportAccess(session.user.id, config.category, "view");

    const filters = filtersFromSearchParams(req.nextUrl.searchParams);
    const descriptor = await config.buildDescriptor(session.user.companyId, session.user.name ?? "Unknown", filters);

    return NextResponse.json({ descriptor });
  } catch (error) {
    return handleApiError(error);
  }
}
