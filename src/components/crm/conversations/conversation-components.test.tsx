// @vitest-environment jsdom
import { cleanup, configure, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Generous async timeout: these screens chain several fetches, and the full suite runs files in parallel.
configure({ asyncUtilTimeout: 4000 });

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }), usePathname: () => "/crm/inbox", useSearchParams: () => new URLSearchParams() }));
const toasts = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn(), warning: vi.fn(), info: vi.fn() }));
vi.mock("@/components/ui/Toast", () => ({ toast: toasts }));

const { ConversationView } = await import("./ConversationView");
const { MessageComposer, MessageBubble } = await import("./ConversationThread");
const { mergeThread, shortWhen } = await import("./conversation-types");
type Detail = import("./conversation-types").ConversationDetailDto;
type Msg = import("./conversation-types").ThreadMessage;

const json = (body: unknown, status = 200) => Promise.resolve(new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } }));
const caps = { canReceive: true, canSend: true, sendUnavailableReason: null, supportsText: true, supportsSubject: false, supportsAttachments: true, attachmentKinds: ["IMAGE", "DOCUMENT"], maxAttachmentBytes: 5 * 1024 * 1024, maxAttachments: 5, maxTextLength: 1000, supportsTemplates: false, supportsReactions: false, supportsEdit: false, supportsDelete: false, deliveryStatuses: ["SENT", "DELIVERED", "READ", "FAILED"] } as Detail["capabilities"];
const detail = (over: Partial<Detail> = {}): Detail => ({
  id: "c1",
  title: "Rahul Sharma",
  channel: { id: "ch1", name: "Sales WhatsApp", channelType: "WHATSAPP", typeLabel: "WhatsApp", status: "ACTIVE" },
  subject: null,
  status: "OPEN",
  statusLabel: "Open",
  matchStatus: "MATCHED",
  matchLabel: "Linked",
  contact: { id: "ct1", fullName: "Rahul Sharma", href: "/crm/contacts/ct1", archived: false },
  company: { id: "co1", name: "ABC Textiles", href: "/crm/companies/co1", archived: false },
  opportunity: { id: "o1", label: "OPP-1 — Winter Order", status: "OPEN", href: "/crm/opportunities/o1" },
  assignedTo: { id: "u1", fullName: "Ashish" },
  displayName: "Rahul S",
  displayIdentifier: "+91 98100 12345",
  unreadCount: 1,
  messageCount: 2,
  lastMessageAt: "2026-10-10T05:12:00.000Z",
  lastMessagePreview: "Thanks.",
  lastMessageDirection: "INBOUND",
  createdAt: "2026-10-10T05:00:00.000Z",
  closedAt: null,
  version: 3,
  participants: [{ id: "p1", type: "CONTACT", role: "CUSTOMER", identifierKind: "PHONE", identifier: "+91 98100 12345", displayName: "Rahul S", contactId: "ct1", user: null }],
  capabilities: caps,
  contactability: { allowed: true, decidedBy: null, status: "ALLOWED", message: null },
  matchCandidates: [],
  opportunityChoices: [],
  permissions: { send: true, note: true, task: true, assign: true, link: true, createContact: false, status: true, viewAll: true },
  ...over,
});
const msg = (over: Partial<Msg> = {}): Msg => ({
  kind: "message",
  id: "m1",
  direction: "INBOUND",
  messageType: "TEXT",
  subject: null,
  body: "Can you send the quotation?",
  status: "RECEIVED",
  statusLabel: "Received",
  senderName: "Rahul S",
  senderIdentifier: "+91 98100 12345",
  senderUser: null,
  occurredAt: "2026-10-10T05:00:00.000Z",
  sentAt: null,
  deliveredAt: null,
  readAt: null,
  failedAt: null,
  error: null,
  attachments: [],
  location: null,
  canRetry: false,
  ...over,
});

