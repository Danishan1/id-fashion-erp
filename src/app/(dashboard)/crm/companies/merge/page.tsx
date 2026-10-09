import { notFound } from "next/navigation";
import { CrmPageHeader } from "@/components/crm/CrmPageHeader";
import { getCrmPageContext } from "@/modules/crm/core/crm-page";
import { CompanyMergeClient } from "../_components/CompanyMergeClient";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** /crm/companies/merge?ids=<keep>[,<merge>] */
export default async function MergeCompaniesPage({ searchParams }: { searchParams: Promise<{ ids?: string }> }) {
  const { permissions } = await getCrmPageContext();
  if (!permissions.edit) notFound();
  const { ids } = await searchParams;
  const initialIds = (ids ?? "").split(",").filter((s) => UUID.test(s)).slice(0, 2);
  return (
    <>
      <CrmPageHeader title="Merge companies" description="Combine two records of the same organisation. Nothing is deleted, and ERP customers are never merged here." breadcrumbs={[{ label: "Companies", href: "/crm/companies" }, { label: "Merge" }]} />
      <CompanyMergeClient initialIds={initialIds} />
    </>
  );
}
