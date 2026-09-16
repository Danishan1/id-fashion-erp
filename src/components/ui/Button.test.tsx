// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";

const { Button, buttonClasses } = await import("./Button");

afterEach(() => {
  cleanup();
});

describe("Button (audit item #6 — shared primary/secondary/danger/success button)", () => {
  it("defaults to the primary indigo variant and calls onClick when clicked", () => {
    const onClick = vi.fn();
    render(<Button onClick={onClick}>Save</Button>);

    const button = screen.getByRole("button", { name: "Save" });
    expect(button.className).toContain("bg-indigo-600");
    fireEvent.click(button);
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it("renders the secondary/danger/success variants with their own distinct classes", () => {
    render(
      <>
        <Button variant="secondary">Cancel</Button>
        <Button variant="danger">Delete</Button>
        <Button variant="success">Approve</Button>
      </>
    );

    expect(screen.getByRole("button", { name: "Cancel" }).className).toContain("border-zinc-300");
    expect(screen.getByRole("button", { name: "Delete" }).className).toContain("bg-red-600");
    expect(screen.getByRole("button", { name: "Approve" }).className).toContain("bg-emerald-600");
  });

  it("is disabled and shows loadingLabel instead of children while isLoading", () => {
    render(
      <Button isLoading loadingLabel="Saving…">
        Save
      </Button>
    );

    const button = screen.getByRole("button", { name: "Saving…" });
    expect(button).toHaveProperty("disabled", true);
    expect(screen.queryByText("Save")).toBeNull();
  });

  it("respects an explicit disabled prop even when not loading", () => {
    render(<Button disabled>Save</Button>);
    expect(screen.getByRole("button", { name: "Save" })).toHaveProperty("disabled", true);
  });

  it("defaults to type=button (never submits a form by accident) unless overridden", () => {
    render(
      <>
        <Button>Default</Button>
        <Button type="submit">Submit</Button>
      </>
    );
    expect(screen.getByRole("button", { name: "Default" }).getAttribute("type")).toBe("button");
    expect(screen.getByRole("button", { name: "Submit" }).getAttribute("type")).toBe("submit");
  });

  it("buttonClasses() produces the same variant/size classes for a non-<button> element (e.g. next/link)", () => {
    const primary = buttonClasses("primary", "sm");
    const secondary = buttonClasses("secondary", "xs");
    expect(primary).toContain("bg-indigo-600");
    expect(primary).toContain("py-1.5");
    expect(secondary).toContain("border-zinc-300");
    expect(secondary).toContain("py-1");
  });
});
