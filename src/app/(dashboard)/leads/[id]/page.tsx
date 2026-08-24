import { notFound } from "next/navigation";
import { auth } from "@/core/auth/auth";
import { getLeadById } from "@/modules/crm/lead.service";
import { Breadcrumb } from "@/components/ui/Breadcrumb";
import { LeadWorkflowPanel } from "./LeadWorkflowPanel";

export default async function LeadDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const session = await auth();

  const lead = await getLeadById(session!.user.companyId, id).catch(() => null);
  if (!lead) notFound();

  return (
    <div className="space-y-4">
      <Breadcrumb items={[{ label: "Dashboard", href: "/dashboard" }, { label: "Leads", href: "/leads" }, { label: lead.leadNumber }]} />
      <h1 className="text-lg font-semibold text-zinc-900 dark:text-zinc-50">
        {lead.leadNumber} — {lead.name}
      </h1>
      <LeadWorkflowPanel key={id} lead={JSON.parse(JSON.stringify(lead))} />
    </div>
  );
}
