// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), refresh: vi.fn(), back: vi.fn() }) }));

const { CloseDate, OpportunityStatusBadge, opportunityValue } = await import("./OpportunityBadges");
const { ChangeOpportunityStatusModal, ChangeStageModal, LinkErpDocumentModal, TransferPipelineModal } = await import("./OpportunityDialogs");
const { OpportunityStageHistory, OpportunityUpcomingSections } = await import("./OpportunityRelatedPanels");

const ID = "6f1c2f1e-1f2a-4b1a-9d1a-2b3c4d5e6f70";
const json = (body: unknown, status = 200) => Promise.resolve(new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } }));
const pipelines = [
  {
    id: "p1",
    key: "sales",
    name: "Sales",
    isDefault: true,
    isActive: true,
    stages: [
      { id: "s1", pipelineId: "p1", key: "new", name: "New", probability: 10, isActive: true, sortOrder: 10 },
      { id: "s2", pipelineId: "p1", key: "qualified", name: "Qualified", probability: 25, isActive: true, sortOrder: 20 },
    ],
  },
];

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("opportunity UI pieces", () => {
  it("labels statuses and formats values", () => {
    render(<OpportunityStatusBadge status="ABANDONED" />);
    expect(screen.getByText("Abandoned")).toBeTruthy();
    expect(opportunityValue(null, "INR")).toBeNull();
    expect(opportunityValue("500000", "INR")).toContain("INR");
  });

  it("flags overdue expected close dates only for open deals", () => {
    render(<CloseDate value="2020-01-01T00:00:00.000Z" status="OPEN" />);
    expect(screen.getByText(/overdue/)).toBeTruthy();
    cleanup();
    render(<CloseDate value="2020-01-01T00:00:00.000Z" status="WON" />);
    expect(screen.queryByText(/overdue/)).toBeNull();
  });

  it("lists activities and tasks as later-phase placeholders", () => {
    render(<OpportunityUpcomingSections />);
    expect(screen.getByText("Tasks")).toBeTruthy();
    expect(screen.getAllByText(/Arrives with/).length).toBeGreaterThanOrEqual(4);
  });

  it("only offers Reopen for a closed opportunity", () => {
    render(<ChangeOpportunityStatusModal target={{ recordId: ID, version: 3 }} current="WON" reasons={[]} onClose={vi.fn()} onDone={vi.fn()} />);
    const options = Array.from((screen.getByLabelText(/Status/) as HTMLSelectElement).options).map((o) => o.value);
    expect(options).toEqual(["OPEN"]);
    expect(screen.getByRole("button", { name: "Reopen" })).toBeTruthy();
  });

  it("sends status, reason and version when closing", async () => {
    const fetchMock = vi.fn(() => json({ data: {} }));
    vi.stubGlobal("fetch", fetchMock);
    const onDone = vi.fn();
    render(<ChangeOpportunityStatusModal target={{ recordId: ID, version: 3 }} current="OPEN" initialStatus="LOST" reasons={["Price"]} onClose={vi.fn()} onDone={onDone} />);
    fireEvent.change(screen.getByLabelText(/Reason/), { target: { value: "Price" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(onDone).toHaveBeenCalled());
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe(`/api/v1/crm/opportunities/${ID}/status`);
    expect(JSON.parse(String(init.body))).toEqual({ status: "LOST", reason: "Price", version: 3 });
  });

  it("moves to a stage and leaves probability to the stage default when blank", async () => {
    const fetchMock = vi.fn((url: string) => json({ data: url.endsWith("/validate") ? { allowed: true, reasons: [], missingFields: [] } : {} }));
    vi.stubGlobal("fetch", fetchMock);
    const onDone = vi.fn();
    render(<ChangeStageModal pipelines={pipelines} target={{ recordId: ID, version: 2 }} current={{ pipelineId: "p1", stageId: "s1", probability: 10, probabilitySource: "STAGE" }} onClose={vi.fn()} onDone={onDone} />);
    expect((screen.getByLabelText(/Probability/) as HTMLInputElement).placeholder).toBe("10");
    fireEvent.change(screen.getByLabelText(/^Stage/), { target: { value: "s2" } });
    expect((screen.getByLabelText(/Probability/) as HTMLInputElement).placeholder).toBe("25");
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(onDone).toHaveBeenCalled());
    const [, init] = (fetchMock.mock.calls as unknown as [string, RequestInit][]).find(([url]) => url.endsWith("/stage"))!;
    expect(JSON.parse(String(init.body))).toEqual({ stageId: "s2", pipelineId: "p1", version: 2 });
  });

  it("shows what a stage requires before the move and disables Save", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(() => json({ data: { allowed: false, reasons: [{ code: "REQUIRED_FIELDS_MISSING", message: "x" }], missingFields: [{ key: "company", label: "Company", field: "crmCompanyId" }, { key: "erp:SALES_ORDER", label: "A linked sales order", field: null }] } }))
    );
    render(<ChangeStageModal pipelines={pipelines} target={{ recordId: ID, version: 2 }} current={{ pipelineId: "p1", stageId: "s1", probability: 10 }} onClose={vi.fn()} onDone={vi.fn()} />);
    fireEvent.change(screen.getByLabelText(/^Stage/), { target: { value: "s2" } });
    expect(await screen.findByText("A linked sales order")).toBeTruthy();
    expect(screen.getByText("Company")).toBeTruthy();
    expect((screen.getByRole("button", { name: "Save" }) as HTMLButtonElement).disabled).toBe(true);
  });

  it("keeps a hand-set probability unless told to use the stage default", async () => {
    const fetchMock = vi.fn((url: string) => json({ data: url.endsWith("/validate") ? { allowed: true, reasons: [], missingFields: [] } : {} }));
    vi.stubGlobal("fetch", fetchMock);
    const onDone = vi.fn();
    render(<ChangeStageModal pipelines={pipelines} target={{ recordId: ID, version: 2 }} current={{ pipelineId: "p1", stageId: "s1", probability: 40, probabilitySource: "MANUAL" }} onClose={vi.fn()} onDone={onDone} />);
    fireEvent.change(screen.getByLabelText(/^Stage/), { target: { value: "s2" } });
    expect((screen.getByLabelText(/^Probability/) as HTMLInputElement).placeholder).toBe("40");
    fireEvent.click(screen.getByLabelText(/Tick to use the stage/));
    expect((screen.getByLabelText(/^Probability/) as HTMLInputElement).placeholder).toBe("25");
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(onDone).toHaveBeenCalled());
    const [, init] = (fetchMock.mock.calls as unknown as [string, RequestInit][]).find(([url]) => url.endsWith("/stage"))!;
    expect(JSON.parse(String(init.body))).toEqual({ stageId: "s2", pipelineId: "p1", version: 2, useStageProbability: true });
  });

  it("moves to another pipeline and lists the missing fields when refused", async () => {
    const two = [...pipelines, { id: "p2", key: "export", name: "Export", isDefault: false, isActive: true, stages: [{ id: "e1", pipelineId: "p2", key: "enq", name: "Enquiry", probability: 10, isActive: true, isDefault: true, sortOrder: 10 }] }];
    const fetchMock = vi.fn(() =>
      json({ error: { code: "CRM_STAGE_TRANSITION_BLOCKED", message: "blocked", details: { reasons: [{ code: "REQUIRED_FIELDS_MISSING", message: "x" }], missingFields: [{ key: "contact", label: "Contact", field: "crmContactId" }] } } }, 422)
    );
    vi.stubGlobal("fetch", fetchMock);
    render(<TransferPipelineModal pipelines={two} target={{ recordId: ID, version: 4 }} currentPipelineId="p1" onClose={vi.fn()} onDone={vi.fn()} />);
    expect(screen.getByText(/Default stage \(Enquiry\)/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Move" }));
    expect(await screen.findByText("Contact")).toBeTruthy();
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe(`/api/v1/crm/opportunities/${ID}/transfer`);
    expect(JSON.parse(String(init.body))).toEqual({ pipelineId: "p2", reason: "", version: 4 });
  });

  it("renders stage history with probabilities and who changed it", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(() =>
        json({
          data: [
            { id: "h2", changeType: "PIPELINE_TRANSFER", source: "TRANSFER", fromPipeline: { id: "p1", name: "Sales" }, toPipeline: { id: "p2", name: "Export" }, fromStage: { id: "s2", name: "Qualified" }, toStage: { id: "e1", name: "Enquiry" }, fromProbability: 25, toProbability: 10, probabilitySource: "STAGE", reason: null, changedBy: { id: "u", name: "Asha" }, changedAt: "2026-10-05T10:00:00.000Z" },
            { id: "h1", changeType: "INITIAL", source: "CREATE", fromPipeline: null, toPipeline: { id: "p1", name: "Sales" }, fromStage: null, toStage: { id: "s1", name: "New" }, fromProbability: null, toProbability: 10, probabilitySource: "STAGE", reason: null, changedBy: { id: "u", name: "Asha" }, changedAt: "2026-10-01T10:00:00.000Z" },
          ],
        })
      )
    );
    render(<OpportunityStageHistory opportunityId={ID} refreshKey={0} />);
    expect(await screen.findByText(/Sales → Export/)).toBeTruthy();
    expect(screen.getByText(/Probability 25% → 10%/)).toBeTruthy();
    expect(screen.getByText(/Started in/)).toBeTruthy();
  });

  it("can't pick an ERP document that is already linked", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(() =>
        json({
          data: {
            customerLinked: true,
            rows: [
              { id: "d1", number: "SO-1", date: "2026-10-01", status: "CONFIRMED", amount: "100", currencyCode: "INR", subtitle: null, customerName: "Acme", alreadyLinked: true },
              { id: "d2", number: "SO-2", date: "2026-10-02", status: "DRAFT", amount: null, currencyCode: null, subtitle: null, customerName: "Acme", alreadyLinked: false },
            ],
          },
        })
      )
    );
    render(<LinkErpDocumentModal opportunityId={ID} onClose={vi.fn()} onDone={vi.fn()} />);
    expect(((await screen.findByRole("button", { name: /SO-1/ })) as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByRole("button", { name: /SO-2/ }) as HTMLButtonElement).disabled).toBe(false);
    expect(screen.getByText(/no quotation module/)).toBeTruthy();
  });
});
