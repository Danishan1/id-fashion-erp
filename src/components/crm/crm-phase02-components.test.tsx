// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { useState } from "react";

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn() }) }));
vi.mock("next/link", () => ({
  default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));

const { DataTable } = await import("@/components/ui/DataTable");
const { CrmBulkBar } = await import("./CrmBulkBar");
const { CrmColumnPicker } = await import("./CrmColumnPicker");
const { CrmFilterBar, countActiveCrmFilters } = await import("./CrmFilterBar");
const { CrmNotesPanel } = await import("./CrmNotesPanel");

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const json = (body: unknown, ok = true, status = 200) => ({ ok, status, json: async () => body }) as Response;

describe("DataTable selection", () => {
  function Harness({ onChange }: { onChange: (ids: string[]) => void }) {
    const [ids, setIds] = useState<string[]>([]);
    return (
      <DataTable<{ id: string; name: string }>
        fetchUrl="/api/v1/things"
        columns={[{ key: "name", header: "Name" }]}
        selection={{
          selectedIds: ids,
          onChange: (next) => {
            setIds(next);
            onChange(next);
          },
          label: (r) => r.name,
        }}
      />
    );
  }

  it("selects single rows and the whole page", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => json({ data: [{ id: "a", name: "Alpha" }, { id: "b", name: "Beta" }], meta: { page: 1, pageSize: 20, totalCount: 2, totalPages: 1 } })));
    const onChange = vi.fn();
    render(<Harness onChange={onChange} />);
    fireEvent.click(await screen.findByRole("checkbox", { name: "Select Alpha" }));
    expect(onChange).toHaveBeenLastCalledWith(["a"]);
    fireEvent.click(screen.getByRole("checkbox", { name: "Select all rows on this page" }));
    expect(onChange).toHaveBeenLastCalledWith(["a", "b"]);
    fireEvent.click(screen.getByRole("checkbox", { name: "Select all rows on this page" }));
    expect(onChange).toHaveBeenLastCalledWith([]);
  });
});

describe("CrmBulkBar", () => {
  it("is hidden with nothing selected and clears the selection", () => {
    const onClear = vi.fn();
    const { rerender } = render(
      <CrmBulkBar count={0} onClear={onClear}>
        <button>Assign</button>
      </CrmBulkBar>
    );
    expect(screen.queryByRole("region", { name: "Bulk actions" })).toBeNull();
    rerender(
      <CrmBulkBar count={3} onClear={onClear}>
        <button>Assign</button>
      </CrmBulkBar>
    );
    expect(screen.getByText("3 selected")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Clear selection" }));
    expect(onClear).toHaveBeenCalled();
  });
});

describe("CrmColumnPicker", () => {
  it("toggles columns in their defined order and never hides the last one", () => {
    const onChange = vi.fn();
    const cols = [
      { key: "name", header: "Name" },
      { key: "email", header: "Email" },
      { key: "score", header: "Score" },
    ];
    const { rerender } = render(<CrmColumnPicker columns={cols} visibleKeys={["score", "name"]} onChange={onChange} />);
    fireEvent.click(screen.getByRole("button", { name: "Columns (2)" }));
    fireEvent.click(screen.getByRole("checkbox", { name: "Email" }));
    expect(onChange).toHaveBeenLastCalledWith(["name", "email", "score"]);
    rerender(<CrmColumnPicker columns={cols} visibleKeys={["name"]} onChange={onChange} />);
    expect((screen.getByRole("checkbox", { name: "Name" }) as HTMLInputElement).disabled).toBe(true);
  });
});

describe("CrmFilterBar number ranges", () => {
  const defs = [{ type: "numberRange" as const, label: "Score", minKey: "scoreMin", maxKey: "scoreMax" }];

  it("counts a range once and applies min/max from the draft", () => {
    expect(countActiveCrmFilters(defs, { scoreMin: "10", scoreMax: "90" })).toBe(1);
    const onApply = vi.fn();
    render(<CrmFilterBar definitions={defs} value={{}} onApply={onApply} onClearAll={vi.fn()} isOpen onToggleOpen={vi.fn()} />);
    fireEvent.change(screen.getByLabelText("Score minimum"), { target: { value: "10" } });
    fireEvent.change(screen.getByLabelText("Score maximum"), { target: { value: "90" } });
    expect(onApply).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Apply Filters" }));
    expect(onApply).toHaveBeenCalledWith(expect.objectContaining({ scoreMin: "10", scoreMax: "90" }));
  });
});

describe("CrmNotesPanel", () => {
  const note = (id: string, body: string, own = true) => ({ id, body, createdAt: "2026-10-01T05:00:00.000Z", editedAt: null, createdBy: { id: "u", fullName: "Asha" }, canEdit: own, canDelete: own });

  it("lists notes, adds one to the top and shows edit/delete only where allowed", async () => {
    const fetchMock = vi.fn(async (_url: string, init?: RequestInit) => {
      if (init?.method === "POST") return json({ data: note("n3", JSON.parse(String(init.body)).body) }, true, 201);
      return json({ data: [note("n1", "Mine"), note("n2", "Theirs", false)] });
    });
    vi.stubGlobal("fetch", fetchMock);
    const onChanged = vi.fn();
    render(<CrmNotesPanel listUrl="/api/v1/crm/leads/l1/notes" canAdd onChanged={onChanged} />);
    expect(await screen.findByText("Mine")).toBeTruthy();
    expect(screen.getAllByRole("button", { name: "Edit" })).toHaveLength(1);
    fireEvent.change(screen.getByLabelText("New note"), { target: { value: "Sent samples" } });
    fireEvent.click(screen.getByRole("button", { name: "Add note" }));
    await waitFor(() => expect(screen.getAllByRole("listitem")[0].textContent).toContain("Sent samples"));
    expect(onChanged).toHaveBeenCalled();
    expect(fetchMock).toHaveBeenCalledWith("/api/v1/crm/leads/l1/notes", expect.objectContaining({ method: "POST" }));
  });

  it("explains an empty record and hides the composer without permission", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => json({ data: [] })));
    render(<CrmNotesPanel listUrl="/x" canAdd={false} />);
    expect(await screen.findByText("No notes yet")).toBeTruthy();
    expect(screen.queryByLabelText("New note")).toBeNull();
  });
});
