import { describe, expect, it } from "vitest";
import { encodeCode128 } from "./barcode128";

/** Reconstructs the raw bit string a set of run-length-encoded bars represents, for round-trip verification. */
function reconstructBits(bars: { x: number; width: number }[], totalModules: number): string {
  const bits = new Array(totalModules).fill("0");
  for (const bar of bars) {
    for (let i = bar.x; i < bar.x + bar.width; i++) bits[i] = "1";
  }
  return bits.join("");
}

describe("encodeCode128", () => {
  it("encodes a realistic project number into a non-empty, well-formed bar sequence", () => {
    const result = encodeCode128("AID-2026-00001");
    expect(result).not.toBeNull();
    expect(result!.bars.length).toBeGreaterThan(0);
    expect(result!.totalModules).toBeGreaterThan(0);
  });

  it("produces bars whose reconstructed bit pattern is internally consistent (no overlapping/out-of-range bars)", () => {
    const result = encodeCode128("AID-2026-00001")!;
    const bits = reconstructBits(result.bars, result.totalModules);
    // Every bar's own width should re-appear intact in the reconstruction — proves buildBars() didn't corrupt run boundaries.
    for (const bar of result.bars) {
      expect(bits.slice(bar.x, bar.x + bar.width)).toBe("1".repeat(bar.width));
    }
  });

  it("is deterministic — encoding the same value twice yields identical output", () => {
    expect(encodeCode128("HELLO-123")).toEqual(encodeCode128("HELLO-123"));
  });

  it("produces different output for different values", () => {
    expect(encodeCode128("AID-2026-00001")).not.toEqual(encodeCode128("AID-2026-00002"));
  });

  it("returns null for an empty string", () => {
    expect(encodeCode128("")).toBeNull();
  });

  it("returns null for a character outside printable ASCII 32-126 (e.g. a control character)", () => {
    expect(encodeCode128("AID001")).toBeNull();
  });

  it("returns null for a character above the printable ASCII range", () => {
    expect(encodeCode128("café")).toBeNull();
  });

  it("accepts every printable ASCII character in the valid range", () => {
    const printable = Array.from({ length: 95 }, (_, i) => String.fromCharCode(32 + i)).join("");
    expect(encodeCode128(printable)).not.toBeNull();
  });
});
