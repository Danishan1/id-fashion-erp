import { notFound } from "next/navigation";
import { auth } from "@/core/auth/auth";
import { PermissionService } from "@/core/rbac/PermissionService";
import { getLeadById } from "@/modules/crm/lead.service";
import { Breadcrumb } from "@/components/ui/Breadcrumb";
import { LeadWorkflowPanel } from "./LeadWorkflowPanel";

export default async function LeadDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const session = await auth();
  // The equivalent API route already gates on this — this page previously
  // called the service directly with no check at all, letting anyone
  // authenticated view a lead's full details via a direct URL regardless of
  // role. Denying reads as a plain 404 (not a distinct "forbidden" page)
  // deliberately doesn't reveal whether the record exists to a caller
  // without view rights, matching the notFound() below for the same reason.
  await PermissionService.assert(session!.user.id, "crm", "view").catch(() => notFound());

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
