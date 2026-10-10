// @vitest-environment jsdom
import { cleanup, configure, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

configure({ asyncUtilTimeout: 4000 });

const router = vi.hoisted(() => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => router, usePathname: () => "/crm/templates", useSearchParams: () => new URLSearchParams() }));
const toasts = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn(), warning: vi.fn(), info: vi.fn() }));
vi.mock("@/components/ui/Toast", () => ({ toast: toasts }));

const { VariablePicker, TemplateIssueList } = await import("./TemplateParts");
const { TemplateEditor } = await import("./TemplateEditor");
const { TemplateTestSendDialog } = await import("./TemplateDialogs");
const { MessageComposer, MessageBubble } = await import("../conversations/ConversationThread");
type Meta = import("./template-types").TemplateMetaDto;
type Detail = import("./template-types").TemplateDetailDto;
type Conv = import("../conversations/conversation-types").ConversationDetailDto;
type Msg = import("../conversations/conversation-types").ThreadMessage;

const json = (body: unknown, status = 200) => Promise.resolve(new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } }));
const meta: Meta = {
  channels: [
    { key: "EMAIL", label: "Email", subject: "required", maxBodyLength: 10000, providerFields: [] },
    { key: "SMS", label: "SMS", subject: "none", maxBodyLength: 1600, smsSegments: true, providerFields: [] },
    { key: "WHATSAPP", label: "WhatsApp", subject: "none", maxBodyLength: 4096, recommendedMaxLength: 1024, providerFields: [{ key: "externalTemplateName", label: "Approved template name (optional)", help: "If your provider requires it.", pattern: ".*", maxLength: 120 }] },
  ],
  statuses: [
    { key: "DRAFT", label: "Draft", tone: "amber", help: "" },
    { key: "ACTIVE", label: "Active", tone: "green", help: "" },
    { key: "ARCHIVED", label: "Archived", tone: "zinc", help: "" },
  ],
  entities: [
    { key: "contact", label: "Contact", variables: [{ key: "contact.first_name", label: "First name", sample: "Rahul" }] },
    { key: "opportunity", label: "Opportunity", variables: [{ key: "opportunity.stage", label: "Stage", sample: "Demo" }] },
  ],
  unavailable: [{ key: "quotation", reason: "Quotation fields aren't available yet." }],
  categories: [{ id: "cat1", name: "Sales", archived: false, sortOrder: 10 }],
  categoryListKey: "template_category",
  testChannels: [{ id: "ch-mail", name: "Sales mail", channelType: "EMAIL", canSend: true, reason: null }],
};
const preview = (body: string, over: Record<string, unknown> = {}) => ({ subject: null, body, errors: [], warnings: [], ok: true, missing: [], ...over });
const detail = (over: Partial<Detail> = {}): Detail => ({
  id: "t1",
  name: "Quotation ready",
  channelType: "EMAIL",
  channelLabel: "Email",
  status: "ACTIVE",
  description: null,
  category: { id: "cat1", name: "Sales", archived: false },
  currentVersion: { id: "v2", templateId: "t1", versionNumber: 2, subject: "Quote for {{company.name}}", body: "Hi {{contact.first_name}}", variables: ["contact.first_name"], providerMetadata: {}, changeNote: null, restoredFromId: null, restoredFromNumber: null, createdBy: { id: "u1", name: "Ashish" }, createdAt: "2026-10-08T05:00:00.000Z", usageCount: 0 },
  currentVersionNumber: 2,
  versionCount: 2,
  validation: { valid: true, errors: [], warnings: [], variables: ["contact.first_name"] },
  usage: [],
  usageCount: 0,
  lastUsedAt: null,
  duplicatedFrom: null,
  createdBy: { id: "u1", name: "Ashish" },
  updatedBy: null,
  activatedAt: null,
  activatedBy: null,
  archivedAt: null,
  archivedBy: null,
  createdAt: "2026-10-08T05:00:00.000Z",
  updatedAt: "2026-10-08T05:00:00.000Z",
  version: 5,
  ...over,
});

