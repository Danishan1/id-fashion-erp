// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
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
// The attachments panel has its own tests; keep this one about the enquiry.
vi.mock("@/components/ui/AttachmentsPanel", () => ({ AttachmentsPanel: () => <div>attachments</div> }));

const { SalesEnquiryDetailClient } = await import("./SalesEnquiryDetailClient");
type Detail = Parameters<typeof SalesEnquiryDetailClient>[0]["initialEnquiry"];

const base: Detail = {
  id: "e1",
  enquiryNumber: "ENQ-2026-00001",
  subject: "AW27 tops",
  enquiryDate: "2026-10-28T00:00:00.000Z",
  createdAt: "2026-10-28T09:00:00.000Z",
  source: "EMAIL",
  status: "OPEN",
  salesStage: "NEW",
  stageBeforeHold: null,
  priority: "HIGH",
  nextFollowUpDate: "2026-10-20T00:00:00.000Z",
  isOverdue: true,
  remarks: null,
  estimatedValue: "294600",
  expectedDecisionDate: null,
  nextAction: null,
  qualificationNotes: null,
  closureReason: null,
  closedAt: null,
  prospectName: null,
  prospectContactPerson: null,
  prospectEmail: null,
  prospectPhone: null,
  prospectCountry: null,
  customer: { id: "c1", name: "Zenith Apparel", code: "CUST-1" },
  buyer: null,
  requestedBy: { id: "u1", fullName: "Asha" },
  owner: { id: "u1", fullName: "Asha" },
  crmCompany: null,
  crmContact: null,
  lines: [
    {
      id: "l1",
      styleNameFreeText: "Crew neck",
      description: null,
      colorRemarks: "Navy",
      targetQuantity: "1200",
      targetUnitPrice: "245.5",
      targetDeliveryDate: null,
      remarks: null,
      lineStatus: "PENDING_REVIEW",
      product: null,
      size: null,
      sampleRequest: null,
    },
  ],
  activities: [],
  opportunities: { visible: [], hiddenCount: 0 },
};
const allow = { create: true, edit: true, viewAll: false, crmView: true, crmEdit: true, merchandisingView: true };

beforeEach(() => push.mockReset());
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("SalesEnquiryDetailClient", () => {
  it("shows the stage, overdue follow-up, requested items and only the allowed moves", () => {
    render(<SalesEnquiryDetailClient initialEnquiry={base} permissions={allow} currentUserId="u1" />);
    expect(screen.getAllByText("New").length).toBeGreaterThan(0);
    expect(screen.getByText(/overdue/)).toBeTruthy();
    expect(screen.getByText("Crew neck")).toBeTruthy();
    expect(screen.getByText("New style")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Mark qualified" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Mark lost" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: /won/i })).toBeNull();
    expect(screen.queryByRole("button", { name: "Reopen" })).toBeNull();
    expect(screen.getByText(/Line review & sampling in Merchandising/)).toBeTruthy();
  });

  it("hides every action without edit permission or when cancelled in Merchandising", () => {
    const { unmount } = render(<SalesEnquiryDetailClient initialEnquiry={base} permissions={{ ...allow, edit: false }} currentUserId="u1" />);
    expect(screen.queryByRole("button", { name: "Mark qualified" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Edit details" })).toBeNull();
    unmount();
    render(<SalesEnquiryDetailClient initialEnquiry={{ ...base, status: "CANCELLED" }} permissions={allow} currentUserId="u1" />);
    expect(screen.getByText(/cancelled in Merchandising/)).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Mark qualified" })).toBeNull();
  });

  it("offers Reopen (not edit) on a lost enquiry and shows the closure reason", () => {
    render(<SalesEnquiryDetailClient initialEnquiry={{ ...base, salesStage: "LOST", closureReason: "Price", closedAt: "2026-10-28T10:00:00.000Z", isOverdue: false }} permissions={allow} currentUserId="u1" />);
    expect(screen.getByRole("button", { name: "Reopen" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Edit details" })).toBeNull();
    expect(screen.getByText(/Price/)).toBeTruthy();
  });

  it("requires a reason to mark lost and shows the server's answer", async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ data: { ...base, salesStage: "LOST", closureReason: "Price", isOverdue: false } }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    render(<SalesEnquiryDetailClient initialEnquiry={base} permissions={allow} currentUserId="u1" />);
    fireEvent.click(screen.getByRole("button", { name: "Mark lost" }));
    const reason = screen.getByLabelText(/Reason/) as HTMLTextAreaElement;
    expect(reason.required).toBe(true);
    fireEvent.change(reason, { target: { value: "Price" } });
    fireEvent.click(screen.getByRole("button", { name: "Confirm" }));
    await waitFor(() => expect(screen.getByRole("button", { name: "Reopen" })).toBeTruthy());
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/v1/sales-marketing/enquiries/e1/stage",
      expect.objectContaining({ method: "POST", body: JSON.stringify({ stage: "LOST", reason: "Price" }) })
    );
  });

  it("goes back to the list when a reassignment takes the enquiry out of view", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) =>
        String(url).includes("/owners")
          ? new Response(JSON.stringify({ data: [{ id: "u2", fullName: "Ravi" }] }), { status: 200 })
          : new Response(JSON.stringify({ data: { id: "e1", visible: false } }), { status: 200 })
      )
    );
    render(<SalesEnquiryDetailClient initialEnquiry={base} permissions={allow} currentUserId="u1" />);
    fireEvent.click(screen.getByRole("button", { name: "Reassign" }));
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(push).toHaveBeenCalledWith("/sales-marketing/enquiries"));
  });
});
