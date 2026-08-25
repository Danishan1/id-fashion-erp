import { NextRequest, NextResponse } from "next/server";
import { requireSession, handleApiError } from "@/lib/api-route";
import { assertReportAccess } from "@/core/reports/permissions";
import { getReportConfig } from "@/modules/reports/registry";
import "@/modules/reports/all-reports";
import { BusinessRuleError } from "@/core/errors/BusinessRuleError";
import { buildReportXlsxBuffer, reportXlsxHeaders } from "@/core/reports/excel";
import { buildReportCsv, reportCsvHeaders } from "@/core/reports/csv";
import { renderReportPdf, reportPdfHeaders } from "@/core/reports/pdf";

function filtersFromSearchParams(searchParams: URLSearchParams): Record<string, string> {
  const filters: Record<string, string> = {};
  searchParams.forEach((value, key) => {
    if (value) filters[key] = value;
  });
  return filters;
}

function slugify(text: string): string {
  return text.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");
}

export async function GET(req: NextRequest, { params }: { params: Promise<{ category: string; report: string; format: string }> }) {
  try {
    const { category, report, format } = await params;
    if (format !== "xlsx" && format !== "csv" && format !== "pdf") {
      throw new BusinessRuleError("VALIDATION_ERROR", "Unsupported export format.", { format });
    }

    const session = await requireSession();

    const config = getReportConfig(category, report);
    if (!config) throw new BusinessRuleError("NOT_FOUND", "Report not found.", { category, report });

    await assertReportAccess(session.user.id, config.category, "export");

    const filters = filtersFromSearchParams(req.nextUrl.searchParams);
    // Same descriptor-builder function as the on-screen view route — the
    // mechanism that guarantees an export can never disagree with the screen.
    const descriptor = await config.buildDescriptor(session.user.companyId, session.user.name ?? "Unknown", filters);

    const fileBaseName = slugify(config.title);

    if (format === "xlsx") {
      const buffer = await buildReportXlsxBuffer(descriptor);
      return new NextResponse(new Uint8Array(buffer), { headers: reportXlsxHeaders(`${fileBaseName}.xlsx`) });
    }
    if (format === "csv") {
      const csv = buildReportCsv(descriptor);
      return new NextResponse(csv, { headers: reportCsvHeaders(`${fileBaseName}.csv`) });
    }
    const buffer = await renderReportPdf(descriptor, { orientation: config.pdfOrientation });
    return new NextResponse(new Uint8Array(buffer), { headers: reportPdfHeaders(`${fileBaseName}.pdf`) });
  } catch (error) {
    return handleApiError(error);
  }
}
