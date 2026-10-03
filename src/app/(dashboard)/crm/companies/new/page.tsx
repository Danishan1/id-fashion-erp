import { notFound } from "next/navigation";
import { CrmPageHeader } from "@/components/crm/CrmPageHeader";
import { getCrmPageContext } from "@/modules/crm/core/crm-page";
import { CompanyForm } from "../_components/CompanyForm";

export default async function NewCompanyPage() {
  const { actor, permissions } = await getCrmPageContext();
  if (!permissions.create) notFound();
  return (
    <>
      <CrmPageHeader title="New company" breadcrumbs={[{ label: "Companies", href: "/crm/companies" }, { label: "New" }]} />
      <CompanyForm currentUserId={actor.userId} />
    </>
  );
}
