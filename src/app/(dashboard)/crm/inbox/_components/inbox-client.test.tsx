// @vitest-environment jsdom
import { act, cleanup, configure, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Generous async timeout: these screens chain several fetches, and the full suite runs files in parallel.
configure({ asyncUtilTimeout: 4000 });

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }), usePathname: () => "/crm/inbox", useSearchParams: () => new URLSearchParams() }));
const toasts = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn(), warning: vi.fn(), info: vi.fn() }));
vi.mock("@/components/ui/Toast", () => ({ toast: toasts }));
vi.mock("@/components/crm/conversations/ConversationView", () => ({ ConversationView: ({ conversationId }: { conversationId: string }) => <div data-testid="view">Viewing {conversationId}</div> }));

const { InboxClient } = await import("./InboxClient");

const json = (body: unknown, status = 200) => Promise.resolve(new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } }));
const row = (id: string, over: Record<string, unknown> = {}) => ({
  id,
  title: `Customer ${id}`,
  channel: { id: "ch1", name: "Sales WhatsApp", channelType: "WHATSAPP", typeLabel: "WhatsApp", status: "ACTIVE" },
  subject: null,
  status: "OPEN",
  statusLabel: "Open",
  matchStatus: "MATCHED",
  matchLabel: "Linked",
  contact: { id: "ct", fullName: `Customer ${id}`, href: "/x", archived: false },
  company: { id: "co", name: "ABC Textiles", href: "/y", archived: false },
  opportunity: null,
  assignedTo: { id: "u1", fullName: "Ashish" },
  displayName: null,
  displayIdentifier: "+91 1",
  unreadCount: 0,
  messageCount: 1,
  lastMessageAt: "2026-10-10T05:00:00.000Z",
  lastMessagePreview: "Can we meet tomorrow?",
  lastMessageDirection: "INBOUND",
  createdAt: "2026-10-10T05:00:00.000Z",
  closedAt: null,
  version: 1,
  ...over,
});

let fetchMock: ReturnType<typeof vi.fn>;
const listCalls = () => (fetchMock.mock.calls as [string][]).map(([u]) => u).filter((u) => u.startsWith("/api/v1/crm/conversations?"));
const lastQuery = () => new URL(listCalls().at(-1)!, "http://x").searchParams;

beforeEach(() => {
  fetchMock = vi.fn((url: string) => {
    if (url === "/api/v1/crm/conversations/meta") return json({ data: { channels: [{ id: "ch1", name: "Sales WhatsApp", channelType: "WHATSAPP", typeLabel: "WhatsApp", status: "ACTIVE", capabilities: {} }, { id: "ch2", name: "Support mail", channelType: "EMAIL", typeLabel: "Email", status: "PAUSED", capabilities: {} }], statuses: [], folders: [], canViewAll: true } });
    if (url === "/api/v1/crm/conversations/counts") return json({ data: { folders: { all: 14, unread: 8, mine: 5, unassigned: 3, unmatched: 2 }, channels: [{ channelId: "ch1", open: 9, unreadMessages: 4 }] } });
    if (url === "/api/v1/users") return json({ data: [{ id: "u1", fullName: "Ashish", status: "ACTIVE" }] });
    if (url.startsWith("/api/v1/crm/conversations?")) {
      const q = new URL(url, "http://x").searchParams;
      if (q.get("search") === "nothing") return json({ data: [], meta: { totalCount: 0 } });
      return json({ data: [row("c1", { unreadCount: 2 }), row("c2", { matchStatus: "UNMATCHED", contact: null, company: null, title: "+91 98100 00000", lastMessageDirection: "OUTBOUND", lastMessagePreview: "Yes, 11 AM works.", assignedTo: null, status: "PENDING", statusLabel: "Pending" })], meta: { totalCount: 40 } });
    }
    return json({ data: [] });
  });
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("unified inbox", () => {
  it("lists every channel's conversations with unread, channel, preview, assignee and status, plus folder counts", async () => {
    render(<InboxClient currentUserId="u1" />);
    const first = await screen.findByRole("button", { name: /Customer c1/ });
    expect(first.textContent).toContain("WhatsApp");
    expect(first.textContent).toContain("Can we meet tomorrow?");
    expect(within(first).getByLabelText("2 unread")).toBeTruthy();
    const second = screen.getByRole("button", { name: /\+91 98100 00000/ });
    expect(second.textContent).toContain("You: Yes, 11 AM works.");
    expect(second.textContent).toContain("Unmatched");
    expect(second.textContent).toContain("Pending");
    expect(second.textContent).toContain("Unassigned");
    await waitFor(() => expect(screen.getByTestId("count-unread").textContent).toBe("8"));
    expect(screen.getByTestId("count-unmatched").textContent).toBe("2");
    expect(screen.getByRole("button", { name: /Support mail.*paused/ })).toBeTruthy();
    expect(lastQuery().get("folder")).toBe("all");
    expect(lastQuery().get("pageSize")).toBe("30");
  });

  it("filters by folder, channel and status on the server, and searches with a debounce", async () => {
    render(<InboxClient currentUserId="u1" />);
    await screen.findByRole("button", { name: /Customer c1/ });
    const folders = screen.getByRole("navigation", { name: "Inbox folders" });
    fireEvent.click(within(folders).getByRole("button", { name: /Unmatched/ }));
    await waitFor(() => expect(lastQuery().get("folder")).toBe("unmatched"));
    fireEvent.click(within(folders).getByRole("button", { name: /Sales WhatsApp/ }));
    await waitFor(() => expect(lastQuery().get("channelIds")).toBe("ch1"));
    fireEvent.change(screen.getByRole("combobox", { name: "Status" }), { target: { value: "CLOSED" } });
    await waitFor(() => expect(lastQuery().get("statuses")).toBe("CLOSED"));
    const before = listCalls().length;
    fireEvent.change(screen.getByRole("searchbox", { name: "Search conversations" }), { target: { value: "noth" } });
    fireEvent.change(screen.getByRole("searchbox", { name: "Search conversations" }), { target: { value: "nothing" } });
    await waitFor(() => expect(lastQuery().get("search")).toBe("nothing"));
    expect(listCalls().length).toBe(before + 1); // one request for the settled term
    expect(await screen.findByText("No conversations match")).toBeTruthy();
  });

  it("opens a conversation and pages the list", async () => {
    render(<InboxClient currentUserId="u1" />);
    fireEvent.click(await screen.findByRole("button", { name: /Customer c1/ }));
    expect(screen.getByTestId("view").textContent).toBe("Viewing c1");
    expect(window.location.search).toContain("c=c1");
    fireEvent.click(screen.getByRole("button", { name: /Show more \(38 more\)/ }));
    await waitFor(() => expect(lastQuery().get("pageSize")).toBe("60"));
  });

  it("starts from the deep-linked conversation and polls for new messages", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    render(<InboxClient currentUserId="u1" initial={{ conversationId: "c9", folder: "mine" }} />);
    expect(screen.getByTestId("view").textContent).toBe("Viewing c9");
    await waitFor(() => expect(listCalls().length).toBe(1));
    expect(lastQuery().get("folder")).toBe("mine");
    await act(async () => {
      vi.advanceTimersByTime(15_500);
    });
    await waitFor(() => expect(listCalls().length).toBe(2));
  });
});
