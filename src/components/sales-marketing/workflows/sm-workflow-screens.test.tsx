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
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }) }));

const { SmWorkflowsClient } = await import("./SmWorkflowsClient");
const { SmWorkflowDefinitionClient } = await import("./SmWorkflowDefinitionClient");
const { SmWorkflowInstanceClient } = await import("./SmWorkflowInstanceClient");
const { SM_WORKFLOWS } = await import("@/modules/sales-marketing/workflows/sm-workflow-registry");

const ok = (data: unknown, meta?: unknown) => Promise.resolve({ ok: true, json: () => Promise.resolve({ data, meta }) } as Response);
type Call = { url: string; init?: RequestInit };
function stub(routes: (c: Call) => unknown) {
  const calls: Call[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn((url: string, init?: RequestInit) => {
      calls.push({ url, init });
      const r = routes({ url, init }) as { data: unknown; meta?: unknown };
      return ok(r.data, r.meta);
    })
  );
  return calls;
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const metrics = { running: 2, waiting: 3, waitingApproval: 1, needsAttention: 1, completed30d: 9, failed30d: 1, completionRate30d: 90, avgApprovalWaitHours: 5.5, retries30d: 0, compensationFailed: 0, overdueRuns: 0, maxQueueLatencySeconds: 0, eventLagSeconds: 30, byWorkflow: [] };
const defs = [
  { key: "quotation_to_order", name: "Accepted quotation → Sales Order", description: "Follows accepted quotations.", status: "ACTIVE", activeVersion: 2, hasDraft: true, runAs: "Asha", activatedAt: "2026-11-01T00:00:00Z", live: 2, attention: 1, completed: 5 },
  { key: "budget_exception", name: "Budget exception", description: "Budget alerts.", status: "INACTIVE", activeVersion: null, hasDraft: true, runAs: null, activatedAt: null, live: 0, attention: 0, completed: 0 },
];

describe("Workflows page", () => {
  it("shows metrics and the workflow types with their state", async () => {
    stub(({ url }) => (url.endsWith("/metrics") ? { data: metrics } : { data: defs }));
    render(<SmWorkflowsClient />);
    await waitFor(() => expect(screen.getByText("Accepted quotation → Sales Order")).toBeTruthy());
    expect(screen.getByText("On · v2")).toBeTruthy();
    expect(screen.getByText("Off")).toBeTruthy();
    expect(screen.getByText("Unpublished changes")).toBeTruthy();
    expect(screen.getByText("1 need attention")).toBeTruthy();
    expect(screen.getByText("5.5 h")).toBeTruthy();
    expect(screen.getByRole("link", { name: /Budget exception/ }).getAttribute("href")).toBe("/sales-marketing/workflows/definitions/budget_exception");
  });

  it("lists running workflows with the status filter in the query", async () => {
    const row = { id: "i1", workflowKey: "quotation_to_order", workflowName: "Accepted quotation → Sales Order", version: 2, entityType: "QUOTATION", entityId: "q1", entityLabel: "QT-2026-00004", entityHref: "/sales-marketing/quotations/q1", status: "NEEDS_ATTENTION", statusLabel: "Needs attention", statusTone: "red", currentStep: "await_order", currentStepLabel: "Wait for the Sales Order", outcome: null, outcomeLabel: null, errorMessage: "Quotation shows converted but no order found.", nextRunAt: null, startedAt: "2026-11-05T10:00:00Z", updatedAt: "2026-11-05T10:00:00Z", triggerSource: "EVENT" };
    const calls = stub(({ url }) => (url.includes("/instances") ? { data: [row], meta: { totalCount: 1, totalPages: 1 } } : url.endsWith("/metrics") ? { data: metrics } : { data: defs }));
    render(<SmWorkflowsClient initialTab="instances" initialStatuses={["NEEDS_ATTENTION"]} />);
    await waitFor(() => expect(screen.getByText("QT-2026-00004")).toBeTruthy());
    expect(calls.some((c) => c.url.includes("statuses=NEEDS_ATTENTION"))).toBe(true);
    expect(screen.getByText(/no order found/)).toBeTruthy();
    expect(screen.getByRole("link", { name: "QT-2026-00004" }).getAttribute("href")).toBe("/sales-marketing/workflows/instances/i1");
  });
});

const wf = SM_WORKFLOWS.budget_exception;
const version = { id: "v1", versionNumber: 1, status: "DRAFT", settings: { createTask: true, reviewDueDays: 2, escalateAfterDays: 5, reviewerUserIds: [] }, conditions: { entry: { kind: "group", logic: "AND", conditions: [] } }, changeNote: "Default settings", createdBy: "Asha", createdAt: "2026-11-01T00:00:00Z", activatedAt: null, activatedBy: null };
const def = {
  key: "budget_exception",
  definitionId: "d1",
  name: wf.name,
  description: wf.description,
  entityLabel: wf.entityLabel,
  triggers: wf.triggers,
  steps: wf.steps,
  boundaries: wf.boundaries,
  settingFields: wf.settingFields,
  conditionFields: wf.conditionFields,
  requiredPermissions: wf.requiredPermissions,
  taskPermissions: wf.taskPermissions ?? [],
  status: "INACTIVE",
  version: 3,
  runAs: null,
  runAsIssue: null,
  activatedAt: null,
  activeVersion: null,
  draft: version,
  versions: [version],
  canEdit: true,
};

describe("Workflow definition", () => {
  it("edits typed settings, saves a draft with the version, and switches on only after confirming", async () => {
    const calls = stub(({ url, init }) => (url === "/api/v1/users" ? { data: [{ id: "u1", fullName: "Ravi" }] } : init?.method ? { data: { ...def, version: 4 } } : { data: def }));
    render(<SmWorkflowDefinitionClient workflowKey="budget_exception" />);
    await waitFor(() => expect(screen.getByText("Never does")).toBeTruthy());
    for (const b of wf.boundaries) expect(screen.getByText(b)).toBeTruthy();
    const due = screen.getByLabelText(/Review due in/) as HTMLInputElement;
    fireEvent.change(due, { target: { value: "4" } });
    await waitFor(() => expect(screen.getByRole("option", { name: "Ravi" })).toBeTruthy());
    fireEvent.change(screen.getByLabelText(/Add to/), { target: { value: "u1" } });
    fireEvent.click(screen.getByRole("button", { name: "Save draft" }));
    await waitFor(() => expect(calls.some((c) => c.init?.method === "PUT")).toBe(true));
    const put = JSON.parse(String(calls.find((c) => c.init?.method === "PUT")!.init!.body));
    expect(put).toMatchObject({ version: 3, settings: { reviewDueDays: 4, reviewerUserIds: ["u1"] }, conditions: { entry: { kind: "group" } } });

    fireEvent.click(screen.getByRole("button", { name: "Switch on" }));
    expect(screen.getByText(/It will run as you/)).toBeTruthy();
    expect(calls.some((c) => String(c.init?.body ?? "").includes("activate"))).toBe(false);
  });

  it("is read-only without edit permission", async () => {
    stub(({ url }) => (url === "/api/v1/users" ? { data: [] } : { data: { ...def, canEdit: false } }));
    render(<SmWorkflowDefinitionClient workflowKey="budget_exception" />);
    await waitFor(() => expect(screen.getByText("Never does")).toBeTruthy());
    expect(screen.queryByRole("button", { name: "Save draft" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Switch on" })).toBeNull();
  });
});

const instance = {
  id: "i1",
  workflowKey: "campaign_readiness",
  workflowName: "Campaign readiness",
  version: 1,
  entityType: "CAMPAIGN",
  entityId: "c1",
  entityLabel: "CMP-0007",
  entityHref: "/sales-marketing/campaigns/c1",
  status: "WAITING_APPROVAL",
  statusLabel: "Waiting for approval",
  statusTone: "amber",
  currentStep: "await_approval",
  plan: [
    { key: "check", label: "Check the campaign", kind: "CHECK", state: "done" },
    { key: "await_approval", label: "Wait for approval", kind: "WAIT", state: "current" },
    { key: "finish", label: "Finish", kind: "COMPLETE", state: "pending" },
  ],
  nextRunAt: "2026-11-06T10:00:00Z",
  waitingSince: "2026-11-05T10:00:00Z",
  attempts: 0,
  outcome: null,
  outcomeLabel: null,
  outcomeMessage: null,
  error: null,
  compensationStatus: null,
  triggerSource: "EVENT",
  triggerEventKey: "campaign:e1",
  trigger: { type: "campaign.submitted", at: "2026-11-05T10:00:00Z" },
  initiatedBy: null,
  correlationId: "smwf:i1",
  checklist: [
    { key: "audience", label: "Audience", ok: true, detail: "120 contacts" },
    { key: "content", label: "Approved content", ok: false, detail: "Email v3 not approved" },
  ],
  references: { quotationId: null, quotationNumber: null, orderId: null, orderNumber: null, exception: null, kind: null },
  tasks: [{ id: "t1", subject: "Get campaign CMP-0007 ready", status: "PENDING", dueAt: "2026-11-08T00:00:00Z", assignee: "Asha" }],
  steps: [{ id: "s1", sequence: 1, stepKey: "check", label: "Check the campaign", kind: "CHECK", status: "DONE", attempt: 1, summary: "Owner Asha.", errorCode: null, errorMessage: null, actor: null, startedAt: "2026-11-05T10:00:00Z", lastCheckAt: null, finishedAt: "2026-11-05T10:00:00Z" }],
  actions: [
    { key: "resolve", label: "Mark resolved", help: "Ends the workflow as resolved by a person (with a note)." },
    { key: "cancel", label: "Cancel", help: "Stops the workflow and cancels the open tasks it created." },
  ],
  startedAt: "2026-11-05T10:00:00Z",
  completedAt: null,
  updatedAt: "2026-11-05T10:00:00Z",
};

describe("Workflow instance", () => {
  it("shows the plan, checklist and tasks; resolve needs a note and posts it", async () => {
    const calls = stub(({ init }) => ({ data: init?.method ? { ...instance, status: "COMPLETED", statusLabel: "Completed", statusTone: "green", actions: [] } : instance }));
    render(<SmWorkflowInstanceClient id="i1" />);
    await waitFor(() => expect(screen.getByText("CMP-0007")).toBeTruthy());
    expect(screen.getByText("Get campaign CMP-0007 ready")).toBeTruthy();
    expect(screen.getByText(/Email v3 not approved/)).toBeTruthy();
    expect(screen.getByText("(current)")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Mark resolved" }));
    const confirm = screen.getAllByRole("button", { name: "Mark resolved" }).at(-1)! as HTMLButtonElement;
    expect(confirm.disabled).toBe(true);
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "Handled by phone" } });
    expect(confirm.disabled).toBe(false);
    fireEvent.click(confirm);
    await waitFor(() => expect(screen.getByText("Completed")).toBeTruthy());
    const post = calls.find((c) => c.init?.method === "POST")!;
    expect(JSON.parse(String(post.init!.body))).toEqual({ action: "resolve", note: "Handled by phone" });
    expect(screen.queryByRole("button", { name: "Cancel" })).toBeNull();
  });
});
