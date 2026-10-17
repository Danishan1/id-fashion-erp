import { CrmPageHeader } from "@/components/crm/CrmPageHeader";
import { getCrmPageContext } from "@/modules/crm/core/crm-page";
import { InboxClient } from "./_components/InboxClient";

/** Phase 11 — the unified CRM inbox: every channel's conversations in one place. ?folder=&channel=&status=&c= */
export default async function CrmInboxPage({ searchParams }: { searchParams: Promise<{ folder?: string; channel?: string; status?: string; c?: string }> }) {
  const { actor, permissions } = await getCrmPageContext();
  const sp = await searchParams;
  return (
    <>
      <CrmPageHeader title="Inbox" description={permissions.viewAll ? "Conversations from every channel, across the team." : "Your conversations and those of your contacts."} breadcrumbs={[{ label: "Inbox" }]} />
      <InboxClient currentUserId={actor.userId} initial={{ folder: sp.folder, channel: sp.channel, status: sp.status, conversationId: sp.c }} />
    </>
  );
}
