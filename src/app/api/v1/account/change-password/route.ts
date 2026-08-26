import { NextResponse } from "next/server";
import { requireSession, handleApiError } from "@/lib/api-route";
import { changeOwnPassword } from "@/modules/account/account.service";
import { changePasswordSchema } from "@/modules/account/account.schema";

// No PermissionService.assert here, deliberately — this is self-scoped by
// construction (changeOwnPassword only ever touches the caller's own row),
// the same category as "view your own session." requireSession() has
// already confirmed the caller is a real, active, not-password-stale user.
export async function POST(req: Request) {
  try {
    const session = await requireSession();
    const input = changePasswordSchema.parse(await req.json());
    await changeOwnPassword({ companyId: session.user.companyId, userId: session.user.id }, input);
    return NextResponse.json({ data: { ok: true } });
  } catch (error) {
    return handleApiError(error);
  }
}
