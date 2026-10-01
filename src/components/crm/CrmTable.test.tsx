// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";

const { replaceMock, searchParamsRef } = vi.hoisted(() => ({
  replaceMock: vi.fn(),
  searchParamsRef: { current: new URLSearchParams() },
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: replaceMock }),
  usePathname: () => "/crm/activity",
  useSearchParams: () => searchParamsRef.current,
}));
vi.mock("next/link", () => ({
  default: ({ href, children }: { href: string; children: React.ReactNode }) => <a href={href}>{children}</a>,
}));

const { CrmTable } = await import("./CrmTable");

interface Row {
  id: string;
  name: string;
}
const ok = (rows: Row[]) => ({ ok: true, json: async () => ({ data: rows, meta: { page: 1, pageSize: 20, totalCount: rows.length, totalPages: 1 } }) }) as Response;
const columns = [{ key: "name", header: "Name" }];
const filters = [{ type: "select" as const, key: "eventType", label: "Event", options: [{ value: "lead.created", label: "Lead created" }] }];

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  replaceMock.mockReset();
  searchParamsRef.current = new URLSearchParams();
});

const lastUrl = (fetchMock: ReturnType<typeof vi.fn>) => new URL(fetchMock.mock.calls.at(-1)![0] as string);

describe("CrmTable", () => {
  it("starts from filters already in the page URL (drill-down links) and sends them to the API", async () => {
    searchParamsRef.current = new URLSearchParams("eventType=lead.created&search=acme&unrelated=1");
    const fetchMock = vi.fn().mockResolvedValue(ok([{ id: "1", name: "Acme" }]));
    vi.stubGlobal("fetch", fetchMock);

    render(<CrmTable<Row> fetchUrl="/api/v1/crm/events" columns={columns} filters={filters} />);
    await waitFor(() => expect(screen.getByText("Acme")).toBeTruthy(), { timeout: 2000 });

    const url = lastUrl(fetchMock);
    expect(url.searchParams.get("eventType")).toBe("lead.created");
    expect(url.searchParams.get("search")).toBe("acme");
    expect(url.searchParams.has("unrelated")).toBe(false);
    expect(screen.getByRole("button", { name: /Filters \(1\)/ })).toBeTruthy();
  });

  it("applying filters refetches and mirrors them into the URL, keeping unrelated params", async () => {
    searchParamsRef.current = new URLSearchParams("tab=x");
    const fetchMock = vi.fn().mockResolvedValue(ok([]));
    vi.stubGlobal("fetch", fetchMock);

    render(<CrmTable<Row> fetchUrl="/api/v1/crm/events" columns={columns} filters={filters} />);
    await waitFor(() => expect(fetchMock).toHaveBeenCalled(), { timeout: 2000 });

    fireEvent.click(screen.getByRole("button", { name: /Filters/ }));
    fireEvent.focus(screen.getByLabelText("Event"));
    fireEvent.click(await screen.findByRole("button", { name: "Lead created" }));
    fireEvent.click(screen.getByRole("button", { name: "Apply Filters" }));

    expect(replaceMock).toHaveBeenCalledWith("/crm/activity?tab=x&eventType=lead.created", { scroll: false });
    await waitFor(() => expect(lastUrl(fetchMock).searchParams.get("eventType")).toBe("lead.created"), { timeout: 2000 });
    expect(lastUrl(fetchMock).searchParams.get("page")).toBe("1");
  });

  it("opens a row through onRowClick when there is no detail page", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(ok([{ id: "1", name: "Acme" }])));
    const onRowClick = vi.fn();
    render(<CrmTable<Row> fetchUrl="/api/v1/x" columns={columns} onRowClick={onRowClick} syncWithUrl={false} />);
    await waitFor(() => expect(screen.getByText("Acme")).toBeTruthy(), { timeout: 2000 });
    fireEvent.click(screen.getByRole("button", { name: "View" }));
    expect(onRowClick).toHaveBeenCalledWith({ id: "1", name: "Acme" });
  });
});
