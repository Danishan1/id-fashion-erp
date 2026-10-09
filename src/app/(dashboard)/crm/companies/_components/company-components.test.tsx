// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), refresh: vi.fn(), back: vi.fn() }) }));

const { CompanyStatusBadge } = await import("./CompaniesListClient");
const { CompanyDuplicatePanel } = await import("./CompanyForm");
const { AddCompanyContactModal, ChangeCompanyStatusModal, LinkErpCustomerModal } = await import("./CompanyDialogs");
const { CompanyUpcomingSections } = await import("./CompanyRelatedPanels");
const { CompanyMergeClient } = await import("./CompanyMergeClient");

const ID = "6f1c2f1e-1f2a-4b1a-9d1a-2b3c4d5e6f70";
const ID2 = "7f1c2f1e-1f2a-4b1a-9d1a-2b3c4d5e6f71";
const json = (body: unknown, status = 200) => Promise.resolve(new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } }));

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const match = (over: Record<string, unknown> = {}) => ({
  id: ID,
  name: "ABC Exports",
  legalName: null,
  website: "https://abc.com",
  email: null,
  phone: null,
  city: "Tiruppur",
  owner: "Asha",
  customer: null,
  archived: false,
  rules: ["NAME"],
  action: "WARN" as const,
  ...over,
});

describe("company UI pieces", () => {
  it("shows the configured status colour, or a dash", () => {
    render(<CompanyStatusBadge status={{ name: "Customer", color: "green" }} />);
    expect(screen.getByText("Customer")).toBeTruthy();
    cleanup();
    render(<CompanyStatusBadge status={null} />);
    expect(screen.getByText("—")).toBeTruthy();
  });

  it("warns with Save anyway, but blocks without it", () => {
    const onConfirm = vi.fn();
    render(<CompanyDuplicatePanel matches={[match()]} mode="warn" onConfirm={onConfirm} />);
    expect(screen.getByText("Possible duplicate company found.")).toBeTruthy();
    expect(screen.getByText(/Matched: Same company name/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Save anyway" }));
    expect(onConfirm).toHaveBeenCalled();
    cleanup();
    render(<CompanyDuplicatePanel matches={[match({ rules: ["ERP_CUSTOMER"], action: "BLOCK", customer: { code: "CUS-1", name: "ABC" } })]} mode="block" onConfirm={onConfirm} />);
    expect(screen.getByText(/saving is blocked/)).toBeTruthy();
    expect(screen.getByText(/same ERP customer/)).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Save anyway" })).toBeNull();
  });

  it("lists later-phase sections as placeholders without data", () => {
    render(<CompanyUpcomingSections />);
    expect(screen.getByText("Support tickets")).toBeTruthy();
    expect(screen.getAllByText(/Arrives with/).length).toBe(3);
  });

  it("changes status in bulk through the bulk endpoint", async () => {
    const fetchMock = vi.fn(() => json({ data: { requested: 2, updated: 2, skipped: [] } }));
    vi.stubGlobal("fetch", fetchMock);
    const onDone = vi.fn();
    render(
      <ChangeCompanyStatusModal
        statuses={[
          { id: ID, name: "Prospect", color: "indigo" },
          { id: ID2, name: "Customer", color: "green" },
        ]}
        target={{ ids: ["a", "b"] }}
        onClose={vi.fn()}
        onDone={onDone}
      />
    );
    fireEvent.change(screen.getByLabelText(/Status/), { target: { value: ID2 } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(onDone).toHaveBeenCalledWith({ requested: 2, updated: 2, skipped: [] }));
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("/api/v1/crm/companies/bulk");
    expect(JSON.parse(String(init.body))).toEqual({ action: "status", ids: ["a", "b"], statusId: ID2 });
  });

  it("won't let a customer already linked to another company be picked", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(() =>
        json({
          data: [
            { id: "cu-1", code: "CUS-1", name: "Taken Ltd", city: null, country: null, isActive: true, crmCompanyId: "other", linkedCompany: { id: "other", name: "Other Co", archived: false } },
            { id: "cu-2", code: "CUS-2", name: "Free Ltd", city: null, country: null, isActive: true, crmCompanyId: null, linkedCompany: null },
          ],
        })
      )
    );
    render(<LinkErpCustomerModal companyId={ID} onClose={vi.fn()} onDone={vi.fn()} />);
    const taken = await screen.findByRole("button", { name: /Taken Ltd/ });
    expect((taken as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByText("Already linked to Other Co")).toBeTruthy();
    expect((screen.getByRole("button", { name: /Free Ltd/ }) as HTMLButtonElement).disabled).toBe(false);
  });

  it("asks before moving a contact from another company, then resends with confirmation", async () => {
    const posts: unknown[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn((url: string, init?: RequestInit) => {
        if (!init?.method || init.method === "GET") return json({ data: [{ id: ID2, fullName: "Ravi", email: null, phone: null, mobile: null, crmCompanyId: "other", crmCompany: { id: "other", name: "Other Co" } }] });
        posts.push(JSON.parse(String(init.body)));
        return posts.length === 1
          ? json({ error: { code: "INVALID_STATE_TRANSITION", message: "At another company", details: { needsConfirmation: true, fromCompanyName: "Other Co" } } }, 409)
          : json({ data: null });
      })
    );
    const onDone = vi.fn();
    render(<AddCompanyContactModal companyId={ID} onClose={vi.fn()} onDone={onDone} />);
    fireEvent.click(await screen.findByRole("button", { name: /Ravi/ }));
    fireEvent.click(screen.getByRole("button", { name: "Add contact" }));
    expect(await screen.findByText(/currently at Other Co/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Move contact here" }));
    await waitFor(() => expect(onDone).toHaveBeenCalled());
    expect(posts).toEqual([
      { contactId: ID2, makePrimary: false, moveFromOtherCompany: false },
      { contactId: ID2, makePrimary: false, moveFromOtherCompany: true },
    ]);
  });

  it("explains an ERP conflict and offers no merge button", async () => {
    const company = (id: string, code: string) => ({ id, name: `Co ${code}`, version: 1, customer: { id: code, code, name: code, type: "CUSTOMER", status: "ACTIVE" }, customFields: {}, counts: { contacts: 0, leads: 0, opportunities: 0, notes: 0, documents: 0, tags: 0, addresses: 0 } });
    vi.stubGlobal(
      "fetch",
      vi.fn((url: string) =>
        url.includes("/merge/preview")
          ? json({ data: { survivor: company(ID, "CUS-1"), merged: company(ID2, "CUS-2"), fields: [], conflicts: [], customFieldConflicts: [], customFields: [], erpConflict: true, erpLinkMoves: false } })
          : json({ data: [] })
      )
    );
    render(<CompanyMergeClient initialIds={[ID, ID2]} />);
    expect(await screen.findByText(/linked to different ERP customers \(CUS-1 and CUS-2\)/)).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Merge companies" })).toBeNull();
  });
});
