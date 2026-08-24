import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/core/audit/AuditLogger", () => ({ writeAuditLog: vi.fn() }));
vi.mock("./crm-settings.repository", () => ({
  CrmSettingsRepository: { findByCompany: vi.fn(), upsert: vi.fn() },
}));

const { CrmSettingsRepository } = await import("./crm-settings.repository");
const { getCrmSettings, updateCrmSettings, DEFAULT_LEAD_PRIORITY_THRESHOLDS } = await import("./crm-settings.service");
const { updateCrmSettingsSchema } = await import("./crm-settings.schema");

const actor = { companyId: "co-1", userId: "user-1" };

beforeEach(() => {
  vi.mocked(CrmSettingsRepository.findByCompany).mockReset();
  vi.mocked(CrmSettingsRepository.upsert).mockReset();
});

describe("getCrmSettings", () => {
  it("falls back to the original 80/50 defaults when a company has never customized these", async () => {
    vi.mocked(CrmSettingsRepository.findByCompany).mockResolvedValue(null);

    const result = await getCrmSettings("co-1");

    expect(result).toEqual(DEFAULT_LEAD_PRIORITY_THRESHOLDS);
  });

  it("returns the company's own stored thresholds, converted from Decimal, when a row exists", async () => {
    vi.mocked(CrmSettingsRepository.findByCompany).mockResolvedValue({ hotThreshold: "90.00", warmThreshold: "60.00" } as never);

    const result = await getCrmSettings("co-1");

    expect(result).toEqual({ hotThreshold: 90, warmThreshold: 60 });
  });
});

describe("updateCrmSettingsSchema", () => {
  it("rejects a warm threshold that isn't strictly below the hot threshold", () => {
    expect(updateCrmSettingsSchema.safeParse({ hotThreshold: 50, warmThreshold: 50 }).success).toBe(false);
    expect(updateCrmSettingsSchema.safeParse({ hotThreshold: 50, warmThreshold: 60 }).success).toBe(false);
  });

  it("accepts a valid ascending pair", () => {
    expect(updateCrmSettingsSchema.safeParse({ hotThreshold: 90, warmThreshold: 60 }).success).toBe(true);
  });
});

describe("updateCrmSettings", () => {
  it("persists the new thresholds and writes an audit entry with the prior values", async () => {
    vi.mocked(CrmSettingsRepository.findByCompany).mockResolvedValue(null);
    vi.mocked(CrmSettingsRepository.upsert).mockResolvedValue({ id: "cs-1", hotThreshold: "90", warmThreshold: "60" } as never);

    const result = await updateCrmSettings(actor, { hotThreshold: 90, warmThreshold: 60 });

    expect(CrmSettingsRepository.upsert).toHaveBeenCalledWith("co-1", { hotThreshold: 90, warmThreshold: 60, updatedByUserId: "user-1" });
    expect(result).toEqual({ hotThreshold: 90, warmThreshold: 60 });
  });
});
