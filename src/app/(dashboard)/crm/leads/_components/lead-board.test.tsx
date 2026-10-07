// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const nav = vi.hoisted(() => ({ push: vi.fn(), replace: vi.fn() }));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: nav.push, replace: nav.replace, refresh: vi.fn(), back: vi.fn() }),
  usePathname: () => "/crm/leads",
  useSearchParams: () => new URLSearchParams("view=board"),
}));
const toasts = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn(), warning: vi.fn(), info: vi.fn() }));
vi.mock("@/components/ui/Toast", () => ({ toast: toasts }));
// The Convert drawer has its own tests; here we only check the board opens it with the full lead.
vi.mock("./ConvertLeadDrawer", () => ({
  ConvertLeadDrawer: ({ lead, onDone }: { lead: { fullName: string }; onDone: () => void }) => (
    <div role="dialog" aria-label="Convert lead">
      Converting {lead.fullName}
      <button onClick={onDone}>Finish conversion</button>
    </div>
  ),
}));

const { LeadBoardClient, leadMoveFailureNotice } = await import("./LeadBoardClient");
type Meta = import("./lead-types").LeadMetaDto;

const json = (body: unknown, status = 200) => Promise.resolve(new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } }));
const meta: Meta = {
  statuses: [
    { id: "s-new", key: "new", name: "New", kind: "OPEN", color: "indigo", isActive: true },
    { id: "s-q", key: "qualified", name: "Qualified", kind: "OPEN", color: "green", isActive: true },
    { id: "s-conv", key: "converted", name: "Converted", kind: "CONVERTED", color: "green", isActive: true },
  ],
  sources: [{ id: "src1", key: "expo", name: "Trade fair" }],
  customFields: [{ id: "cf1", key: "buyer_type", label: "Buyer type", fieldType: "TEXT", description: null, options: null, isRequired: false, isActive: true, sortOrder: 1 }],
  baseCurrencyCode: "INR",
};
const lead = (id: string, statusId: string, extra: Record<string, unknown> = {}) => ({
  id,
  leadNumber: `LEAD-${id}`,
  firstName: `Asha ${id}`,
  lastName: null,
  fullName: `Asha ${id}`,
  companyName: "Rao Exports",
  email: "asha@example.test",
  phone: "9876543210",
  mobile: null,
  whatsapp: null,
  score: 0,
  temperature: "HOT" as const,
  estimatedValue: "50000",
  currencyCode: "INR",
  lastContactedAt: null,
  nextFollowUpAt: null,
  createdAt: "2026-10-01T00:00:00Z",
  updatedAt: "2026-10-01T00:00:00Z",
  archivedAt: null,
  convertedAt: null,
  ownerUserId: "u1",
  version: 4,
  status: { id: statusId, name: "New", kind: "OPEN" as const, color: "indigo" },
  source: { id: "src1", key: "expo", name: "Trade fair" },
  owner: { id: "u1", fullName: "Ravi Rep" },
  ownerInactive: false,
  crmCompany: null,
  tags: [],
  customFields: { buyer_type: "Wholesaler" },
  ...extra,
});
const boardData = () => ({
  statuses: [
    { id: "s-new", name: "New", kind: "OPEN", color: "indigo", sortOrder: 10, isDefault: true, archived: false, count: 2, values: [{ currencyCode: "INR", total: 100000, average: 50000 }], records: [lead("l1", "s-new"), lead("l2", "s-new")], hasMore: false },
    { id: "s-q", name: "Qualified", kind: "OPEN", color: "green", sortOrder: 20, isDefault: false, archived: false, count: 0, values: [], records: [], hasMore: false },
    { id: "s-conv", name: "Converted", kind: "CONVERTED", color: "green", sortOrder: 30, isDefault: false, archived: false, count: 0, values: [], records: [], hasMore: false },
  ],
});

let statusResponse: () => Promise<Response>;
let fetchMock: ReturnType<typeof vi.fn>;
const calls = () => fetchMock.mock.calls as [string, RequestInit?][];
const renderBoard = (prefs: Record<string, unknown> = {}) => {
  const p = { prefs, loaded: true, setPreference: vi.fn() };
  render(<LeadBoardClient permissions={{ create: true, edit: true, viewAll: true, settings: true }} meta={meta} users={[{ id: "u1", fullName: "Ravi Rep" }]} preferences={p as never} />);
  return p;
};
const column = (name: string) => screen.getByRole("region", { name: `${name} status` });
const drag = (cardId: string, to: string) => {
  const data: Record<string, string> = {};
  const dataTransfer = { setData: (k: string, v: string) => (data[k] = v), getData: (k: string) => data[k] ?? "", dropEffect: "", effectAllowed: "" };
  fireEvent.dragStart(document.querySelector(`[data-card-id="${cardId}"]`)!, { dataTransfer });
  fireEvent.dragOver(column(to), { dataTransfer });
  fireEvent.drop(column(to), { dataTransfer });
};

