import { NextRequest, NextResponse } from "next/server";
import { requireSession, handleApiError } from "@/lib/api-route";
import { PermissionService } from "@/core/rbac/PermissionService";
import { BusinessRuleError } from "@/core/errors/BusinessRuleError";
import { AD_PLATFORMS } from "@/modules/marketing/ad-integrations/ad-integration.schema";
import { initiateAdIntegrationConnection } from "@/modules/marketing/ad-integrations/ad-integration.service";

interface RouteContext {
  params: Promise<{ platform: string }>;
}

export async function GET(_req: NextRequest, { params }: RouteContext) {
  try {
    const session = await requireSession();
    await PermissionService.assert(session.user.id, "marketing", "edit");

    const { platform } = await params;
    const upper = platform.toUpperCase();
    if (!AD_PLATFORMS.includes(upper as (typeof AD_PLATFORMS)[number])) {
      throw new BusinessRuleError("VALIDATION_ERROR", `Unknown ad platform "${platform}".`);
    }

    const redirectUrl = initiateAdIntegrationConnection(
      { companyId: session.user.companyId, userId: session.user.id },
      upper as (typeof AD_PLATFORMS)[number]
    );

    return NextResponse.redirect(redirectUrl);
  } catch (error) {
    return handleApiError(error);
  }
}
