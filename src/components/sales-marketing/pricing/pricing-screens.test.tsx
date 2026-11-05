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
vi.mock("next/navigation", () => ({ useRouter: () => ({ push, replace: vi.fn(), refresh: vi.fn() }) }));

const { PriceListDetailClient } = await import("./PriceListDetailClient");
const { PricingPreviewClient } = await import("./PricingPreviewClient");
type Detail = Parameters<typeof PriceListDetailClient>[0]["initial"];

const version = (extra: Record<string, unknown> = {}) => ({
  id: "v1",
  versionNumber: 1,
  status: "DRAFT",
  effectiveFrom: "2026-11-02",
  effectiveTo: null,
  changeNote: null,
  approvalComment: null,
  version: 3,
  timing: null,
  createdBy: { fullName: "Asha" },
  submittedBy: null,
  approvedBy: null,
  approvedAt: null,
  _count: { entries: 1 },
  ...extra,
});
const detail = (sel: Record<string, unknown>): Detail =>
  ({
    id: "pl1",
    code: "STD",
    name: "Standard",
    description: null,
    kind: "DEFAULT",
    customer: null,
    priority: 0,
    isActive: true,
    currencyCode: "INR",
    versions: [version(sel)],
    selected: { ...version(sel), viewerCanApprove: false, entries: [{ id: "e1", productId: "s1", uomId: "pcs", minQuantity: "0", unitPrice: "100", notes: null, product: { styleName: "Polo", styleCode: "P1" }, uom: { code: "PCS" } }] },
    events: [],
    usedByRules: [],
  }) as unknown as Detail;
const buttons = () => screen.queryAllByRole("button").map((b) => b.textContent);

function stub(response: unknown = {}) {
  const calls: { url: string; init?: RequestInit }[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init?: RequestInit) => {
      calls.push({ url, init });
      if (init?.method === "POST" || init?.method === "PUT") return new Response(JSON.stringify({ data: response }), { status: 200 });
      if (url.startsWith("/api/v1/units")) return new Response(JSON.stringify({ data: [{ id: "pcs", code: "PCS" }] }));
      if (url.startsWith("/api/v1/products")) return new Response(JSON.stringify({ data: [{ id: "s1", styleName: "Polo", styleCode: "P1" }] }));
      return new Response(JSON.stringify({ data: [] }));
    })
  );
  return calls;
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("Price list detail", () => {
  it("a draft is edited, saved with its version and submitted", async () => {
    const calls = stub(detail({}));
    render(<PriceListDetailClient initial={detail({})} perms={{ edit: true, approve: false, reject: false }} />);
    expect(buttons()).toEqual(expect.arrayContaining(["Save draft", "Submit for approval", "Discard", "Edit details", "Deactivate"]));
    expect(buttons()).not.toContain("Approve");
    expect(buttons()).not.toContain("New version"); // a draft is already open
    fireEvent.change(screen.getByLabelText("Price 1"), { target: { value: "95" } });
    fireEvent.click(screen.getByRole("button", { name: "Save draft" }));
    await waitFor(() => expect(calls.some((c) => c.init?.method === "PUT")).toBe(true));
    const put = calls.find((c) => c.init?.method === "PUT")!;
    expect(put.url).toBe("/api/v1/sales-marketing/pricing/price-lists/pl1/versions/v1");
    expect(JSON.parse(String(put.init!.body))).toMatchObject({ effectiveFrom: "2026-11-02", version: 3, entries: [{ productId: "s1", uomId: "pcs", unitPrice: "95", minQuantity: "0" }] });
  });

  it("pending: Approve only for an allowed approver; read-only prices", () => {
    const { unmount } = render(<PriceListDetailClient initial={detail({ status: "PENDING_APPROVAL" })} perms={{ edit: true, approve: true, reject: true }} />);
    expect(buttons()).not.toContain("Approve");
    expect(screen.getByText(/Waiting for approval/)).toBeTruthy();
    expect(screen.getByText("₹100.00")).toBeTruthy();
    unmount();
    const d = detail({ status: "PENDING_APPROVAL" });
    (d.selected as { viewerCanApprove: boolean }).viewerCanApprove = true;
    render(<PriceListDetailClient initial={d} perms={{ edit: false, approve: true, reject: true }} />);
    expect(buttons()).toEqual(expect.arrayContaining(["Approve", "Decline"]));
    expect(buttons()).not.toContain("Return to draft");
  });

  it("an approved scheduled version can be withdrawn; one in force can't", () => {
    const { unmount } = render(<PriceListDetailClient initial={detail({ status: "APPROVED", timing: "SCHEDULED" })} perms={{ edit: true, approve: false, reject: false }} />);
    expect(buttons()).toEqual(expect.arrayContaining(["Withdraw", "New version"]));
    unmount();
    render(<PriceListDetailClient initial={detail({ status: "APPROVED", timing: "IN_FORCE" })} perms={{ edit: true, approve: false, reject: false }} />);
    expect(buttons()).not.toContain("Withdraw");
    expect(screen.getAllByText("In force").length).toBeGreaterThan(0);
  });
});

describe("Pricing preview", () => {
  it("prices one line and shows why", async () => {
    const result = [
      {
        status: "PRICED",
        quantity: 100,
        uomCode: "PCS",
        listUnitPrice: 100,
        ruleDiscountAmount: 10,
        ruleDiscountCapped: false,
        netUnitPrice: 90,
        extendedAmount: 9000,
        message: null,
        explanation: ["Default price list STD (Standard) v1, in force from 02/11/2026: ₹100.00 per PCS", "Net price ₹90.00 per PCS"],
        source: { level: "DEFAULT", priceListCode: "STD", priceListName: "Standard", versionNumber: 1, minQuantity: 0, entryUomCode: "PCS" },
        rules: [{ code: "P10", name: "P10", discountPerUnit: 10, stacking: "EXCLUSIVE" }],
        skipped: [{ kind: "RULE", code: "BULK", reason: "needs at least 500 PCS" }],
      },
    ];
    const calls = stub(result);
    render(<PricingPreviewClient />);
    await waitFor(() => expect(calls.some((c) => c.url.startsWith("/api/v1/products"))).toBe(true));
    fireEvent.focus(screen.getByLabelText(/^Style/));
    fireEvent.click(await screen.findByText("Polo"));
    fireEvent.click(screen.getByRole("button", { name: "Show price" }));
    expect(await screen.findByText("Net price ₹90.00 per PCS")).toBeTruthy();
    expect(screen.getByText(/needs at least 500 PCS/)).toBeTruthy();
    const post = calls.find((c) => c.init?.method === "POST")!;
    expect(JSON.parse(String(post.init!.body))).toMatchObject({ customerId: null, lines: [{ productId: "s1", quantity: "100", uomId: null }] });
  });
});
