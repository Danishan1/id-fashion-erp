import { NextResponse } from "next/server";
import { CONVERSATION_STATUSES, INBOX_FOLDERS } from "@/modules/crm/conversations/conversation-registry";
import { listInboxChannels } from "@/modules/crm/conversations/crm-channels.service";
import { crmRoute } from "@/modules/crm/core/crm-route";
import { getCrmRecordScope } from "@/modules/crm/core/crm-visibility";

/** Inbox lookups: configured channels with their capabilities (no secrets), statuses and folders. */
export const GET = crmRoute("view", async ({ actor }) =>
  NextResponse.json({
    data: {
      channels: await listInboxChannels(actor),
      statuses: Object.entries(CONVERSATION_STATUSES).map(([key, v]) => ({ key, label: v.label })),
      folders: Object.entries(INBOX_FOLDERS).map(([key, label]) => ({ key, label })),
      canViewAll: (await getCrmRecordScope(actor)).mode === "ALL",
    },
  })
);
