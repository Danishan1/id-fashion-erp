// @vitest-environment jsdom
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const toastMock = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn(), warning: vi.fn(), info: vi.fn() }));
vi.mock("@/components/ui/Toast", () => ({ toast: toastMock }));

const underlyingFetch = vi.fn();

beforeAll(() => {
  window.fetch = underlyingFetch as unknown as typeof fetch;
});

const { readApiError, installApiToastInterceptor, fallbackMessageForStatus } = await import("./api-client");

function jsonResponse(status: number, body: unknown) {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

describe("readApiError", () => {
  it("prefers the top-level message and exposes field errors", async () => {
    const res = jsonResponse(400, {
      success: false,
      message: "Assigned quantity cannot exceed available quantity.",
      errors: { assignedQuantity: ["Assigned quantity cannot exceed available quantity."] },
      error: { code: "VALIDATION_ERROR", message: "x", details: null },
    });
    const err = await readApiError(res);
    expect(err.message).toBe("Assigned quantity cannot exceed available quantity.");
    expect(err.code).toBe("VALIDATION_ERROR");
    expect(err.fieldErrors.assignedQuantity).toHaveLength(1);
    // The original response is still readable by the caller.
    expect((await res.json()).message).toContain("Assigned quantity");
  });

  it("falls back to the legacy error.message, then to a status message", async () => {
    expect((await readApiError(jsonResponse(409, { error: { code: "X", message: "Legacy msg" } }))).message).toBe(
      "Legacy msg",
    );
    expect((await readApiError(new Response("not json", { status: 403 }))).message).toBe(
      fallbackMessageForStatus(403),
    );
  });
});

describe("installApiToastInterceptor", () => {
  beforeAll(() => installApiToastInterceptor());
  beforeEach(() => {
    underlyingFetch.mockReset();
    Object.values(toastMock).forEach((f) => f.mockReset());
  });

  it("toasts success for a same-origin /api/v1 mutation", async () => {
    underlyingFetch.mockResolvedValue(jsonResponse(201, { data: {} }));
    await window.fetch("/api/v1/customers", { method: "POST" });
    expect(toastMock.success).toHaveBeenCalledWith("Saved successfully.");
  });

  it("toasts the API's own error message on failure", async () => {
    underlyingFetch.mockResolvedValue(jsonResponse(409, { message: "Worker already busy.", error: { code: "C" } }));
    await window.fetch("/api/v1/job-orders/1/assignments", { method: "POST" });
    expect(toastMock.error).toHaveBeenCalledWith("Worker already busy.");
  });

  it("never toasts GET requests", async () => {
    underlyingFetch.mockResolvedValue(jsonResponse(500, {}));
    await window.fetch("/api/v1/customers");
    expect(toastMock.error).not.toHaveBeenCalled();
  });

  it("respects the x-toast opt-out and strips control headers before sending", async () => {
    underlyingFetch.mockResolvedValue(jsonResponse(200, {}));
    await window.fetch("/api/v1/x", { method: "PATCH", headers: { "x-toast": "off" } });
    expect(toastMock.success).not.toHaveBeenCalled();
    const sentHeaders = new Headers(underlyingFetch.mock.calls[0][1].headers);
    expect(sentHeaders.has("x-toast")).toBe(false);
  });

  it("uses a custom success message when supplied", async () => {
    underlyingFetch.mockResolvedValue(jsonResponse(200, {}));
    await window.fetch("/api/v1/x", { method: "PATCH", headers: { "x-toast-success": "Worker assigned successfully." } });
    expect(toastMock.success).toHaveBeenCalledWith("Worker assigned successfully.");
  });

  it("shows a network-error toast when fetch rejects", async () => {
    underlyingFetch.mockRejectedValue(new TypeError("Failed to fetch"));
    await expect(window.fetch("/api/v1/x", { method: "DELETE" })).rejects.toThrow();
    expect(toastMock.error).toHaveBeenCalledWith(fallbackMessageForStatus(0));
  });
});
