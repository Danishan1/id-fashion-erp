import { NextRequest, NextResponse } from "next/server";
import { requireSession, handleApiError } from "@/lib/api-route";
import { PermissionService } from "@/core/rbac/PermissionService";
import { BusinessRuleError } from "@/core/errors/BusinessRuleError";
import { buildXlsxBuffer, xlsxResponseHeaders } from "@/lib/xlsx";
import { toCsv } from "@/lib/csv";
import { reportCsvHeaders } from "@/core/reports/csv";
import { BULK_IMPORT_COLUMNS, BULK_IMPORT_MASTER_TYPES, BULK_IMPORT_SAMPLE_ROWS, type BulkImportMasterType } from "@/modules/import/import.schema";

interface RouteContext {
  params: Promise<{ masterType: string }>;
}

function assertMasterType(value: string): BulkImportMasterType {
  if (!(BULK_IMPORT_MASTER_TYPES as readonly string[]).includes(value)) {
    throw new BusinessRuleError("VALIDATION_ERROR", `Unknown master type "${value}".`);
  }
  return value as BulkImportMasterType;
}

/**
 * Template download for the Super Admin Bulk Master Data Import portal —
 * headers + one realistic sample row, generated from the exact same column
 * spec (`BULK_IMPORT_COLUMNS`) validation itself reads, so a template can
 * never drift from what the file-parsing/validation step actually accepts.
 */
export async function GET(req: NextRequest, { params }: RouteContext) {
  try {
    const session = await requireSession();
    await PermissionService.assert(session.user.id, "administration_settings", "create");

    const { masterType: rawMasterType } = await params;
    const masterType = assertMasterType(rawMasterType);
    const format = req.nextUrl.searchParams.get("format") === "csv" ? "csv" : "xlsx";

    const columns = BULK_IMPORT_COLUMNS[masterType];
    const sampleRow = BULK_IMPORT_SAMPLE_ROWS[masterType];
    const fileBaseName = masterType.toLowerCase().replace(/_/g, "-");

    if (format === "csv") {
      const header = columns.map((c) => c.label);
      const row = columns.map((c) => sampleRow[c.key] ?? "");
      const csv = toCsv(header, [row]);
      return new NextResponse(csv, { headers: reportCsvHeaders(`${fileBaseName}-template.csv`) });
    }

    const buffer = await buildXlsxBuffer(
      masterType,
      columns.map((c) => ({ header: c.label, key: c.key, width: Math.max(18, c.label.length) })),
      [sampleRow]
    );
    return new NextResponse(new Uint8Array(buffer), { headers: xlsxResponseHeaders(`${fileBaseName}-template.xlsx`) });
  } catch (error) {
    return handleApiError(error);
  }
}
