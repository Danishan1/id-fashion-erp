import Link from "next/link";
import { notFound } from "next/navigation";
import { auth } from "@/core/auth/auth";
import { Breadcrumb } from "@/components/ui/Breadcrumb";
import { TicketPriorityText, TicketStatusBadge } from "@/components/support/TicketThread";
import { listTenantTickets } from "@/modules/support-tickets/support-ticket.service";
import {
  TICKET_CATEGORY_LABELS,
  TICKET_PRIORITY_LABELS,
  TICKET_STATUS_LABELS,
} from "@/modules/support-tickets/support-ticket.schema";

/** Platform SaaS Phase 5 (PLAT-028): my support tickets. */
export default async function SupportTicketsPage() {
  const session = await auth();
  if (!session?.user?.id || session.user.userType === "SUPPORT") notFound();
  const { tickets, seesAllCompanyTickets } = await listTenantTickets({
    userId: session.user.id,
    companyId: session.user.companyId,
  });

  return (
    <div className="space-y-4">
      <Breadcrumb items={[{ label: "Dashboard", href: "/dashboard" }, { label: "Help & Support" }]} />
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-lg font-semibold text-zinc-900 dark:text-zinc-50">Help &amp; Support</h1>
          <p className="mt-1 text-sm text-zinc-500">
            {seesAllCompanyTickets
              ? "Every support ticket raised by your company. Our support team replies here."
              : "Your support tickets. Our support team replies here."}
          </p>
        </div>
        <Link
          href="/support-tickets/new"
          className="rounded-md bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-500"
        >
          New ticket
        </Link>
      </div>

      <div className="overflow-x-auto rounded-lg border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-900">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-zinc-200 text-left text-xs uppercase tracking-wide text-zinc-500 dark:border-zinc-800">
              <th className="px-4 py-2 font-medium">Ticket</th>
              <th className="px-4 py-2 font-medium">Subject</th>
              <th className="px-4 py-2 font-medium">Category</th>
              <th className="px-4 py-2 font-medium">Priority</th>
              <th className="px-4 py-2 font-medium">Status</th>
              {seesAllCompanyTickets && <th className="px-4 py-2 font-medium">Raised by</th>}
              <th className="px-4 py-2 font-medium">Last update</th>
            </tr>
          </thead>
          <tbody>
            {tickets.length === 0 && (
              <tr>
                <td colSpan={7} className="px-4 py-8 text-center text-zinc-500">
                  No tickets yet. Raise one if you need help.
                </td>
              </tr>
            )}
            {tickets.map((t) => (
              <tr key={t.id} className="border-b border-zinc-100 last:border-0 hover:bg-zinc-50 dark:border-zinc-800 dark:hover:bg-zinc-800/50">
                <td className="px-4 py-2 font-mono">
                  <Link href={`/support-tickets/${t.id}`} className="text-indigo-600 hover:underline">
                    {t.ticketNumber}
                  </Link>
                </td>
                <td className="px-4 py-2">
                  <Link href={`/support-tickets/${t.id}`} className="text-zinc-900 hover:underline dark:text-zinc-50">
                    {t.subject}
                  </Link>
                  {t.status === "WAITING_ON_CUSTOMER" && (
                    <span className="ml-2 text-xs font-medium text-amber-700 dark:text-amber-400">Reply needed</span>
                  )}
                </td>
                <td className="px-4 py-2">{TICKET_CATEGORY_LABELS[t.category]}</td>
                <td className="px-4 py-2">
                  <TicketPriorityText priority={t.priority} label={TICKET_PRIORITY_LABELS[t.priority]} />
                </td>
                <td className="px-4 py-2">
                  <TicketStatusBadge status={t.status} label={TICKET_STATUS_LABELS[t.status]} />
                </td>
                {seesAllCompanyTickets && <td className="px-4 py-2">{t.createdBy.fullName}</td>}
                <td className="px-4 py-2 text-zinc-500">
                  {t.lastMessageAt.toLocaleString("en-IN", {
                    day: "numeric",
                    month: "short",
                    hour: "2-digit",
                    minute: "2-digit",
                    timeZone: "Asia/Kolkata",
                  })}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
