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
vi.mock("next/navigation", () => ({ useRouter: () => ({ push, refresh: vi.fn() }) }));
vi.mock("@/components/ui/AttachmentsPanel", () => ({ AttachmentsPanel: () => <div>attachments</div> }));

const { QuotationDetailClient } = await import("./QuotationDetailClient");
type Detail = Parameters<typeof QuotationDetailClient>[0]["initialQuotation"];

const rev = {
  revisionNumber: 1,
  status: "DRAFT",
  title: "AW27",
  quotationDate: "2026-10-28",
  validUntil: "2026-11-27",
  companyStateCode: "33",
  placeOfSupplyStateCode: "27",
  isInterState: true,
  billingAddress: null,
  shippingAddress: null,
  paymentTermsDays: null,
  deliveryTerms: null,
  introduction: null,
  customerNotes: null,
  internalNotes: null,
  termsAndConditions: null,
  freightAmount: "0",
  freightGstRate: "0",
  otherChargesLabel: null,
  otherChargesAmount: "0",
  otherChargesGstRate: "0",
  subtotalAmount: "10000",
  discountTotal: "1200",
  taxableTotal: "8800",
  chargesTotal: "0",
  cgstTotal: "0",
  sgstTotal: "0",
  igstTotal: "440",
  taxTotal: "440",
  grandTotal: "9240",
  version: 1,
  revisionReason: null,
  approvalRequired: false,
  approvalReasons: [],
  submittedAt: null,
  approvedAt: null,
  approvalComment: null,
  issuedAt: null,
  sentAt: null,
  sentTo: null,
  sentMethod: null,
  customerDecisionAt: null,
  decisionMethod: null,
  customerReference: null,
  decisionComment: null,
  lines: [],
} as unknown as Detail["current"];

const base = {
  id: "q1",
  quotationNumber: "QUO-2026-00001",
  status: "DRAFT",
  currentRevisionNumber: 1,
  prospectName: null,
  cancelledAt: null,
  cancellationReason: null,
  createdAt: "2026-10-28T09:00:00.000Z",
  isCurrentRevision: true,
  isExpired: false,
  approvalPreview: [] as string[],
  viewerCanApprove: false,
  people: { submittedBy: null, approvedBy: null, issuedBy: null, sentBy: null, decisionRecordedBy: null },
  customer: { id: "c1", name: "Zenith", code: "C1" },
  buyer: null,
  buyerEnquiry: null,
  salesOrder: null,
  crmCompany: null,
  crmContact: null,
  owner: null,
  createdBy: { id: "u1", fullName: "Asha" },
  revisions: [{ id: "r1", revisionNumber: 1, status: "DRAFT", grandTotal: "9240", revisionReason: null, issuedAt: null, createdAt: "2026-10-28T09:00:00.000Z" }],
  events: [],
  current: rev,
} as unknown as Detail;

