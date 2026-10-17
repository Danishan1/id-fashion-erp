import { notFound } from "next/navigation";
import { CrmPageHeader } from "@/components/crm/CrmPageHeader";
import { TemplateDetail } from "@/components/crm/templates/TemplateDetail";
import { BusinessRuleError } from "@/core/errors/BusinessRuleError";
import { getCrmPageContext } from "@/modules/crm/core/crm-page";
import { getTemplate } from "@/modules/crm/templates/crm-templates.service";

export default async function TemplateDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { actor, permissions } = await getCrmPageContext();
  const { id } = await params;
  const t = await getTemplate(actor, id).catch((e) => {
    if (e instanceof BusinessRuleError && e.code === "NOT_FOUND") notFound();
    throw e;
  });
  return (
    <>
      <CrmPageHeader title={t.name} description={t.description ?? undefined} breadcrumbs={[{ label: "Templates", href: "/crm/templates" }, { label: t.name }]} />
      <TemplateDetail templateId={id} canCreate={permissions.create} canEdit={permissions.edit} />
    </>
  );
}