let routes: Record<string, (init?: RequestInit) => Promise<Response>>;
let fetchMock: ReturnType<typeof vi.fn>;
const posts = (url: string) => (fetchMock.mock.calls as [string, RequestInit?][]).filter(([u, i]) => u === url && i?.method && i.method !== "GET").map(([, i]) => JSON.parse(String(i!.body)));

beforeEach(() => {
  routes = {
    "/api/v1/crm/templates/meta": () => json({ data: meta }),
    "/api/v1/crm/templates/preview": (init) => {
      const b = JSON.parse(String(init?.body));
      return json({ data: preview(String(b.body).replace(/\{\{contact\.first_name[^}]*\}\}/g, "Rahul"), { subject: b.subject ? String(b.subject).replace("{{company.name}}", "ABC") : null }) });
    },
    "/api/v1/crm/templates": () => json({ data: { id: "new1" } }, 201),
    "/api/v1/crm/templates/t1": () => json({ data: { versionCreated: true, versionNumber: 3 } }),
  };
  fetchMock = vi.fn((url: string, init?: RequestInit) => {
    const handler = routes[url] ?? Object.entries(routes).find(([k]) => k.endsWith("*") && url.startsWith(k.slice(0, -1)))?.[1];
    return handler ? handler(init) : json({ error: { message: `no route ${url}` } }, 404);
  });
  vi.stubGlobal("fetch", fetchMock);
  router.push.mockReset();
  Object.values(toasts).forEach((t) => t.mockReset());
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("variable picker and issues", () => {
  it("groups variables by record, filters, and inserts the chosen key", () => {
    const onPick = vi.fn();
    render(<VariablePicker meta={meta} onPick={onPick} />);
    fireEvent.click(screen.getByRole("button", { name: /Insert variable/ }));
    const dialog = screen.getByRole("dialog", { name: "Insert variable" });
    expect(within(dialog).getByText("Contact")).toBeTruthy();
    expect(within(dialog).getByText("Quotation fields aren't available yet.")).toBeTruthy();
    fireEvent.change(within(dialog).getByRole("textbox", { name: "Filter variables" }), { target: { value: "stage" } });
    expect(within(dialog).queryByText("First name")).toBeNull();
    fireEvent.click(within(dialog).getByText("Stage"));
    expect(onPick).toHaveBeenCalledWith("opportunity.stage");
  });

  it("lists template errors and provider notes separately", () => {
    render(<TemplateIssueList errors={[{ code: "UNKNOWN_VARIABLE", severity: "error", source: "template", message: "Template contains unsupported variable: {{customer.xyz}}." }]} warnings={[{ code: "PROVIDER_CANNOT_SEND", severity: "warning", source: "provider", message: "Replies are not set up." }]} />);
    expect(screen.getByRole("alert").textContent).toContain("Error: Template contains unsupported variable: {{customer.xyz}}.");
    expect(screen.getByText(/Provider note:/)).toBeTruthy();
  });
});

describe("template editor", () => {
  it("creates a draft: inserts a variable at the caret, previews on the server, saves", async () => {
    render(<TemplateEditor template={null} canCreate canEdit />);
    await screen.findByLabelText(/Template name/);
    fireEvent.change(screen.getByLabelText(/Template name/), { target: { value: "Welcome" } });
    fireEvent.change(screen.getByLabelText(/^Channel/), { target: { value: "SMS" } });
    expect(screen.queryByLabelText(/^Subject/)).toBeNull(); // SMS has no subject
    const body = screen.getByLabelText(/^Message/) as HTMLTextAreaElement;
    fireEvent.change(body, { target: { value: "Hi , welcome" } });
    body.setSelectionRange(3, 3);
    fireEvent.focus(body);
    fireEvent.click(screen.getByRole("button", { name: /Insert variable/ }));
    fireEvent.click(screen.getByText("First name"));
    expect(body.value).toBe("Hi {{contact.first_name}}, welcome");
    await waitFor(() => expect(screen.getByTestId("preview-body").textContent).toBe("Hi Rahul, welcome"));
    expect(screen.getByText("Unsaved changes")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Save draft" }));
    await waitFor(() => expect(router.push).toHaveBeenCalledWith("/crm/templates/new1"));
    expect(posts("/api/v1/crm/templates")[0]).toMatchObject({ name: "Welcome", channelType: "SMS", subject: null, body: "Hi {{contact.first_name}}, welcome" });
  });

  it("editing an active template's text asks before saving a new version; leaving with changes asks too", async () => {
    render(<TemplateEditor template={detail()} canCreate canEdit />);
    await screen.findByText(/Changing its text saves/);
    fireEvent.change(screen.getByLabelText(/^Message/), { target: { value: "Hello {{contact.first_name}}" } });
    fireEvent.change(screen.getByLabelText(/What changed in version 3/), { target: { value: "Friendlier" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    const dlg = await screen.findByRole("dialog");
    expect(within(dlg).getByText("Save as version 3?")).toBeTruthy();
    expect(within(dlg).getByText(/every message already sent stay exactly as they were/)).toBeTruthy();
    fireEvent.click(within(dlg).getByRole("button", { name: "Save version 3" }));
    await waitFor(() => expect(router.push).toHaveBeenCalledWith("/crm/templates/t1"));
    expect(posts("/api/v1/crm/templates/t1")[0]).toMatchObject({ version: 5, body: "Hello {{contact.first_name}}", subject: "Quote for {{company.name}}", changeNote: "Friendlier" });
    expect(toasts.success).toHaveBeenCalledWith("Saved as version 3.");
  });

  it("asks before discarding unsaved changes", async () => {
    render(<TemplateEditor template={detail({ status: "DRAFT" })} canCreate canEdit />);
    await screen.findByLabelText(/^Message/);
    fireEvent.change(screen.getByLabelText(/^Message/), { target: { value: "Changed" } });
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    const dlg = await screen.findByRole("dialog");
    expect(within(dlg).getByText("Discard unsaved changes?")).toBeTruthy();
    expect(router.push).not.toHaveBeenCalled();
    fireEvent.click(within(dlg).getByRole("button", { name: "Discard changes" }));
    expect(router.push).toHaveBeenCalledWith("/crm/templates/t1");
  });

  it("is read-only without permission", async () => {
    render(<TemplateEditor template={detail()} canCreate={false} canEdit={false} />);
    await screen.findByText("You can view this template but not change it.");
    expect((screen.getByLabelText(/^Message/) as HTMLTextAreaElement).disabled).toBe(true);
    expect(screen.queryByRole("button", { name: "Save" })).toBeNull();
  });
});

describe("test send", () => {
  it("marks the message as a test, needs one explicit address and a confirmation", async () => {
    routes["/api/v1/crm/templates/t1/preview"] = () => json({ data: preview("Hi Rahul", { subject: "Quote for ABC", version: { id: "v2", versionNumber: 2 } }) });
    routes["/api/v1/crm/templates/t1/test-send"] = () => json({ data: { ok: true, to: "ashish@example.com", channel: { name: "Sales mail" } } });
    const onSent = vi.fn();
    render(<TemplateTestSendDialog open onClose={vi.fn()} template={detail()} meta={meta} onSent={onSent} />);
    expect(screen.getByText("This is a test message.")).toBeTruthy();
    await waitFor(() => expect(screen.getByTestId("preview-subject").textContent).toBe("[TEST] Quote for ABC"));
    const review = screen.getByRole("button", { name: /Review/ });
    expect((review as HTMLButtonElement).disabled).toBe(true);
    fireEvent.change(screen.getByLabelText(/Test email to/), { target: { value: "ashish@example.com" } });
    fireEvent.click(review);
    expect(screen.getByText(/Send one test of/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Send test" }));
    await waitFor(() => expect(onSent).toHaveBeenCalled());
    expect(posts("/api/v1/crm/templates/t1/test-send")[0]).toEqual({ channelId: "ch-mail", to: "ashish@example.com", confirm: true, sample: true });
    expect(toasts.success).toHaveBeenCalledWith("Test sent to ashish@example.com via Sales mail.");
  });
});

describe("inbox composer with templates", () => {
  const caps = { canReceive: true, canSend: true, sendUnavailableReason: null, supportsText: true, supportsSubject: false, supportsAttachments: false, attachmentKinds: [], maxAttachmentBytes: 0, maxAttachments: 0, maxTextLength: 4096, supportsTemplates: false, supportsReactions: false, supportsEdit: false, supportsDelete: false, deliveryStatuses: ["SENT"] } as Conv["capabilities"];
  const conv = { id: "c1", channel: { id: "ch1", name: "Sales WhatsApp", channelType: "WHATSAPP", typeLabel: "WhatsApp", status: "ACTIVE" }, subject: null, status: "OPEN", displayIdentifier: "+91 98100 12345", capabilities: caps, contactability: { allowed: true, decidedBy: null, status: "ALLOWED", message: null }, permissions: { send: true, note: true } } as unknown as Conv;

  it("inserts an active template rendered for this conversation and sends its exact version", async () => {
    routes["/api/v1/crm/templates?*"] = () => json({ data: [{ id: "t9", name: "Status update", channelType: "WHATSAPP", channelLabel: "WhatsApp", status: "ACTIVE", category: { id: "cat1", name: "Sales", archived: false }, currentVersionNumber: 4 }] });
    routes["/api/v1/crm/templates/t9/preview"] = () => json({ data: preview("Hi Rahul, Winter Order is at Demo.", { warnings: [{ code: "NO_VALUE", severity: "warning", source: "template", message: "Contact last name is empty" }], version: { id: "v94", versionNumber: 4 } }) });
    routes["/api/v1/crm/conversations/c1/messages"] = () => json({ data: { id: "m5", status: "SENT" } }, 201);
    const onSent = vi.fn();
    render(<MessageComposer conversation={conv} onSent={onSent} onNoted={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: "Use template" }));
    fireEvent.click(await screen.findByRole("option", { name: /Status update/ }));
    await screen.findByText("Hi Rahul, Winter Order is at Demo.");
    expect(screen.getByText(/Contact last name is empty/)).toBeTruthy();
    const list = (fetchMock.mock.calls as [string][]).map(([u]) => u).find((u) => u.startsWith("/api/v1/crm/templates?"))!;
    expect(new URL(list, "http://x").searchParams.get("usable")).toBe("true");
    expect(new URL(list, "http://x").searchParams.get("channels")).toBe("WHATSAPP");
    expect(posts("/api/v1/crm/templates/t9/preview")[0]).toEqual({ context: { conversationId: "c1" } });
    fireEvent.click(screen.getByRole("button", { name: "Insert into reply" }));
    const box = screen.getByRole("textbox", { name: "Message" }) as HTMLTextAreaElement;
    expect(box.value).toBe("Hi Rahul, Winter Order is at Demo.");
    expect(screen.getByTestId("composer-template").textContent).toContain("Status update (v4)");
    fireEvent.change(box, { target: { value: "Hi Rahul, Winter Order is at Demo. Thanks!" } });
    fireEvent.click(screen.getByRole("button", { name: "Send" }));
    await waitFor(() => expect(onSent).toHaveBeenCalled());
    expect(posts("/api/v1/crm/conversations/c1/messages")[0]).toMatchObject({ body: "Hi Rahul, Winter Order is at Demo. Thanks!", templateId: "t9", templateVersionId: "v94" });
    expect(screen.queryByTestId("composer-template")).toBeNull();
  });

  it("shows which template (and version) a sent message came from", () => {
    const m = { kind: "message", id: "m1", direction: "OUTBOUND", messageType: "TEXT", subject: null, body: "Hi Rahul", status: "SENT", statusLabel: "Sent", senderName: "Ashish", senderIdentifier: null, senderUser: { id: "u1", fullName: "Ashish" }, occurredAt: "2026-10-10T05:00:00.000Z", sentAt: null, deliveredAt: null, readAt: null, failedAt: null, error: null, attachments: [], location: null, canRetry: false, template: { id: "t9", versionId: "v94", name: "Status update", versionNumber: 4, edited: true } } as Msg;
    render(<ul><MessageBubble m={m} deliveryStatuses={["SENT"]} /></ul>);
    expect(screen.getByTestId("message-template").textContent).toContain("Status update v4 (edited)");
  });
});
