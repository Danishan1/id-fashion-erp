// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const nav = vi.hoisted(() => ({ push: vi.fn(), replace: vi.fn() }));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: nav.push, replace: nav.replace, refresh: vi.fn(), back: vi.fn() }),
  usePathname: () => "/crm/opportunities",
  useSearchParams: () => new URLSearchParams("view=board"),
}));
const toasts = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn(), warning: vi.fn(), info: vi.fn() }));
vi.mock("@/components/ui/Toast", () => ({ toast: toasts }));

const { OpportunityBoardClient, CONFLICT_MESSAGE, moveFailureNotice } = await import("./OpportunityBoardClient");
const { BulkResultModal, BulkUpdateFieldsModal } = await import("./OpportunityDialogs");
type BoardDto = import("./OpportunityBoardClient").BoardDto;
type Meta = import("./opportunity-types").OpportunityMetaDto;

const json = (body: unknown, status = 200) => Promise.resolve(new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } }));
const meta: Meta = {
  pipelines: [
    {
      id: "p1",
      key: "sales",
      name: "Sales",
      isDefault: true,
      isActive: true,
      stages: [
        { id: "s1", pipelineId: "p1", key: "new", name: "New", probability: 10, isActive: true, sortOrder: 10 },
        { id: "s2", pipelineId: "p1", key: "costing", name: "Costing", probability: 60, isActive: true, sortOrder: 20 },
      ],
    },
    { id: "p-old", key: "old", name: "Retired", isDefault: false, isActive: false, archivedAt: "2026-01-01T00:00:00Z", stages: [] },
  ],
  statuses: [],
  sources: [{ id: "src1", key: "expo", name: "Trade fair" }],
  customFields: [{ id: "cf1", key: "fabric", label: "Fabric", fieldType: "TEXT", description: null, options: null, isRequired: false, isActive: true, sortOrder: 1 }],
  suggestions: { opportunity_close_reason: [] },
  baseCurrencyCode: "INR",
};
const card = (id: string, stageId: string, extra: Record<string, unknown> = {}) => ({
  id,
  opportunityNumber: `OPP-${id}`,
  name: `Deal ${id}`,
  status: "OPEN",
  amount: "1000",
  currencyCode: "INR",
  probability: 10,
  probabilitySource: "STAGE" as const,
  expectedCloseDate: null,
  closedAt: null,
  lastActivityAt: null,
  createdAt: "2026-10-01T00:00:00Z",
  updatedAt: "2026-10-01T00:00:00Z",
  archivedAt: null,
  version: 3,
  ownerUserId: "u1",
  leadId: null,
  crmCompanyId: "c1",
  crmContactId: null,
  pipelineId: "p1",
  stageId,
  owner: { id: "u1", fullName: "Ravi Rep" },
  ownerInactive: false,
  crmCompany: { id: "c1", name: "ABC Textiles" },
  crmContact: null,
  pipeline: { id: "p1", name: "Sales" },
  stage: { id: stageId, name: stageId === "s1" ? "New" : "Costing", probability: 10, sortOrder: 10 },
  source: null,
  tags: [{ id: "t1", name: "Export", color: null }],
  customFields: { fabric: "Linen" },
  ...extra,
});
const boardData = (): BoardDto => ({
  pipeline: { id: "p1", name: "Sales", isDefault: true, archivedAt: null },
  stages: [
    { id: "s1", name: "New", sortOrder: 10, probability: 10, isDefault: true, archived: false, requiredFields: [], count: 3, values: [{ currencyCode: "INR", total: 3000, weighted: 300, average: 1000 }], records: [card("o1", "s1"), card("o2", "s1")], hasMore: true },
    { id: "s2", name: "Costing", sortOrder: 20, probability: 60, isDefault: false, archived: false, requiredFields: ["amount"], count: 0, values: [], records: [], hasMore: false },
  ],
});

