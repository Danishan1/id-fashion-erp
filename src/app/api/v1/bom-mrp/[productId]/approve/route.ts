import { NextRequest, NextResponse } from "next/server";
import { requireSession, handleApiError } from "@/lib/api-route";
import { approveBomVersion } from "@/modules/bom-mrp/bom.service";

interface RouteContext {
  params: Promise<{ productId: string }>;
}

// No coarse PermissionService.assert here — approveBomVersion() itself
// asserts "bom_mrp"/"approve" with the real self-approval-guarded
// resourceContext (the version's own creator), matching the same
// "service does the real check, route is just plumbing" shape already used
// by Sampling's decision route.
export async function POST(_req: NextRequest, { params }: RouteContext) {
  try {
    const session = await requireSession();
    const { productId } = await params;
    const bom = await approveBomVersion({ companyId: session.user.companyId, userId: session.user.id }, productId);
    return NextResponse.json({ data: bom });
  } catch (error) {
    return handleApiError(error);
  }
}
