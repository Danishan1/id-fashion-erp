// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";

const push = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ push, refresh: vi.fn() }) }));

const { SalesOrderForm } = await import("./SalesOrderForm");
type Conversion = NonNullable<Parameters<typeof SalesOrderForm>[0]>["fromQuotation"];

const conversion: Conversion = {
  quotationId: "q1",
  quotationNumber: "QUO-2026-00007",
  revisionNumber: 2,
  customerId: "c1",
  buyerId: null,
  customerPoNumber: "PO-778",
  requiredShipDate: "2026-12-01",
  chargesNotCarried: true,
  lines: [
    { quotationLineId: "l1", lineNumber: 1, description: "Polo", colorSizeRemarks: "Navy, M–XL", productId: "p1", styleFixed: true, sampleRequestId: null, pieces: 120, unitPrice: 90 },
    { quotationLineId: "l2", lineNumber: 2, description: "Kids tee (new)", colorSizeRemarks: null, productId: null, styleFixed: false, sampleRequestId: null, pieces: 7, unitPrice: 100 },
  ],
};

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("SalesOrderForm converting a quotation", () => {
  it("pre-fills and locks what comes from the quotation and posts to the convert endpoint", async () => {
    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      if (init?.method === "POST") return new Response(JSON.stringify({ data: { salesOrderId: "so1", orderNumber: "ORD-1", alreadyConverted: false } }), { status: 201 });
      if (url.startsWith("/api/v1/customers?")) return new Response(JSON.stringify({ data: [{ id: "c1", name: "Zenith" }] }));
      if (url.startsWith("/api/v1/products?")) return new Response(JSON.stringify({ data: [{ id: "p1", styleName: "Polo" }, { id: "p2", styleName: "Tee" }] }));
      if (url === "/api/v1/products/p1") return new Response(JSON.stringify({ data: { variants: [] } }));
      return new Response(JSON.stringify({ data: [] }));
    });
    vi.stubGlobal("fetch", fetchMock);
    render(<SalesOrderForm fromQuotation={conversion} />);

    expect(screen.getByText(/Converting quotation QUO-2026-00007 \(revision 2\)/)).toBeTruthy();
    expect(screen.getByText(/freight \/ other charges are not carried/)).toBeTruthy();
    expect(screen.getByText(/120 pieces to split — entered 0/)).toBeTruthy();
    expect(screen.getByText(/pick the Style this line is made as/)).toBeTruthy();
    expect(screen.queryByText("+ Add Style Line")).toBeNull();
    expect(screen.queryByRole("button", { name: "Remove" })).toBeNull();
    const price = screen.getByLabelText(/Unit Price/, { selector: "#price-0" }) as HTMLInputElement;
    expect(price.value).toBe("90");
    expect(price.readOnly).toBe(true);
    expect((screen.getByLabelText(/Customer PO Number/) as HTMLInputElement).value).toBe("PO-778");
    expect((screen.getByLabelText(/Required Ship Date/) as HTMLInputElement).value).toBe("2026-12-01");
    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith("/api/v1/products/p1"));

    fireEvent.submit(screen.getByRole("button", { name: "Create Sales Order from Quotation" }).closest("form")!);
    await waitFor(() => expect(push).toHaveBeenCalledWith("/sales-orders/so1"));
    const [url, init] = fetchMock.mock.calls.find(([, i]) => i?.method === "POST") as unknown as [string, RequestInit];
    expect(url).toBe("/api/v1/sales-marketing/quotations/q1/convert");
    const body = JSON.parse(String(init.body));
    expect(body).toMatchObject({ customerId: "c1", customerPoNumber: "PO-778", requiredShipDate: "2026-12-01", quotationLineIds: ["l1", "l2"] });
    expect(body.items.map((i: { productId: string; unitPrice: number }) => [i.productId, i.unitPrice])).toEqual([["p1", 90], ["", 100]]);
  });
});
