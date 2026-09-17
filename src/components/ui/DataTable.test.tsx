// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor, fireEvent, cleanup, within } from "@testing-library/react";

// DataTable calls useRouter()/renders <Link> from next/navigation & next/link,
// both of which require a real Next.js app-router context to avoid throwing
// outside the framework — mocked the same way this project's own service
// tests mock any module a unit under test depends on, per its established
// vi.mock convention (see e.g. sales-order.service.test.ts).
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn() }) }));
vi.mock("next/link", () => ({
  default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));

const { DataTable } = await import("./DataTable");

interface Row {
  id: string;
  name: string;
}

function jsonResponse(ok: boolean, body: unknown): Response {
  return { ok, json: async () => body } as Response;
}

function listBody(rows: Row[], totalCount = rows.length) {
  return { data: rows, meta: { page: 1, pageSize: 20, totalCount, totalPages: 1 } };
}

const columns = [{ key: "name", header: "Name" }];

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("DataTable — empty state (audit item #8)", () => {
  it("shows the empty message + New CTA (newAction) when zero rows and no active search", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse(true, listBody([]))));
    const onClick = vi.fn();

    const { container } = render(
      <DataTable<Row> fetchUrl="/api/v1/things" columns={columns} newAction={{ label: "New Thing", onClick }} />
    );

    await waitFor(() => expect(screen.getByText("No records found.")).toBeTruthy(), { timeout: 2000 });
    expect(screen.getByText("Create your first one to get started.")).toBeTruthy();

    // The exact same "New Thing" button also renders in the header toolbar
    // (unchanged, pre-existing behavior) — scope to the empty-state's own
    // table body so this assertion is about the new CTA specifically.
    const tbody = within(container.querySelector("tbody")!);
    const cta = tbody.getByRole("button", { name: "New Thing" });
    fireEvent.click(cta);
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it("shows the empty message + a Link CTA when using newHref instead of newAction", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse(true, listBody([]))));

    const { container } = render(
      <DataTable<Row> fetchUrl="/api/v1/things" columns={columns} newHref="/things/new" newLabel="New Thing" />
    );

    await waitFor(() => expect(screen.getByText("No records found.")).toBeTruthy(), { timeout: 2000 });
    const tbody = within(container.querySelector("tbody")!);
    const cta = tbody.getByRole("link", { name: "New Thing" });
    expect(cta.getAttribute("href")).toBe("/things/new");
  });

  it("shows only the plain empty message — no CTA — when neither newHref nor newAction is provided (no create capability)", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse(true, listBody([]))));

    const { container } = render(<DataTable<Row> fetchUrl="/api/v1/things" columns={columns} />);

    await waitFor(() => expect(screen.getByText("No records found.")).toBeTruthy(), { timeout: 2000 });
    expect(screen.queryByText("Create your first one to get started.")).toBeNull();
    // No newHref/newAction means no header toolbar button either — safe to
    // assert against the whole document here, not just the table body.
    expect(container.querySelector("tbody")?.querySelector("button, a")).toBeNull();
  });

  it("shows 'No records match your search or filter.' with no CTA once a search is active, even when a New action exists", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse(true, listBody([]))));
    const onClick = vi.fn();

    const { container } = render(
      <DataTable<Row> fetchUrl="/api/v1/things" columns={columns} newAction={{ label: "New Thing", onClick }} />
    );

    const searchBox = await screen.findByPlaceholderText("Search…");
    fireEvent.change(searchBox, { target: { value: "zzz" } });

    await waitFor(() => expect(screen.getByText("No records match your search or filter.")).toBeTruthy(), { timeout: 2000 });
    expect(screen.queryByText("No records found.")).toBeNull();
    // The header's own "New Thing" button legitimately stays visible while
    // searching (unchanged behavior) — the requirement is that the empty
    // *table body* never shows a Create CTA merely because search found
    // nothing, so scope this assertion to the table body specifically.
    expect(within(container.querySelector("tbody")!).queryByRole("button", { name: "New Thing" })).toBeNull();
  });
});

