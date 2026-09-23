import { NextRequest, NextResponse } from "next/server";
import { requireSession, handleApiError } from "@/lib/api-route";
import { PermissionService } from "@/core/rbac/PermissionService";
import { duplicateSampleRequestSchema } from "@/modules/sampling/sample.schema";
import { duplicateSampleRequest } from "@/modules/sampling/sample.service";

interface RouteContext {
  params: Promise<{ id: string }>;
}

// "Copy Design" — gated on the same "create" action as an ordinary new
// Sample Request, since that's exactly what this produces (a new request,
// just pre-filled from an existing one).
export async function POST(req: NextRequest, { params }: RouteContext) {
  try {
    const session = await requireSession();
    await PermissionService.assert(session.user.id, "sampling", "create");

    const { id } = await params;
    const input = duplicateSampleRequestSchema.parse(await req.json());
    const created = await duplicateSampleRequest(
      { companyId: session.user.companyId, userId: session.user.id, branchId: session.user.defaultBranchId },
      id,
      { styleName: input.styleName, customerId: input.customerId, buyerId: input.buyerId || null }
    );

    return NextResponse.json({ data: created }, { status: 201 });
  } catch (error) {
    return handleApiError(error);
  }
}
