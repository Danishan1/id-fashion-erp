import { NextRequest, NextResponse } from "next/server";
import { requirePlatformSession, handleApiError } from "@/lib/api-route";
import { EntitlementService } from "@/core/entitlements/EntitlementService";
import type { EntitlementPackageKey } from "@/config/module-entitlements";
import { setModuleEntitlementSchema } from "@/modules/platform/platform-company-lifecycle.schema";
import { setModuleEntitlement } from "@/modules/platform/platform-company-lifecycle.service";

/** PLAT-020: the company's module packages and whether each is on. */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    await requirePlatformSession();
    const { id } = await params;
    return NextResponse.json({ data: await EntitlementService.listPackageStates(id) });
  } catch (error) {
    return handleApiError(error);
  }
}

/** PLAT-020: turn one module package on or off. */
export async function PUT(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { platformUser } = await requirePlatformSession(["PLATFORM_SUPER_ADMIN"]);
    const { id } = await params;
    const { packageKey, isEnabled } = setModuleEntitlementSchema.parse(await req.json());
    const result = await setModuleEntitlement(
      { platformUserId: platformUser.id },
      id,
      packageKey as EntitlementPackageKey,
      isEnabled
    );
    return NextResponse.json(
      { data: result },
      { headers: { "x-toast-success": isEnabled ? "Module enabled." : "Module disabled." } }
    );
  } catch (error) {
    return handleApiError(error);
  }
}
