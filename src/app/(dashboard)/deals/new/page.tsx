import { Breadcrumb } from "@/components/ui/Breadcrumb";
import { auth } from "@/core/auth/auth";
import { prisma } from "@/core/db/client";
import { DealForm } from "../DealForm";

/** `?leadId=` (the lead page's "Create Opportunity" action) pre-selects the
 * lead and pre-fills a title and value from it — only after confirming the
 * lead belongs to the signed-in user's own company. */
export default async function NewDealPage({ searchParams }: { searchParams: Promise<{ leadId?: string }> }) {
  const { leadId } = await searchParams;
  const session = await auth();
  const lead =
    leadId && session
      ? await prisma.lead
          .findFirst({ where: { id: leadId, companyId: session.user.companyId }, select: { id: true, name: true, companyName: true, value: true } })
          .catch(() => null)
      : null;

  return (
    <div className="space-y-4">
      <Breadcrumb
        items={[
          { label: "Dashboard", href: "/dashboard" },
          { label: "Opportunities", href: "/deals" },
          ...(lead ? [{ label: lead.companyName ?? lead.name, href: `/leads/${lead.id}` }] : []),
          { label: "New" },
        ]}
      />
      <h1 className="text-lg font-semibold text-zinc-900 dark:text-zinc-50">New Opportunity</h1>
      <DealForm
        defaultLeadId={lead?.id}
        defaultTitle={lead ? `${lead.companyName ?? lead.name} — ` : undefined}
        defaultValue={lead ? String(lead.value) : undefined}
      />
    </div>
  );
}
