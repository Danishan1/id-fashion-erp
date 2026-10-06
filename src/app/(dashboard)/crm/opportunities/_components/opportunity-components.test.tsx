// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), refresh: vi.fn(), back: vi.fn() }) }));

const { CloseDate, OpportunityStatusBadge, opportunityValue } = await import("./OpportunityBadges");
const { ChangeOpportunityStatusModal, ChangeStageModal, LinkErpDocumentModal } = await import("./OpportunityDialogs");
const { OpportunityUpcomingSections } = await import("./OpportunityRelatedPanels");

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
    const fetchMock = vi.fn(() => json({ data: {} }));
    vi.stubGlobal("fetch", fetchMock);
    const onDone = vi.fn();
    render(<ChangeStageModal pipelines={pipelines} target={{ recordId: ID, version: 2 }} current={{ pipelineId: "p1", stageId: "s1", probability: 10 }} onClose={vi.fn()} onDone={onDone} />);
    expect((screen.getByLabelText(/Probability/) as HTMLInputElement).placeholder).toBe("10");
    fireEvent.change(screen.getByLabelText(/^Stage/), { target: { value: "s2" } });
    expect((screen.getByLabelText(/Probability/) as HTMLInputElement).placeholder).toBe("25");
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(onDone).toHaveBeenCalled());
    const [, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(JSON.parse(String(init.body))).toEqual({ stageId: "s2", pipelineId: "p1", version: 2 });
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