const perms = {
  view: true,
  create: true,
  edit: true,
  viewAll: false,
  crmView: true,
  crmEdit: true,
  merchandisingView: true,
  quotations: { view: true, create: true, edit: true, cancel: true, approve: true, reject: true, print: true },
  settings: { view: false, edit: false },
  salesOrders: { view: true, create: true },
};
const withStatus = (status: string, extra: Partial<Detail> = {}) => ({ ...base, status, current: { ...rev, status }, ...extra }) as Detail;
const buttons = () => screen.queryAllByRole("button").map((b) => b.textContent);

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("QuotationDetailClient actions", () => {
  it("offers Issue for a draft within the limits, Submit for approval when over", () => {
    const { unmount } = render(<QuotationDetailClient initialQuotation={base} permissions={perms} />);
    expect(buttons()).toEqual(expect.arrayContaining(["Issue", "Cancel"]));
    expect(buttons()).not.toContain("Submit for approval");
    unmount();
    render(<QuotationDetailClient initialQuotation={{ ...base, approvalPreview: ["Discount 12% on line 1 is above the 10% limit"] } as Detail} permissions={perms} />);
    expect(buttons()).toContain("Submit for approval");
    expect(buttons()).not.toContain("Issue");
    expect(screen.getByText(/Needs approval before issue/)).toBeTruthy();
  });

  it("shows Approve only to an allowed approver", () => {
    const { unmount } = render(<QuotationDetailClient initialQuotation={withStatus("PENDING_APPROVAL")} permissions={perms} />);
    expect(buttons()).not.toContain("Approve");
    expect(buttons()).toEqual(expect.arrayContaining(["Decline", "Return to draft"]));
    unmount();
    render(<QuotationDetailClient initialQuotation={withStatus("PENDING_APPROVAL", { viewerCanApprove: true })} permissions={perms} />);
    expect(buttons()).toContain("Approve");
  });

  it("offers send / accept / reject / revise / withdraw on an issued quotation, and blocks acceptance when expired", () => {
    const { unmount } = render(<QuotationDetailClient initialQuotation={withStatus("ISSUED")} permissions={perms} />);
    expect(buttons()).toEqual(expect.arrayContaining(["Mark as sent", "Record acceptance", "Record rejection", "New revision", "Withdraw"]));
    unmount();
    render(<QuotationDetailClient initialQuotation={withStatus("ISSUED", { isExpired: true })} permissions={perms} />);
    expect((screen.getByRole("button", { name: "Record acceptance" }) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByText("Expired")).toBeTruthy();
  });

  it("shows no actions on an earlier revision", () => {
    render(<QuotationDetailClient initialQuotation={withStatus("SUPERSEDED", { isCurrentRevision: false, currentRevisionNumber: 2, status: "ISSUED" } as Partial<Detail>)} permissions={perms} />);
    expect(buttons()).toEqual([]);
    expect(screen.getByText(/Go to the current revision/)).toBeTruthy();
  });

  it("posts the acceptance with its evidence fields", async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ data: withStatus("ACCEPTED") }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    render(<QuotationDetailClient initialQuotation={withStatus("ISSUED", { current: { ...rev, status: "ISSUED", issuedAt: "2026-10-01T10:00:00.000Z" } } as Partial<Detail>)} permissions={perms} />);
    fireEvent.click(screen.getByRole("button", { name: "Record acceptance" }));
    fireEvent.change(screen.getByLabelText(/Customer reference/), { target: { value: "PO-7781" } });
    fireEvent.click(screen.getAllByRole("button", { name: "Record acceptance" }).at(-1)!);
    await waitFor(() => expect(screen.getByText(/convert it to a Sales Order/)).toBeTruthy());
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("/api/v1/sales-marketing/quotations/q1/actions/accept");
    expect(JSON.parse(String(init.body))).toMatchObject({ method: "PURCHASE_ORDER", customerReference: "PO-7781" });
  });

  it("offers Convert to Sales Order on an accepted quotation, only with sales order permission", () => {
    const { unmount } = render(<QuotationDetailClient initialQuotation={withStatus("ACCEPTED")} permissions={perms} />);
    expect(screen.getByRole("link", { name: "Convert to Sales Order" }).getAttribute("href")).toBe("/sales-marketing/quotations/q1/convert");
    unmount();
    render(<QuotationDetailClient initialQuotation={withStatus("ACCEPTED")} permissions={{ ...perms, salesOrders: { view: true, create: false } }} />);
    expect(screen.queryByText("Convert to Sales Order")).toBeNull();
  });

  it("asks to link a customer before a prospect can be converted, and posts the pick", async () => {
    const fetchMock = vi.fn(async (url: string) => {
      if (url.startsWith("/api/v1/customers?")) return new Response(JSON.stringify({ data: [{ id: "c9", name: "Real Co", code: "C9" }] }));
      if (url === "/api/v1/customers/c9") return new Response(JSON.stringify({ data: { buyers: [] } }));
      return new Response(JSON.stringify({ data: withStatus("ACCEPTED") }), { status: 200 });
    });
    vi.stubGlobal("fetch", fetchMock);
    render(<QuotationDetailClient initialQuotation={withStatus("ACCEPTED", { customer: null, prospectName: "Prospect Ltd" } as Partial<Detail>)} permissions={perms} />);
    expect((screen.getByRole("button", { name: "Convert to Sales Order" }) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByText(/link the real customer/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Link customer" }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith("/api/v1/customers?pageSize=200"));
    fireEvent.focus(screen.getByLabelText(/^Customer/));
    fireEvent.click(await screen.findByText("Real Co"));
    fireEvent.click(screen.getAllByRole("button", { name: "Link customer" }).at(-1)!);
    await waitFor(() => expect(fetchMock.mock.calls.some(([u]) => u === "/api/v1/sales-marketing/quotations/q1/actions/link-customer")).toBe(true));
    const call = fetchMock.mock.calls.find(([u]) => u === "/api/v1/sales-marketing/quotations/q1/actions/link-customer") as unknown as [string, RequestInit];
    expect(JSON.parse(String(call[1].body))).toEqual({ customerId: "c9" });
  });

  it("links the Sales Order once converted", () => {
    render(<QuotationDetailClient initialQuotation={withStatus("CONVERTED", { salesOrder: { id: "so1", orderNumber: "ORD-2026-00042", status: "DRAFT", totalAmount: "10800", revisionNumber: 1 } } as Partial<Detail>)} permissions={perms} />);
    expect(screen.getByRole("link", { name: "ORD-2026-00042" }).getAttribute("href")).toBe("/sales-orders/so1");
    expect(buttons()).not.toContain("Convert to Sales Order");
  });
});
