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

const { PromotionDetailClient } = await import("./PromotionDetailClient");
const { CampaignBudgetPanel } = await import("../budgets/CampaignBudgetPanel");
type Detail = Parameters<typeof PromotionDetailClient>[0]["initial"];

const terms = { validFrom: "2026-11-01", validTo: null, discountType: "PERCENT" as const, value: 10, stacking: "EXCLUSIVE" as const, priority: 0, productIds: ["s1"], categoryIds: [], excludedProductIds: [], customerIds: [], priceListIds: [], salesChannelIds: [], campaignIds: [], segmentEvaluationId: null, minQuantity: null, minLineValue: null, maxRedemptions: 5, maxRedemptionsPerCustomer: null, changeNote: null };
const detail = (extra: Partial<Detail> = {}): Detail => ({
  id: "p1",
  code: "DIWALI10",
  name: "Diwali",
  description: null,
  objective: null,
  owner: { id: "u1", fullName: "Asha" },
  applyMode: "CODE",
  status: "DRAFT",
  version: 1,
  displayStatus: "DRAFT",
  approvedVersionId: null,
  versions: [{ id: "v1", number: 1, status: "PENDING_APPROVAL", terms, createdBy: "Asha", createdAt: "2026-11-01T10:00:00Z", submittedBy: "Asha", submittedAt: "2026-11-01T10:00:00Z", decidedBy: null, decidedAt: null, decisionComment: null, canApproveThis: true }],
  labels: { s1: "Polo" },
  usage: { reserved: 1, redeemed: 2, discountRedeemed: 900 },
  redemptions: [],
  events: [],
  can: { edit: true, newVersion: false, reject: true, approve: true, activate: false, pause: false, archive: true },
  ...extra,
});
const ok = (data: unknown) => Promise.resolve({ ok: true, json: () => Promise.resolve({ data }) } as Response);

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("Promotion screens", () => {
  it("detail shows the terms, usage and the approve action; approving posts to the version route", async () => {
    const approved = detail({ status: "DRAFT", approvedVersionId: "v1", versions: [{ ...detail().versions[0], status: "APPROVED", canApproveThis: false }], can: { ...detail().can, activate: true } });
    const fetchMock = vi.fn(() => ok(approved));
    vi.stubGlobal("fetch", fetchMock);
    render(<PromotionDetailClient initial={detail()} />);
    expect(screen.getByText("Polo")).toBeTruthy();
    expect(screen.getByText("₹900.00")).toBeTruthy();
    expect(screen.getByText(/No version is approved yet/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Approve" }));
    fireEvent.click(screen.getAllByRole("button", { name: "Approve" }).at(-1)!);
    await waitFor(() => expect(screen.getByRole("button", { name: "Switch on" })).toBeTruthy());
    expect(fetchMock).toHaveBeenCalledWith("/api/v1/sales-marketing/promotions/p1/versions/v1/approve", expect.objectContaining({ method: "POST" }));
    expect(screen.getByText(/isn.t switched on yet/)).toBeTruthy();
  });

  it("campaign budget panel shows the measures, lines and a hidden-records note", async () => {
    const f = (limit: number | null, actual: number, committed: number) => ({ limit, actual, committed, pipeline: 0, remaining: limit === null ? null : limit - actual - committed, usedPercent: limit ? Math.round(((actual + committed) / limit) * 1000) / 10 : null });
    vi.stubGlobal(
      "fetch",
      vi.fn(() =>
        ok({
          campaignId: "c1",
          approved: 100000,
          plannedNotApproved: null,
          canEdit: true,
          canLink: true,
          totals: { ...f(100000, 35000, 18000), allocated: 90000, unallocatedLimit: 10000 },
          allocations: [
            { id: "a1", name: "Media", category: "Media", categoryId: "k1", campaignChannelId: null, notes: null, status: "ACTIVE", version: 1, ...f(60000, 3000, 0) },
            { id: "-", name: "Not allocated", category: "—", categoryId: null, campaignChannelId: null, notes: null, status: "ACTIVE", version: 0, ...f(10000, 32000, 18000) },
          ],
          expenses: [],
          purchaseOrders: null,
          purchaseInvoices: [],
          categories: [{ id: "k1", name: "Media" }],
          channels: [],
          alerts: [{ id: "al", kind: "OVER_BUDGET", scope: "Not allocated", status: "OPEN", message: "Over", raisedAt: "2026-11-06T10:00:00Z", clearedAt: null }],
        })
      )
    );
    render(<CampaignBudgetPanel campaignId="c1" />);
    await waitFor(() => expect(screen.getByText("Media", { selector: "span" })).toBeTruthy());
    expect(screen.getByText("₹47,000.00")).toBeTruthy(); // remaining = 100000 − 35000 − 18000
    expect(screen.getByText(/Purchase orders: you can.t see these records/)).toBeTruthy();
    expect(screen.getByText("Over budget")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Link spend" })).toBeTruthy();
  });
});
