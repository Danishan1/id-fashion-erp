import { NextRequest, NextResponse } from "next/server";
import { requirePlatformSession, handleApiError } from "@/lib/api-route";
import { EntitlementService } from "@/core/entitlements/EntitlementService";
import type { EntitlementPackageKey } from "@/config/module-entitlements";
import { setModuleEntitlementSchema } from "@/modules/platform/platform-company-lifecycle.schema";
import { resetModuleEntitlement, setModuleEntitlement } from "@/modules/platform/platform-company-lifecycle.service";
import { isEntitlementPackageKey } from "@/config/module-entitlements";
import { BusinessRuleError } from "@/core/errors/BusinessRuleError";

/** Phase 4: remove a per-company override so the subscription plan decides again. `?packageKey=CRM` */
export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { platformUser } = await requirePlatformSession(["PLATFORM_SUPER_ADMIN"]);
    const { id } = await params;
    const packageKey = req.nextUrl.searchParams.get("packageKey") ?? "";
    if (!isEntitlementPackageKey(packageKey)) {
      throw new BusinessRuleError("VALIDATION_ERROR", "Unknown module package.", { packageKey });
    }
    const result = await resetModuleEntitlement({ platformUserId: platformUser.id }, id, packageKey);
    return NextResponse.json({ data: result }, { headers: { "x-toast-success": "Module now follows the plan." } });
  } catch (error) {
    return handleApiError(error);
  }
}

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
