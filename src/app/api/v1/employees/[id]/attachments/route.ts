import { NextRequest, NextResponse } from "next/server";
import { requireSession, handleApiError } from "@/lib/api-route";
import { PermissionService } from "@/core/rbac/PermissionService";
import { BusinessRuleError } from "@/core/errors/BusinessRuleError";
import { listAttachments, uploadAttachment } from "@/core/attachments/AttachmentService";
import { EmployeeRepository } from "@/modules/employees/employee.repository";

interface RouteContext {
  params: Promise<{ id: string }>;
}

export async function GET(_req: NextRequest, { params }: RouteContext) {
  try {
    const session = await requireSession();
    await PermissionService.assert(session.user.id, "masters_core", "view");

    const { id } = await params;
    const attachments = await listAttachments(session.user.companyId, "EMPLOYEE", id);

    return NextResponse.json({ data: attachments });
  } catch (error) {
    return handleApiError(error);
  }
}

export async function POST(req: NextRequest, { params }: RouteContext) {
  try {
    const session = await requireSession();
    await PermissionService.assert(session.user.id, "masters_core", "edit");

    const { id } = await params;
    const formData = await req.formData();
    const file = formData.get("file");
    if (!(file instanceof File)) {
      throw new BusinessRuleError("VALIDATION_ERROR", "No file was uploaded.");
    }

    const employee = await EmployeeRepository.findById(session.user.companyId, id);
    if (!employee) throw new BusinessRuleError("NOT_FOUND", "Employee not found.", { id });

    const buffer = Buffer.from(await file.arrayBuffer());
    // Employee is a master record, not a workflow document — there is no
    // stage/status to snapshot, so contextLabel is left unset rather than
    // fabricating one (matches Attachment.contextLabel's own "generic,
    // module-agnostic" design — it's fine to be null).
    const attachment = await uploadAttachment(
      { companyId: session.user.companyId, userId: session.user.id },
      "EMPLOYEE",
      id,
      { buffer, fileName: file.name, mimeType: file.type || "application/octet-stream" }
    );

    return NextResponse.json({ data: attachment }, { status: 201 });
  } catch (error) {
    return handleApiError(error);
  }
}
