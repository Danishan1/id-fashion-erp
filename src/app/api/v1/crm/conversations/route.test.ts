import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const m = vi.hoisted(() => ({
  requireSession: vi.fn(),
  assert: vi.fn(),
  can: vi.fn(),
  svc: {} as Record<string, ReturnType<typeof vi.fn>>,
  msg: {} as Record<string, ReturnType<typeof vi.fn>>,
  ch: {} as Record<string, ReturnType<typeof vi.fn>>,
  notes: { listNotes: vi.fn(), createNote: vi.fn() },
}));
for (const k of ["listConversations", "inboxCounts", "getConversation", "updateConversation", "listThread", "markConversationRead", "assignConversation", "changeConversationStatus", "linkConversation", "createContactFromConversation", "createTaskFromConversation", "downloadMessageAttachment"]) m.svc[k] = vi.fn();
for (const k of ["sendConversationMessage", "retryConversationMessage", "handleChannelWebhook"]) m.msg[k] = vi.fn();
for (const k of ["listChannels", "listInboxChannels", "channelSettingsMeta", "createChannel", "updateChannel", "rotateChannelSecret"]) m.ch[k] = vi.fn();

vi.mock("@/lib/api-route", async () => {
  const { toErrorResponse } = await import("@/core/errors/BusinessRuleError");
  return {
    requireSession: m.requireSession,
    handleApiError: (error: unknown) => {
      const { status, body } = toErrorResponse(error);
      return Response.json(body, { status });
    },
  };
});
vi.mock("@/core/rbac/PermissionService", () => ({ PermissionService: { assert: m.assert, can: m.can } }));
vi.mock("@/modules/crm/conversations/crm-conversations.service", () => m.svc);
vi.mock("@/modules/crm/conversations/conversation-messaging.service", () => m.msg);
vi.mock("@/modules/crm/conversations/crm-channels.service", () => m.ch);
vi.mock("@/modules/crm/notes/crm-notes.service", () => m.notes);

const r = {
  list: await import("./route"),
  counts: await import("./counts/route"),
  meta: await import("./meta/route"),
  one: await import("./[id]/route"),
  messages: await import("./[id]/messages/route"),
  retry: await import("./[id]/messages/[messageId]/retry/route"),
  read: await import("./[id]/read/route"),
  assign: await import("./[id]/assign/route"),
  status: await import("./[id]/status/route"),
  link: await import("./[id]/link/route"),
  createContact: await import("./[id]/create-contact/route"),
  tasks: await import("./[id]/tasks/route"),
  notes: await import("./[id]/notes/route"),
  download: await import("./attachments/[attachmentId]/download/route"),
  channels: await import("../settings/channels/route"),
  channel: await import("../settings/channels/[id]/route"),
  rotate: await import("../settings/channels/[id]/rotate-secret/route"),
  webhook: await import("../webhooks/conversations/[provider]/[channelId]/route"),
};
const ID = "6f1c2f1e-1f2a-4b1a-9d1a-2b3c4d5e6f70";
const ACTOR = { companyId: "co-1", userId: "user-1", branchId: null };
const ctx = <P,>(params: P) => ({ params: Promise.resolve(params) });
const post = (b: unknown) => new NextRequest("http://x", { method: "POST", body: JSON.stringify(b) });
const lastPerm = () => m.assert.mock.calls.at(-1)!.slice(1);

beforeEach(() => {
  m.requireSession.mockReset().mockResolvedValue({ user: { id: "user-1", companyId: "co-1", defaultBranchId: null } });
  m.assert.mockReset().mockResolvedValue(undefined);
  m.can.mockReset().mockResolvedValue(true);
  for (const fn of [...Object.values(m.svc), ...Object.values(m.msg), ...Object.values(m.ch), m.notes.listNotes, m.notes.createNote]) fn.mockReset().mockResolvedValue({ ok: true });
  m.svc.listConversations.mockResolvedValue({ data: [], totalCount: 0 });
});

