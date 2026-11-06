import { describe, expect, it } from "vitest";
import { recalcPeriod } from "./sm-bulk-actions";
import { bulkFilterQuery } from "@/components/sales-marketing/bulk/SmBulkActions";

describe("S&M bulk helpers (Phase 14)", () => {
  it("relative recalculation periods end today and move with each run", () => {
    expect(recalcPeriod({ period: "LAST_30" }, "2026-11-06")).toEqual({ from: "2026-10-08", to: "2026-11-06" });
    expect(recalcPeriod({ period: "LAST_365" }, "2026-11-06")).toEqual({ from: "2025-11-07", to: "2026-11-06" });
    expect(recalcPeriod({ period: "CUSTOM", from: "2026-01-01", to: "2026-03-31" }, "2026-11-06")).toEqual({ from: "2026-01-01", to: "2026-03-31" });
  });

  it("builds the list's filter query, dropping blanks", () => {
    expect(bulkFilterQuery({ view: "open", stage: "", owner: undefined, overdue: false, search: "linen shirts" })).toBe("view=open&search=linen+shirts");
  });
});
