// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

const { OutgoingWebhooksTab } = await import("./OutgoingWebhooksTab");

const json = (body: unknown, status = 200) => Promise.resolve(new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } }));
const row = {
  id: "s1",
  name: "Warehouse",
  description: null,
  url: "https://hooks.example.com/crm",
  eventTypes: ["lead.created"],
  isActive: true,
  version: 3,
  secret: { configured: true, masked: "whsec_••••••••", rotatedAt: null },
  health: "NEEDS_ATTENTION",
  consecutiveFailures: 4,
  lastDeliveryAt: "2026-10-14T09:00:00.000Z",
  lastDeliveryStatus: "FAILED",
  lastSuccessAt: null,
  lastError: "The endpoint answered HTTP 503.",
  createdBy: "Admin",
  createdAt: "2026-10-01T09:00:00.000Z",
};

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("OutgoingWebhooksTab", () => {
  it("lists subscriptions with a masked status only — no reveal control anywhere", async () => {
    vi.stubGlobal("fetch", vi.fn(() => json({ data: [row] })));
    render(<OutgoingWebhooksTab canEdit />);
    await screen.findByText("Warehouse");
    expect(screen.getByText("Secret configured")).toBeTruthy();
    expect(screen.getByText("Needs attention")).toBeTruthy();
    expect(screen.getByText("4 failures in a row")).toBeTruthy();
    expect(screen.queryByRole("button", { name: /reveal|show secret/i })).toBeNull();
  });

  it("edit form never contains the secret; it only says one is configured", async () => {
    vi.stubGlobal("fetch", vi.fn(() => json({ data: [row] })));
    render(<OutgoingWebhooksTab canEdit />);
    fireEvent.click(await screen.findByRole("button", { name: "Edit" }));
    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getAllByText("Secret configured").length).toBeGreaterThan(0);
    for (const input of dialog.querySelectorAll("input")) expect((input as HTMLInputElement).value).not.toMatch(/^whsec_[A-Za-z0-9]/);
  });

  it("shows a newly created secret once, then it is gone after confirmation", async () => {
    const fetchMock = vi.fn((url: string, init?: RequestInit) => {
      if (init?.method === "POST") return json({ data: { ...row, id: "s2", name: "New", health: "NO_DELIVERIES", secretOnce: "whsec_ONCE_ONLY_VALUE" } }, 201);
      return json({ data: [row] });
    });
    vi.stubGlobal("fetch", fetchMock);
    render(<OutgoingWebhooksTab canEdit />);
    fireEvent.click(await screen.findByRole("button", { name: "Add outgoing webhook" }));
    const dialog = await screen.findByRole("dialog");
    fireEvent.change(within(dialog).getByLabelText(/Name/), { target: { value: "New" } });
    fireEvent.change(within(dialog).getByLabelText(/Endpoint URL/), { target: { value: "https://hooks.example.com/new" } });
    fireEvent.click(within(dialog).getAllByRole("checkbox")[0]);
    fireEvent.click(within(dialog).getByRole("button", { name: "Create and show secret" }));
    await screen.findByText("whsec_ONCE_ONLY_VALUE");
    const body = JSON.parse(String(fetchMock.mock.calls.find(([, i]) => i?.method === "POST")?.[1]?.body));
    expect(body).not.toHaveProperty("secret");
    fireEvent.click(screen.getByLabelText(/I have stored this secret/));
    fireEvent.click(screen.getByRole("button", { name: "Done" }));
    await waitFor(() => expect(screen.queryByText("whsec_ONCE_ONLY_VALUE")).toBeNull());
    // Nothing re-fetches the secret: every later GET is the list.
    expect(fetchMock.mock.calls.filter(([, i]) => !i?.method || i.method === "GET").every(([u]) => String(u).endsWith("/webhook-subscriptions"))).toBe(true);
  });

  it("view-only users get the list and delivery log, but no change buttons", async () => {
    vi.stubGlobal("fetch", vi.fn(() => json({ data: [row] })));
    render(<OutgoingWebhooksTab canEdit={false} />);
    await screen.findByText("Warehouse");
    expect(screen.getByRole("button", { name: "Deliveries" })).toBeTruthy();
    for (const name of ["Edit", "Test", "Rotate secret", "Delete", "Add outgoing webhook"]) expect(screen.queryByRole("button", { name })).toBeNull();
  });
});