describe("CRM conversation routes", () => {
  it("inbox list needs crm.view and passes filters, search and paging through", async () => {
    const res = await r.list.GET(new NextRequest(`http://x/api/v1/crm/conversations?folder=unmatched&channelTypes=WHATSAPP&statuses=OPEN,PENDING&search=quotation&page=2&pageSize=25`), ctx({}));
    expect(res.status).toBe(200);
    expect(lastPerm()).toEqual(["crm", "view"]);
    const [actor, filter, query] = m.svc.listConversations.mock.calls[0];
    expect(actor).toEqual(ACTOR);
    expect(filter).toMatchObject({ folder: "unmatched", channelTypes: ["WHATSAPP"], statuses: ["OPEN", "PENDING"] });
    expect(query).toMatchObject({ search: "quotation", page: 2, pageSize: 25, skip: 25, sortBy: "lastMessageAt" });
    expect((await r.list.GET(new NextRequest("http://x/api/v1/crm/conversations?folder=spam"), ctx({}))).status).toBe(400);
  });

  it("maps every action to the existing ERP permissions (no CRM-specific role system)", async () => {
    const cases: [() => Promise<Response>, [string, string]][] = [
      [() => r.counts.GET(new NextRequest("http://x"), ctx({})), ["crm", "view"]],
      [() => r.one.GET(new NextRequest("http://x"), ctx({ id: ID })), ["crm", "view"]],
      [() => r.one.PATCH(new NextRequest("http://x", { method: "PATCH", body: "{}" }), ctx({ id: ID })), ["crm", "edit"]],
      [() => r.messages.GET(new NextRequest("http://x?before=abc&limit=20"), ctx({ id: ID })), ["crm", "view"]],
      [() => r.messages.POST(post({ body: "hi" }), ctx({ id: ID })), ["crm", "create"]],
      [() => r.retry.POST(post({}), ctx({ id: ID, messageId: ID })), ["crm", "create"]],
      [() => r.read.POST(post({}), ctx({ id: ID })), ["crm", "view"]],
      [() => r.assign.POST(post({}), ctx({ id: ID })), ["crm", "edit"]],
      [() => r.status.POST(post({}), ctx({ id: ID })), ["crm", "edit"]],
      [() => r.link.POST(post({}), ctx({ id: ID })), ["crm", "edit"]],
      [() => r.createContact.POST(post({}), ctx({ id: ID })), ["crm", "create"]],
      [() => r.tasks.POST(post({}), ctx({ id: ID })), ["crm", "create"]],
      [() => r.notes.GET(new NextRequest("http://x"), ctx({ id: ID })), ["crm", "view"]],
      [() => r.notes.POST(post({ body: "n" }), ctx({ id: ID })), ["crm", "create"]],
      [() => r.channels.GET(new NextRequest("http://x"), ctx({})), ["crm_settings", "view"]],
      [() => r.channels.POST(post({}), ctx({})), ["crm_settings", "edit"]],
      [() => r.channel.PATCH(new NextRequest("http://x", { method: "PATCH", body: "{}" }), ctx({ id: ID })), ["crm_settings", "edit"]],
      [() => r.rotate.POST(post({}), ctx({ id: ID })), ["crm_settings", "edit"]],
    ];
    for (const [call, perm] of cases) {
      const res = await call();
      expect(res.status, perm.join(".")).toBeLessThan(300);
      expect(lastPerm()).toEqual(perm);
    }
    expect(m.svc.listThread).toHaveBeenCalledWith(ACTOR, ID, { before: "abc", limit: "20" });
    expect(m.notes.createNote).toHaveBeenCalledWith(ACTOR, "CONVERSATION", ID, { body: "n" });
  });

  it("refuses without permission and without a session", async () => {
    const { BusinessRuleError } = await import("@/core/errors/BusinessRuleError");
    m.assert.mockRejectedValueOnce(new BusinessRuleError("PERMISSION_DENIED", "No."));
    expect((await r.messages.POST(post({ body: "hi" }), ctx({ id: ID }))).status).toBe(403);
    expect(m.msg.sendConversationMessage).not.toHaveBeenCalled();
    m.requireSession.mockRejectedValueOnce(new BusinessRuleError("PERMISSION_DENIED", "Sign in required."));
    expect((await r.list.GET(new NextRequest("http://x"), ctx({}))).status).toBe(403);
    expect(m.svc.listConversations).not.toHaveBeenCalled();
  });

  it("send accepts JSON or multipart with files, and surfaces DND / channel errors", async () => {
    const form = new FormData();
    form.set("body", "See attached");
    form.set("clientMessageId", ID);
    form.append("files", new File([new Uint8Array([1, 2, 3])], "a.pdf", { type: "application/pdf" }));
    const res = await r.messages.POST(new NextRequest("http://x", { method: "POST", body: form }), ctx({ id: ID }));
    expect(res.status).toBe(201);
    const [, , body, files] = m.msg.sendConversationMessage.mock.calls[0];
    expect(body).toEqual({ body: "See attached", clientMessageId: ID });
    expect(files[0]).toMatchObject({ fileName: "a.pdf", mimeType: "application/pdf" });
    expect(Buffer.isBuffer(files[0].buffer)).toBe(true);

    const { BusinessRuleError } = await import("@/core/errors/BusinessRuleError");
    m.msg.sendConversationMessage.mockRejectedValueOnce(new BusinessRuleError("CRM_CONTACT_NOT_CONTACTABLE", "Opted out of WhatsApp."));
    const dnd = await r.messages.POST(post({ body: "hi" }), ctx({ id: ID }));
    expect(dnd.status).toBe(422);
    expect(await dnd.json()).toMatchObject({ error: { code: "CRM_CONTACT_NOT_CONTACTABLE" } });
    m.msg.sendConversationMessage.mockRejectedValueOnce(new BusinessRuleError("CRM_CHANNEL_UNAVAILABLE", "Paused."));
    expect((await r.messages.POST(post({ body: "hi" }), ctx({ id: ID }))).status).toBe(422);
  });

  it("downloads attachments with safe headers", async () => {
    m.svc.downloadMessageAttachment.mockResolvedValue({ fileName: "a b.pdf", mimeType: "application/pdf", buffer: Buffer.from("PDF") });
    const res = await r.download.GET(new NextRequest("http://x?disposition=inline"), ctx({ attachmentId: ID }));
    expect(res.headers.get("content-disposition")).toBe('inline; filename="a%20b.pdf"');
    expect(res.headers.get("x-content-type-options")).toBe("nosniff");
    expect(await res.text()).toBe("PDF");
  });

  it("meta lists channels and capabilities without secrets", async () => {
    m.ch.listInboxChannels.mockResolvedValue([{ id: ID, name: "WA", capabilities: { canSend: false } }]);
    const body = await (await r.meta.GET(new NextRequest("http://x"), ctx({}))).json();
    expect(body.data.channels).toEqual([{ id: ID, name: "WA", capabilities: { canSend: false } }]);
    expect(body.data.folders.map((f: { key: string }) => f.key)).toEqual(["all", "unread", "mine", "unassigned", "unmatched"]);
  });
});

