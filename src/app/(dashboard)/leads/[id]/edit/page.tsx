import { notFound } from "next/navigation";
import { auth } from "@/core/auth/auth";
import { PermissionService } from "@/core/rbac/PermissionService";
import { getLeadById } from "@/modules/crm/lead.service";
import { Breadcrumb } from "@/components/ui/Breadcrumb";
import { LeadForm } from "../../LeadForm";

export default async function EditLeadPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const session = await auth();
  await PermissionService.assert(session!.user.id, "crm", "view", { sessionIssuedAt: session!.user.sessionIssuedAt }).catch(() => notFound());

  const lead = await getLeadById(session!.user.companyId, id).catch(() => null);
  if (!lead) notFound();

  return (
    <div className="space-y-4">
      <Breadcrumb
        items={[
          { label: "Dashboard", href: "/dashboard" },
          { label: "Leads", href: "/leads" },
          { label: lead.leadNumber, href: `/leads/${id}` },
          { label: "Edit" },
        ]}
      />
      <h1 className="text-lg font-semibold text-zinc-900 dark:text-zinc-50">Edit {lead.leadNumber}</h1>
      <LeadForm key={id} initialLead={JSON.parse(JSON.stringify(lead))} />
    </div>
  );
}
