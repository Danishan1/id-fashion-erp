import { notFound } from "next/navigation";
import { CrmPageHeader } from "@/components/crm/CrmPageHeader";
import { TemplateEditor } from "@/components/crm/templates/TemplateEditor";
import type { TemplateDetailDto } from "@/components/crm/templates/template-types";
import { BusinessRuleError } from "@/core/errors/BusinessRuleError";
import { getCrmPageContext } from "@/modules/crm/core/crm-page";
import { getTemplate } from "@/modules/crm/templates/crm-templates.service";

export default async function EditTemplatePage({ params }: { params: Promise<{ id: string }> }) {
  const { actor, permissions } = await getCrmPageContext();
  const { id } = await params;
  const t = await getTemplate(actor, id).catch((e) => {
    if (e instanceof BusinessRuleError && e.code === "NOT_FOUND") notFound();
    throw e;
  });
  // Dates → strings, as the API returns them.
  const dto = JSON.parse(JSON.stringify(t)) as TemplateDetailDto;
  return (
    <>
      <CrmPageHeader title={`Edit: ${t.name}`} breadcrumbs={[{ label: "Templates", href: "/crm/templates" }, { label: t.name, href: `/crm/templates/${id}` }, { label: "Edit" }]} />
      <TemplateEditor template={dto} canCreate={permissions.create} canEdit={permissions.edit && t.status !== "ARCHIVED"} />
    </>
  );
}
