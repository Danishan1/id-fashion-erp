import { NextResponse } from "next/server";
import { requireSession, handleApiError } from "@/lib/api-route";
import { PermissionService } from "@/core/rbac/PermissionService";
import { BusinessRuleError } from "@/core/errors/BusinessRuleError";
import { getImportBatchById } from "@/modules/import/import.service";
import { toCsv } from "@/lib/csv";
import { reportCsvHeaders } from "@/core/reports/csv";

interface RouteContext {
  params: Promise<{ id: string }>;
}

interface FailedRow {
  rowNumber: number;
  data: Record<string, string>;
  reason: string;
}

/** Downloadable error log — every failed row's number, its own raw column
 * values, and why it failed, so a Super Admin can fix and re-upload just
 * the bad rows rather than re-checking the entire original file by hand. */
export async function GET(_req: Request, { params }: RouteContext) {
  try {
    const session = await requireSession();
    await PermissionService.assert(session.user.id, "administration", "create");

    const { id } = await params;
    const batch = await getImportBatchById(session.user.companyId, id);
    if (!batch.failedRowsJson) {
      throw new BusinessRuleError("VALIDATION_ERROR", "This batch has no failed rows to export.");
    }

    const failedRows = batch.failedRowsJson as unknown as FailedRow[];
    const columnKeys = Array.from(new Set(failedRows.flatMap((r) => Object.keys(r.data))));
    const header = ["Row #", ...columnKeys, "Error Reason"];
    const rows = failedRows.map((r) => [String(r.rowNumber), ...columnKeys.map((k) => r.data[k] ?? ""), r.reason]);

    const csv = toCsv(header, rows);
    return new NextResponse(csv, { headers: reportCsvHeaders(`${batch.fileName.replace(/\.[^.]+$/, "")}-errors.csv`) });
  } catch (error) {
    return handleApiError(error);
  }
}
