// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor, fireEvent, cleanup } from "@testing-library/react";

const { SimpleLookupManager } = await import("./SimpleLookupManager");

function jsonResponse(ok: boolean, body: unknown): Response {
  return { ok, json: async () => body } as Response;
}

const fields = [{ key: "name", label: "Name", required: true }];

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("SimpleLookupManager — empty state (audit item #8)", () => {
  it("shows the empty message + '+ Add {entityLabel}' CTA when zero rows exist, and it opens the Add modal", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse(true, { data: [] })));

    render(<SimpleLookupManager fetchUrl="/api/v1/brands" fields={fields} entityLabel="Brand" />);

    await waitFor(() => expect(screen.getByText("No records found.")).toBeTruthy(), { timeout: 2000 });
    const cta = screen.getByRole("button", { name: "+ Add Brand" });

    fireEvent.click(cta);
    expect(screen.getByText("Add Brand")).toBeTruthy(); // the modal's own title
  });

  it("shows 'No records match your search.' with no Add CTA once a search narrows real rows down to zero", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse(true, { data: [{ id: "1", name: "Acme" }] })));

    render(<SimpleLookupManager fetchUrl="/api/v1/brands" fields={fields} entityLabel="Brand" />);

    await waitFor(() => expect(screen.getByText("Acme")).toBeTruthy(), { timeout: 2000 });

    const searchBox = screen.getByPlaceholderText("Search…");
    fireEvent.change(searchBox, { target: { value: "nonexistent" } });

    await waitFor(() => expect(screen.getByText("No records match your search.")).toBeTruthy());
    expect(screen.queryByText("No records found.")).toBeNull();
    expect(screen.queryByRole("button", { name: "+ Add Brand" })).toBeNull();
  });
});

describe("SimpleLookupManager — form fields use FormField (audit item #5)", () => {
  it("renders a required field's label with an asterisk and a real htmlFor/id association to its input", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse(true, { data: [] })));

    render(
      <SimpleLookupManager
        fetchUrl="/api/v1/brands"
        fields={[
          { key: "name", label: "Name", required: true },
          { key: "notes", label: "Notes" },
        ]}
        entityLabel="Brand"
      />
    );

    await waitFor(() => expect(screen.getByText("No records found.")).toBeTruthy(), { timeout: 2000 });
    fireEvent.click(screen.getByRole("button", { name: "+ Add Brand" }));

    // getByLabelText only succeeds if the <label>'s htmlFor genuinely matches
    // the <input>'s id — this is the regression guard for the gap being
    // closed: the inline form previously used a plain, unassociated <label>.
    const nameInput = screen.getByLabelText("Name *");
    expect(nameInput.tagName).toBe("INPUT");

    const notesInput = screen.getByLabelText("Notes");
    expect(notesInput.tagName).toBe("INPUT");
    // A non-required field must not render the red asterisk at all.
    expect(screen.queryByText("Notes *")).toBeNull();
  });
});

describe("SimpleLookupManager — error + retry (audit item #9)", () => {
  it("shows a real error (not a false 'No records found.') when the list fetch fails, with a working Retry", async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(jsonResponse(false, { error: { message: "Failed to load records." } }));
    vi.stubGlobal("fetch", fetchMock);

    render(<SimpleLookupManager fetchUrl="/api/v1/brands" fields={fields} entityLabel="Brand" />);

    await waitFor(() => expect(screen.getByText("Failed to load records.")).toBeTruthy(), { timeout: 2000 });
    // Regression guard for the pre-existing bug this fix closes: load() never
    // checked res.ok before, so a real HTTP failure silently rendered as an
    // empty list instead of a genuine error.
    expect(screen.queryByText("No records found.")).toBeNull();

    const retryButton = screen.getByRole("button", { name: "Retry" });
    fetchMock.mockResolvedValueOnce(jsonResponse(true, { data: [{ id: "1", name: "Acme" }] }));
    fireEvent.click(retryButton);

    await waitFor(() => expect(screen.getByText("Acme")).toBeTruthy(), { timeout: 2000 });
    expect(screen.queryByText("Failed to load records.")).toBeNull();
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});
