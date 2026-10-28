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

const { QuotationEditor } = await import("./QuotationEditor");
const { emptyLine, toDraftValues } = await import("./draft-values");

const options = {
  taxRates: [{ id: "t5", name: "GST 5%", rate: 5, taxType: "GST" }],
  units: [{ id: "pcs", code: "PCS", name: "Pieces" }],
  companyStateCode: "33",
  owners: [{ id: "u1", fullName: "Asha" }],
};

function stubFetch(saveResponse = { data: { id: "q9" } }) {
  const calls: { url: string; init?: RequestInit }[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init?: RequestInit) => {
      calls.push({ url, init });
      if (url.includes("/options")) return new Response(JSON.stringify({ data: options }), { status: 200 });
      if (init?.method === "POST" || init?.method === "PUT") return new Response(JSON.stringify(saveResponse), { status: 200 });
      return new Response(JSON.stringify({ data: [] }), { status: 200 });
    })
  );
  return calls;
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  push.mockReset();
});

const initial = () => {
  const v = toDraftValues({ customerId: "c1", quotationDate: "2026-10-28", validUntil: "2026-11-27", placeOfSupplyStateCode: "27", lines: [] });
  v.title = "AW27 tops";
  v.lines = [{ ...emptyLine(), kind: "FREE_TEXT", description: "Crew neck", quantity: "1200", unitPrice: "245.5", discountPercent: "5", taxRateId: "t5" }];
  return v;
};

describe("QuotationEditor", () => {
  it("previews IGST totals with the same maths the server uses", async () => {
    stubFetch();
    render(<QuotationEditor mode="create" initial={initial()} canUseCrm={false} />);
    await waitFor(() => expect(screen.getByText("IGST")).toBeTruthy());
    expect(screen.getAllByText("₹2,93,863.50").length).toBeGreaterThan(0); // 279870 + 13993.50
    expect(screen.getByText(/server recalculates/)).toBeTruthy();
  });

  it("sends the draft without any totals and goes to the new quotation", async () => {
    const calls = stubFetch();
    render(<QuotationEditor mode="create" enquiry={{ id: "e1", enquiryNumber: "ENQ-1", partyLabel: "Zenith" }} initial={initial()} canUseCrm={false} />);
    await waitFor(() => expect(screen.getByText("IGST")).toBeTruthy());
    fireEvent.click(screen.getByRole("button", { name: "Create draft quotation" }));
    await waitFor(() => expect(push).toHaveBeenCalledWith("/sales-marketing/quotations/q9"));
    const post = calls.find((c) => c.init?.method === "POST")!;
    const body = JSON.parse(String(post.init!.body));
    expect(body).toMatchObject({ buyerEnquiryId: "e1", title: "AW27 tops", lines: [{ description: "Crew neck", quantity: "1200", taxRateId: "t5", productId: "" }] });
    expect(JSON.stringify(body)).not.toMatch(/grandTotal|taxAmount|lineTotal/);
  });

  it("shows the enquiry's party instead of a customer picker", () => {
    stubFetch();
    render(<QuotationEditor mode="create" enquiry={{ id: "e1", enquiryNumber: "ENQ-1", partyLabel: "Zenith Apparel" }} initial={initial()} canUseCrm={false} />);
    expect(screen.getByText(/Zenith Apparel — from enquiry/)).toBeTruthy();
    expect(screen.queryByLabelText(/Quote a prospect/)).toBeNull();
  });
});
