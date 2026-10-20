import { NextRequest, NextResponse } from "next/server";
import { requireSession, handleApiError } from "@/lib/api-route";
import { PermissionService } from "@/core/rbac/PermissionService";
import { BusinessRuleError } from "@/core/errors/BusinessRuleError";
import { listJobOrderSlips, uploadJobOrderSlip } from "@/modules/production/work-portal.service";

type Params = { params: Promise<{ id: string }> };

/** P4: slips (photos of handwritten slips, scans or PDFs) on a job order. */
export async function GET(_req: NextRequest, { params }: Params) {
  try {
    const session = await requireSession();
    await PermissionService.assert(session.user.id, "production", "view");
    const { id } = await params;
    const data = await listJobOrderSlips({ companyId: session.user.companyId, userId: session.user.id }, id);
    return NextResponse.json({ data });
  } catch (error) {
    return handleApiError(error);
  }
}

export async function POST(req: NextRequest, { params }: Params) {
  try {
    const session = await requireSession();
    await PermissionService.assert(session.user.id, "production", "view");
    const { id } = await params;
    const formData = await req.formData();
    const file = formData.get("file");
    if (!(file instanceof File)) throw new BusinessRuleError("VALIDATION_ERROR", "No file was uploaded.");
    const data = await uploadJobOrderSlip({ companyId: session.user.companyId, userId: session.user.id }, id, {
      buffer: Buffer.from(await file.arrayBuffer()),
      fileName: file.name,
      mimeType: file.type || "application/octet-stream",
    });
    return NextResponse.json({ data }, { status: 201, headers: { "x-toast-success": "Slip uploaded." } });
  } catch (error) {
    return handleApiError(error);
  }
}
