import { notFound } from "next/navigation";
import { CrmPageHeader } from "@/components/crm/CrmPageHeader";
import { getCompany } from "@/modules/crm/companies/crm-companies.service";
import { getCrmPageContext } from "@/modules/crm/core/crm-page";
import { CompanyForm } from "../../_components/CompanyForm";
import type { CompanyDetailDto } from "../../_components/company-types";

export default async function EditCompanyPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { actor, permissions } = await getCrmPageContext();
  if (!permissions.edit) notFound();
  const company = await getCompany(actor, id).catch(() => null);
  if (!company || company.archivedAt || company.mergedIntoId) notFound();
  const dto = JSON.parse(JSON.stringify(company)) as CompanyDetailDto;
  return (
    <>
      <CrmPageHeader title={`Edit ${dto.name}`} breadcrumbs={[{ label: "Companies", href: "/crm/companies" }, { label: dto.name, href: `/crm/companies/${dto.id}` }, { label: "Edit" }]} />
      <CompanyForm company={dto} currentUserId={actor.userId} />
    </>
  );
}
