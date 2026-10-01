// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { toErrorResponse, BusinessRuleError } from "@/core/errors/BusinessRuleError";

const push = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ push, refresh: vi.fn() }) }));
vi.mock("next/link", () => ({
  default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));

const { LeadForm } = await import("./LeadForm");

const META = {
  statuses: [{ id: "s-new", key: "new", name: "New", kind: "OPEN", color: "indigo", isDefault: true, isActive: true }],
  sources: [{ id: "src-manual", key: "manual", name: "Manual", isActive: true }],
  customFields: [],
  baseCurrencyCode: "INR",
};
const MATCH = { id: "l-old", leadNumber: "LEAD-0001", fullName: "Asha Rao", companyName: null, email: "asha@x.test", phone: null, status: "New", owner: null, archived: false, rules: ["EMAIL"], action: "WARN" };
const res = (body: unknown, status = 200) => ({ ok: status < 400, status, json: async () => body }) as Response;

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  push.mockReset();
});

function stubApi(onCreate: (body: Record<string, unknown>) => Response) {
  const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
    if (url === "/api/v1/crm/leads/meta") return res({ data: META });
    if (url === "/api/v1/users") return res({ data: [{ id: "me", fullName: "Me" }] });
    if (url === "/api/v1/crm/leads/duplicate-check") return res({ data: { matches: [] } });
    if (url === "/api/v1/crm/leads" && init?.method === "POST") return onCreate(JSON.parse(String(init.body)));
    return res({ data: [] });
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

describe("LeadForm", () => {
  it("shows a possible-duplicate warning on save and creates the lead after 'Save anyway'", async () => {
    const bodies: Record<string, unknown>[] = [];
    stubApi((body) => {
      bodies.push(body);
      if (!body.confirmDuplicate) {
        const { status, body: err } = toErrorResponse(new BusinessRuleError("CRM_POSSIBLE_DUPLICATE", "Possible duplicate found.", { matches: [MATCH] }));
        return res(err, status);
      }
      return res({ data: { id: "l-new" } }, 201);
    });
    render(<LeadForm currentUserId="me" />);
    fireEvent.change(await screen.findByLabelText(/First name/), { target: { value: "Asha" } });
    fireEvent.change(screen.getByLabelText("Email"), { target: { value: "asha@x.test" } });
    fireEvent.click(screen.getByRole("button", { name: "Create lead" }));
    expect(await screen.findByText("Possible duplicate found.")).toBeTruthy();
    expect(screen.getByText(/LEAD-0001/)).toBeTruthy();
    expect(push).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "Save anyway" }));
    await waitFor(() => expect(push).toHaveBeenCalledWith("/crm/leads/l-new"));
    expect(bodies).toHaveLength(2);
    expect(bodies[0]).toMatchObject({ firstName: "Asha", email: "asha@x.test", statusId: "s-new", sourceId: "src-manual", ownerUserId: "me" });
    expect(bodies[1].confirmDuplicate).toBe(true);
  });

  it("offers no override when duplicates are blocked", async () => {
    stubApi(() => {
      const { status, body } = toErrorResponse(new BusinessRuleError("DUPLICATE_LEAD_EXISTS", "Exists.", { matches: [{ ...MATCH, action: "BLOCK" }] }));
      return res(body, status);
    });
    render(<LeadForm currentUserId="me" />);
    fireEvent.change(await screen.findByLabelText(/First name/), { target: { value: "Asha" } });
    fireEvent.click(screen.getByRole("button", { name: "Create lead" }));
    expect(await screen.findByText(/saving is blocked/)).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Save anyway" })).toBeNull();
  });
});
