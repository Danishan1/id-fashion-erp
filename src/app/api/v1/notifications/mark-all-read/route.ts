import { NextResponse } from "next/server";
import { requireSession, handleApiError } from "@/lib/api-route";
import { markAllNotificationsRead } from "@/core/notifications/NotificationService";

export async function POST() {
  try {
    const session = await requireSession();
    await markAllNotificationsRead(session.user.companyId, session.user.id);
    return NextResponse.json({ data: { ok: true } });
  } catch (error) {
    return handleApiError(error);
  }
}
