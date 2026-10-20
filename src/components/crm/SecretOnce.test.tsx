// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

const { CopyButton, SecretOnce } = await import("./SecretOnce");

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const stubClipboard = (writeText: () => Promise<void>) => vi.stubGlobal("navigator", { ...navigator, clipboard: { writeText: vi.fn(writeText) } });

describe("SecretOnce (Phase 22)", () => {
  it("says Copied only when the clipboard really accepted the text", async () => {
    stubClipboard(() => Promise.resolve());
    render(<SecretOnce label="Signing secret" value="whsec_test_value" />);
    fireEvent.click(screen.getByRole("button", { name: "Copy" }));
    await waitFor(() => expect(screen.getByRole("button", { name: "Copied" })).toBeTruthy());
    expect(navigator.clipboard.writeText).toHaveBeenCalledWith("whsec_test_value");
  });

  it("reports a refused clipboard instead of a false success", async () => {
    stubClipboard(() => Promise.reject(new Error("denied")));
    render(<SecretOnce label="Signing secret" value="whsec_test_value" />);
    fireEvent.click(screen.getByRole("button", { name: "Copy" }));
    await waitFor(() => expect(screen.getByText(/blocked copying/)).toBeTruthy());
    expect(screen.queryByRole("button", { name: "Copied" })).toBeNull();
  });

  it("can only be dismissed after confirming the secret is stored, and warns before leaving", async () => {
    const onDone = vi.fn();
    const add = vi.spyOn(window, "addEventListener");
    render(<SecretOnce label="API key" value="crmk_x" onDone={onDone} />);
    expect(add.mock.calls.some(([t]) => t === "beforeunload")).toBe(true);
    const done = screen.getByRole("button", { name: "Done" }) as HTMLButtonElement;
    expect(done.disabled).toBe(true);
    fireEvent.click(screen.getByLabelText(/I have stored this secret/));
    expect(done.disabled).toBe(false);
    fireEvent.click(done);
    expect(onDone).toHaveBeenCalledOnce();
  });

  it("CopyButton reports failure when there is no clipboard API", async () => {
    vi.stubGlobal("navigator", { ...navigator, clipboard: undefined });
    render(<CopyButton value="curl …" />);
    fireEvent.click(screen.getByRole("button", { name: "Copy" }));
    await waitFor(() => expect(screen.getByRole("button", { name: /Copy failed/ })).toBeTruthy());
  });
});
