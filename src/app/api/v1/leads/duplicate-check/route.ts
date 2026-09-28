import { NextRequest, NextResponse } from "next/server";
import { requireSession, handleApiError } from "@/lib/api-route";
import { PermissionService } from "@/core/rbac/PermissionService";
import { findPossibleDuplicates } from "@/modules/crm/lead.service";

/** Backs the Add Lead form's live "possible duplicate" panel — the exact
 * same matching the save-time guard applies. */
export async function GET(req: NextRequest) {
  try {
    const session = await requireSession();
    await PermissionService.assert(session.user.id, "crm", "view");

    const sp = req.nextUrl.searchParams;
    const get = (k: string) => sp.get(k) ?? undefined;
    const duplicates = await findPossibleDuplicates(
      session.user.companyId,
      {
        email: get("email"),
        phone: get("phone"),
        whatsappNumber: get("whatsappNumber"),
        alternativePhone: get("alternativePhone"),
        companyName: get("companyName"),
        country: get("country"),
      },
      get("excludeId")
    );
    return NextResponse.json({ data: duplicates });
  } catch (error) {
    return handleApiError(error);
  }
}
