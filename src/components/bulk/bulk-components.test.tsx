// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";

vi.mock("next/link", () => ({
  default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));

const { BulkActionDialog } = await import("./BulkActionsButton");

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const caps = {
  entity: { entityType: "LEAD", label: "Lead", pluralLabel: "Leads" },
  actions: [
    {
      key: "lead.archive",
      kind: "archive",
      label: "Archive",
      description: "Archive the selected leads.",
      available: true,
      unavailableReason: null,
      destructive: true,
      confirmation: "type_count",
      cancellable: true,
      retrySafe: true,
      maxItems: 5000,
      fields: [],
    },
    {
      key: "lead.assign",
      kind: "assign",
      label: "Assign owner",
      description: "New owner.",
      available: true,
      unavailableReason: null,
      destructive: false,
      confirmation: "confirm",
      cancellable: true,
      retrySafe: true,
      maxItems: 5000,
      fields: [{ key: "ownerUserId", label: "New owner", type: "user", allowNone: true, noneLabel: "Unassigned", options: [{ value: "u1", label: "Priya" }] }],
    },
    { key: "lead.delete", kind: "delete", label: "Delete permanently", description: "", available: false, unavailableReason: "Use Archive instead.", destructive: true, confirmation: "type_count", cancellable: true, retrySafe: false, maxItems: 1, fields: [] },
  ],
};

function mockApi(handlers: Record<string, (body: unknown) => { status?: number; body: unknown }>) {
  const calls: { url: string; method: string; body: unknown }[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init?: RequestInit) => {
      const method = init?.method ?? "GET";
      const body = init?.body ? JSON.parse(String(init.body)) : undefined;
      calls.push({ url, method, body });
      const key = Object.keys(handlers).find((k) => url.startsWith(k));
      const r = key ? handlers[key](body) : { status: 404, body: { error: { message: "nope" } } };
      return new Response(JSON.stringify(r.body), { status: r.status ?? 200, headers: { "Content-Type": "application/json" } });
    })
  );
  return calls;
}

describe("BulkActionDialog", () => {
  it("lists available actions, explains unavailable ones, and requires the typed count for archive", async () => {
    const calls = mockApi({
      "/api/v1/bulk-actions/capabilities": () => ({ body: { data: caps } }),
      "/api/v1/bulk-actions/preview": () => ({ body: { data: { count: 3, requested: 3, maxItems: 5000, actionLabel: "Archive", summary: "Archive leads", warnings: ["1 selected record(s) no longer exist"], destructive: true, confirmation: "type_count", sample: ["L-1 · A", "L-2 · B"] } } }),
      "/api/v1/bulk-jobs": () => ({ status: 202, body: { data: { id: "job-1", actionLabel: "Archive", totalCount: 3, queued: true, duplicate: false } } }),
    });
    render(<BulkActionDialog entityType="LEAD" selectedIds={["a", "b", "c", "d"]} filterQuery="search=x" onClose={() => {}} />);
    await screen.findByLabelText(/Action/);
    expect(screen.getByText(/Not available \(1\)/)).toBeTruthy();
    expect(screen.getByText(/Use Archive instead/)).toBeTruthy();
    expect((screen.getByRole("radio", { name: /Selected leads \(4\)/ }) as HTMLInputElement).checked).toBe(true);

    fireEvent.change(screen.getByLabelText(/Action/), { target: { value: "lead.archive" } });
    fireEvent.click(screen.getByRole("button", { name: "Review" }));
    await screen.findByText(/will be processed/);
    expect(screen.getByText(/no longer exist/)).toBeTruthy();
    const start = screen.getByRole("button", { name: /Start on 3 leads/ }) as HTMLButtonElement;
    expect(start.disabled).toBe(true);
    fireEvent.change(screen.getByLabelText(/Type 3 to confirm/), { target: { value: "2" } });
    expect(start.disabled).toBe(true);
    fireEvent.change(screen.getByLabelText(/Type 3 to confirm/), { target: { value: "3" } });
    expect(start.disabled).toBe(false);
    fireEvent.click(start);
    await screen.findByText(/in the background/);
    const post = calls.find((c) => c.url === "/api/v1/bulk-jobs" && c.method === "POST")!;
    expect(post.body).toMatchObject({ entityType: "LEAD", actionKey: "lead.archive", selection: { mode: "IDS", ids: ["a", "b", "c", "d"] }, confirmCount: 3 });
    expect(typeof (post.body as { idempotencyKey: string }).idempotencyKey).toBe("string");
    expect(screen.getByRole("link", { name: "View progress" }).getAttribute("href")).toBe("/crm/bulk-jobs/job-1");
  });

  it("uses the filter when nothing is selected and sends 'unassigned' as null", async () => {
    const calls = mockApi({
      "/api/v1/bulk-actions/capabilities": () => ({ body: { data: caps } }),
      "/api/v1/bulk-actions/preview": () => ({ body: { data: { count: 120, requested: 120, maxItems: 5000, actionLabel: "Assign owner", summary: "Owner → Unassigned", warnings: [], destructive: false, confirmation: "confirm", sample: [] } } }),
    });
    render(<BulkActionDialog entityType="LEAD" selectedIds={[]} filterQuery="statusIds=s1&search=acme" onClose={() => {}} />);
    await screen.findByLabelText(/Action/);
    expect((screen.getByRole("radio", { name: /Selected leads \(0\)/ }) as HTMLInputElement).disabled).toBe(true);
    fireEvent.change(screen.getByLabelText(/Action/), { target: { value: "lead.assign" } });
    fireEvent.change(screen.getByLabelText(/New owner/), { target: { value: "__none__" } });
    fireEvent.click(screen.getByRole("button", { name: "Review" }));
    await screen.findByRole("button", { name: /Start on 120 leads/ });
    const preview = calls.find((c) => c.url.startsWith("/api/v1/bulk-actions/preview"))!;
    expect(preview.body).toMatchObject({ selection: { mode: "FILTER", filterQuery: "statusIds=s1&search=acme" }, params: { ownerUserId: null } });
    const start = screen.getByRole("button", { name: /Start on 120 leads/ }) as HTMLButtonElement;
    expect(start.disabled).toBe(true);
    fireEvent.click(screen.getByRole("checkbox"));
    await waitFor(() => expect(start.disabled).toBe(false));
  });

  it("shows server validation errors next to the form", async () => {
    mockApi({
      "/api/v1/bulk-actions/capabilities": () => ({ body: { data: caps } }),
      "/api/v1/bulk-actions/preview": () => ({ status: 422, body: { message: "The filter matches 25,000 leads; \"Assign owner\" handles up to 5,000 at once. Narrow the filter.", error: { code: "VALIDATION_ERROR", message: "x", details: {} } } }),
    });
    render(<BulkActionDialog entityType="LEAD" selectedIds={[]} filterQuery="" onClose={() => {}} />);
    await screen.findByLabelText(/Action/);
    fireEvent.change(screen.getByLabelText(/Action/), { target: { value: "lead.assign" } });
    fireEvent.click(screen.getByRole("button", { name: "Review" }));
    expect(await screen.findByText(/Narrow the filter/)).toBeTruthy();
  });
});