beforeEach(() => {
  statusResponse = () => json({ data: {} });
  fetchMock = vi.fn((url: string) => {
    if (url.startsWith("/api/v1/crm/leads/board")) return json({ data: boardData() });
    if (url.endsWith("/status")) return statusResponse();
    if (url === "/api/v1/crm/leads/l1") return json({ data: { ...lead("l1", "s-new"), crmCompanyId: null, crmContactId: null } });
    return json({ data: [] });
  });
  vi.stubGlobal("fetch", fetchMock);
  for (const t of Object.values(toasts)) t.mockReset();
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("lead board", () => {
  it("shows one column per status with count, estimated value and average, and the chosen card fields", async () => {
    renderBoard({ "leads.board.cardFields": ["company", "estimatedValue", "cf:buyer_type"] });
    await screen.findByText("Asha l1");
    expect(within(column("New")).getByLabelText("2 leads")).toBeTruthy();
    const header = within(column("New")).getByRole("banner").textContent!;
    expect(header).toContain("INR 1,00,000");
    expect(header).toMatch(/Average.*INR 50,000/);
    expect(within(column("Converted")).getByText("Drop a lead here to convert it")).toBeTruthy();
    const li = screen.getByText("Asha l1").closest("li")!;
    expect(li.textContent).toContain("Rao Exports");
    expect(li.textContent).toContain("Wholesaler");
    expect(li.textContent).not.toContain("Ravi Rep");
    expect(calls().find(([u]) => u.startsWith("/api/v1/crm/leads/board"))![0]).toBe("/api/v1/crm/leads/board?perStatus=20");
  });

  it("drops a card through the existing status endpoint with its version and reloads after success", async () => {
    renderBoard();
    await screen.findByText("Asha l1");
    drag("l1", "Qualified");
    await waitFor(() => expect(within(column("Qualified")).getByText("Asha l1")).toBeTruthy());
    const [url, init] = calls().find(([u]) => u.endsWith("/status"))! as [string, RequestInit];
    expect(url).toBe("/api/v1/crm/leads/l1/status");
    expect(JSON.parse(String(init.body))).toEqual({ statusId: "s-q", version: 4 });
    await waitFor(() => expect(toasts.success).toHaveBeenCalledWith('Moved "Asha l1" to Qualified.'));
    await waitFor(() => expect(calls().filter(([u]) => u.startsWith("/api/v1/crm/leads/board")).length).toBe(2));
  });

  it("puts the card back and shows the server's reason when the change is refused", async () => {
    statusResponse = () => json({ error: { code: "VALIDATION_ERROR", message: '"Qualified" is no longer in use.' } }, 422);
    renderBoard();
    await screen.findByText("Asha l1");
    drag("l2", "Qualified");
    expect(await screen.findByText('"Qualified" is no longer in use.')).toBeTruthy();
    expect([...column("New").querySelectorAll("[data-card-id]")].map((e) => e.getAttribute("data-card-id"))).toEqual(["l1", "l2"]);
    expect(within(screen.getByRole("dialog")).getByRole("link", { name: "Open Lead" }).getAttribute("href")).toBe("/crm/leads/l2");
  });

  it("shows the conflict message on a version conflict", async () => {
    statusResponse = () => json({ error: { code: "RECORD_VERSION_CONFLICT", message: "stale" } }, 409);
    renderBoard();
    await screen.findByText("Asha l1");
    drag("l1", "Qualified");
    expect(await screen.findByText("This lead was updated by another user. Please refresh and try again.")).toBeTruthy();
    expect(within(column("New")).getByText("Asha l1")).toBeTruthy();
  });

  it("dropping on a Converted status opens Convert instead of changing the status", async () => {
    renderBoard();
    await screen.findByText("Asha l1");
    drag("l1", "Converted");
    expect(await screen.findByRole("dialog", { name: "Convert lead" })).toBeTruthy();
    expect(calls().some(([u]) => u.endsWith("/status"))).toBe(false);
    expect(within(column("New")).getByText("Asha l1")).toBeTruthy(); // stays until conversion is done
    const before = calls().filter(([u]) => u.startsWith("/api/v1/crm/leads/board")).length;
    fireEvent.click(screen.getByRole("button", { name: "Finish conversion" }));
    await waitFor(() => expect(calls().filter(([u]) => u.startsWith("/api/v1/crm/leads/board")).length).toBe(before + 1));
  });

  it("remembers card fields and maps refusals without re-validating", async () => {
    const p = renderBoard();
    await screen.findByText("Asha l1");
    fireEvent.click(screen.getByRole("button", { name: /Card fields/ }));
    fireEvent.click(screen.getByLabelText("Buyer type"));
    expect(p.setPreference).toHaveBeenCalledWith("leads.board.cardFields", expect.arrayContaining(["company", "cf:buyer_type"]));
    expect(leadMoveFailureNotice({ status: 409, code: "RECORD_VERSION_CONFLICT", message: "x", details: null, fieldErrors: {} }).kind).toBe("conflict");
    expect(leadMoveFailureNotice({ status: 422, code: "INVALID_STATE_TRANSITION", message: "This lead has been converted; its status can't be changed.", details: null, fieldErrors: {} })).toEqual({
      kind: "error",
      message: "This lead has been converted; its status can't be changed.",
    });
  });
});
