import { notFound } from "next/navigation";
import { getPlatformPageUser } from "@/modules/platform/platform-page";
import { Breadcrumb } from "@/components/ui/Breadcrumb";
import { BusinessRuleError } from "@/core/errors/BusinessRuleError";
import { getPlatformTicket, listAssignablePlatformUsers } from "@/modules/support-tickets/support-ticket.service";
import { PlatformTicketDetailClient } from "./PlatformTicketDetailClient";

/** Platform SaaS Phase 5 (PLAT-030): reply, add internal notes, change status / priority / owner. */
export default async function PlatformTicketDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await getPlatformPageUser();
  if (!user) notFound();
  const { id } = await params;
  const [ticket, assignees] = await Promise.all([
    getPlatformTicket(id).catch((err) => {
      if (err instanceof BusinessRuleError) notFound();
      throw err;
    }),
    listAssignablePlatformUsers(),
  ]);

  const messages = ticket.messages.map((m) => ({
    id: m.id,
    authorType: m.authorType,
    authorLabel:
      m.authorType === "PLATFORM"
        ? `${m.authorPlatformUser?.fullName ?? "Platform"} (support)`
        : `${m.authorUser?.fullName ?? "Customer"} · ${ticket.company.name}`,
    body: m.body,
    isInternal: m.isInternal,
    createdAt: m.createdAt.toISOString(),
    attachments: m.attachments,
  }));

  return (
    <div className="space-y-4">
      <Breadcrumb
        items={[
          { label: "Platform", href: "/platform" },
          { label: "Support Tickets", href: "/platform/tickets" },
          { label: ticket.ticketNumber },
        ]}
      />
      <PlatformTicketDetailClient
        key={ticket.id}
        ticket={{
          id: ticket.id,
          ticketNumber: ticket.ticketNumber,
          subject: ticket.subject,
          category: ticket.category,
          priority: ticket.priority,
          status: ticket.status,
          assignedToId: ticket.assignedTo?.id ?? "",
          company: ticket.company,
          createdBy: ticket.createdBy,
          createdAt: ticket.createdAt.toISOString(),
        }}
        messages={messages}
        assignees={assignees}
        canRequestAccess={user.role === "PLATFORM_SUPER_ADMIN" || user.role === "SUPPORT_AGENT"}
      />
    </div>
  );
}
