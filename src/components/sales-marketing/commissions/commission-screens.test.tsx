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
vi.mock("next/navigation", () => ({ useRouter: () => ({ push, replace: vi.fn(), refresh: vi.fn(), back: vi.fn() }) }));

const { StatementDetailClient } = await import("./StatementDetailClient");
const { RuleEditor, emptyRule } = await import("./PlanRuleEditor");
type RuleDraft = import("./PlanRuleEditor").RuleDraft;
const { StatementsClient } = await import("./StatementsClient");
const { ChannelAgentPanel } = await import("../channels/ChannelAgentPanel");
type View = Parameters<typeof StatementDetailClient>[0]["initial"];

const ok = (data: unknown) => Promise.resolve(new Response(JSON.stringify({ data }), { status: 200 }));
const statement = (extra: Partial<View> = {}): View => ({
  id: "s1",
  month: "2026-10",
  payeeType: "REP",
  payee: "Asha",
  status: "PENDING_APPROVAL",
  totals: { earned: 3500, reversals: 0, incentives: 2500, adjustments: 100, carryForward: 0, net: 6100 },
  calculatedAt: "2026-11-02T10:00:00.000Z",
  calculatedBy: "Prep",
  submittedBy: "Prep",
  approvedBy: null,
  approvedAt: null,
  decisionComment: null,
  monthOver: true,
  payment: null,
  lines: [
    { id: "l1", kind: "EARNING", eventKey: "INV:1", eventDate: "2026-10-10", basis: 100000, rate: 2.3333, amount: 2333.34, salesInvoiceId: "i1", salesOrderId: "o1", reason: null, createdBy: null, details: { planCode: "REP", versionNumber: 1, rule: "Progressive tiers", invoiceNumber: "INV-1", orderNumber: "ORD-1", group: { basis: 150000, events: 2, gross: 3500, amount: 3500, effectiveRate: 2.3333, belowMinimum: false, capped: false } } },
    { id: "l2", kind: "EARNING", eventKey: "INV:2", eventDate: "2026-10-12", basis: 50000, rate: 2.3333, amount: 1166.66, salesInvoiceId: "i2", salesOrderId: "o2", reason: null, createdBy: null, details: { planCode: "REP", versionNumber: 1, invoiceNumber: "INV-2", orderNumber: "ORD-2" } },
    { id: "l3", kind: "INCENTIVE", eventKey: "INC:x", eventDate: "2026-10-31", basis: 150000, rate: null, amount: 2500, salesInvoiceId: null, salesOrderId: null, reason: null, createdBy: null, details: { planCode: "INC", metric: "Invoiced value", periodStart: "2026-10-01", periodEnd: "2026-10-31", attainment: 150, target: 100000 } },
    { id: "l4", kind: "ADJUSTMENT", eventKey: "ADJ:1", eventDate: null, basis: null, rate: null, amount: 100, salesInvoiceId: null, salesOrderId: null, reason: "Sample bonus", createdBy: "Prep", details: {} },
  ],
  can: { recalculate: false, adjust: false, submit: false, discard: false, returnToDraft: true, approve: true, sendBack: true, raisePayment: false },
  ...extra,
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("Commission screens", () => {
  it("statement detail: net with its parts, lines grouped by plan version with the tier maths, approval posts and shows the payment", async () => {
    render(<StatementDetailClient initial={statement()} />);
    expect(screen.getByText("₹6,100.00")).toBeTruthy();
    expect(screen.getByText(/Plan REP v1/)).toBeTruthy();
    expect(screen.getByText(/basis ₹1,50,000.00 from 2 items → ₹3,500.00/)).toBeTruthy();
    expect(screen.getByText(/150% of ₹1,00,000.00/)).toBeTruthy();
    expect(screen.getByText(/Sample bonus — Prep/)).toBeTruthy();
    const fetchMock = vi.fn(() => ok(statement({ status: "APPROVED", approvedBy: "Appr", can: { ...statement().can, approve: false, sendBack: false, returnToDraft: false }, payment: { id: "pr1", number: "PR-1", status: "PENDING_APPROVAL", label: "Waiting for approval", amount: 6100, paid: 0 } })));
    vi.stubGlobal("fetch", fetchMock);
    fireEvent.click(screen.getByRole("button", { name: "Approve" }));
    fireEvent.click(screen.getAllByRole("button", { name: "Approve" }).at(-1)!);
    await waitFor(() => expect(screen.getByText("PR-1")).toBeTruthy());
    expect(fetchMock).toHaveBeenCalledWith("/api/v1/sales-marketing/commissions/statements/s1/approve", expect.objectContaining({ method: "POST" }));
    expect(screen.getByRole("link", { name: "PR-1" }).getAttribute("href")).toBe("/accounts/payment-requests/pr1");
  });

  it("an approved negative month says it is carried forward, not paid", () => {
    render(<StatementDetailClient initial={statement({ status: "APPROVED", totals: { earned: 200, reversals: -1166.66, incentives: 0, adjustments: 0, carryForward: 0, net: -966.66 }, lines: [], can: { ...statement().can, approve: false, sendBack: false, returnToDraft: false } })} />);
    expect(screen.getByText("−₹966.66")).toBeTruthy();
    expect(screen.getByText(/carried to the next statement/)).toBeTruthy();
  });

  it("rule editor: progressive worked example uses the engine; fixed amount is disabled on collected basis", () => {
    let value: RuleDraft = { ...emptyRule("2026-11-01"), tierMode: "PROGRESSIVE", tiers: [{ from: "0", rate: "2" }, { from: "100000", rate: "3" }] };
    const { rerender } = render(<RuleEditor value={value} onChange={(v) => (value = v)} basis="COLLECTED" />);
    expect(screen.getByText("₹3,500.00")).toBeTruthy();
    expect(screen.getByText(/₹1,00,000.00 × 2% = ₹2,000.00/)).toBeTruthy();
    expect((screen.getByLabelText(/Fixed amount per posted invoice/) as HTMLInputElement).disabled).toBe(true);
    value = { ...value, tierMode: "ALL_UNITS" };
    rerender(<RuleEditor value={value} onChange={(v) => (value = v)} basis="INVOICED" />);
    expect(screen.getByText("₹4,500.00")).toBeTruthy();
    value = { ...value, tiers: [{ from: "0", rate: "2" }, { from: "0", rate: "3" }] };
    rerender(<RuleEditor value={value} onChange={(v) => (value = v)} basis="INVOICED" />);
    expect(screen.getByText(/must start above the previous one/)).toBeTruthy();
  });

  it("statements list: calculate posts the month and reports what happened", async () => {
    const fetchMock = vi.fn((url: string, init?: RequestInit) =>
      init?.method === "POST" ? ok({ month: "2026-10", calculated: [{ payee: "Asha", statementId: "s1", net: 10, lines: 1 }], skippedLocked: [{ payee: "Ravi", status: "APPROVED" }], removedEmpty: 0, notes: [] }) : ok({ viewAll: true, rows: [] })
    );
    vi.stubGlobal("fetch", fetchMock);
    render(<StatementsClient months={["2026-11", "2026-10"]} canCalculate viewAll />);
    await waitFor(() => expect(screen.getByText(/No statements for October 2026/)).toBeTruthy());
    fireEvent.click(screen.getByRole("button", { name: /Calculate October 2026/ }));
    await waitFor(() => expect(screen.getByRole("status").textContent).toContain("Calculated 1 draft statement for October 2026"));
    expect(screen.getByRole("status").textContent).toContain("Ravi");
    expect(fetchMock).toHaveBeenCalledWith("/api/v1/sales-marketing/commissions/statements/calculate", expect.objectContaining({ body: JSON.stringify({ month: "2026-10" }) }));
  });

  it("channel panel: shows the values; on an order a reason is required", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn((url: string) => (url.includes("options") ? ok({ channels: [{ id: "c1", code: "EX", name: "Export" }], agents: [] }) : ok({ salesChannelId: "c1", salesChannel: "Export (EX)", salesAgentId: null, salesAgent: null, history: [] })))
    );
    render(<ChannelAgentPanel apiUrl="/api/x" docType="SALES_ORDER" canChange />);
    await waitFor(() => expect(screen.getByText("Export (EX)")).toBeTruthy());
    fireEvent.click(screen.getByRole("button", { name: "Change" }));
    expect((screen.getByLabelText(/Reason/) as HTMLTextAreaElement).required).toBe(true);
  });
});
