import { NextRequest, NextResponse } from "next/server";
import { requireSession, handleApiError } from "@/lib/api-route";
import { BusinessRuleError } from "@/core/errors/BusinessRuleError";
import { listAttachments, uploadAttachment } from "@/core/attachments/AttachmentService";
import { assertAttachmentAccess, relatedModuleFromSlug } from "@/core/attachments/attachment-targets";

interface RouteContext {
  params: Promise<{ module: string; recordId: string }>;
}

const MAX_FILES = 10;

/** Files and voice notes attached to one record (see attachment-targets.ts). */
export async function GET(_req: NextRequest, { params }: RouteContext) {
  try {
    const session = await requireSession();
    const { module, recordId } = await params;
    const relatedModule = relatedModuleFromSlug(module);
    const actor = { companyId: session.user.companyId, userId: session.user.id };
    await assertAttachmentAccess(actor, relatedModule, recordId, "view");

    return NextResponse.json({ data: await listAttachments(actor.companyId, relatedModule, recordId) });
  } catch (error) {
    return handleApiError(error);
  }
}

/** Multipart upload: one or more `files` (documents, photos, voice notes). */
export async function POST(req: NextRequest, { params }: RouteContext) {
  try {
    const session = await requireSession();
    const { module, recordId } = await params;
    const relatedModule = relatedModuleFromSlug(module);
    const actor = { companyId: session.user.companyId, userId: session.user.id };
    const { status } = await assertAttachmentAccess(actor, relatedModule, recordId, "create");

    const formData = await req.formData();
    const files = [...formData.getAll("files"), ...formData.getAll("file")].filter(
      (f): f is File => f instanceof File && f.size > 0
    );
    if (files.length === 0) throw new BusinessRuleError("VALIDATION_ERROR", "No file was uploaded.");
    if (files.length > MAX_FILES) {
      throw new BusinessRuleError("VALIDATION_ERROR", `You can upload at most ${MAX_FILES} files at once.`);
    }

    const created = [];
    for (const file of files) {
      created.push(
        await uploadAttachment(
          actor,
          relatedModule,
          recordId,
          { buffer: Buffer.from(await file.arrayBuffer()), fileName: file.name, mimeType: file.type || "application/octet-stream" },
          status
        )
      );
    }

    return NextResponse.json({ data: created }, { status: 201 });
  } catch (error) {
    return handleApiError(error);
  }
}
