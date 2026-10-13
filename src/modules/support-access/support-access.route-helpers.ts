import { requireSession } from "@/lib/api-route";
import { BusinessRuleError } from "@/core/errors/BusinessRuleError";
import type { PlatformActor, TenantActor } from "./support-access.service";

/**
 * Customer-side support-access routes: a real tenant user only (never a
 * support session itself — support can't approve its own access). The
 * service then requires the company's Super Admin role.
 */
export async function requireTenantSupportActor(): Promise<TenantActor> {
  const session = await requireSession();
  if (session.user.userType === "SUPPORT") {
    throw new BusinessRuleError("PERMISSION_DENIED", "A support session can't manage support access.");
  }
  return { userId: session.user.id, companyId: session.user.companyId };
}

export function toPlatformActor(platformUser: { id: string; role: PlatformActor["role"] }): PlatformActor {
  return { platformUserId: platformUser.id, role: platformUser.role };
}
