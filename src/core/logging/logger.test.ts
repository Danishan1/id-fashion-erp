import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { logger } from "./logger";

describe("logger", () => {
  let logSpy: ReturnType<typeof vi.spyOn>;
  let warnSpy: ReturnType<typeof vi.spyOn>;
  let errorSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    logSpy.mockRestore();
    warnSpy.mockRestore();
    errorSpy.mockRestore();
  });

  it("writes info through console.log as a single JSON line", () => {
    logger.info("something happened", { userId: "u-1" });

    expect(logSpy).toHaveBeenCalledTimes(1);
    const parsed = JSON.parse(logSpy.mock.calls[0][0] as string);
    expect(parsed).toMatchObject({ level: "info", message: "something happened", context: { userId: "u-1" } });
    expect(typeof parsed.timestamp).toBe("string");
  });

  it("routes warn/error to their own console methods, not console.log", () => {
    logger.warn("careful");
    logger.error("broken");

    expect(warnSpy).toHaveBeenCalledTimes(1);
    expect(errorSpy).toHaveBeenCalledTimes(1);
    expect(logSpy).not.toHaveBeenCalled();
  });

  it("unwraps an Error instance in the context into a plain, JSON-serializable object", () => {
    const err = new Error("boom");
    logger.error("unhandled", { error: err });

    const parsed = JSON.parse(errorSpy.mock.calls[0][0] as string);
    expect(parsed.context.error.name).toBe("Error");
    expect(parsed.context.error.message).toBe("boom");
    expect(typeof parsed.context.error.stack).toBe("string");
  });

  it("omits the context key entirely when no context is given", () => {
    logger.info("no context here");
    const parsed = JSON.parse(logSpy.mock.calls[0][0] as string);
    expect(parsed).not.toHaveProperty("context");
  });
});
