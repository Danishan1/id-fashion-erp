// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

const { PipelinesTab } = await import("./PipelinesTab");
const { ArchiveStageModal, StageModal } = await import("./PipelineDialogs");

const json = (body: unknown, status = 200) => Promise.resolve(new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } }));
const stage = (id: string, name: string, sortOrder: number, extra: Record<string, unknown> = {}) => ({
  id,
  pipelineId: "p1",
  key: id,
  name,
  description: null,
  probability: sortOrder,
  isDefault: false,
  status: "ACTIVE",
  sortOrder,
  requiredFields: [],
  requiredFieldLabels: [],
  transitionMode: "ANY",
  transitionRules: [],
  opportunityCount: 0,
  openOpportunityCount: 0,
  version: 1,
  ...extra,
});
const stages = [stage("s1", "New", 10, { isDefault: true }), stage("s2", "Qualified", 20, { requiredFieldLabels: ["Company"], opportunityCount: 3, openOpportunityCount: 2 }), stage("s3", "Proposal", 30)];
const pipeline = { id: "p1", key: "sales", name: "Sales", description: null, isDefault: true, status: "ACTIVE", version: 1, opportunityCount: 3, openOpportunityCount: 2, stages };
const detail = {
  ...pipeline,
  requirementOptions: [
    { key: "company", label: "Company", group: "Fields" },
    { key: "amount", label: "Estimated value", group: "Fields" },
    { key: "erp:SALES_ORDER", label: "Linked sales order", group: "ERP documents" },
  ],
  unavailableRequirements: [{ key: "quotation", label: "Quotation", reason: "The ERP has no quotation module yet." }],
};

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function stubApi() {
  const fetchMock = vi.fn((url: string, init?: RequestInit) => {
    if (url === "/api/v1/crm/settings/pipelines") return json({ data: [pipeline] });
    if (url === "/api/v1/crm/pipelines/p1") return json({ data: detail });
    return json({ data: {}, init });
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}
const calls = (f: ReturnType<typeof stubApi>, suffix: string) => (f.mock.calls as unknown as [string, RequestInit][]).filter(([u, i]) => u.endsWith(suffix) && i?.method === "POST");

describe("Settings → Pipelines & stages", () => {
  it("lists stages with probability, default, requirements and usage; edit actions hidden when read-only", async () => {
    stubApi();
    render(<PipelinesTab canEdit={false} />);
    const row = await screen.findByTestId("stage-row-Qualified");
    expect(within(row).getByText("20%")).toBeTruthy();
    expect(within(row).getByText("Company")).toBeTruthy();
    expect(within(row).getByText(/2 open · 3 total/)).toBeTruthy();
    expect(within(screen.getByTestId("stage-row-New")).getByText("Start stage")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Add stage" })).toBeNull();
    expect(screen.queryByLabelText("Move New up")).toBeNull();
  });

  it("reorders with ↑/↓ and by drag and drop, sending every active stage id", async () => {
    const f = stubApi();
    render(<PipelinesTab canEdit />);
    await screen.findByTestId("stage-row-Proposal");
    fireEvent.click(screen.getByLabelText("Move Proposal up"));
    await waitFor(() => expect(calls(f, "/stages/reorder")).toHaveLength(1));
    expect(JSON.parse(String(calls(f, "/stages/reorder")[0][1].body))).toEqual({ ids: ["s1", "s3", "s2"] });

    cleanup();
    const g = stubApi();
    render(<PipelinesTab canEdit />);
    const from = await screen.findByTestId("stage-row-New");
    fireEvent.dragStart(from);
    fireEvent.dragOver(screen.getByTestId("stage-row-Proposal"));
    fireEvent.drop(screen.getByTestId("stage-row-Proposal"));
    await waitFor(() => expect(calls(g, "/stages/reorder")).toHaveLength(1));
    expect(JSON.parse(String(calls(g, "/stages/reorder")[0][1].body))).toEqual({ ids: ["s2", "s3", "s1"] });
  });

  it("stage form sends required fields and shows quotation as not available", async () => {
    const f = vi.fn(() => json({ data: {} }));
    vi.stubGlobal("fetch", f);
    const onSaved = vi.fn();
    render(<StageModal pipeline={detail as never} stage={stages[1] as never} onClose={vi.fn()} onSaved={onSaved} />);
    expect(screen.getByText(/Quotation:/)).toBeTruthy();
    fireEvent.click(screen.getByLabelText("Estimated value"));
    fireEvent.click(screen.getByLabelText("Linked sales order"));
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(onSaved).toHaveBeenCalled());
    const [url, init] = f.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("/api/v1/crm/pipelines/p1/stages/s2");
    expect(JSON.parse(String(init.body))).toMatchObject({ version: 1, requiredFields: ["amount", "erp:SALES_ORDER"], probability: "20" });
  });

  it("archiving a used stage needs a destination and confirmation; the default stage can't be archived", async () => {
    const f = vi.fn(() => json({ data: {} }));
    vi.stubGlobal("fetch", f);
    const onDone = vi.fn();
    render(<ArchiveStageModal pipeline={detail as never} stage={stages[1] as never} onClose={vi.fn()} onDone={onDone} />);
    expect(screen.getByText(/3 opportunities are in this stage/)).toBeTruthy();
    const archive = screen.getByRole("button", { name: "Archive" }) as HTMLButtonElement;
    expect(archive.disabled).toBe(true);
    fireEvent.change(screen.getByLabelText(/Move them to/), { target: { value: "s3" } });
    fireEvent.click(screen.getByRole("checkbox"));
    expect(archive.disabled).toBe(false);
    fireEvent.click(archive);
    await waitFor(() => expect(onDone).toHaveBeenCalled());
    expect(JSON.parse(String((f.mock.calls[0] as unknown as [string, RequestInit])[1].body))).toEqual({ version: 1, reassignToStageId: "s3", confirm: true });

    cleanup();
    render(<ArchiveStageModal pipeline={detail as never} stage={stages[0] as never} onClose={vi.fn()} onDone={vi.fn()} />);
    expect(screen.getByText(/default stage/)).toBeTruthy();
    expect((screen.getByRole("button", { name: "Archive" }) as HTMLButtonElement).disabled).toBe(true);
  });
});
