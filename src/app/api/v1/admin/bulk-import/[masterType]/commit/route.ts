import { NextRequest, NextResponse } from "next/server";
import { requireSession, handleApiError } from "@/lib/api-route";
import { PermissionService } from "@/core/rbac/PermissionService";
import { BusinessRuleError } from "@/core/errors/BusinessRuleError";
import { BULK_IMPORT_MASTER_TYPES, type BulkImportMasterType } from "@/modules/import/import.schema";
import { commitBulkImport, parseUploadedFile, resolveUploadedFileMimeType } from "@/modules/import/bulk-import.service";

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
 * Re-parses the uploaded file independently — never trusts anything
 * computed by the earlier .../validate call — persists the original file
 * for audit, creates the ImportBatch, and enqueues a background job. Returns
 * as soon as the job is enqueued (not once processing finishes), which is
 * what actually satisfies "not synchronous request blocking" for a
 * 5,000-10,000 row file: the real processing happens in the separate worker
 * process (src/core/jobs/worker.ts).
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
    const { rows } = await parseUploadedFile(buffer, mimeType, masterType);

    const actor = { companyId: session.user.companyId, userId: session.user.id, branchId: session.user.defaultBranchId };
    const result = await commitBulkImport(actor, masterType, file.name, buffer, mimeType, rows);

    return NextResponse.json({ data: result }, { status: 202 });
  } catch (error) {
    return handleApiError(error);
  }
}
