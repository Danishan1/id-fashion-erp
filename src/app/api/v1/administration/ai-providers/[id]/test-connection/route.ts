import { NextRequest, NextResponse } from "next/server";
import { requireSession, handleApiError } from "@/lib/api-route";
import { PermissionService } from "@/core/rbac/PermissionService";
import { testConnection } from "@/modules/ai-providers/ai-provider-admin.service";

interface RouteContext {
  params: Promise<{ id: string }>;
}

/** A real, non-mocked connectivity check — see AIProviderManager's connection-test.ts for exactly what it verifies (never a fabricated success/failure). */
export async function POST(_req: NextRequest, { params }: RouteContext) {
  try {
    const session = await requireSession();
    await PermissionService.assert(session.user.id, "administration_settings", "edit");

    const { id } = await params;
    const result = await testConnection({ companyId: session.user.companyId, userId: session.user.id }, id);
    return NextResponse.json({ data: result });
  } catch (error) {
    return handleApiError(error);
  }
}
