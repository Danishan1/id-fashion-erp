import { notFound } from "next/navigation";
import { CrmPageHeader } from "@/components/crm/CrmPageHeader";
import { getCrmPageContext } from "@/modules/crm/core/crm-page";
import { ContactMergeClient } from "../_components/ContactMergeClient";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** /crm/contacts/merge?ids=<keep>[,<merge>] */
export default async function MergeContactsPage({ searchParams }: { searchParams: Promise<{ ids?: string }> }) {
  const { permissions } = await getCrmPageContext();
  if (!permissions.edit) notFound();
  const { ids } = await searchParams;
  const initialIds = (ids ?? "").split(",").filter((s) => UUID.test(s)).slice(0, 2);
  return (
    <>
      <CrmPageHeader title="Merge contacts" description="Combine two records of the same person. Nothing is deleted." breadcrumbs={[{ label: "Contacts", href: "/crm/contacts" }, { label: "Merge" }]} />
      <ContactMergeClient initialIds={initialIds} />
    </>
  );
}