describe("DataTable — error + retry (audit item #9)", () => {
  it("shows the error message and a Retry button; Retry re-runs the same request and can recover", async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(jsonResponse(false, { error: { message: "Server exploded." } }));
    vi.stubGlobal("fetch", fetchMock);

    render(<DataTable<Row> fetchUrl="/api/v1/things" columns={columns} />);

    await waitFor(() => expect(screen.getByText("Server exploded.")).toBeTruthy(), { timeout: 2000 });
    const retryButton = screen.getByRole("button", { name: "Retry" });

    fetchMock.mockResolvedValueOnce(jsonResponse(true, listBody([{ id: "1", name: "Real Row" }])));
    fireEvent.click(retryButton);

    await waitFor(() => expect(screen.getByText("Real Row")).toBeTruthy(), { timeout: 2000 });
    expect(screen.queryByText("Server exploded.")).toBeNull();
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});

describe("DataTable — sortable columns (audit item #7)", () => {
  const sortableColumns = [
    { key: "name", header: "Name", sortable: true },
    { key: "type", header: "Type" }, // deliberately non-sortable, e.g. a computed/relation column
  ];

  function lastFetchedUrl(fetchMock: ReturnType<typeof vi.fn>): URL {
    const calls = fetchMock.mock.calls;
    return new URL(String(calls[calls.length - 1][0]));
  }

  it("renders a sortable column's header as a clickable button with aria-sort='none', and a plain header for a non-sortable column", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(true, listBody([{ id: "1", name: "Acme" }])));
    vi.stubGlobal("fetch", fetchMock);

    render(<DataTable<Row> fetchUrl="/api/v1/things" columns={sortableColumns} />);
    await waitFor(() => expect(screen.getByText("Acme")).toBeTruthy(), { timeout: 2000 });

    const nameHeaderCell = screen.getByText("Name").closest("th")!;
    expect(nameHeaderCell.getAttribute("aria-sort")).toBe("none");
    expect(screen.getByRole("button", { name: "Name" })).toBeTruthy();

    const typeHeaderCell = screen.getByText("Type").closest("th")!;
    expect(typeHeaderCell.getAttribute("aria-sort")).toBeNull();
    expect(screen.queryByRole("button", { name: "Type" })).toBeNull();

    // No sort params are sent at all until a column header is actually clicked.
    const url = lastFetchedUrl(fetchMock);
    expect(url.searchParams.has("sortBy")).toBe(false);
    expect(url.searchParams.has("sortOrder")).toBe(false);
  });

  it("clicking a sortable header sorts ascending, shows the ▲ indicator, then toggles to descending on a second click", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(true, listBody([{ id: "1", name: "Acme" }])));
    vi.stubGlobal("fetch", fetchMock);

    render(<DataTable<Row> fetchUrl="/api/v1/things" columns={sortableColumns} />);
    await waitFor(() => expect(screen.getByText("Acme")).toBeTruthy(), { timeout: 2000 });

    fireEvent.click(screen.getByRole("button", { name: "Name" }));
    await waitFor(() => expect(lastFetchedUrl(fetchMock).searchParams.get("sortBy")).toBe("name"), { timeout: 2000 });
    expect(lastFetchedUrl(fetchMock).searchParams.get("sortOrder")).toBe("asc");
    expect(screen.getByText("Name").closest("th")!.getAttribute("aria-sort")).toBe("ascending");
    expect(screen.getByText("▲")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Name" }));
    await waitFor(() => expect(lastFetchedUrl(fetchMock).searchParams.get("sortOrder")).toBe("desc"), { timeout: 2000 });
    expect(screen.getByText("Name").closest("th")!.getAttribute("aria-sort")).toBe("descending");
    expect(screen.getByText("▼")).toBeTruthy();
  });
});

describe("DataTable — statusFilter", () => {
  function lastFetchedUrl(fetchMock: ReturnType<typeof vi.fn>): URL {
    const calls = fetchMock.mock.calls;
    return new URL(String(calls[calls.length - 1][0]));
  }

  it("renders no filter dropdown when statusFilter is not supplied", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse(true, listBody([{ id: "1", name: "Acme" }]))));
    render(<DataTable<Row> fetchUrl="/api/v1/things" columns={columns} />);
    await waitFor(() => expect(screen.getByText("Acme")).toBeTruthy(), { timeout: 2000 });
    expect(screen.queryByRole("combobox", { name: "Filter by status" })).toBeNull();
  });

  it("selecting a status option appends it to fetchUrl under the default 'status' param and resets to page 1", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(true, listBody([{ id: "1", name: "Acme" }])));
    vi.stubGlobal("fetch", fetchMock);

    render(
      <DataTable<Row>
        fetchUrl="/api/v1/things"
        columns={columns}
        statusFilter={{ options: [{ value: "ACTIVE", label: "Active" }, { value: "CLOSED", label: "Closed" }] }}
      />
    );
    await waitFor(() => expect(screen.getByText("Acme")).toBeTruthy(), { timeout: 2000 });

    const select = screen.getByRole("combobox", { name: "Filter by status" }) as HTMLSelectElement;
    expect(select.value).toBe("");
    fireEvent.change(select, { target: { value: "CLOSED" } });

    await waitFor(() => expect(lastFetchedUrl(fetchMock).searchParams.get("status")).toBe("CLOSED"), { timeout: 2000 });
    expect(lastFetchedUrl(fetchMock).searchParams.get("page")).toBe("1");
  });

  it("respects a custom paramName instead of the default 'status'", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(true, listBody([{ id: "1", name: "Acme" }])));
    vi.stubGlobal("fetch", fetchMock);

    render(
      <DataTable<Row>
        fetchUrl="/api/v1/things"
        columns={columns}
        statusFilter={{ options: [{ value: "TRANSFER", label: "Transfer" }], paramName: "movementType" }}
      />
    );
    await waitFor(() => expect(screen.getByText("Acme")).toBeTruthy(), { timeout: 2000 });

    fireEvent.change(screen.getByRole("combobox", { name: "Filter by status" }), { target: { value: "TRANSFER" } });

    await waitFor(() => expect(lastFetchedUrl(fetchMock).searchParams.get("movementType")).toBe("TRANSFER"), {
      timeout: 2000,
    });
    expect(lastFetchedUrl(fetchMock).searchParams.has("status")).toBe(false);
  });

  it("shows the search-or-filter empty message once a status filter yields zero rows, even with no search text", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse(true, listBody([]))));

    render(
      <DataTable<Row>
        fetchUrl="/api/v1/things"
        columns={columns}
        statusFilter={{ options: [{ value: "CLOSED", label: "Closed" }] }}
      />
    );

    fireEvent.change(await screen.findByRole("combobox", { name: "Filter by status" }), {
      target: { value: "CLOSED" },
    });

    await waitFor(() => expect(screen.getByText("No records match your search or filter.")).toBeTruthy(), {
      timeout: 2000,
    });
  });
});
