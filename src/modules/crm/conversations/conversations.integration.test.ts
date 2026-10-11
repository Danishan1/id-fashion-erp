/**
 * CRM unified conversations (Phase 11) against a real, migrated + seeded
 * Postgres database: channels, signed webhooks, normalisation, idempotency,
 * contact matching and the unmatched queue, outbound sending through the
 * provider adapter (HTTP mocked at fetch), DND, retry, delivery receipts,
 * notes, tasks, timelines, search, pagination, visibility and merges.
 *
 * Skipped unless CRM_IT_DATABASE_URL points at a DISPOSABLE database:
 *   CRM_IT_DATABASE_URL=postgresql://…/crm_it npx vitest run src/modules/crm/conversations/conversations.integration.test.ts
 *
 * Only permissions are mocked: `crm.view_all` is granted to "manager".
 */
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";

const DB_URL = process.env.CRM_IT_DATABASE_URL;
if (DB_URL) process.env.DATABASE_URL = DB_URL;
process.env.NEXTAUTH_SECRET ??= "integration-test-secret";

const viewAllUsers = new Set<string>();
vi.mock("@/core/rbac/PermissionService", () => ({
  PermissionService: {
    can: vi.fn(async (userId: string, _module: string, action: string) => (action === "view_all" ? viewAllUsers.has(userId) : true)),
    assert: vi.fn(async () => undefined),
    getAllowedBranchIds: vi.fn(async () => null),
    invalidate: vi.fn(),
  },
}));

type Actor = { companyId: string; userId: string; branchId: string | null };
// 1×1 PNG.
const PNG = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMB/6X8Z9oAAAAASUVORK5CYII=";

