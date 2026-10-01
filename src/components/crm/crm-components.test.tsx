// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";

vi.mock("next/link", () => ({
  default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));

const { CrmEmptyState, CrmErrorState, CrmLoadingState } = await import("./CrmStates");
const { CrmPageHeader } = await import("./CrmPageHeader");
const { CrmRecordHeader } = await import("./CrmRecordHeader");
const { CrmDrawer } = await import("./CrmDrawer");
const { CrmSearchInput } = await import("./CrmSearchInput");
const { CrmFilterBar, countActiveCrmFilters, crmDatePreset } = await import("./CrmFilterBar");
const { CrmTimeline } = await import("./CrmTimeline");

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("CRM state components", () => {
  it("renders loading as plain text, empty with its reason, and error with retry", () => {
    const onRetry = vi.fn();
    render(
      <>
        <CrmLoadingState />
        <CrmEmptyState title="No leads" description="None have been captured yet." />
        <CrmErrorState message="Network down" onRetry={onRetry} />
      </>
    );
    expect(screen.getByRole("status").textContent).toBe("Loading…");
    expect(screen.getByText("None have been captured yet.")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(onRetry).toHaveBeenCalledTimes(1);
  });
});

describe("CrmPageHeader / CrmRecordHeader", () => {
  it("roots breadcrumbs at CRM and shows title, description and actions", () => {
    render(<CrmPageHeader title="Leads" description="All leads" breadcrumbs={[{ label: "Leads" }]} actions={<button>New</button>} />);
    expect(screen.getByRole("link", { name: "CRM" }).getAttribute("href")).toBe("/crm");
    expect(screen.getByRole("heading", { name: "Leads" })).toBeTruthy();
    expect(screen.getByText("All leads")).toBeTruthy();
    expect(screen.getByRole("button", { name: "New" })).toBeTruthy();
  });

  it("renders record badges and meta facts", () => {
    render(<CrmRecordHeader title="Acme" subtitle="LEAD-0001" badges={[{ label: "Hot", tone: "red" }]} meta={[{ label: "Owner", value: "Asha" }]} />);
    expect(screen.getByText("Hot")).toBeTruthy();
    expect(screen.getByText("Owner")).toBeTruthy();
    expect(screen.getByText("Asha")).toBeTruthy();
  });
});

describe("CrmDrawer", () => {
  it("renders only when open and closes on Escape and on the close button", () => {
    const onClose = vi.fn();
    const { rerender } = render(
      <CrmDrawer open={false} onClose={onClose} title="Details">
        body
      </CrmDrawer>
    );
    expect(screen.queryByRole("dialog")).toBeNull();
    rerender(
      <CrmDrawer open onClose={onClose} title="Details">
        body
      </CrmDrawer>
    );
    expect(screen.getByRole("dialog", { name: "Details" })).toBeTruthy();
    fireEvent.keyDown(window, { key: "Escape" });
    fireEvent.click(screen.getByRole("button", { name: "Close" }));
    expect(onClose).toHaveBeenCalledTimes(2);
  });
});

describe("CrmSearchInput", () => {
  it("debounces and trims before reporting", () => {
    vi.useFakeTimers();
    const onChange = vi.fn();
    render(<CrmSearchInput value="" onChange={onChange} />);
    fireEvent.change(screen.getByRole("searchbox"), { target: { value: " acme " } });
    expect(onChange).not.toHaveBeenCalled();
    act(() => {
      vi.advanceTimersByTime(260);
    });
    expect(onChange).toHaveBeenCalledWith("acme");
  });
});

describe("CrmFilterBar", () => {
  const defs = [
    { type: "select" as const, key: "eventType", label: "Event", options: [{ value: "lead.created", label: "Lead created" }] },
    { type: "dateRange" as const, label: "Date", fromKey: "from", toKey: "to" },
  ];

  it("counts applied filters, with a date range counting once", () => {
    expect(countActiveCrmFilters(defs, {})).toBe(0);
    expect(countActiveCrmFilters(defs, { eventType: "lead.created", from: "2026-10-01", to: "2026-10-02" })).toBe(2);
  });

  it("stages edits in a draft and applies them only on 'Apply Filters'; Clear All keeps the panel open", () => {
    const onApply = vi.fn();
    const onClearAll = vi.fn();
    render(<CrmFilterBar definitions={defs} value={{}} onApply={onApply} onClearAll={onClearAll} isOpen onToggleOpen={() => {}} />);

    fireEvent.change(screen.getByLabelText("Date from"), { target: { value: "2026-10-01" } });
    expect(onApply).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Apply Filters" }));
    expect(onApply).toHaveBeenCalledWith({ from: "2026-10-01" });

    fireEvent.click(screen.getByRole("button", { name: "Clear All" }));
    expect(onClearAll).toHaveBeenCalledTimes(1);
    expect(screen.getByRole("button", { name: "Apply Filters" })).toBeTruthy();
  });

  it("shows the applied count on the toggle", () => {
    render(<CrmFilterBar definitions={defs} value={{ eventType: "lead.created" }} onApply={() => {}} onClearAll={() => {}} isOpen={false} onToggleOpen={() => {}} />);
    expect(screen.getByRole("button", { name: /Filters \(1\)/ })).toBeTruthy();
  });

  it("computes date presets from local calendar dates", () => {
    const wed = new Date(2026, 9, 7, 23, 30); // Wed 7 Oct 2026, late evening local time
    expect(crmDatePreset("today", wed)).toEqual({ from: "2026-10-07", to: "2026-10-07" });
    expect(crmDatePreset("week", wed)).toEqual({ from: "2026-10-05", to: "2026-10-07" });
    expect(crmDatePreset("month", wed)).toEqual({ from: "2026-10-01", to: "2026-10-07" });
  });
});

function ok(body: unknown) {
  return { ok: true, status: 200, json: async () => body, clone() { return this; } } as unknown as Response;
}
function event(id: string, day: string, overrides: Record<string, unknown> = {}) {
  return {
    id,
    entityType: "LEAD",
    entityId: "e1",
    eventType: "lead.created",
    summary: `Summary ${id}`,
    payload: null,
    correlationId: null,
    occurredAt: `${day}T06:00:00.000Z`,
    actor: { id: "u1", fullName: "Asha" },
    label: "Lead created",
    category: "created",
    entityLabel: "Lead",
    entityHref: null,
    ...overrides,
  };
}

describe("CrmTimeline", () => {
  it("shows the empty state with its reason", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(ok({ data: [], meta: { totalPages: 1 } })));
    render(<CrmTimeline />);
    await waitFor(() => expect(screen.getByText("No activity yet")).toBeTruthy());
  });

  it("groups events by day, shows actor and record context, and loads more pages", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(ok({ data: [event("a", "2026-10-02"), event("b", "2026-10-01")], meta: { totalPages: 2 } }))
      .mockResolvedValueOnce(ok({ data: [event("c", "2026-10-01")], meta: { totalPages: 2 } }));
    vi.stubGlobal("fetch", fetchMock);

    render(<CrmTimeline pageSize={2} />);
    await waitFor(() => expect(screen.getByText("Summary a")).toBeTruthy());
    expect(screen.getAllByRole("region")).toHaveLength(2);
    expect(screen.getAllByText("Lead").length).toBe(2);
    expect(fetchMock.mock.calls[0][0]).toBe("/api/v1/crm/events?page=1&pageSize=2");

    fireEvent.click(screen.getByRole("button", { name: "Load more" }));
    await waitFor(() => expect(screen.getByText("Summary c")).toBeTruthy());
    expect(fetchMock.mock.calls[1][0]).toBe("/api/v1/crm/events?page=2&pageSize=2");
    expect(screen.queryByRole("button", { name: "Load more" })).toBeNull();
  });

  it("asks for one record's events and hides the record context when scoped", async () => {
    const fetchMock = vi.fn().mockResolvedValue(ok({ data: [event("a", "2026-10-02")], meta: { totalPages: 1 } }));
    vi.stubGlobal("fetch", fetchMock);
    render(<CrmTimeline entityType="LEAD" entityId="e1" />);
    await waitFor(() => expect(screen.getByText("Summary a")).toBeTruthy());
    expect(fetchMock.mock.calls[0][0]).toBe("/api/v1/crm/events?page=1&pageSize=20&entityType=LEAD&entityId=e1");
    expect(screen.queryByText("Lead")).toBeNull();
  });

  it("shows an error with a working retry", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({ ok: false, status: 500, json: async () => ({ error: { message: "Server unavailable" } }), clone() { return this; } })
      .mockResolvedValueOnce(ok({ data: [event("a", "2026-10-02")], meta: { totalPages: 1 } }));
    vi.stubGlobal("fetch", fetchMock);
    render(<CrmTimeline />);
    await waitFor(() => expect(screen.getByRole("alert").textContent).toContain("Server unavailable"));
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    await waitFor(() => expect(screen.getByText("Summary a")).toBeTruthy());
  });
});
