import { NextRequest, NextResponse } from "next/server";
import { requireSession, handleApiError } from "@/lib/api-route";
import { PermissionService } from "@/core/rbac/PermissionService";
import { createTechnicalSpecificationSchema } from "@/modules/ai-garment-flow/technical-specification.schema";
import { createTechnicalSpecification, listTechnicalSpecifications } from "@/modules/ai-garment-flow/technical-specification.service";

interface RouteContext {
  params: Promise<{ id: string }>;
}

export async function GET(_req: NextRequest, { params }: RouteContext) {
  try {
    const session = await requireSession();
    await PermissionService.assert(session.user.id, "ai_garment_flow", "view");

    const { id } = await params;
    const specifications = await listTechnicalSpecifications(session.user.companyId, id);

    return NextResponse.json({ data: specifications });
  } catch (error) {
    return handleApiError(error);
  }
}

export async function POST(req: NextRequest, { params }: RouteContext) {
  try {
    const session = await requireSession();
    await PermissionService.assert(session.user.id, "ai_garment_flow", "edit");

    const { id } = await params;
    const input = createTechnicalSpecificationSchema.parse(await req.json());
    const specifications = await createTechnicalSpecification(
      { companyId: session.user.companyId, userId: session.user.id },
      id,
      input
    );

    return NextResponse.json({ data: specifications }, { status: 201 });
  } catch (error) {
    return handleApiError(error);
  }
}
