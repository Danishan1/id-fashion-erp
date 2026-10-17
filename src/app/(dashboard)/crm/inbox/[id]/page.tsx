import { CrmPageHeader } from "@/components/crm/CrmPageHeader";
import { getCrmPageContext } from "@/modules/crm/core/crm-page";
import { InboxClient } from "../_components/InboxClient";

/** Deep link to one conversation (timelines, tasks, record pages): the inbox with it open. */
export default async function CrmConversationPage({ params }: { params: Promise<{ id: string }> }) {
  const { actor } = await getCrmPageContext();
  const { id } = await params;
  return (
    <>
      <CrmPageHeader title="Inbox" breadcrumbs={[{ label: "Inbox", href: "/crm/inbox" }, { label: "Conversation" }]} />
      <InboxClient currentUserId={actor.userId} initial={{ conversationId: id }} />
    </>
  );
}
