import { notFound } from "next/navigation";
import { CrmPageHeader } from "@/components/crm/CrmPageHeader";
import { getContact } from "@/modules/crm/contacts/crm-contacts.service";
import { getCrmPageContext } from "@/modules/crm/core/crm-page";
import { ContactForm } from "../../_components/ContactForm";
import type { ContactDetailDto } from "../../_components/contact-types";

export default async function EditContactPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { actor, permissions } = await getCrmPageContext();
  if (!permissions.edit) notFound();
  const contact = await getContact(actor, id).catch(() => null);
  if (!contact || contact.archivedAt || contact.mergedIntoId) notFound();
  const dto = JSON.parse(JSON.stringify(contact)) as ContactDetailDto;
  return (
    <>
      <CrmPageHeader title={`Edit ${dto.fullName}`} breadcrumbs={[{ label: "Contacts", href: "/crm/contacts" }, { label: dto.fullName, href: `/crm/contacts/${dto.id}` }, { label: "Edit" }]} />
      <ContactForm contact={dto} currentUserId={actor.userId} />
    </>
  );
}