describe("conversation webhook route (public)", () => {
  const hook = (body: string, params = { provider: "generic", channelId: ID }, headers: Record<string, string> = {}) => r.webhook.POST(new NextRequest("http://x", { method: "POST", body, headers }), ctx(params));

  it("needs no session, passes the raw body to the provider layer, and answers with per-event results", async () => {
    m.msg.handleChannelWebhook.mockResolvedValue({ paused: false, received: 1, results: [{ outcome: "created" }] });
    const res = await hook('{"type":"message"}', undefined, { "x-crm-signature": "sha256=abc" });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ data: { received: 1, results: [{ outcome: "created" }] } });
    expect(m.requireSession).not.toHaveBeenCalled();
    const arg = m.msg.handleChannelWebhook.mock.calls[0][0];
    expect(arg).toMatchObject({ providerKey: "generic", channelId: ID, rawBody: '{"type":"message"}' });
    expect(arg.headers.get("x-crm-signature")).toBe("sha256=abc");
  });

  it("404s malformed ids, 401s bad signatures, 503s paused channels, 413s huge bodies", async () => {
    expect((await hook("{}", { provider: "generic", channelId: "not-a-uuid" })).status).toBe(404);
    expect((await hook("{}", { provider: "../etc", channelId: ID })).status).toBe(404);
    const { BusinessRuleError } = await import("@/core/errors/BusinessRuleError");
    m.msg.handleChannelWebhook.mockRejectedValueOnce(new BusinessRuleError("INVALID_WEBHOOK_SIGNATURE", "Invalid signature."));
    expect((await hook("{}")).status).toBe(401);
    m.msg.handleChannelWebhook.mockResolvedValueOnce({ paused: true });
    const paused = await hook("{}");
    expect(paused.status).toBe(503);
    expect(paused.headers.get("retry-after")).toBe("300");
    expect((await hook("{}", undefined, { "content-length": String(13 * 1024 * 1024) })).status).toBe(413);
  });
});
