import { NextRequest, NextResponse } from "next/server";
import { requireSession, handleApiError } from "@/lib/api-route";
import { PermissionService } from "@/core/rbac/PermissionService";
import { BusinessRuleError } from "@/core/errors/BusinessRuleError";
import { listAttachments, uploadAttachment } from "@/core/attachments/AttachmentService";
import { GoodsReceiptRepository } from "@/modules/purchasing/goods-receipt.repository";

interface RouteContext {
  params: Promise<{ id: string }>;
}

export async function GET(_req: NextRequest, { params }: RouteContext) {
  try {
    const session = await requireSession();
    await PermissionService.assert(session.user.id, "inventory", "view");

    const { id } = await params;
    const attachments = await listAttachments(session.user.companyId, "GOODS_RECEIPT", id);

    return NextResponse.json({ data: attachments });
  } catch (error) {
    return handleApiError(error);
  }
}

export async function POST(req: NextRequest, { params }: RouteContext) {
  try {
    const session = await requireSession();
    await PermissionService.assert(session.user.id, "inventory", "edit");

    const { id } = await params;
    const formData = await req.formData();
    const file = formData.get("file");
    if (!(file instanceof File)) {
      throw new BusinessRuleError("VALIDATION_ERROR", "No file was uploaded.");
    }

    const receipt = await GoodsReceiptRepository.findAnyById(session.user.companyId, id);
    if (!receipt) throw new BusinessRuleError("NOT_FOUND", "Goods receipt not found.", { id });

    const buffer = Buffer.from(await file.arrayBuffer());
    const attachment = await uploadAttachment(
      { companyId: session.user.companyId, userId: session.user.id },
      "GOODS_RECEIPT",
      id,
      { buffer, fileName: file.name, mimeType: file.type || "application/octet-stream" },
      receipt.status
    );

    return NextResponse.json({ data: attachment }, { status: 201 });
  } catch (error) {
    return handleApiError(error);
  }
}
