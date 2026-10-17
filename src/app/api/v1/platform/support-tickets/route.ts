import { NextRequest, NextResponse } from "next/server";
import type { SupportTicketStatus } from "@prisma/client";
import { requirePlatformSession, handleApiError } from "@/lib/api-route";
import { TICKET_STATUSES } from "@/modules/support-tickets/support-ticket.schema";
import { listPlatformTickets } from "@/modules/support-tickets/support-ticket.service";

/** PLAT-029: the platform ticket inbox. `?status=ACTIVE|ALL|<status>&assigned=ME|UNASSIGNED&companyId=&search=` */
export async function GET(req: NextRequest) {
  try {
    const { platformUser } = await requirePlatformSession();
    const sp = req.nextUrl.searchParams;
    const rawStatus = sp.get("status") ?? "ACTIVE";
    const status =
      rawStatus === "ALL" || rawStatus === "ACTIVE" || (TICKET_STATUSES as readonly string[]).includes(rawStatus)
        ? (rawStatus as SupportTicketStatus | "ACTIVE" | "ALL")
        : "ACTIVE";
    const assigned = sp.get("assigned");
    const data = await listPlatformTickets(
      { platformUserId: platformUser.id, role: platformUser.role },
      {
        status,
        assigned: assigned === "ME" || assigned === "UNASSIGNED" ? assigned : undefined,
        companyId: sp.get("companyId") || undefined,
        search: sp.get("search") || undefined,
      }
    );
    return NextResponse.json({ data });
  } catch (error) {
    return handleApiError(error);
  }
}