let stageResponse: () => Promise<Response>;
let fetchMock: ReturnType<typeof vi.fn>;
const boardCalls = () => (fetchMock.mock.calls as [string, RequestInit?][]).filter(([u]) => u.includes("/board"));
const preferences = (prefs: Record<string, unknown> = {}) => ({ prefs, loaded: true, setPreference: vi.fn() });
const renderBoard = (prefs: Record<string, unknown> = {}, edit = true) => {
  const p = preferences(prefs);
  render(<OpportunityBoardClient permissions={{ create: true, edit, viewAll: true, settings: true }} meta={meta} users={[{ id: "u1", fullName: "Ravi Rep" }]} preferences={p as never} />);
  return p;
};
const column = (name: string) => screen.getByRole("region", { name: `${name} stage` });
const dt = () => {
  const data: Record<string, string> = {};
  return { setData: (k: string, v: string) => (data[k] = v), getData: (k: string) => data[k] ?? "", dropEffect: "", effectAllowed: "" };
};
const drag = (cardId: string, toStage: string) => {
  const transfer = dt();
  const el = document.querySelector(`[data-card-id="${cardId}"]`)!;
  fireEvent.dragStart(el, { dataTransfer: transfer });
  fireEvent.dragOver(column(toStage), { dataTransfer: transfer });
  fireEvent.drop(column(toStage), { dataTransfer: transfer });
};

