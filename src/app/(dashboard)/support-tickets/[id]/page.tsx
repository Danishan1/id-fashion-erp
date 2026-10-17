import { notFound } from "next/navigation";
import { auth } from "@/core/auth/auth";
import { Breadcrumb } from "@/components/ui/Breadcrumb";
import { BusinessRuleError } from "@/core/errors/BusinessRuleError";
import { getTenantTicket } from "@/modules/support-tickets/support-ticket.service";
import { TicketDetailClient } from "./TicketDetailClient";

export default async function SupportTicketDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user?.id || session.user.userType === "SUPPORT") notFound();
  const { id } = await params;
  const ticket = await getTenantTicket({ userId: session.user.id, companyId: session.user.companyId }, id).catch((err) => {
    if (err instanceof BusinessRuleError) notFound();
    throw err;
  });

  const messages = ticket.messages.map((m) => ({
    id: m.id,
    authorType: m.authorType,
    // Customers see "Support team" rather than the individual operator.
    authorLabel: m.authorType === "PLATFORM" ? "Support team" : (m.authorUser?.fullName ?? "Customer"),
    body: m.body,
    isInternal: false,
    createdAt: m.createdAt.toISOString(),
    attachments: m.attachments,
  }));

  return (
    <div className="space-y-4">
      <Breadcrumb
        items={[
          { label: "Dashboard", href: "/dashboard" },
          { label: "Help & Support", href: "/support-tickets" },
          { label: ticket.ticketNumber },
        ]}
      />
      <TicketDetailClient
        key={ticket.id}
        ticket={{
          id: ticket.id,
          ticketNumber: ticket.ticketNumber,
          subject: ticket.subject,
          category: ticket.category,
          priority: ticket.priority,
          status: ticket.status,
          createdBy: ticket.createdBy.fullName,
          createdAt: ticket.createdAt.toISOString(),
        }}
        messages={messages}
      />
    </div>
  );
}
