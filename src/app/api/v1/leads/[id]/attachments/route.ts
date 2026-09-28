import { NextRequest, NextResponse } from "next/server";
import { requireSession, handleApiError } from "@/lib/api-route";
import { PermissionService } from "@/core/rbac/PermissionService";
import { BusinessRuleError } from "@/core/errors/BusinessRuleError";
import { listAttachments, uploadAttachment } from "@/core/attachments/AttachmentService";
import { prisma } from "@/core/db/client";

interface RouteContext {
  params: Promise<{ id: string }>;
}

/** Company-scoped existence check; returns the lead's current stage name. */
async function getLeadStageName(companyId: string, id: string) {
  const lead = await prisma.lead.findFirst({ where: { id, companyId }, select: { stage: { select: { name: true } } } });
  if (!lead) throw new BusinessRuleError("NOT_FOUND", "Lead not found.", { id });
  return lead.stage.name;
}

export async function GET(_req: NextRequest, { params }: RouteContext) {
  try {
    const session = await requireSession();
    await PermissionService.assert(session.user.id, "crm", "view");
    const { id } = await params;
    await getLeadStageName(session.user.companyId, id);
    return NextResponse.json({ data: await listAttachments(session.user.companyId, "LEAD", id) });
  } catch (error) {
    return handleApiError(error);
  }
}

export async function POST(req: NextRequest, { params }: RouteContext) {
  try {
    const session = await requireSession();
    await PermissionService.assert(session.user.id, "crm", "edit");

    const { id } = await params;
    const formData = await req.formData();
    const file = formData.get("file");
    if (!(file instanceof File)) throw new BusinessRuleError("VALIDATION_ERROR", "No file was uploaded.");

    // The lead's current stage, snapshotted server-side, labels when the
    // document arrived (e.g. "Requirement Received").
    const stageName = await getLeadStageName(session.user.companyId, id);
    const buffer = Buffer.from(await file.arrayBuffer());
    const attachment = await uploadAttachment(
      { companyId: session.user.companyId, userId: session.user.id },
      "LEAD",
      id,
      { buffer, fileName: file.name, mimeType: file.type || "application/octet-stream" },
      stageName
    );
    await prisma.lead.update({ where: { id }, data: { lastActivityAt: new Date() } });

    return NextResponse.json({ data: attachment }, { status: 201 });
  } catch (error) {
    return handleApiError(error);
  }
}
