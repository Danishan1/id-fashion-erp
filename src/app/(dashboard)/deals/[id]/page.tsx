import { notFound } from "next/navigation";
import { auth } from "@/core/auth/auth";
import { PermissionService } from "@/core/rbac/PermissionService";
import { getDealById } from "@/modules/crm/deal.service";
import { Breadcrumb } from "@/components/ui/Breadcrumb";
import { DealWorkflowPanel } from "./DealWorkflowPanel";

export default async function DealDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const session = await auth();
  await PermissionService.assert(session!.user.id, "crm", "view", { sessionIssuedAt: session!.user.sessionIssuedAt }).catch(() => notFound());

  const deal = await getDealById(session!.user.companyId, id).catch(() => null);
  if (!deal) notFound();

  return (
    <div className="space-y-4">
      <Breadcrumb items={[{ label: "Dashboard", href: "/dashboard" }, { label: "Deals", href: "/deals" }, { label: deal.dealNumber }]} />
      <h1 className="text-lg font-semibold text-zinc-900 dark:text-zinc-50">
        {deal.dealNumber} — {deal.title}
      </h1>
      <DealWorkflowPanel key={id} deal={JSON.parse(JSON.stringify(deal))} />
    </div>
  );
}
