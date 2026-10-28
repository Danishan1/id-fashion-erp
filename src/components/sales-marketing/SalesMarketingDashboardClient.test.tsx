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

const { SalesMarketingDashboardClient } = await import("./SalesMarketingDashboardClient");
const { SALES_MARKETING_SECTIONS } = await import("@/modules/sales-marketing/sales-marketing-sections");

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const ok = (data: unknown) => Promise.resolve(new Response(JSON.stringify({ data }), { status: 200 }));

describe("SalesMarketingDashboardClient", () => {
  it("shows loading first, then real source figures, no fake KPIs, and the planned sections", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(() =>
        ok({
          sections: SALES_MARKETING_SECTIONS,
          connectedSources: [
            { key: "customers", label: "Customers", description: "d", href: "/masters/customers", metrics: [{ label: "Active customers", value: 1234 }] },
          ],
        })
      )
    );
    render(<SalesMarketingDashboardClient />);
    expect(screen.getByRole("status").textContent).toContain("Loading");
    await waitFor(() => expect(screen.getByText("Active customers")).toBeTruthy());
    expect(screen.getByText("1,234")).toBeTruthy();
    expect(screen.getByText("Not available yet")).toBeTruthy();
    expect(screen.getByText("Quotations & Proposals")).toBeTruthy();
    expect(screen.getAllByText(/Planned · Phase 02/).length).toBeGreaterThan(0);
    expect(screen.getByRole("link", { name: /Customers/ }).getAttribute("href")).toBe("/masters/customers");
  });

  it("explains an empty source list", async () => {
    vi.stubGlobal("fetch", vi.fn(() => ok({ sections: [], connectedSources: [] })));
    render(<SalesMarketingDashboardClient />);
    await waitFor(() => expect(screen.getByText("No related modules available")).toBeTruthy());
  });

  it("shows the API error and retries", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ error: { code: "PERMISSION_DENIED", message: "No access to this module." } }), { status: 403 }))
      .mockImplementationOnce(() => ok({ sections: [], connectedSources: [] }));
    vi.stubGlobal("fetch", fetchMock);
    render(<SalesMarketingDashboardClient />);
    await waitFor(() => expect(screen.getByRole("alert").textContent).toContain("No access to this module."));
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    await waitFor(() => expect(screen.getByText("No related modules available")).toBeTruthy());
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("handles a network failure", async () => {
    vi.stubGlobal("fetch", vi.fn(() => Promise.reject(new TypeError("offline"))));
    render(<SalesMarketingDashboardClient />);
    await waitFor(() => expect(screen.getByRole("alert").textContent).toContain("Could not reach the server"));
  });
});
