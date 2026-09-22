import { NextRequest, NextResponse } from "next/server";
import { requireSession, handleApiError } from "@/lib/api-route";
import { PermissionService } from "@/core/rbac/PermissionService";
import { replaceProjectPiecesSchema } from "@/modules/ai-designer/ai-designer.schema";
import { listProjectPieces, replaceProjectPieces } from "@/modules/ai-designer/ai-designer.service";

interface RouteContext {
  params: Promise<{ id: string }>;
}

/** Multi-piece Set support (Step 5, SET-mode projects only) — the list of garment pieces (e.g. Kurta, Pant, Dupatta) making up this coordinated outfit. */
export async function GET(_req: NextRequest, { params }: RouteContext) {
  try {
    const session = await requireSession();
    await PermissionService.assert(session.user.id, "ai_designer", "view");

    const { id } = await params;
    const data = await listProjectPieces(session.user.companyId, id);

    return NextResponse.json({ data });
  } catch (error) {
    return handleApiError(error);
  }
}

/** Full-replace-on-save — an empty array clears every piece, a real state, not a no-op. */
export async function PUT(req: NextRequest, { params }: RouteContext) {
  try {
    const session = await requireSession();
    await PermissionService.assert(session.user.id, "ai_designer", "edit");

    const { id } = await params;
    const input = replaceProjectPiecesSchema.parse(await req.json());
    const data = await replaceProjectPieces({ companyId: session.user.companyId, userId: session.user.id }, id, input);

    return NextResponse.json({ data });
  } catch (error) {
    return handleApiError(error);
  }
}
