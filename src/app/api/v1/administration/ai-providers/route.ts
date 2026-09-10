import { NextResponse } from "next/server";
import { requireSession, handleApiError } from "@/lib/api-route";
import { PermissionService } from "@/core/rbac/PermissionService";
import { createAIProviderSchema } from "@/modules/ai-providers/ai-provider.schema";
import { createProvider, listProviders } from "@/modules/ai-providers/ai-provider-admin.service";

export async function GET() {
  try {
    const session = await requireSession();
    await PermissionService.assert(session.user.id, "administration", "view");

    const providers = await listProviders(session.user.companyId);
    return NextResponse.json({ data: providers });
  } catch (error) {
    return handleApiError(error);
  }
}

export async function POST(req: Request) {
  try {
    const session = await requireSession();
    await PermissionService.assert(session.user.id, "administration", "create");

    const input = createAIProviderSchema.parse(await req.json());
    const provider = await createProvider({ companyId: session.user.companyId, userId: session.user.id }, input);
    return NextResponse.json({ data: provider }, { status: 201 });
  } catch (error) {
    return handleApiError(error);
  }
}
