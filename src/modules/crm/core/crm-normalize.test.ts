import { describe, expect, it } from "vitest";
import { buildSearchText, emailKey, fullNameOf, nameKey, phoneKey, uniqueKeys } from "./crm-normalize";

describe("crm-normalize", () => {
  it("normalises emails", () => {
    expect(emailKey("  Elin.Berg@Nordic.SE ")).toBe("elin.berg@nordic.se");
    expect(emailKey("   ")).toBeNull();
  });

  it("matches the same phone written different ways", () => {
    expect(phoneKey("+91 98765 43210")).toBe("9876543210");
    expect(phoneKey("098765-43210")).toBe("9876543210");
    expect(phoneKey("9876543210")).toBe("9876543210");
    expect(phoneKey("12345")).toBeNull();
    expect(phoneKey(null)).toBeNull();
  });

  it("normalises names and builds search text", () => {
    expect(nameKey("  Nordic   Threads AB ")).toBe("nordic threads ab");
    expect(fullNameOf(" Elin ", " Berg ")).toBe("Elin Berg");
    expect(fullNameOf("Elin", null)).toBe("Elin");
    expect(buildSearchText(["LEAD-2026-00001", "Elin Berg", null, " Nordic "])).toBe("lead-2026-00001 elin berg nordic");
    expect(uniqueKeys(["a", null, "a", "b"])).toEqual(["a", "b"]);
  });
});
