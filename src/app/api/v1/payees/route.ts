import { NextRequest, NextResponse } from "next/server";
import { requireSession, handleApiError } from "@/lib/api-route";
import { PermissionService } from "@/core/rbac/PermissionService";
import { payeeSchema } from "@/modules/finance-config/finance-config.schema";
import { createPayee, listPayees } from "@/modules/finance-config/payee-purpose.service";

/** Readable by finance masters users and by anyone who raises payment requests (pay-to picker). */
export async function GET() {
  try {
    const session = await requireSession();
    await PermissionService.assertAny(session.user.id, [
      ["masters_finance", "view"],
      ["payment_requests", "view"],
    ]);
    return NextResponse.json({ data: await listPayees(session.user.companyId) });
  } catch (error) {
    return handleApiError(error);
  }
}

export async function POST(req: NextRequest) {
  try {
    const session = await requireSession();
    await PermissionService.assert(session.user.id, "masters_finance", "create");

    const input = payeeSchema.parse(await req.json());
    const payee = await createPayee({ companyId: session.user.companyId, userId: session.user.id }, input);
    return NextResponse.json({ data: payee }, { status: 201 });
  } catch (error) {
    return handleApiError(error);
  }
}