let routes: Record<string, (init?: RequestInit) => Promise<Response>>;
let fetchMock: ReturnType<typeof vi.fn>;
const calls = () => fetchMock.mock.calls as [string, RequestInit?][];
const bodyOf = (url: string) => {
  const c = calls().filter(([u, i]) => u === url && i?.method === "POST").at(-1);
  return c ? (typeof c[1]!.body === "string" ? JSON.parse(c[1]!.body as string) : c[1]!.body) : undefined;
};

beforeEach(() => {
  routes = {
    "/api/v1/crm/conversations/c1": () => json({ data: detail() }),
    "/api/v1/crm/conversations/c1/messages?limit=50": () =>
      json({
        data: {
          items: [
            msg(),
            { kind: "note", id: "n1", body: "Waiting for revised quotation", author: { id: "u1", fullName: "Ashish" }, createdAt: "2026-10-10T05:01:00.000Z", editedAt: null, canEdit: true, canDelete: true },
            { kind: "event", id: "e1", eventType: "conversation.assigned", summary: "Assigned to Ashish", actor: { id: "u9", fullName: "Meera" }, occurredAt: "2026-10-10T05:02:00.000Z" },
            msg({ id: "m2", direction: "OUTBOUND", body: "Yes, I'll send it today.", status: "FAILED", statusLabel: "Failed", senderUser: { id: "u1", fullName: "Ashish" }, occurredAt: "2026-10-10T05:05:00.000Z", error: { code: "PROVIDER_HTTP_502", message: "The provider rejected the message (HTTP 502)." }, canRetry: true }),
          ],
          nextCursor: "CURSOR1",
        },
      }),
    "/api/v1/crm/conversations/c1/messages?limit=50&before=CURSOR1": () => json({ data: { items: [msg({ id: "m0", body: "Hello, older", occurredAt: "2026-10-09T05:00:00.000Z" })], nextCursor: null } }),
    "/api/v1/crm/conversations/c1/read": () => json({ data: { unreadCount: 0 } }),
    "/api/v1/crm/conversations/c1/messages": () => json({ data: msg({ id: "m3", direction: "OUTBOUND", body: "On its way", status: "SENT", statusLabel: "Sent", occurredAt: "2026-10-10T05:10:00.000Z" }) }, 201),
    "/api/v1/crm/conversations/c1/messages/m2/retry": () => json({ data: msg({ id: "m2", direction: "OUTBOUND", body: "Yes, I'll send it today.", status: "SENT", statusLabel: "Sent", occurredAt: "2026-10-10T05:05:00.000Z" }) }),
    "/api/v1/crm/conversations/c1/notes": () => json({ data: { id: "n2" } }, 201),
  };
  fetchMock = vi.fn((url: string, init?: RequestInit) => {
    const handler = routes[url];
    if (handler) return handler(init);
    if (url.startsWith("/api/v1/crm/activities")) return json({ data: [], meta: { totalCount: 0 } });
    if (url.startsWith("/api/v1/crm/events")) return json({ data: [], meta: { totalCount: 0, page: 1, pageSize: 20, totalPages: 1 } });
    return json({ data: [] });
  });
  vi.stubGlobal("fetch", fetchMock);
  for (const t of Object.values(toasts)) t.mockReset();
  Element.prototype.scrollTo = vi.fn();
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const renderView = () => render(<ConversationView conversationId="c1" users={[{ id: "u1", fullName: "Ashish" }]} currentUserId="u1" onChanged={vi.fn()} />);

describe("conversation workspace", () => {
  it("shows CRM context, the thread in order (messages, internal note, event) and marks it read", async () => {
    renderView();
    expect(await screen.findByRole("heading", { name: "Rahul Sharma" })).toBeTruthy();
    expect(screen.getByRole("link", { name: "ABC Textiles" }).getAttribute("href")).toBe("/crm/companies/co1");
    expect(screen.getByRole("link", { name: "OPP-1 — Winter Order" }).getAttribute("href")).toBe("/crm/opportunities/o1");
    const log = await screen.findByRole("log", { name: "Conversation thread" });
    await within(log).findByText("Can you send the quotation?");
    const text = log.textContent ?? "";
    expect(text.indexOf("Can you send the quotation?")).toBeLessThan(text.indexOf("Waiting for revised quotation"));
    expect(text.indexOf("Waiting for revised quotation")).toBeLessThan(text.indexOf("Assigned to Ashish"));
    expect(within(log).getByText("Internal note")).toBeTruthy();
    expect(within(log).getByText(/never sent to the customer/)).toBeTruthy();
    await waitFor(() => expect(bodyOf("/api/v1/crm/conversations/c1/read")).toEqual({ upToMessageId: "m1" }));
  });

  it("loads older messages on demand with the cursor", async () => {
    renderView();
    fireEvent.click(await screen.findByRole("button", { name: "Load older messages" }));
    expect(await screen.findByText("Hello, older")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Load older messages" })).toBeNull();
  });

  it("keeps a failed message with its reason and retries it", async () => {
    renderView();
    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toContain("Message could not be sent.");
    expect(alert.textContent).toContain("HTTP 502");
    // From now on the server reports the message as sent (the thread refreshes after the retry).
    routes["/api/v1/crm/conversations/c1/messages?limit=50"] = () => json({ data: { items: [msg(), msg({ id: "m2", direction: "OUTBOUND", body: "Yes, I'll send it today.", status: "SENT", statusLabel: "Sent", occurredAt: "2026-10-10T05:05:00.000Z" })], nextCursor: null } });
    fireEvent.click(within(alert).getByRole("button", { name: "Retry" }));
    await waitFor(() => expect(toasts.success).toHaveBeenCalledWith("Message sent."));
    await waitFor(() => expect(screen.queryByRole("alert")).toBeNull());
    expect(calls().filter(([u, i]) => u.endsWith("/m2/retry") && i?.method === "POST")).toHaveLength(1);
  });

  it("explains DND and blocks replies, while internal notes still work", async () => {
    routes["/api/v1/crm/conversations/c1"] = () => json({ data: detail({ contactability: { allowed: false, decidedBy: "WHATSAPP", status: "UNSUBSCRIBED", message: "Rahul Sharma has opted out of WhatsApp messages (unsubscribed). Messages can't be sent on this channel." }, permissions: { ...detail().permissions, send: false } }) });
    renderView();
    expect((await screen.findAllByText(/opted out of WhatsApp/)).length).toBeGreaterThan(0);
    expect((screen.getByRole("tab", { name: "Reply" }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.change(screen.getByRole("textbox", { name: "Internal note" }), { target: { value: "Call him instead" } });
    fireEvent.click(screen.getByRole("button", { name: "Add note" }));
    await waitFor(() => expect(bodyOf("/api/v1/crm/conversations/c1/notes")).toEqual({ body: "Call him instead" }));
    expect(calls().some(([u, i]) => u === "/api/v1/crm/conversations/c1/messages" && i?.method === "POST")).toBe(false);
  });

  it("offers the unmatched-queue actions and links a chosen candidate", async () => {
    routes["/api/v1/crm/conversations/c1"] = () =>
      json({ data: detail({ matchStatus: "MULTIPLE", matchLabel: "Several possible contacts", contact: null, company: null, opportunity: null, title: "+91 98100 12345", matchCandidates: [{ id: "ct7", fullName: "Rahul One", companyName: "ABC", email: null, phone: null, archived: false }, { id: "ct8", fullName: "Rahul Two", companyName: "XYZ", email: null, phone: null, archived: false }], permissions: { ...detail().permissions, createContact: true } }) });
    routes["/api/v1/crm/conversations/c1/link"] = () => json({ data: detail() });
    renderView();
    const banner = (await screen.findByText("Several contacts match this sender. Choose the right one:")).closest("div")!;
    expect(within(banner).getByRole("button", { name: "Create contact" })).toBeTruthy();
    fireEvent.click(within(banner).getAllByRole("button", { name: "Link" })[1]);
    await waitFor(() => expect(bodyOf("/api/v1/crm/conversations/c1/link")).toEqual({ version: 3, contactId: "ct8" }));
    expect(await screen.findByRole("link", { name: "ABC Textiles" })).toBeTruthy();
  });
});

describe("composer", () => {
  it("sends with a stable client id, adapts to capabilities and clears on success", async () => {
    const onSent = vi.fn();
    render(<MessageComposer conversation={detail()} onSent={onSent} onNoted={vi.fn()} />);
    expect(screen.queryByRole("textbox", { name: "Subject" })).toBeNull(); // channel has no subjects
    expect(screen.getByRole("button", { name: "Attach" })).toBeTruthy();
    const box = screen.getByRole("textbox", { name: "Message" });
    fireEvent.change(box, { target: { value: "On its way" } });
    fireEvent.keyDown(box, { key: "Enter", ctrlKey: true });
    await waitFor(() => expect(onSent).toHaveBeenCalled());
    const sent = bodyOf("/api/v1/crm/conversations/c1/messages");
    expect(sent).toMatchObject({ body: "On its way" });
    expect(sent.clientMessageId).toMatch(/^[0-9a-f-]{36}$/);
    expect((box as HTMLTextAreaElement).value).toBe("");
  });

  it("shows subject and hides attachments when the channel says so, and keeps the text on errors", async () => {
    routes["/api/v1/crm/conversations/c1/messages"] = () => json({ error: { code: "CRM_CONTACT_NOT_CONTACTABLE", message: "Opted out of email." } }, 422);
    render(<MessageComposer conversation={detail({ subject: "Quote", capabilities: { ...caps, supportsSubject: true, supportsAttachments: false } })} onSent={vi.fn()} onNoted={vi.fn()} />);
    expect((screen.getByRole("textbox", { name: "Subject" }) as HTMLInputElement).value).toBe("Re: Quote");
    expect(screen.queryByRole("button", { name: "Attach" })).toBeNull();
    fireEvent.change(screen.getByRole("textbox", { name: "Message" }), { target: { value: "Hello" } });
    fireEvent.click(screen.getByRole("button", { name: "Send" }));
    expect((await screen.findByRole("alert")).textContent).toBe("Opted out of email.");
    expect((screen.getByRole("textbox", { name: "Message" }) as HTMLTextAreaElement).value).toBe("Hello");
  });

  it("explains why replies are unavailable on a receive-only channel", () => {
    render(<MessageComposer conversation={detail({ capabilities: { ...caps, canSend: false, sendUnavailableReason: "Replies are not set up for this channel yet." }, permissions: { ...detail().permissions, send: false } })} onSent={vi.fn()} onNoted={vi.fn()} />);
    expect(screen.getByRole("status").textContent).toContain("Replies are not set up for this channel yet.");
    expect(screen.getByRole("button", { name: "Add note" })).toBeTruthy();
  });
});

describe("thread helpers", () => {
  it("merges pages by id in time order", () => {
    const a = [msg({ id: "b", occurredAt: "2026-10-10T05:00:00Z" })];
    const b = [msg({ id: "a", occurredAt: "2026-10-09T05:00:00Z" }), msg({ id: "b", occurredAt: "2026-10-10T05:00:00Z", body: "updated" })];
    const merged = mergeThread(a, b);
    expect(merged.map((i) => i.id)).toEqual(["a", "b"]);
    expect((merged[1] as Msg).body).toBe("updated");
  });

  it("only shows delivery states the channel reports", () => {
    render(
      <ul>
        <MessageBubble m={msg({ id: "x", direction: "OUTBOUND", status: "DELIVERED", statusLabel: "Delivered" })} deliveryStatuses={["SENT"]} />
        <MessageBubble m={msg({ id: "y", direction: "OUTBOUND", status: "SENT", statusLabel: "Sent" })} deliveryStatuses={["SENT"]} />
      </ul>
    );
    expect(screen.queryByText("Delivered")).toBeNull();
    expect(screen.getByText("Sent")).toBeTruthy();
    expect(shortWhen(null)).toBe("");
  });
});