beforeEach(() => {
  stageResponse = () => json({ data: {} });
  fetchMock = vi.fn((url: string) => {
    if (url.includes("/board")) return json({ data: boardData() });
    if (url.endsWith("/stage")) return stageResponse();
    return json({ data: [] });
  });
  vi.stubGlobal("fetch", fetchMock);
  for (const t of Object.values(toasts)) t.mockReset();
  nav.push.mockReset();
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("opportunity board", () => {
  it("shows active pipelines only and stage columns with count, value, weighted value and average from the server", async () => {
    renderBoard();
    await screen.findByRole("region", { name: "New stage" });
    const options = [...(screen.getByLabelText("Pipeline") as HTMLSelectElement).options].map((o) => o.textContent);
    expect(options).toEqual(["Sales (default)"]);
    const header = within(column("New")).getByRole("banner");
    expect(within(header).getByLabelText("3 opportunities")).toBeTruthy();
    expect(header.textContent).toContain("INR 3,000");
    expect(header.textContent).toMatch(/Weighted.*INR 300/);
    expect(header.textContent).toMatch(/Average.*INR 1,000/);
    expect(within(column("Costing")).getByText("No opportunities — drop one here")).toBeTruthy();
    expect(boardCalls()[0][0]).toBe("/api/v1/crm/pipelines/p1/board?perStage=20");
  });

  it("renders the configured card fields, including custom fields", async () => {
    renderBoard({ "opportunities.board.cardFields": ["company", "cf:fabric", "unknown-field"] });
    const first = await screen.findByText("Deal o1");
    const li = first.closest("li")!;
    expect(li.textContent).toContain("ABC Textiles");
    expect(li.textContent).toContain("Linen");
    expect(li.textContent).not.toContain("Ravi Rep"); // owner not chosen
    expect(first.getAttribute("href")).toBe("/crm/opportunities/o1");
  });

  it("drops a card through the Phase 07 stage endpoint with its version, moving it optimistically and reloading after success", async () => {
    let resolve!: (r: Response) => void;
    stageResponse = () => new Promise<Response>((r) => (resolve = r));
    renderBoard();
    await screen.findByText("Deal o1");
    drag("o1", "Costing");
    // Optimistic: already in the target column while the server decides.
    await waitFor(() => expect(within(column("Costing")).getByText("Deal o1")).toBeTruthy());
    expect(within(column("Costing")).getByText(/saving…/)).toBeTruthy();
    const [url, init] = (fetchMock.mock.calls as [string, RequestInit][]).find(([u]) => u.endsWith("/stage"))!;
    expect(url).toBe("/api/v1/crm/opportunities/o1/stage");
    expect(JSON.parse(String(init.body))).toEqual({ stageId: "s2", pipelineId: "p1", version: 3 });
    const before = boardCalls().length;
    resolve(new Response(JSON.stringify({ data: {} }), { status: 200 }));
    await waitFor(() => expect(toasts.success).toHaveBeenCalledWith('Moved "Deal o1" to Costing.'));
    await waitFor(() => expect(boardCalls().length).toBe(before + 1));
  });

  it("puts the card back and lists the missing fields with an Open Opportunity action when the stage requires them", async () => {
    stageResponse = () =>
      json(
        { error: { code: "CRM_STAGE_TRANSITION_BLOCKED", message: "Blocked", details: { reasons: [{ code: "REQUIRED_FIELDS_MISSING", message: "x" }], missingFields: [{ key: "expectedCloseDate", label: "Expected close date", field: "expectedCloseDate" }, { key: "erp:SALES_ORDER", label: "A linked sales order", field: null }] } } },
        422
      );
    renderBoard();
    await screen.findByText("Deal o1");
    drag("o1", "Costing");
    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByText("Can't move to Costing")).toBeTruthy();
    expect(within(dialog).getByText("Expected close date")).toBeTruthy();
    expect(within(dialog).getByText("A linked sales order")).toBeTruthy();
    expect(within(dialog).getByRole("link", { name: "Open Opportunity" }).getAttribute("href")).toBe("/crm/opportunities/o1");
    // Rolled back to its original column and position, counts restored.
    const newCol = column("New");
    expect([...newCol.querySelectorAll("[data-card-id]")].map((e) => e.getAttribute("data-card-id"))).toEqual(["o1", "o2"]);
    expect(within(newCol).getByLabelText("3 opportunities")).toBeTruthy();
    expect(column("Costing").querySelector("[data-card-id]")).toBeNull();
  });

  it("shows the conflict message and keeps the card in place on a version conflict", async () => {
    stageResponse = () => json({ error: { code: "RECORD_VERSION_CONFLICT", message: "stale" } }, 409);
    renderBoard();
    await screen.findByText("Deal o1");
    drag("o2", "Costing");
    expect(await screen.findByText(CONFLICT_MESSAGE)).toBeTruthy();
    expect(within(column("New")).getByText("Deal o2")).toBeTruthy();
    const before = boardCalls().length;
    fireEvent.click(screen.getByRole("button", { name: "Refresh board" }));
    await waitFor(() => expect(boardCalls().length).toBe(before + 1));
  });

  it("rolls back when the network fails", async () => {
    stageResponse = () => Promise.reject(new TypeError("offline"));
    renderBoard();
    await screen.findByText("Deal o1");
    drag("o1", "Costing");
    expect(await screen.findByText(/Couldn't reach the server/)).toBeTruthy();
    expect(within(column("New")).getByText("Deal o1")).toBeTruthy();
  });

  it("does nothing when a card is dropped on its own column, and cards aren't draggable without edit rights", async () => {
    renderBoard();
    await screen.findByText("Deal o1");
    drag("o1", "New");
    expect((fetchMock.mock.calls as [string][]).some(([u]) => u.endsWith("/stage"))).toBe(false);
    cleanup();
    renderBoard({}, false);
    await screen.findByText("Deal o1");
    expect(document.querySelector('[data-card-id="o1"]')!.getAttribute("draggable")).toBe("false");
  });

  it("loads the next page of one column only", async () => {
    renderBoard();
    await screen.findByText("Deal o1");
    fetchMock.mockImplementationOnce(() =>
      json({ data: { ...boardData(), stages: [{ ...boardData().stages[0], records: [card("o2", "s1"), card("o3", "s1")], hasMore: false }] } })
    );
    fireEvent.click(within(column("New")).getByRole("button", { name: "Load more (1)" }));
    await waitFor(() => expect(within(column("New")).getByText("Deal o3")).toBeTruthy());
    expect(boardCalls().at(-1)![0]).toBe("/api/v1/crm/pipelines/p1/board?perStage=20&stageId=s1&offset=2");
    expect(column("New").querySelectorAll("[data-card-id]")).toHaveLength(3); // o2 not duplicated
    expect(within(column("New")).queryByRole("button", { name: /Load more/ })).toBeNull();
  });

  it("remembers the chosen pipeline and card fields as preferences", async () => {
    const p = renderBoard();
    await screen.findByText("Deal o1");
    fireEvent.click(screen.getByRole("button", { name: /Card fields/ }));
    fireEvent.click(screen.getByLabelText("Fabric"));
    expect(p.setPreference).toHaveBeenCalledWith("opportunities.board.cardFields", expect.arrayContaining(["company", "cf:fabric"]));
    fireEvent.change(screen.getByLabelText("Pipeline"), { target: { value: "p1" } });
    expect(p.setPreference).toHaveBeenCalledWith("opportunities.board.pipelineId", "p1");
  });

  it("shows an error with retry when the board can't load", async () => {
    fetchMock.mockImplementation((url: string) => (url.includes("/board") ? json({ error: { code: "NOT_FOUND", message: "Pipeline not found." } }, 404) : json({ data: [] })));
    renderBoard();
    expect(await screen.findByText(/Pipeline not found/)).toBeTruthy();
    expect(screen.getByRole("button", { name: "Try again" })).toBeTruthy();
  });

  it("maps server refusals to board notices without re-validating anything", () => {
    const rec = card("o1", "s1") as never;
    expect(moveFailureNotice({ status: 422, code: "CRM_STAGE_TRANSITION_BLOCKED", message: "x", details: { reasons: [], missingFields: [{ key: "amount", label: "Value", field: "amount" }] }, fieldErrors: {} }, rec, "Costing")).toMatchObject({ kind: "blocked", stageName: "Costing", missingFields: [{ key: "amount" }] });
    expect(moveFailureNotice({ status: 409, code: "RECORD_VERSION_CONFLICT", message: "x", details: null, fieldErrors: {} }, rec, "Costing").kind).toBe("conflict");
    expect(moveFailureNotice({ status: 422, code: "INVALID_STATE_TRANSITION", message: "Closed — reopen it first", details: null, fieldErrors: {} }, rec, "Costing")).toMatchObject({ kind: "error", message: "Closed — reopen it first" });
  });
});

describe("list bulk dialogs", () => {
  it("bulk field update sends only the ticked safe fields", async () => {
    const onDone = vi.fn();
    fetchMock.mockImplementation(() => json({ data: { requested: 2, updated: 2, skipped: [] } }));
    render(<BulkUpdateFieldsModal ids={["a", "b"]} meta={meta} onClose={vi.fn()} onDone={onDone} />);
    expect((screen.getByRole("button", { name: "Update" }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(screen.getByLabelText("Expected close date"));
    fireEvent.change(screen.getByLabelText("New expected close date"), { target: { value: "2026-12-31" } });
    fireEvent.click(screen.getByLabelText("Custom field"));
    fireEvent.change(screen.getByLabelText("Fabric"), { target: { value: "Linen" } });
    fireEvent.click(screen.getByRole("button", { name: "Update" }));
    await waitFor(() => expect(onDone).toHaveBeenCalled());
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("/api/v1/crm/opportunities/bulk");
    expect(JSON.parse(String(init.body))).toEqual({ action: "update", ids: ["a", "b"], fields: { expectedCloseDate: "2026-12-31", customFields: { fabric: "Linen" } } });
  });

  it("bulk result lists every skipped record with its reason", () => {
    render(
      <BulkResultModal
        title="Moved 1 of 3."
        result={{ requested: 3, updated: 1, skipped: [{ id: "x", reason: "Missing Estimated value", label: "OPP-1 — Shirts" }, { id: "y", reason: "Not found or not visible to you", label: null }] }}
        onClose={vi.fn()}
      />
    );
    expect(screen.getByText("1 updated")).toBeTruthy();
    expect(screen.getByText("2 not changed")).toBeTruthy();
    expect(screen.getByRole("link", { name: "OPP-1 — Shirts" }).getAttribute("href")).toBe("/crm/opportunities/x");
    expect(screen.getByText("Missing Estimated value")).toBeTruthy();
    expect(screen.getByText("Not available")).toBeTruthy();
  });
});
