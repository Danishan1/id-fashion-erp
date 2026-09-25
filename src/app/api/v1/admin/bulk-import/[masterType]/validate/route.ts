import { NextRequest, NextResponse } from "next/server";
import { requireSession, handleApiError } from "@/lib/api-route";
import { PermissionService } from "@/core/rbac/PermissionService";
import { BusinessRuleError } from "@/core/errors/BusinessRuleError";
import { BULK_IMPORT_MASTER_TYPES, type BulkImportMasterType } from "@/modules/import/import.schema";
import { parseUploadedFile, resolveUploadedFileMimeType, validateBulkImportRows } from "@/modules/import/bulk-import.service";

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
 * Dry-run only — parses the uploaded file server-side and runs every row
 * through the real validation/resolution logic with nothing written to the
 * database (see validateBulkImportRows's own doc comment for how that's
 * achieved). The client is expected to hold onto the same File object and
 * POST it again to .../commit once the Super Admin reviews this report and
 * confirms — no server-side state is kept between the two calls.
 */
export async function POST(req: NextRequest, { params }: RouteContext) {
  try {
    const session = await requireSession();
    await PermissionService.assert(session.user.id, "administration_settings", "create");

    const { masterType: rawMasterType } = await params;
    const masterType = assertMasterType(rawMasterType);

    const formData = await req.formData();
    const file = formData.get("file");
    if (!(file instanceof File)) {
      throw new BusinessRuleError("VALIDATION_ERROR", "No file was uploaded.");
    }

    const mimeType = resolveUploadedFileMimeType(file.name, file.type);
    const buffer = Buffer.from(await file.arrayBuffer());
    const { rows, totalRows } = await parseUploadedFile(buffer, mimeType, masterType);

    const actor = { companyId: session.user.companyId, userId: session.user.id, branchId: session.user.defaultBranchId };
    const result = await validateBulkImportRows(actor, masterType, rows);

    return NextResponse.json({ data: { ...result, totalRows } });
  } catch (error) {
    return handleApiError(error);
  }
}
