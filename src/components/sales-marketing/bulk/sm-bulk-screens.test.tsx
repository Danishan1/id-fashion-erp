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
const push = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ push, replace: vi.fn(), refresh: vi.fn() }), usePathname: () => "/sales-marketing/bulk-jobs", useSearchParams: () => new URLSearchParams() }));

const { BulkActionDialog } = await import("@/components/bulk/BulkActionsButton");
const { BulkJobDetailClient } = await import("@/components/bulk/BulkJobDetailClient");

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  push.mockReset();
});

function mockApi(handlers: Record<string, (body: unknown) => { status?: number; body: unknown }>) {
  const calls: { url: string; method: string; body: unknown }[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init?: RequestInit) => {
      const method = init?.method ?? "GET";
      const body = init?.body && typeof init.body === "string" ? JSON.parse(init.body) : undefined;
      calls.push({ url, method, body });
      const key = Object.keys(handlers).sort((a, b) => b.length - a.length).find((k) => url.startsWith(k));
      const r = key ? handlers[key](body) : { status: 404, body: { error: { message: "nope" } } };
      return new Response(JSON.stringify(r.body), { status: r.status ?? 200, headers: { "Content-Type": "application/json" } });
    })
  );
  return calls;
}

const base = { available: true, unavailableReason: null, destructive: false, cancellable: true, retrySafe: true, maxItems: 2000 };
const caps = {
  entity: { entityType: "ENQUIRY", label: "Enquiry", pluralLabel: "Enquiries" },
  actions: [
    { ...base, key: "enquiry.assign", kind: "assign", label: "Assign owner", description: "New owner.", confirmation: "confirm", fields: [{ key: "ownerUserId", label: "New owner", type: "user", allowNone: true, options: [{ value: "u1", label: "Priya" }] }], dryRun: true, dryRunUnavailableReason: null, schedulable: false },
    { ...base, key: "enquiry.export", kind: "export", label: "Export", description: "Export.", confirmation: "none", fields: [{ key: "format", label: "Format", type: "select", required: true, options: [{ value: "CSV", label: "CSV" }] }], dryRun: false, dryRunUnavailableReason: "An export changes nothing — just run it.", schedulable: true },
  ],
};
const preview = (label: string, confirmation: string) => ({ body: { data: { count: 4, requested: 4, maxItems: 2000, actionLabel: label, summary: label, warnings: [], destructive: false, confirmation, sample: [] } } });

describe("S&M bulk dialog (Phase 14)", () => {
  it("dry run first: no confirmation needed, sends dryRun and links to the S&M jobs page", async () => {
    const calls = mockApi({
      "/api/v1/bulk-actions/capabilities": () => ({ body: { data: caps } }),
      "/api/v1/bulk-actions/preview": () => preview("Assign owner", "confirm"),
      "/api/v1/bulk-jobs": () => ({ status: 202, body: { data: { id: "job-9", actionLabel: "Assign owner", totalCount: 4, queued: true, dryRun: true } } }),
    });
    render(<BulkActionDialog entityType="ENQUIRY" selectedIds={["a", "b", "c", "d"]} filterQuery="view=open" onClose={() => {}} jobsPath="/sales-marketing/bulk-jobs" />);
    await screen.findByLabelText(/Action/);
    fireEvent.change(screen.getByLabelText(/Action/), { target: { value: "enquiry.assign" } });
    fireEvent.change(screen.getByLabelText(/New owner/), { target: { value: "u1" } });
    fireEvent.click(screen.getByRole("button", { name: "Review" }));
    fireEvent.click(await screen.findByRole("radio", { name: /Dry run first/ }));
    const go = screen.getByRole("button", { name: /Dry run on 4/ }) as HTMLButtonElement;
    expect(go.disabled).toBe(false); // no confirmation checkbox for a dry run
    expect(screen.queryByRole("radio", { name: /Save as a schedule/ })).toBeNull(); // assign isn't schedulable
    fireEvent.click(go);
    await screen.findByText(/nothing is changed/);
    expect(calls.find((c) => c.url === "/api/v1/bulk-jobs")!.body).toMatchObject({ actionKey: "enquiry.assign", dryRun: true, params: { ownerUserId: "u1" } });
    expect(screen.getByRole("link", { name: "View progress" }).getAttribute("href")).toBe("/sales-marketing/bulk-jobs/job-9");
  });

  it("saves a weekly export schedule over the current filters", async () => {
    const calls = mockApi({
      "/api/v1/bulk-actions/capabilities": () => ({ body: { data: caps } }),
      "/api/v1/bulk-actions/preview": () => preview("Export", "none"),
      "/api/v1/bulk-schedules": () => ({ status: 201, body: { data: { id: "s1", name: "Weekly enquiries", when: "Every Wednesday at 08:15 IST" } } }),
    });
    render(<BulkActionDialog entityType="ENQUIRY" selectedIds={[]} filterQuery="view=all&search=linen" onClose={() => {}} schedulesPath="/sales-marketing/bulk-jobs?tab=schedules" />);
    await screen.findByLabelText(/Action/);
    fireEvent.change(screen.getByLabelText(/Action/), { target: { value: "enquiry.export" } });
    fireEvent.change(screen.getByLabelText(/Format/), { target: { value: "CSV" } });
    fireEvent.click(screen.getByRole("button", { name: "Review" }));
    expect(await screen.findByRole("radio", { name: /Save as a schedule/ })).toBeTruthy();
    expect(screen.queryByRole("radio", { name: /Dry run first/ })).toBeNull();
    fireEvent.click(screen.getByRole("radio", { name: /Save as a schedule/ }));
    fireEvent.change(screen.getByLabelText(/Schedule name/), { target: { value: "Weekly enquiries" } });
    fireEvent.change(screen.getByLabelText(/Repeats/), { target: { value: "WEEKLY" } });
    fireEvent.change(screen.getByLabelText(/^Day/), { target: { value: "3" } });
    fireEvent.change(screen.getByLabelText(/Time/), { target: { value: "08:15" } });
    fireEvent.click(screen.getByRole("button", { name: "Save schedule" }));
    await screen.findByText(/Every Wednesday at 08:15 IST/);
    expect(calls.find((c) => c.url === "/api/v1/bulk-schedules")!.body).toEqual({ name: "Weekly enquiries", entityType: "ENQUIRY", actionKey: "enquiry.export", filterQuery: "view=all&search=linen", params: { format: "CSV" }, frequency: "WEEKLY", timeOfDay: "08:15", dayOfWeek: 3 });
    expect(screen.getByRole("link", { name: "View schedules" }).getAttribute("href")).toBe("/sales-marketing/bulk-jobs?tab=schedules");
  });
});

