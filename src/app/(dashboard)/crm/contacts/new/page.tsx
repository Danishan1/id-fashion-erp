import { notFound } from "next/navigation";
import { CrmPageHeader } from "@/components/crm/CrmPageHeader";
import { getCrmPageContext } from "@/modules/crm/core/crm-page";
import { ContactForm } from "../_components/ContactForm";

export default async function NewContactPage() {
  const { actor, permissions } = await getCrmPageContext();
  if (!permissions.create) notFound();
  return (
    <>
      <CrmPageHeader title="New contact" breadcrumbs={[{ label: "Contacts", href: "/crm/contacts" }, { label: "New" }]} />
      <ContactForm currentUserId={actor.userId} />
    </>
  );
}
