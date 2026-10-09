import { notFound } from "next/navigation";
import { CrmPageHeader } from "@/components/crm/CrmPageHeader";
import { getContact } from "@/modules/crm/contacts/crm-contacts.service";
import { getCrmPageContext } from "@/modules/crm/core/crm-page";
import { ContactDetailClient } from "../_components/ContactDetailClient";
import type { ContactDetailDto } from "../_components/contact-types";

export default async function ContactDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { actor, permissions } = await getCrmPageContext();
  const contact = await getContact(actor, id).catch(() => null);
  if (!contact) notFound();
  // Same JSON shape the API returns (Date → ISO string).
  const dto = JSON.parse(JSON.stringify(contact)) as ContactDetailDto;
  return (
    <>
      <CrmPageHeader title="Contact" breadcrumbs={[{ label: "Contacts", href: "/crm/contacts" }, { label: dto.fullName }]} />
      <ContactDetailClient initialContact={dto} permissions={permissions} currentUserId={actor.userId} />
    </>
  );
}
