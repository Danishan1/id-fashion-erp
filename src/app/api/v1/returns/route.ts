import { NextRequest, NextResponse } from "next/server";
import { requireSession, handleApiError } from "@/lib/api-route";
import { PermissionService } from "@/core/rbac/PermissionService";
import { createCustomerReturn, listCustomerReturns } from "@/modules/returns/customer-return.service";

/** Same either-module rule the Customer Returns page itself uses. */
const RETURNS_VIEW = [
  ["barcodes", "view"],
  ["dispatch", "view"],
] as const;

export async function GET() {
  try {
    const session = await requireSession();
    await PermissionService.assertAny(session.user.id, RETURNS_VIEW);
    const returns = await listCustomerReturns({
      companyId: session.user.companyId,
      userId: session.user.id,
    });
    return NextResponse.json({ data: returns });
  } catch (error) {
    return handleApiError(error);
  }
}

export async function POST(req: NextRequest) {
  try {
    const session = await requireSession();
    // Receiving a return can restock finished goods (an inventory ledger
    // write), so it needs a real create grant, not just a login.
    await PermissionService.assert(session.user.id, "dispatch", "create");
    const body = await req.json();

    const result = await createCustomerReturn(
      { companyId: session.user.companyId, userId: session.user.id },
      body
    );

    return NextResponse.json({ data: result }, { status: 201 });
  } catch (error) {
    return handleApiError(error);
  }
}
