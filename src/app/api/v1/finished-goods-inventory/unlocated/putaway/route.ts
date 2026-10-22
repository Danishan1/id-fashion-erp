import { NextRequest, NextResponse } from "next/server";
import { requireSession, handleApiError } from "@/lib/api-route";
import { PermissionService } from "@/core/rbac/PermissionService";
import { bulkPutawayStock } from "@/modules/finished-goods-inventory/finished-goods-putaway.service";
import { bulkPutawaySchema } from "@/modules/finished-goods-inventory/finished-goods-putaway.schema";

/** Bulk "set location" for unlocated Finished Goods rows — each row is its own put-away. */
export async function POST(req: NextRequest) {
  try {
    const session = await requireSession();
    await PermissionService.assert(session.user.id, "fg_inventory", "edit");
    const input = bulkPutawaySchema.parse(await req.json());
    const data = await bulkPutawayStock({ companyId: session.user.companyId, userId: session.user.id }, input);
    return NextResponse.json({ data });
  } catch (error) {
    return handleApiError(error);
  }
}