describe("Bulk job detail — dry run (Phase 14)", () => {
  const job = {
    id: "dry-1", entityType: "ENQUIRY", entityLabel: "Enquiries", listHref: "/sales-marketing/enquiries", actionKey: "enquiry.assign", actionLabel: "Assign owner", kind: "assign",
    status: "COMPLETED_WITH_ERRORS", statusLabel: "Completed with errors", statusTone: "warning", selectionMode: "IDS", summary: "Owner → Priya", totalCount: 3, processedCount: 3,
    succeededCount: 1, failedCount: 1, skippedCount: 1, progress: 100, error: null, requestedBy: { id: "u", name: "Me" }, isMine: true, retryOfJobId: null, dryRun: true, dryRunOfJobId: null,
    scheduleId: null, canCancel: false, canRetry: true, download: null, createdAt: "2026-11-06T10:00:00Z", startedAt: null, finishedAt: "2026-11-06T10:01:00Z", cancelRequestedAt: null,
    updatedAt: "2026-11-06T10:01:00Z", selection: null, retries: [], itemCounts: { SUCCEEDED: 1, FAILED: 1, SKIPPED: 1 }, action: { destructive: false, retrySafe: true, description: "" },
    realRun: null, canRunForReal: true, wouldSucceedCount: 1, confirmation: "confirm", schedule: null,
  };

  it("labels outcomes as would-be, and Run for real starts the real job", async () => {
    const calls = mockApi({
      "/api/v1/bulk-jobs/dry-1/items": () => ({ body: { data: [], meta: { page: 1, pageSize: 25, totalCount: 0, totalPages: 0 } } }),
      "/api/v1/bulk-jobs/dry-1/run-for-real": () => ({ status: 202, body: { data: { id: "real-1" } } }),
      "/api/v1/bulk-jobs/dry-1": () => ({ body: { data: job } }),
    });
    render(<BulkJobDetailClient id="dry-1" basePath="/sales-marketing/bulk-jobs" />);
    await screen.findByText(/nothing was changed/);
    expect(screen.getByText("Would succeed")).toBeTruthy();
    expect(screen.getByText("Would fail")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /Run for real \(1\)/ }));
    fireEvent.click(await screen.findByRole("button", { name: /^Run for real$/ }));
    await waitFor(() => expect(push).toHaveBeenCalledWith("/sales-marketing/bulk-jobs/real-1"));
    expect(calls.some((c) => c.url === "/api/v1/bulk-jobs/dry-1/run-for-real" && c.method === "POST")).toBe(true);
  });
});
