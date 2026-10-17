import { notFound } from "next/navigation";
import { CrmPageHeader } from "@/components/crm/CrmPageHeader";
import { TemplateEditor } from "@/components/crm/templates/TemplateEditor";
import { getCrmPageContext } from "@/modules/crm/core/crm-page";

export default async function NewTemplatePage() {
  const { permissions } = await getCrmPageContext();
  if (!permissions.create) notFound();
  return (
    <>
      <CrmPageHeader title="New template" breadcrumbs={[{ label: "Templates", href: "/crm/templates" }, { label: "New" }]} />
      <TemplateEditor template={null} canCreate={permissions.create} canEdit={permissions.edit} />
    </>
  );
}
