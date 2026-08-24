import { NextRequest, NextResponse } from "next/server";
import { requireSession, handleApiError } from "@/lib/api-route";
import { listNotifications, getUnreadNotificationCount } from "@/core/notifications/NotificationService";

// No RBAC module check — a notification only ever targets the requesting
// user's own `userId` (see NotificationService), so there's nothing to
// authorize beyond being logged in, matching this project's own precedent
// for purely-self-scoped reads (e.g. "my" resources have no separate module).
export async function GET(req: NextRequest) {
  try {
    const session = await requireSession();
    const unreadOnly = req.nextUrl.searchParams.get("unreadOnly") === "true";

    const [data, unreadCount] = await Promise.all([
      listNotifications(session.user.companyId, session.user.id, { unreadOnly }),
      getUnreadNotificationCount(session.user.companyId, session.user.id),
    ]);

    return NextResponse.json({ data, meta: { unreadCount } });
  } catch (error) {
    return handleApiError(error);
  }
}
