import { notFound } from "next/navigation";
import { CrmPageHeader } from "@/components/crm/CrmPageHeader";
import { getCompany } from "@/modules/crm/companies/crm-companies.service";
import { getCrmPageContext } from "@/modules/crm/core/crm-page";
import { CompanyDetailClient } from "../_components/CompanyDetailClient";
import type { CompanyDetailDto } from "../_components/company-types";

export default async function CompanyDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { actor, permissions } = await getCrmPageContext();
  const company = await getCompany(actor, id).catch(() => null);
  if (!company) notFound();
  // Same JSON shape the API returns (Date → ISO string).
  const dto = JSON.parse(JSON.stringify(company)) as CompanyDetailDto;
  return (
    <>
      <CrmPageHeader title="Company" breadcrumbs={[{ label: "Companies", href: "/crm/companies" }, { label: dto.name }]} />
      <CompanyDetailClient initialCompany={dto} permissions={permissions} currentUserId={actor.userId} />
    </>
  );
}