describe.skipIf(!DB_URL)("CRM conversations (database integration)", async () => {
  const { prisma } = await import("@/core/db/client");
  const channels = await import("./crm-channels.service");
  const conv = await import("./crm-conversations.service");
  const messaging = await import("./conversation-messaging.service");
  const companies = await import("../companies/crm-companies.service");
  const contacts = await import("../contacts/crm-contacts.service");
  const merge = await import("../contacts/contact-merge.service");
  const opps = await import("../opportunities/crm-opportunities.service");
  const notes = await import("../notes/crm-notes.service");
  const { linkedConversationIds } = await import("./crm-conversation.repository");
  const { listCrmEvents } = await import("../core/crm-events.service");
  const { signGenericPayload } = await import("@/core/communication/providers/generic-webhook.provider");
  const { parseConversationFilterParams } = await import("./conversation.schema");

  const run = `cv${Date.now().toString(36)}`;
  const digits = (n: number) => `9${String(Date.now()).slice(-6)}${String(n).padStart(3, "0")}`;
  let manager: Actor;
  let rep: Actor;
  let otherRep: Actor;
  let co: { id: string; name: string };
  let ct: { id: string; fullName: string; version: number };
  let opp: { id: string };
  let wa: { id: string; secret: string; version: number };
  let ig: { id: string; secret: string };
  let web: { id: string; secret: string };
  let mail: { id: string; secret: string; version: number };
  const phone = `+91 ${digits(1)}`;
  let seq = 0;
  const expectCode = (p: Promise<unknown>, code: string) => expect(p).rejects.toMatchObject({ code });
  const events = async (id: string) => (await prisma.crmEvent.findMany({ where: { entityId: id }, orderBy: [{ occurredAt: "asc" }, { id: "asc" }] })).map((e) => e.eventType);
  const deliver = (channel: { id: string; secret: string }, body: unknown, opts: { ts?: number; secret?: string } = {}) => {
    const raw = JSON.stringify(body);
    const ts = opts.ts ?? Math.floor(Date.now() / 1000);
    const headers = new Headers({ "x-crm-timestamp": String(ts), "x-crm-signature": signGenericPayload(opts.secret ?? channel.secret, ts, raw) });
    return messaging.handleChannelWebhook({ providerKey: "generic", channelId: channel.id, headers, rawBody: raw });
  };
  const inbound = (from: Record<string, unknown>, text: string, extra: Record<string, unknown> = {}) => ({ type: "message", id: `m-${run}-${++seq}`, from, text, ...extra });
  const firstResult = (r: Awaited<ReturnType<typeof deliver>>) => (r.paused ? null : (r.results[0] as { outcome: string; conversationId: string; messageId: string; conversationCreated: boolean }))!;
  const list = (actor: Actor, params: Record<string, string> = {}, search?: string) => conv.listConversations(actor, parseConversationFilterParams(new URLSearchParams(params)), { skip: 0, take: 100, search, sortBy: "lastMessageAt", sortOrder: "desc" });
  const fetchMock = vi.fn();

  beforeAll(async () => {
    const company = await prisma.company.findFirstOrThrow({ orderBy: { createdAt: "asc" } });
    const mk = (u: string, n: string) => prisma.user.create({ data: { companyId: company.id, email: `${u}.${run}@crm-it.local`, passwordHash: "x", fullName: `${n} ${run}` } });
    const [m, r, o] = await Promise.all([mk("cvmanager", "Meera Manager"), mk("cvrep", "Ashish Rep"), mk("cvother", "Zoya Other")]);
    manager = { companyId: company.id, userId: m.id, branchId: null };
    rep = { companyId: company.id, userId: r.id, branchId: null };
    otherRep = { companyId: company.id, userId: o.id, branchId: null };
    viewAllUsers.add(m.id);
    co = (await companies.createCompany(rep, { name: `ABC Textiles ${run}` })) as typeof co;
    ct = (await contacts.createContact(rep, { firstName: "Rahul", lastName: `Sharma ${run}`, mobile: phone, email: `rahul.${run}@abc.example`, crmCompanyId: co.id })) as typeof ct;
    opp = (await opps.createOpportunity(rep, { name: `Winter Order ${run}`, crmCompanyId: co.id, crmContactId: ct.id })) as typeof opp;
    wa = (await channels.createChannel(manager, { channelType: "WHATSAPP", name: `WhatsApp ${run}`, address: "+91 80000 00000", config: { outboundUrl: "https://relay.example.com/send" } })) as typeof wa;
    ig = await channels.createChannel(manager, { channelType: "INSTAGRAM", name: `Instagram ${run}` });
    web = await channels.createChannel(manager, { channelType: "WEB_CHAT", name: `Website chat ${run}`, defaultAssigneeUserId: rep.userId });
    mail = (await channels.createChannel(manager, { channelType: "EMAIL", name: `Support mail ${run}`, config: { outboundUrl: "https://relay.example.com/mail" } })) as typeof mail;
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => fetchMock.mockReset());
  afterAll(async () => {
    vi.unstubAllGlobals();
    await prisma.$disconnect();
  });

  // ── Channels ──

  it("creates channels with a one-time secret, encrypted at rest, and validates settings", async () => {
    expect(wa.secret).toMatch(/^whsec_/);
    const row = await prisma.crmChannel.findUniqueOrThrow({ where: { id: wa.id } });
    expect(row.secretEncrypted).not.toContain(wa.secret);
    const listed = await channels.listChannels(manager);
    const mine = listed.find((c) => c.id === wa.id)!;
    expect(mine).not.toHaveProperty("secret");
    expect(mine).not.toHaveProperty("secretEncrypted");
    expect(mine.path).toBe(`/api/v1/crm/webhooks/conversations/generic/${wa.id}`);
    expect(mine.capabilities).toMatchObject({ canSend: true, canReceive: true, supportsAttachments: true });
    expect(listed.find((c) => c.id === ig.id)!.capabilities).toMatchObject({ canSend: false });
    await expectCode(channels.createChannel(manager, { channelType: "SMS", name: `WhatsApp ${run}` }), "VALIDATION_ERROR");
    await expectCode(channels.createChannel(manager, { channelType: "SMS", name: `Bad ${run}`, config: { outboundUrl: "https://user:pw@relay.example.com" } }), "VALIDATION_ERROR");
    await expectCode(channels.createChannel(manager, { channelType: "SMS", name: `Bad2 ${run}`, config: { foo: 1 } }), "VALIDATION_ERROR");
  });

  // ── Inbound ──

  it("receives a signed WhatsApp message, matches the contact by phone and links company + sole open opportunity", async () => {
    const r = await deliver(wa, inbound({ phone, name: "Rahul S" }, "Can you send the quotation?"));
    const res = firstResult(r);
    expect(res).toMatchObject({ outcome: "created", conversationCreated: true });
    const c = await prisma.crmConversation.findUniqueOrThrow({ where: { id: res.conversationId } });
    expect(c).toMatchObject({ matchStatus: "MATCHED", contactId: ct.id, crmCompanyId: co.id, opportunityId: opp.id, unreadCount: 1, messageCount: 1, status: "OPEN", channelType: "WHATSAPP", lastMessageDirection: "INBOUND" });
    expect(await events(c.id)).toEqual(["conversation.created", "conversation.contact_linked", "conversation.company_linked", "conversation.opportunity_linked", "message.received"]);
    const ev = await prisma.crmEvent.findFirstOrThrow({ where: { entityId: c.id, eventType: "message.received" } });
    expect(ev.actorUserId).toBeNull();
    expect(ev.payload).toMatchObject({ schemaVersion: 1, conversationId: c.id, messageId: res.messageId, channelId: wa.id, channelType: "WHATSAPP", contactId: ct.id, crmCompanyId: co.id, opportunityId: opp.id, direction: "INBOUND" });
    expect(JSON.stringify(ev.payload)).not.toContain("quotation"); // no message body in the payload
    // Phase 04 contact's last activity bumped
    expect((await prisma.crmContact.findUniqueOrThrow({ where: { id: ct.id } })).lastActivityAt).not.toBeNull();
  });

  it("is idempotent on the provider message id — retries and concurrent deliveries store one message", async () => {
    const body = inbound({ phone }, "Same message");
    const first = firstResult(await deliver(wa, body));
    const again = firstResult(await deliver(wa, body));
    expect(again).toMatchObject({ outcome: "duplicate", messageId: first.messageId });
    const burst = inbound({ phone }, "Burst");
    const results = await Promise.all(Array.from({ length: 5 }, () => deliver(wa, burst)));
    const outcomes = results.map((x) => firstResult(x).outcome).sort();
    expect(outcomes.filter((o) => o === "created")).toHaveLength(1);
    expect(await prisma.crmMessage.count({ where: { channelId: wa.id, providerMessageId: burst.id } })).toBe(1);
    // All of them landed in the same conversation as before (same identity).
    expect(firstResult(results[0]).conversationId).toBe(first.conversationId);
  });

  it("rejects bad signatures, old timestamps, unknown channels and malformed payloads", async () => {
    await expectCode(deliver(wa, inbound({ phone }, "x"), { secret: "whsec_wrong" }), "INVALID_WEBHOOK_SIGNATURE");
    await expectCode(deliver(wa, inbound({ phone }, "x"), { ts: Math.floor(Date.now() / 1000) - 3600 }), "INVALID_WEBHOOK_SIGNATURE");
    await expectCode(messaging.handleChannelWebhook({ providerKey: "generic", channelId: "00000000-0000-4000-8000-000000000000", headers: new Headers(), rawBody: "{}" }), "NOT_FOUND");
    await expectCode(deliver(wa, { type: "message", id: "x1", from: { email: "a@b.c" }, text: "hi" }), "VALIDATION_ERROR"); // WhatsApp needs a phone
    await expectCode(deliver(wa, { type: "message", id: "x2", from: { phone } }), "VALIDATION_ERROR"); // no content
  });

  it("puts unknown senders in the unmatched queue — never creates a contact, never drops the message", async () => {
    const before = await prisma.crmContact.count();
    const stranger = `+91 ${digits(2)}`;
    const res = firstResult(await deliver(wa, inbound({ phone: stranger }, "Hi, I need information about polo shirts")));
    expect(await prisma.crmContact.count()).toBe(before);
    const c = await prisma.crmConversation.findUniqueOrThrow({ where: { id: res.conversationId } });
    expect(c).toMatchObject({ matchStatus: "UNMATCHED", contactId: null, assignedToUserId: null });
    const queue = await list(manager, { folder: "unmatched" });
    expect(queue.data.some((x) => x.id === c.id)).toBe(true);
    // Unassigned + unmatched: a salesperson without view_all can't see it; a manager triages.
    await expectCode(conv.getConversation(rep, c.id), "NOT_FOUND");
    expect((await list(rep, { folder: "unmatched" })).data.some((x) => x.id === c.id)).toBe(false);
    // Link the existing contact → normal inbox, participant learns the contact.
    const linked = await conv.linkConversation(manager, c.id, { version: c.version, contactId: ct.id });
    expect(linked).toMatchObject({ matchStatus: "MATCHED", contact: { id: ct.id }, company: { id: co.id } });
    expect((await prisma.crmConversationParticipant.findFirstOrThrow({ where: { conversationId: c.id, role: "CUSTOMER" } })).contactId).toBe(ct.id);
    expect(await events(c.id)).toEqual(expect.arrayContaining(["conversation.contact_linked", "conversation.company_linked"]));
    expect((await list(manager, { folder: "unmatched" })).data.some((x) => x.id === c.id)).toBe(false);
    // The rep owns the contact → now sees the unassigned conversation.
    expect((await conv.getConversation(rep, c.id)).id).toBe(c.id);
  });

  it("asks the user to choose when several contacts match, and learns provider identities once linked", async () => {
    const email = `shared.${run}@example.com`;
    const a = await contacts.createContact(rep, { firstName: "Anil", lastName: `One ${run}`, email });
    const b = await contacts.createContact(rep, { firstName: "Anil", lastName: `Two ${run}`, email, confirmDuplicate: true });
    const res = firstResult(await deliver(mail, inbound({ email, name: "Anil" }, "Who am I?", { subject: "Question" })));
    const c = await conv.getConversation(manager, res.conversationId);
    expect(c.matchStatus).toBe("MULTIPLE");
    expect(c.matchCandidates.map((x) => x.id).sort()).toEqual([a.id, b.id].sort());
    expect(c.subject).toBe("Question");

    // Instagram: provider id unknown → unmatched; once linked, a later conversation from that id matches by itself.
    const igUser = `ig-${run}`;
    const first = firstResult(await deliver(ig, inbound({ id: igUser, name: "rahul.s" }, "hello from insta")));
    const c1 = await prisma.crmConversation.findUniqueOrThrow({ where: { id: first.conversationId } });
    expect(c1.matchStatus).toBe("UNMATCHED");
    const linked = await conv.linkConversation(manager, c1.id, { version: c1.version, contactId: ct.id });
    await conv.changeConversationStatus(manager, c1.id, { version: linked.version, status: "ARCHIVED" });
    const second = firstResult(await deliver(ig, inbound({ id: igUser }, "me again")));
    expect(second.conversationId).not.toBe(c1.id); // archived conversations stay archived
    expect(await prisma.crmConversation.findUniqueOrThrow({ where: { id: second.conversationId } })).toMatchObject({ matchStatus: "MATCHED", contactId: ct.id });
  });

  it("accepts anonymous website chat and creates a contact from it through the duplicate rules", async () => {
    const res = firstResult(await deliver(web, inbound({ sessionId: `sess-${run}` }, "Do you make kids wear?")));
    const c = await conv.getConversation(manager, res.conversationId);
    expect(c).toMatchObject({ matchStatus: "UNMATCHED", assignedTo: { id: rep.userId } }); // channel default assignee
    expect(c.participants[0]).toMatchObject({ type: "ANONYMOUS", identifierKind: "SESSION" });
    expect(await prisma.notification.count({ where: { userId: rep.userId, relatedRecordId: c.id } })).toBe(1);
    // A task on an unmatched conversation lives on the conversation itself.
    const task = await conv.createTaskFromConversation(rep, c.id, { subject: "Reply with the kids-wear catalogue", messageId: res.messageId });
    expect(task.primary).toMatchObject({ entityType: "CONVERSATION", entityId: c.id, href: `/crm/inbox/${c.id}` });
    expect(task.description).toContain("Do you make kids wear?");
    // Same email as Rahul → duplicate rule (WARN) stops it; the user links Rahul instead or confirms.
    await expect(conv.createContactFromConversation(rep, c.id, { version: c.version, firstName: "Rahul", email: `rahul.${run}@abc.example` })).rejects.toMatchObject({ code: expect.stringMatching(/CRM_POSSIBLE_DUPLICATE|CRM_DUPLICATE_RECORD/) });
    const created = await conv.createContactFromConversation(rep, c.id, { version: c.version, firstName: "Kavya", lastName: `Visitor ${run}`, email: `kavya.${run}@example.com` });
    expect(created).toMatchObject({ matchStatus: "MATCHED", contact: { fullName: `Kavya Visitor ${run}` } });
  });

  it("stores inline files through the ERP file store and lists rejected or provider-hosted ones without storing them", async () => {
    const res = firstResult(
      await deliver(wa, inbound({ phone }, "", { attachments: [{ fileName: "swatch.png", mimeType: "image/png", contentBase64: PNG }, { fileName: "virus.exe", mimeType: "application/x-msdownload", contentBase64: Buffer.from("MZ...").toString("base64") }, { fileName: "voice.ogg", mimeType: "audio/ogg", mediaId: "media-123" }] }))
    );
    const files = await prisma.crmMessageAttachment.findMany({ where: { messageId: res.messageId }, orderBy: { createdAt: "asc" } });
    expect(files.map((f) => [f.fileName, Boolean(f.attachmentId), f.providerMediaRef])).toEqual([
      ["swatch.png", true, null],
      ["virus.exe", false, null],
      ["voice.ogg", false, "media-123"],
    ]);
    const stored = await prisma.attachment.findUniqueOrThrow({ where: { id: files[0].attachmentId! } });
    expect(stored).toMatchObject({ relatedModule: "CRM_CONVERSATION", relatedRecordId: res.conversationId });
    const dl = await conv.downloadMessageAttachment(rep, files[0].id);
    expect(dl.buffer.equals(Buffer.from(PNG, "base64"))).toBe(true);
    await expectCode(conv.downloadMessageAttachment(otherRep, files[0].id), "NOT_FOUND");
    await expectCode(conv.downloadMessageAttachment(rep, files[1].id), "NOT_FOUND");
    expect((await prisma.crmMessage.findUniqueOrThrow({ where: { id: res.messageId } })).messageType).toBe("IMAGE");
  });

  // ── Outbound ──

  const rahulConversation = async () => (await prisma.crmConversation.findFirstOrThrow({ where: { channelId: wa.id, contactId: ct.id, status: { not: "ARCHIVED" } }, orderBy: { createdAt: "asc" } })).id;
  const ok = (id: string) => Promise.resolve(new Response(JSON.stringify({ messageId: id }), { status: 200, headers: { "Content-Type": "application/json" } }));

  it("sends a reply through the provider adapter: signed, idempotent key, SENT + message.sent, unread cleared", async () => {
    const id = await rahulConversation();
    fetchMock.mockImplementationOnce(() => ok(`wamid-${run}-1`));
    const m = await messaging.sendConversationMessage(rep, id, { body: "Yes, 11 AM works." });
    expect(m).toMatchObject({ direction: "OUTBOUND", status: "SENT", body: "Yes, 11 AM works.", senderUser: { id: rep.userId } });
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://relay.example.com/send");
    const headers = init.headers as Record<string, string>;
    expect(headers["X-CRM-Idempotency-Key"]).toBe(m.id);
    expect(headers["X-CRM-Signature"]).toBe(signGenericPayload(wa.secret, headers["X-CRM-Timestamp"], String(init.body)));
    expect(JSON.parse(String(init.body))).toMatchObject({ id: m.id, to: { kind: "PHONE", value: phone }, text: "Yes, 11 AM works." });
    const row = await prisma.crmMessage.findUniqueOrThrow({ where: { id: m.id } });
    expect(row).toMatchObject({ status: "SENT", providerMessageId: `wamid-${run}-1`, attempts: 1 });
    const c = await prisma.crmConversation.findUniqueOrThrow({ where: { id } });
    expect(c).toMatchObject({ unreadCount: 0, lastMessageDirection: "OUTBOUND" });
    expect(await events(id)).toContain("message.sent");
    // Double submit with the same client id → the same message, one provider call.
    const clientMessageId = crypto.randomUUID();
    fetchMock.mockImplementationOnce(() => ok(`wamid-${run}-2`));
    const a = await messaging.sendConversationMessage(rep, id, { body: "Once", clientMessageId });
    const b = await messaging.sendConversationMessage(rep, id, { body: "Once", clientMessageId });
    expect(b.id).toBe(a.id);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("keeps the send when a relay returns a provider id already used on the channel", async () => {
    const id = await rahulConversation();
    fetchMock.mockImplementation(() => ok(`wamid-${run}-dup`));
    const first = await messaging.sendConversationMessage(rep, id, { body: "First" });
    const second = await messaging.sendConversationMessage(rep, id, { body: "Second" });
    expect([first.status, second.status]).toEqual(["SENT", "SENT"]);
    const rows = await prisma.crmMessage.findMany({ where: { id: { in: [first.id, second.id] } }, orderBy: { createdAt: "asc" } });
    expect(rows.map((r) => r.providerMessageId)).toEqual([`wamid-${run}-dup`, null]);
  });

  it("keeps a failed message with a safe reason, then retries it once with the same idempotency key", async () => {
    const id = await rahulConversation();
    fetchMock.mockImplementationOnce(() => Promise.resolve(new Response("upstream token=SECRET123 exploded", { status: 502 })));
    const failed = await messaging.sendConversationMessage(rep, id, { body: "Price list attached soon" });
    expect(failed).toMatchObject({ status: "FAILED", canRetry: true, error: { code: "PROVIDER_HTTP_502" } });
    const row = await prisma.crmMessage.findUniqueOrThrow({ where: { id: failed.id } });
    expect(JSON.stringify(row)).not.toContain("SECRET123");
    expect(await events(id)).toContain("message.failed");
    fetchMock.mockImplementation(() => ok(`wamid-${run}-retry`));
    const [r1, r2] = await Promise.allSettled([messaging.retryConversationMessage(rep, id, failed.id), messaging.retryConversationMessage(rep, id, failed.id)]);
    expect([r1.status, r2.status].sort()).toEqual(["fulfilled", "rejected"]);
    const after = await prisma.crmMessage.findUniqueOrThrow({ where: { id: failed.id } });
    expect(after).toMatchObject({ status: "SENT", attempts: 2, providerMessageId: `wamid-${run}-retry`, errorCode: null });
    expect(fetchMock).toHaveBeenCalledTimes(2); // original + one retry
    const keys = fetchMock.mock.calls.map((c) => (c[1] as RequestInit & { headers: Record<string, string> }).headers["X-CRM-Idempotency-Key"]);
    expect(new Set(keys)).toEqual(new Set([failed.id]));
    await expectCode(messaging.retryConversationMessage(rep, id, failed.id), "INVALID_STATE_TRANSITION");
  });

  it("enforces DND server-side: WhatsApp opt-out blocks sending (nothing stored, no provider call); notes and tasks still work", async () => {
    const id = await rahulConversation();
    const before = await prisma.crmMessage.count({ where: { conversationId: id } });
    await contacts.setContactability(rep, ct.id, { channel: "WHATSAPP", status: "UNSUBSCRIBED", reason: "Asked to stop WhatsApp" });
    await expectCode(messaging.sendConversationMessage(rep, id, { body: "Hello?" }), "CRM_CONTACT_NOT_CONTACTABLE");
    expect(fetchMock).not.toHaveBeenCalled();
    expect(await prisma.crmMessage.count({ where: { conversationId: id } })).toBe(before);
    const detail = await conv.getConversation(rep, id);
    expect(detail.contactability).toMatchObject({ allowed: false, decidedBy: "WHATSAPP" });
    expect(detail.permissions.send).toBe(false);
    // Email is still allowed for Rahul; internal note + task unaffected.
    const note = await notes.createNote(rep, "CONVERSATION", id, { body: "Customer is waiting for revised quotation." });
    expect(note.body).toContain("revised quotation");
    const task = await conv.createTaskFromConversation(rep, id, { subject: "Send revised quotation", dueDate: "2027-05-01" });
    expect(task.primary).toMatchObject({ entityType: "OPPORTUNITY", entityId: opp.id });
    expect(task.links.map((l) => l.entityType).sort()).toEqual(["COMPANY", "CONTACT", "CONVERSATION", "OPPORTUNITY"]);
    await contacts.setContactability(rep, ct.id, { channel: "WHATSAPP", status: "ALLOWED" });
    // A contact-wide restriction blocks channels that have no consent row of their own (e.g. Instagram).
    await contacts.setContactability(rep, ct.id, { channel: "ALL", status: "DO_NOT_CONTACT", reason: "Legal hold" });
    await expectCode(messaging.sendConversationMessage(rep, id, { body: "Hello?" }), "CRM_CONTACT_NOT_CONTACTABLE");
    await contacts.setContactability(rep, ct.id, { channel: "ALL", status: "ALLOWED" });
  });

  it("checks channel capabilities before sending", async () => {
    const igConv = await prisma.crmConversation.findFirstOrThrow({ where: { channelId: ig.id, status: { not: "ARCHIVED" } } });
    await expectCode(messaging.sendConversationMessage(manager, igConv.id, { body: "hi" }), "CRM_CHANNEL_UNAVAILABLE"); // no outbound URL
    const id = await rahulConversation();
    await expectCode(messaging.sendConversationMessage(rep, id, { body: "hi", subject: "Subject on WhatsApp" }), "VALIDATION_ERROR");
    await expectCode(messaging.sendConversationMessage(rep, id, { body: "   " }), "VALIDATION_ERROR");
    await expectCode(messaging.sendConversationMessage(rep, id, { body: "hi" }, [{ buffer: Buffer.from("a,b"), fileName: "x.csv", mimeType: "text/csv" }, ...Array.from({ length: 5 }, (_, i) => ({ buffer: Buffer.from(PNG, "base64"), fileName: `p${i}.png`, mimeType: "image/png" }))]), "VALIDATION_ERROR");
    // A paused channel can't send.
    const chan = await prisma.crmChannel.findUniqueOrThrow({ where: { id: wa.id } });
    await channels.updateChannel(manager, wa.id, { version: chan.version, status: "PAUSED" });
    await expectCode(messaging.sendConversationMessage(rep, id, { body: "hi" }), "CRM_CHANNEL_UNAVAILABLE");
    const paused = await deliver(wa, inbound({ phone }, "while paused"));
    expect(paused.paused).toBe(true);
    await channels.updateChannel(manager, wa.id, { version: chan.version + 1, status: "ACTIVE" });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("sends attachments inline to the provider and stores them in the ERP file store", async () => {
    const id = await rahulConversation();
    fetchMock.mockImplementationOnce(() => ok(`wamid-${run}-att`));
    const m = await messaging.sendConversationMessage(rep, id, { body: "" }, [{ buffer: Buffer.from(PNG, "base64"), fileName: "design.png", mimeType: "image/png" }]);
    expect(m).toMatchObject({ status: "SENT", messageType: "IMAGE", attachments: [{ fileName: "design.png", stored: true }] });
    expect(JSON.parse(String((fetchMock.mock.calls[0] as [string, RequestInit])[1].body)).attachments).toEqual([{ fileName: "design.png", mimeType: "image/png", contentBase64: PNG }]);
  });

  it("applies delivery receipts forward-only and idempotently", async () => {
    const id = await rahulConversation();
    fetchMock.mockImplementationOnce(() => ok(`wamid-${run}-rcpt`));
    const m = await messaging.sendConversationMessage(rep, id, { body: "Tracking receipts" });
    const status = (s: string) => deliver(wa, { type: "status", messageId: `wamid-${run}-rcpt`, status: s });
    expect((await status("read")).results?.[0]).toMatchObject({ outcome: "applied" });
    expect((await status("delivered")).results?.[0]).toMatchObject({ outcome: "ignored" }); // late, never goes back
    expect((await status("read")).results?.[0]).toMatchObject({ outcome: "ignored" });
    expect((await deliver(wa, { type: "status", messageId: "nope", status: "read" })).results?.[0]).toMatchObject({ outcome: "unknown_message" });
    const row = await prisma.crmMessage.findUniqueOrThrow({ where: { id: m.id } });
    expect(row.status).toBe("READ");
    expect(row.readAt).not.toBeNull();
    expect(row.deliveredAt).not.toBeNull();
    expect((await events(id)).filter((e) => e === "message.read")).toHaveLength(1);
  });

  // ── Thread, read state, search ──

  it("pages the thread newest-first with a cursor, merging messages, internal notes and events", async () => {
    const t0 = Date.now() - 60_000;
    const res = firstResult(await deliver(mail, inbound({ email: `pager.${run}@example.com` }, "msg 0", { timestamp: new Date(t0).toISOString() })));
    for (let i = 1; i < 30; i++) await deliver(mail, inbound({ email: `pager.${run}@example.com` }, `msg ${i}`, { timestamp: new Date(t0 + i * 1000).toISOString() }));
    await notes.createNote(manager, "CONVERSATION", res.conversationId, { body: "internal only" });
    const seen: string[] = [];
    let cursor: string | undefined;
    let pages = 0;
    do {
      const page = await conv.listThread(manager, res.conversationId, { before: cursor, limit: 12 });
      seen.unshift(...page.items.map((i) => (i as { id: string }).id));
      cursor = page.nextCursor ?? undefined;
      pages++;
    } while (cursor && pages < 10);
    const messages = await prisma.crmMessage.count({ where: { conversationId: res.conversationId } });
    const evs = await prisma.crmEvent.count({ where: { entityId: res.conversationId, eventType: { in: ["conversation.assigned", "conversation.status_changed", "conversation.closed", "conversation.reopened", "conversation.archived", "conversation.contact_linked", "conversation.company_linked", "conversation.opportunity_linked"] } } });
    expect(new Set(seen).size).toBe(seen.length);
    expect(seen).toHaveLength(messages + 1 + evs);
    expect(pages).toBe(3);
    const latest = await conv.listThread(manager, res.conversationId, { limit: 3 });
    expect(latest.items.map((i) => (i as { kind: string }).kind)).toContain("note");
    // Internal notes never become messages.
    expect(await prisma.crmMessage.count({ where: { conversationId: res.conversationId, body: "internal only" } })).toBe(0);
  });

  it("tracks unread per conversation and clears it up to the message on screen", async () => {
    const email = `unread.${run}@example.com`;
    const a = firstResult(await deliver(mail, inbound({ email }, "first", { timestamp: new Date(Date.now() - 60_000).toISOString() })));
    const b = firstResult(await deliver(mail, inbound({ email }, "second")));
    expect((await prisma.crmConversation.findUniqueOrThrow({ where: { id: a.conversationId } })).unreadCount).toBe(2);
    expect(await conv.markConversationRead(manager, a.conversationId, { upToMessageId: a.messageId })).toEqual({ unreadCount: 1 });
    expect(await conv.markConversationRead(manager, a.conversationId, { upToMessageId: b.messageId })).toEqual({ unreadCount: 0 });
    const counts = await conv.inboxCounts(manager);
    expect(counts.folders.all).toBeGreaterThan(0);
    expect(counts.channels.some((c) => c.channelId === mail.id)).toBe(true);
  });

  it("searches subjects, participants, linked records and message text on the server", async () => {
    const res = firstResult(await deliver(mail, inbound({ email: `search.${run}@example.com`, name: `Searchable ${run}` }, `Please share the revised quotation for ${run}`)));
    expect((await list(manager, {}, "quotation")).data.some((c) => c.id === res.conversationId)).toBe(true);
    expect((await list(manager, {}, "quot revis")).data.some((c) => c.id === res.conversationId)).toBe(true);
    expect((await list(manager, {}, `searchable ${run}`)).data.some((c) => c.id === res.conversationId)).toBe(true);
    expect((await list(manager, {}, `Sharma ${run}`)).data.length).toBeGreaterThan(0); // linked contact name
    expect((await list(manager, {}, "zzzz-not-there")).data).toHaveLength(0);
    expect((await list(manager, { channelTypes: "EMAIL", folder: "unread" })).data.every((c) => c.channel.channelType === "EMAIL" && c.unreadCount > 0)).toBe(true);
  });

  // ── Assignment, status, links ──

  it("assigns with history and notifications, reopens on new messages, and guards versions", async () => {
    const id = await rahulConversation();
    const c0 = await conv.getConversation(manager, id);
    const c1 = await conv.assignConversation(manager, id, { version: c0.version, assignedToUserId: rep.userId });
    expect(c1.assignedTo?.id).toBe(rep.userId);
    await expectCode(conv.assignConversation(manager, id, { version: c0.version, assignedToUserId: otherRep.userId }), "RECORD_VERSION_CONFLICT");
    const c2 = await conv.assignConversation(manager, id, { version: c1.version, assignedToUserId: otherRep.userId });
    await expectCode(conv.getConversation(rep, id), "NOT_FOUND"); // assigned to someone else now
    expect((await conv.getConversation(otherRep, id)).id).toBe(id);
    const assigned = await prisma.crmEvent.findMany({ where: { entityId: id, eventType: "conversation.assigned" }, orderBy: { occurredAt: "asc" } });
    expect(assigned.slice(-2).map((e) => e.summary)).toEqual([`Assigned to Ashish Rep ${run}`, `Reassigned from Ashish Rep ${run} to Zoya Other ${run}`]);
    expect(await prisma.notification.count({ where: { userId: otherRep.userId, relatedRecordId: id } })).toBe(1);
    const closed = await conv.changeConversationStatus(manager, id, { version: c2.version, status: "CLOSED" });
    expect(closed.status).toBe("CLOSED");
    await expectCode(conv.changeConversationStatus(manager, id, { version: closed.version, status: "PENDING" }), "INVALID_STATE_TRANSITION");
    await deliver(wa, inbound({ phone }, "One more thing"));
    expect((await prisma.crmConversation.findUniqueOrThrow({ where: { id } })).status).toBe("OPEN");
    expect(await events(id)).toEqual(expect.arrayContaining(["conversation.closed", "conversation.reopened"]));
    const back = await conv.getConversation(manager, id);
    await conv.assignConversation(manager, id, { version: back.version, assignedToUserId: null });
  });

  it("links, relinks and unlinks records with events, and refuses an opportunity of another company", async () => {
    const id = await rahulConversation();
    const other = await companies.createCompany(rep, { name: `XYZ Mills ${run}` });
    const otherOpp = await opps.createOpportunity(rep, { name: `Summer ${run}`, crmCompanyId: other.id });
    let c = await conv.getConversation(manager, id);
    await expectCode(conv.linkConversation(manager, id, { version: c.version, opportunityId: otherOpp.id }), "VALIDATION_ERROR");
    c = await conv.linkConversation(manager, id, { version: c.version, opportunityId: null });
    expect(c.opportunity).toBeNull();
    c = await conv.linkConversation(manager, id, { version: c.version, opportunityId: opp.id });
    const linkEvents = await prisma.crmEvent.findMany({ where: { entityId: id, eventType: "conversation.opportunity_linked" }, orderBy: { occurredAt: "asc" } });
    expect(linkEvents.slice(-2).map((e) => (e.payload as { toOpportunityId: string | null }).toOpportunityId)).toEqual([null, opp.id]);
    expect(c.opportunityChoices.some((o) => o.id === opp.id)).toBe(true);
  });

  // ── Timelines ──

  it("shows conversation activity on the contact, company and opportunity timelines (no delivery receipts)", async () => {
    const id = await rahulConversation();
    for (const [type, recordId] of [["CONTACT", ct.id], ["COMPANY", co.id], ["OPPORTUNITY", opp.id]] as const) {
      const ids = await linkedConversationIds(rep, type, [recordId]);
      expect(ids).toContain(id);
      const { data } = await listCrmEvents(rep.companyId, { entityType: type, entityId: recordId }, { page: 1, pageSize: 100, skip: 0, take: 100, sortBy: "occurredAt", sortOrder: "desc" }, [], [{ entityType: "CONVERSATION", ids, excludeEventTypes: ["message.delivered", "message.read"] }]);
      const types = data.map((e) => e.eventType);
      expect(types).toEqual(expect.arrayContaining(["message.received", "message.sent", "conversation.note_added"]));
      expect(types).not.toContain("message.read");
    }
    // Someone who can't open the conversation doesn't get its events on the contact timeline.
    expect(await linkedConversationIds(otherRep, "CONTACT", [ct.id])).not.toContain(id);
  });

  // ── Merge, sweeper ──

  it("moves conversations to the surviving contact on merge", async () => {
    const dupePhone = `+91 ${digits(3)}`;
    const dupe = await contacts.createContact(rep, { firstName: "Rahul", lastName: `Dupe ${run}`, mobile: dupePhone, confirmDuplicate: true });
    const res = firstResult(await deliver(wa, inbound({ phone: dupePhone }, "from the duplicate")));
    expect((await prisma.crmConversation.findUniqueOrThrow({ where: { id: res.conversationId } })).contactId).toBe(dupe.id);
    const s = await prisma.crmContact.findUniqueOrThrow({ where: { id: ct.id } });
    const d = await prisma.crmContact.findUniqueOrThrow({ where: { id: dupe.id } });
    await merge.mergeContacts(manager, { survivorId: ct.id, mergedId: dupe.id, survivorVersion: s.version, mergedVersion: d.version });
    expect((await prisma.crmConversation.findUniqueOrThrow({ where: { id: res.conversationId } })).contactId).toBe(ct.id);
    // The merged contact's number now matches the survivor.
    const next = firstResult(await deliver(wa, inbound({ phone: dupePhone }, "again")));
    expect(next.conversationId).toBe(res.conversationId);
  });

  it("marks sends interrupted mid-flight as failed (never resent automatically)", async () => {
    const id = await rahulConversation();
    const m = await prisma.crmMessage.create({ data: { companyId: rep.companyId, conversationId: id, channelId: wa.id, direction: "OUTBOUND", body: "stuck", status: "QUEUED", attempts: 1, lastAttemptAt: new Date(Date.now() - 60 * 60_000) } });
    const r = await messaging.failStaleOutboundMessages();
    expect(r.failed).toBeGreaterThanOrEqual(1);
    expect(await prisma.crmMessage.findUniqueOrThrow({ where: { id: m.id } })).toMatchObject({ status: "FAILED", errorCode: "SEND_INTERRUPTED" });
    expect((await messaging.failStaleOutboundMessages()).failed).toBe(0);
  });

  it("never writes events for a change that rolled back", async () => {
    const id = await rahulConversation();
    const count = await prisma.crmEvent.count({ where: { entityId: id } });
    const c = await conv.getConversation(manager, id);
    await expectCode(conv.changeConversationStatus(manager, id, { version: c.version + 99, status: "PENDING" }), "RECORD_VERSION_CONFLICT");
    expect(await prisma.crmEvent.count({ where: { entityId: id } })).toBe(count);
  });
});
