import { NextRequest, NextResponse } from "next/server";
import { requireSession, handleApiError } from "@/lib/api-route";
import { PermissionService } from "@/core/rbac/PermissionService";
import { designPatternSchema } from "@/modules/garment-attributes/garment-attributes.schema";
import { listDesignPatterns, createDesignPattern } from "@/modules/garment-attributes/garment-attributes.service";

export async function GET() {
  try {
    const session = await requireSession();
    await PermissionService.assert(session.user.id, "masters_core", "view");
    return NextResponse.json({ data: await listDesignPatterns(session.user.companyId) });
  } catch (error) {
    return handleApiError(error);
  }
}

export async function POST(req: NextRequest) {
  try {
    const session = await requireSession();
    await PermissionService.assert(session.user.id, "masters_core", "create");

    const input = designPatternSchema.parse(await req.json());
    const designPattern = await createDesignPattern({ companyId: session.user.companyId, userId: session.user.id }, input);
    return NextResponse.json({ data: designPattern }, { status: 201 });
  } catch (error) {
    return handleApiError(error);
  }
}
