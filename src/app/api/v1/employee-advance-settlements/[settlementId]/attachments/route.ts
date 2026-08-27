import { NextRequest, NextResponse } from "next/server";
import { requireSession, handleApiError } from "@/lib/api-route";
import { PermissionService } from "@/core/rbac/PermissionService";
import { BusinessRuleError } from "@/core/errors/BusinessRuleError";
import { listAttachments, uploadAttachment } from "@/core/attachments/AttachmentService";
import { EmployeeAdvanceSettlementRepository } from "@/modules/accounts/employee-advance.repository";

interface RouteContext {
  params: Promise<{ settlementId: string }>;
}

export async function GET(_req: NextRequest, { params }: RouteContext) {
  try {
    const session = await requireSession();
    await PermissionService.assert(session.user.id, "expenses", "view");

    const { settlementId } = await params;
    const attachments = await listAttachments(session.user.companyId, "EMPLOYEE_ADVANCE_SETTLEMENT", settlementId);

    return NextResponse.json({ data: attachments });
  } catch (error) {
    return handleApiError(error);
  }
}

export async function POST(req: NextRequest, { params }: RouteContext) {
  try {
    const session = await requireSession();
    await PermissionService.assert(session.user.id, "expenses", "create");

    const { settlementId } = await params;
    const formData = await req.formData();
    const file = formData.get("file");
    if (!(file instanceof File)) {
      throw new BusinessRuleError("VALIDATION_ERROR", "No file was uploaded.");
    }

    // Snapshot the settlement's current status server-side — never trust a
    // client-supplied stage label, same pattern as Expense's own attachments.
    const settlement = await EmployeeAdvanceSettlementRepository.findAnyById(session.user.companyId, settlementId);
    if (!settlement) throw new BusinessRuleError("NOT_FOUND", "Settlement not found.", { id: settlementId });

    const buffer = Buffer.from(await file.arrayBuffer());
    const attachment = await uploadAttachment(
      { companyId: session.user.companyId, userId: session.user.id },
      "EMPLOYEE_ADVANCE_SETTLEMENT",
      settlementId,
      { buffer, fileName: file.name, mimeType: file.type || "application/octet-stream" },
      settlement.status
    );

    return NextResponse.json({ data: attachment }, { status: 201 });
  } catch (error) {
    return handleApiError(error);
  }
}
