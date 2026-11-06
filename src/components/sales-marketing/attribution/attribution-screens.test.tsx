// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";

vi.mock("next/link", () => ({
  default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }) }));

const { AttributionDashboardClient } = await import("./AttributionDashboardClient");

const credited = { LEAD_CREATED: 1, ENQUIRY_CREATED: 0, QUOTATION_ACCEPTED: 0, SALES_ORDER_BOOKED: 0.5 };
const by = { attributed: 1, unattributed: 0, excluded: 0 };
const report = {
  models: [{ id: "m1", code: "LIN", name: "Linear", status: "ACTIVE", isDefault: true }],
  sync: [{ source: "DELIVERY", lastSyncAt: "2026-11-06T10:00:00Z" }],
  basis: "ORDER_VALUE",
  basisLabel: "Sales Order value",
  basisHelp: "Booked order value, before GST.",
  model: { id: "m1", code: "LIN", name: "Linear", status: "ACTIVE", version: 1, rules: { modelType: "LINEAR", windowDays: 90, touchpointTypes: ["MESSAGE_DELIVERED"], channelTypes: [], conversionTypes: ["SALES_ORDER_BOOKED"], collapseRepeats: true, firstTouchPercent: null, lastTouchPercent: null, halfLifeDays: null, changeNote: null } },
  run: { id: "r1", from: "2026-10-01", to: "2026-10-31", finishedAt: "2026-11-06T10:00:00Z", dataCut: "2026-11-06T09:59:00Z", trigger: "MANUAL" },
  period: { from: "2026-10-01", to: "2026-10-31", partial: false },
  rows: [
    { campaignId: "a", code: "CAMP-A", name: "A", messagesSent: 2, messagesDelivered: 1, campaignResponses: 1, credited, revenue: 5000, actualSpend: 2000, committed: 0, costPerLead: 2000, costPerOrder: 4000, roi: { value: 150, status: "OK" }, roas: { value: 2.5, status: "OK" }, compare: null },
    { campaignId: "b", code: "CAMP-B", name: "B", messagesSent: 1, messagesDelivered: 0, campaignResponses: 0, credited, revenue: 5000, actualSpend: 0, committed: 500, costPerLead: null, costPerOrder: null, roi: { value: null, status: "NO_COST" }, roas: { value: null, status: "NO_COST" }, compare: null },
  ],
  totals: { byType: { LEAD_CREATED: by, ENQUIRY_CREATED: by, QUOTATION_ACCEPTED: by, SALES_ORDER_BOOKED: by }, attributed: 4, unattributed: 1, excluded: 0, coveragePercent: 80, revenue: 10000, actualSpend: 2000, roi: { value: 400, status: "OK" }, roas: { value: 5, status: "OK" } },
  channels: [],
  compareModel: null,
  quality: { notices: ["Campaigns with no actual spend dated in the period show no ROI — link their expenses or invoices on the campaign's Budget panel."] },
};

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("Attribution dashboard", () => {
  it("shows credit, revenue and ROI per campaign; no percentage without spend; notices and the model's rules", async () => {
    vi.stubGlobal("fetch", vi.fn(() => Promise.resolve({ ok: true, json: () => Promise.resolve({ data: report }) } as Response)));
    render(<AttributionDashboardClient canRecalculate today="2026-11-06" />);
    await waitFor(() => expect(screen.getByText("CAMP-A")).toBeTruthy());
    expect(screen.getByText("150%")).toBeTruthy();
    expect(screen.getAllByText("n/a").length).toBeGreaterThanOrEqual(3); // B: cost per order, ROI, ROAS
    expect(screen.getByText(/show no ROI/)).toBeTruthy();
    expect(screen.getByText(/90-day window/)).toBeTruthy();
    expect(screen.getByText("80%")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Recalculate" })).toBeTruthy();
    expect(screen.getByRole("link", { name: "CAMP-A" }).getAttribute("href")).toContain("/sales-marketing/attribution/campaigns/a?modelId=m1");
  });
});
