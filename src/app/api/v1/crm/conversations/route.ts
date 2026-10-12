import { parseListQuery } from "@/lib/list-query";
import { parseConversationFilterParams } from "@/modules/crm/conversations/conversation.schema";
import { listConversations } from "@/modules/crm/conversations/crm-conversations.service";
import { crmListResponse, crmRoute } from "@/modules/crm/core/crm-route";

/**
 * Unified inbox (Phase 11). Query: folder (all | unread | mine | unassigned |
 * unmatched), statuses (CSV; default OPEN,PENDING — record filters default to
 * everything but ARCHIVED), channelIds, channelTypes, assignedToUserId,
 * contactId, companyId, opportunityId, unread, from / to (last activity,
 * YYYY-MM-DD), search (subject, participants, linked records, channel, plus
 * full-text message bodies), sortBy (lastMessageAt | createdAt), page, pageSize.
 * Only conversations the caller may open are returned.
 */
export const GET = crmRoute("view", async ({ req, actor }) => {
  const sp = req.nextUrl.searchParams;
  const query = parseListQuery(sp, "lastMessageAt");
  const { data, totalCount } = await listConversations(actor, parseConversationFilterParams(sp), query);
  return crmListResponse(data, totalCount, query);
});
