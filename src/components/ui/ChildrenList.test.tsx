// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor, fireEvent, cleanup } from "@testing-library/react";

const { ChildrenList } = await import("./ChildrenList");

interface Row {
  id: string;
  name: string;
  isActive?: boolean;
}

function jsonResponse(ok: boolean, body: unknown): Response {
  return { ok, json: async () => body } as Response;
}

const columns = [{ key: "name", header: "Name" }];
const fields = [{ key: "name", label: "Name", required: true }];

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("ChildrenList — empty state (audit item #8)", () => {
  it("shows the empty message + its own addLabel CTA when zero rows exist, and it opens the Add modal", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse(true, { data: [] })));

    render(
      <ChildrenList<Row> fetchUrl="/api/v1/warehouses/w1/locations" columns={columns} fields={fields} entityLabel="Location" />
    );

    await waitFor(() => expect(screen.getByText("No records yet.")).toBeTruthy(), { timeout: 2000 });
    // "+ Add Location" appears twice (the always-visible header trigger and
    // the new empty-state CTA) — both must be real, clickable buttons.
    const ctas = screen.getAllByRole("button", { name: "+ Add Location" });
    expect(ctas).toHaveLength(2);

    fireEvent.click(ctas[1]);
    expect(screen.getByText("Add Location")).toBeTruthy(); // the modal's own title
  });
});

describe("ChildrenList — error + retry (audit item #9)", () => {
  it("shows the error message and a Retry button; Retry re-runs the same request and can recover", async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(jsonResponse(false, { error: { message: "Failed to load." } }));
    vi.stubGlobal("fetch", fetchMock);

    render(
      <ChildrenList<Row> fetchUrl="/api/v1/warehouses/w1/locations" columns={columns} fields={fields} entityLabel="Location" />
    );

    await waitFor(() => expect(screen.getByText("Failed to load.")).toBeTruthy(), { timeout: 2000 });
    const retryButton = screen.getByRole("button", { name: "Retry" });

    fetchMock.mockResolvedValueOnce(jsonResponse(true, { data: [{ id: "1", name: "Rack A" }] }));
    fireEvent.click(retryButton);

    await waitFor(() => expect(screen.getByText("Rack A")).toBeTruthy(), { timeout: 2000 });
    expect(screen.queryByText("Failed to load.")).toBeNull();
    // Filtered by URL, not a raw call count — once a row renders, its Edit
    // RowAction independently fetches the shared Action Display setting
    // over this same stubbed global fetch, which is unrelated to what this
    // assertion is actually verifying (that ChildrenList's own retry fired
    // exactly once more, not a stale request piling up).
    const ownCalls = fetchMock.mock.calls.filter(([url]) => url === "/api/v1/warehouses/w1/locations");
    expect(ownCalls).toHaveLength(2);
  });
});
