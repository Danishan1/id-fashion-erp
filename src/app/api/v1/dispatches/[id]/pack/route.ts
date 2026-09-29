import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireSession, handleApiError } from "@/lib/api-route";
import { PermissionService } from "@/core/rbac/PermissionService";
import { markPacked } from "@/modules/dispatch/dispatch.service";

// Optional body — every pre-existing caller (the plain "Mark Packed" button)
// sends none at all; scannedCartonIds is only present when the pack screen's
// own carton-scan flow (Barcode Management & Scanning System, Phase 1) was
// used instead.
const packBodySchema = z.object({ scannedCartonIds: z.array(z.string().uuid()).optional() }).optional();

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await requireSession();
    await PermissionService.assert(session.user.id, "dispatch", "edit");

    const rawBody = await req.text();
    const body = packBodySchema.parse(rawBody ? JSON.parse(rawBody) : undefined);

    const { id } = await params;
    const dispatch = await markPacked(
      { companyId: session.user.companyId, userId: session.user.id, branchId: session.user.defaultBranchId },
      id,
      body?.scannedCartonIds
    );

    return NextResponse.json({ data: dispatch });
  } catch (error) {
    return handleApiError(error);
  }
}
