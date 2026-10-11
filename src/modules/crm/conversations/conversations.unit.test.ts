import { describe, expect, it } from "vitest";
import { decideMatch } from "./conversation-matching";
import { canApplyDeliveryStatus, canChangeConversationStatus, CONTACTABILITY_CHANNEL_FOR, CONVERSATION_EVENT_TYPES, identifierKey, messagePreview } from "./conversation-registry";
import { conversationTaskSchema, createChannelSchema, linkConversationSchema, parseConversationFilterParams, sendMessageSchema } from "./conversation.schema";
import { CRM_EVENT_TYPES } from "../core/crm-event-types";

describe("conversation lifecycle", () => {
  it("allows exactly the documented status changes", () => {
    expect(canChangeConversationStatus("OPEN", "PENDING")).toBe(true);
    expect(canChangeConversationStatus("OPEN", "CLOSED")).toBe(true);
    expect(canChangeConversationStatus("PENDING", "OPEN")).toBe(true);
    expect(canChangeConversationStatus("CLOSED", "OPEN")).toBe(true);
    expect(canChangeConversationStatus("ARCHIVED", "OPEN")).toBe(true);
    expect(canChangeConversationStatus("CLOSED", "PENDING")).toBe(false);
    expect(canChangeConversationStatus("ARCHIVED", "CLOSED")).toBe(false);
    expect(canChangeConversationStatus("NOPE", "OPEN")).toBe(false);
  });

  it("only moves delivery status forward; a later success beats an earlier failure", () => {
    expect(canApplyDeliveryStatus("QUEUED", "SENT")).toBe(true);
    expect(canApplyDeliveryStatus("SENT", "READ")).toBe(true);
    expect(canApplyDeliveryStatus("READ", "DELIVERED")).toBe(false);
    expect(canApplyDeliveryStatus("DELIVERED", "DELIVERED")).toBe(false);
    expect(canApplyDeliveryStatus("SENT", "FAILED")).toBe(true);
    expect(canApplyDeliveryStatus("DELIVERED", "FAILED")).toBe(false);
    expect(canApplyDeliveryStatus("FAILED", "DELIVERED")).toBe(true);
    expect(canApplyDeliveryStatus("RECEIVED", "READ")).toBe(false);
  });
});

describe("identities, matching and contactability", () => {
  it("normalises identifiers the same way contacts are keyed", () => {
    expect(identifierKey("EMAIL", "  Rahul@ABC.com ")).toBe("rahul@abc.com");
    expect(identifierKey("PHONE", "+91 98100-12345")).toBe("9810012345");
    expect(identifierKey("PHONE", "123")).toBeNull();
    expect(identifierKey("PROVIDER_ID", " psid-1 ")).toBe("psid-1");
  });

  it("never guesses between several contacts", () => {
    const c = (id: string, archived = false) => ({ id, archivedAt: archived ? new Date() : null, mergedIntoId: null, crmCompanyId: `co-${id}` });
    expect(decideMatch([], "EMAIL")).toBeNull();
    expect(decideMatch([c("a")], "PHONE")).toEqual({ status: "MATCHED", contactId: "a", crmCompanyId: "co-a", candidateIds: [], matchedBy: "PHONE" });
    expect(decideMatch([c("a"), c("b")], "EMAIL")).toMatchObject({ status: "MULTIPLE", contactId: null, candidateIds: ["a", "b"] });
    expect(decideMatch([c("a", true), c("b")], "EMAIL")).toMatchObject({ status: "MATCHED", contactId: "b" });
  });

  it("maps every channel to the Phase 04 contactability channel that governs it", () => {
    expect(CONTACTABILITY_CHANNEL_FOR).toEqual({ EMAIL: "EMAIL", SMS: "SMS", WHATSAPP: "WHATSAPP", FACEBOOK_MESSENGER: null, INSTAGRAM: null, WEB_CHAT: null, OTHER: null });
  });

  it("builds inbox previews", () => {
    expect(messagePreview("  Can   we\nmeet? ", 0)).toBe("Can we meet?");
    expect(messagePreview("x".repeat(200), 0)).toHaveLength(140);
    expect(messagePreview("", 2)).toBe("[2 attachments]");
    expect(messagePreview("", 0, "LOCATION")).toBe("[Location]");
  });

  it("registers every automation event on the CONVERSATION entity", () => {
    for (const e of CONVERSATION_EVENT_TYPES) expect(CRM_EVENT_TYPES[e]?.entityType).toBe("CONVERSATION");
    for (const e of ["message.received", "message.sent", "message.failed", "message.delivered", "message.read", "conversation.created", "conversation.assigned", "conversation.closed"]) expect(CONVERSATION_EVENT_TYPES).toContain(e);
  });
});

describe("conversation schemas", () => {
  it("parses inbox filters and refuses unknown values", () => {
    const f = parseConversationFilterParams(new URLSearchParams({ folder: "unmatched", statuses: "OPEN,CLOSED", channelTypes: "WHATSAPP,EMAIL", unread: "true" }));
    expect(f).toMatchObject({ folder: "unmatched", statuses: ["OPEN", "CLOSED"], channelTypes: ["WHATSAPP", "EMAIL"], unread: "true", channelIds: [] });
    expect(parseConversationFilterParams(new URLSearchParams()).folder).toBe("all");
    expect(() => parseConversationFilterParams(new URLSearchParams({ statuses: "DELETED" }))).toThrow();
    expect(() => parseConversationFilterParams(new URLSearchParams({ folder: "spam" }))).toThrow();
    expect(() => parseConversationFilterParams(new URLSearchParams({ from: "2026-10-10", to: "2026-10-01" }))).toThrow();
  });

  it("validates actions", () => {
    expect(sendMessageSchema.safeParse({ body: "hi", direction: "INBOUND" }).success).toBe(false); // strict: no smuggled fields
    expect(sendMessageSchema.parse({}).body).toBe("");
    expect(linkConversationSchema.safeParse({ version: 1 }).success).toBe(false);
    expect(linkConversationSchema.parse({ version: 1, contactId: "" })).toEqual({ version: 1, contactId: null });
    expect(conversationTaskSchema.safeParse({ subject: "Call back", reminderMinutes: 7 }).success).toBe(false);
    expect(createChannelSchema.safeParse({ channelType: "TELEGRAM", name: "x" }).success).toBe(false);
    expect(createChannelSchema.parse({ channelType: "SMS", name: "Gateway" }).provider).toBe("generic");
  });
});
