import { NextRequest, NextResponse } from "next/server";
import { requireSession, handleApiError } from "@/lib/api-route";
import { PermissionService } from "@/core/rbac/PermissionService";
import { BusinessRuleError } from "@/core/errors/BusinessRuleError";
import { listAttachments, uploadAttachment } from "@/core/attachments/AttachmentService";
import { ProductRepository } from "@/modules/products/product.repository";

interface RouteContext {
  params: Promise<{ id: string }>;
}

export async function GET(_req: NextRequest, { params }: RouteContext) {
  try {
    const session = await requireSession();
    await PermissionService.assert(session.user.id, "masters_core", "view");

    const { id } = await params;
    const attachments = await listAttachments(session.user.companyId, "PRODUCT", id);

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
    const product = await ProductRepository.findAnyById(session.user.companyId, id);
    if (!product) throw new BusinessRuleError("NOT_FOUND", "Style not found.", { id });

    const formData = await req.formData();
    const file = formData.get("file");
    if (!(file instanceof File)) {
      throw new BusinessRuleError("VALIDATION_ERROR", "No file was uploaded.");
    }
    // This module's own attachment bag is exclusively the product-gallery
    // image concept (unlike Sampling's, which is shared with general
    // tech-pack files) -- reject anything that isn't an image up front with
    // a clear message, rather than accepting a stray PDF into a gallery.
    if (!file.type.startsWith("image/")) {
      throw new BusinessRuleError("VALIDATION_ERROR", "Only image files (JPEG, PNG, WEBP) can be added to a style's gallery.");
    }

    const buffer = Buffer.from(await file.arrayBuffer());
    const attachment = await uploadAttachment(
      { companyId: session.user.companyId, userId: session.user.id },
      "PRODUCT",
      id,
      { buffer, fileName: file.name, mimeType: file.type }
    );

    return NextResponse.json({ data: attachment }, { status: 201 });
  } catch (error) {
    return handleApiError(error);
  }
}
