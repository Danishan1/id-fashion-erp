import { NextRequest, NextResponse } from "next/server";
import { requireSession, handleApiError } from "@/lib/api-route";
import { PermissionService } from "@/core/rbac/PermissionService";
import { returnDispatchItems } from "@/modules/dispatch/dispatch-return.service";
import { dispatchReturnSchema } from "@/modules/dispatch/dispatch.schema";

/** Customer return (whole or partial, with a remark): pieces go back to the same colour/size and location. */
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await requireSession();
    await PermissionService.assert(session.user.id, "dispatch", "cancel");
    const { id } = await params;
    const input = dispatchReturnSchema.parse(await req.json());
    const data = await returnDispatchItems(
      { companyId: session.user.companyId, userId: session.user.id },
      id,
      input
    );
    return NextResponse.json({ data }, { status: 201 });
  } catch (error) {
    return handleApiError(error);
  }
}
