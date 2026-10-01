// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn() }) }));
vi.mock("next/link", () => ({
  default: ({ href, children }: { href: string; children: React.ReactNode }) => <a href={href}>{children}</a>,
}));

const { DataTable } = await import("./DataTable");

const ok = () => ({ ok: true, json: async () => ({ data: [], meta: { page: 1, pageSize: 20, totalCount: 0, totalPages: 1 } }) }) as Response;
const columns = [{ key: "name", header: "Name" }];

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("DataTable extraParams / hideSearch / toolbar (additive props for CrmTable)", () => {
  it("sends non-blank extraParams with the request", async () => {
    const fetchMock = vi.fn().mockResolvedValue(ok());
    vi.stubGlobal("fetch", fetchMock);
    render(<DataTable<{ id: string }> fetchUrl="/api/v1/things?fixed=1" columns={columns} extraParams={{ a: "x", b: "", c: undefined }} />);
    await waitFor(() => expect(fetchMock).toHaveBeenCalled(), { timeout: 2000 });
    const url = new URL(fetchMock.mock.calls[0][0] as string);
    expect(url.searchParams.get("fixed")).toBe("1");
    expect(url.searchParams.get("a")).toBe("x");
    expect(url.searchParams.has("b")).toBe(false);
    expect(url.searchParams.has("c")).toBe(false);
  });

  it("can hide its own search box and render extra toolbar controls", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(ok()));
    render(<DataTable<{ id: string }> fetchUrl="/api/v1/things" columns={columns} hideSearch toolbar={<button>Extra</button>} />);
    expect(screen.queryByRole("searchbox")).toBeNull();
    expect(screen.getByRole("button", { name: "Extra" })).toBeTruthy();
  });

  it("keeps the search box when hideSearch is not set (existing behaviour)", () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(ok()));
    render(<DataTable<{ id: string }> fetchUrl="/api/v1/things" columns={columns} />);
    expect(screen.getByRole("searchbox")).toBeTruthy();
  });
});
