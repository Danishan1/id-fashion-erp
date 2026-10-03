import { notFound } from "next/navigation";
import { CrmPageHeader } from "@/components/crm/CrmPageHeader";
import { getCrmCompanyForActor } from "@/modules/crm/companies/crm-companies.service";
import { getCrmPageContext } from "@/modules/crm/core/crm-page";
import { ContactForm } from "../_components/ContactForm";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** /crm/contacts/new[?companyId=<crm company>] — the company is preselected when the caller can see it. */
export default async function NewContactPage({ searchParams }: { searchParams: Promise<{ companyId?: string }> }) {
  const { actor, permissions } = await getCrmPageContext();
  if (!permissions.create) notFound();
  const { companyId } = await searchParams;
  const company = companyId && UUID.test(companyId) ? await getCrmCompanyForActor(actor, companyId).catch(() => null) : null;
  return (
    <>
      <CrmPageHeader title="New contact" breadcrumbs={[{ label: "Contacts", href: "/crm/contacts" }, { label: "New" }]} />
      <ContactForm currentUserId={actor.userId} initialCompany={company ? { id: company.id, name: company.name } : null} />
    </>
  );
}
