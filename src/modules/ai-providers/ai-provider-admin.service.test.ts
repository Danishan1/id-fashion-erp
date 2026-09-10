import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/core/audit/AuditLogger", () => ({ writeAuditLog: vi.fn() }));
vi.mock("@/core/security/encryption", () => ({
  encryptSecret: vi.fn((v: string) => `enc:${v}`),
  decryptSecret: vi.fn((v: string) => v.replace(/^enc:/, "")),
}));
vi.mock("@/core/ai/provider-manager/connection-test", () => ({ testProviderConnection: vi.fn() }));
vi.mock("@/core/ai/provider-manager/ai-provider.repository", () => ({
  AIProviderRepository: { findMany: vi.fn(), findAnyById: vi.fn(), create: vi.fn(), update: vi.fn(), delete: vi.fn(), resetHealth: vi.fn() },
  AIProviderUsageRepository: { countSince: vi.fn() },
  AIFailoverLogRepository: { findRecent: vi.fn() },
  utcStartOfDay: vi.fn(() => new Date("2026-09-10T00:00:00.000Z")),
  utcStartOfMonth: vi.fn(() => new Date("2026-09-01T00:00:00.000Z")),
}));

const { writeAuditLog } = await import("@/core/audit/AuditLogger");
const { testProviderConnection } = await import("@/core/ai/provider-manager/connection-test");
const { AIProviderRepository, AIProviderUsageRepository } = await import("@/core/ai/provider-manager/ai-provider.repository");
const { createProvider, updateProvider, listProviders, getProviderById, deleteProvider, testConnection, getUsageDashboard } = await import(
  "./ai-provider-admin.service"
);

const actor = { companyId: "co-1", userId: "user-1" };

function providerRow(overrides: Record<string, unknown> = {}) {
  return {
    id: "provider-1",
    companyId: "co-1",
    name: "OpenAI Production",
    providerType: "OPENAI",
    apiKeyEncrypted: "enc:sk-real-secret-value-12345",
    model: "gpt-image-1",
    baseUrl: null,
    isActive: true,
    priority: 100,
    autoFailoverEnabled: true,
    dailyGenerationLimit: null,
    monthlyGenerationLimit: null,
    requestTimeoutMs: 120000,
    maxRetryCount: 1,
    capabilities: ["FABRIC_REFERENCE"],
    healthStatus: "HEALTHY",
    cooldownUntil: null,
    lastHealthCheckAt: null,
    lastErrorMessage: null,
    createdByUserId: "user-1",
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

const CREATE_INPUT = {
  name: "OpenAI Production",
  providerType: "OPENAI" as const,
  apiKey: "sk-real-secret-value-12345",
  model: "gpt-image-1",
  baseUrl: "",
  isActive: true,
  priority: 100,
  autoFailoverEnabled: true,
  requestTimeoutMs: 120000,
  maxRetryCount: 1,
  capabilities: ["FABRIC_REFERENCE" as const],
};

beforeEach(() => {
  vi.mocked(AIProviderRepository.findMany).mockReset();
  vi.mocked(AIProviderRepository.findAnyById).mockReset();
  vi.mocked(AIProviderRepository.create).mockReset();
  vi.mocked(AIProviderRepository.update).mockReset();
  vi.mocked(AIProviderRepository.delete).mockReset();
  vi.mocked(AIProviderRepository.resetHealth).mockReset();
  vi.mocked(AIProviderUsageRepository.countSince).mockReset().mockResolvedValue(0);
  vi.mocked(testProviderConnection).mockReset();
  vi.mocked(writeAuditLog).mockReset();
});

describe("security — the raw API key never reaches the caller", () => {
  it("createProvider's return value has no apiKeyEncrypted field and no full plaintext key anywhere in it", async () => {
    vi.mocked(AIProviderRepository.create).mockResolvedValue(providerRow() as never);

    const result = await createProvider(actor, CREATE_INPUT);

    expect(result).not.toHaveProperty("apiKeyEncrypted");
    expect(JSON.stringify(result)).not.toContain("sk-real-secret-value-12345");
    expect(result.hasApiKey).toBe(true);
    expect(result.apiKeyMasked).toBe("sk-r••••2345");
  });

  it("listProviders masks every row the same way", async () => {
    vi.mocked(AIProviderRepository.findMany).mockResolvedValue([providerRow()] as never);

    const rows = await listProviders("co-1");

    expect(rows).toHaveLength(1);
    expect(rows[0]).not.toHaveProperty("apiKeyEncrypted");
    expect(JSON.stringify(rows)).not.toContain("sk-real-secret-value-12345");
  });

  it("a provider with no key at all (e.g. an unauthenticated local Qwen server) reports hasApiKey:false and a null mask, not a fabricated one", async () => {
    vi.mocked(AIProviderRepository.findMany).mockResolvedValue([providerRow({ apiKeyEncrypted: null })] as never);

    const rows = await listProviders("co-1");

    expect(rows[0].hasApiKey).toBe(false);
    expect(rows[0].apiKeyMasked).toBeNull();
  });

  it("the audit log never records the API key, encrypted or plain", async () => {
    vi.mocked(AIProviderRepository.create).mockResolvedValue(providerRow() as never);

    await createProvider(actor, CREATE_INPUT);

    const [[auditCall]] = vi.mocked(writeAuditLog).mock.calls;
    expect(JSON.stringify(auditCall)).not.toContain("sk-real-secret-value-12345");
    expect(JSON.stringify(auditCall)).not.toContain("enc:sk-real-secret-value-12345");
  });
});

describe("createProvider", () => {
  it("encrypts the plaintext key before it ever reaches the repository/database layer", async () => {
    vi.mocked(AIProviderRepository.create).mockResolvedValue(providerRow() as never);

    await createProvider(actor, CREATE_INPUT);

    expect(AIProviderRepository.create).toHaveBeenCalledWith(
      expect.objectContaining({ apiKeyEncrypted: "enc:sk-real-secret-value-12345", companyId: "co-1", createdByUserId: "user-1" })
    );
  });

  it("rejects a duplicate provider name within the same company with a clean error", async () => {
    vi.mocked(AIProviderRepository.create).mockRejectedValue({
      code: "P2002",
      meta: { driverAdapterError: { cause: { constraint: { fields: ["name"] } } } },
    });

    await expect(createProvider(actor, CREATE_INPUT)).rejects.toMatchObject({ code: "REFERENCED_RECORD_IN_USE" });
  });
});

describe("updateProvider — the 3-state apiKey field", () => {
  it("omitting apiKey from the update payload leaves the stored key untouched", async () => {
    vi.mocked(AIProviderRepository.findAnyById).mockResolvedValue(providerRow() as never);
    vi.mocked(AIProviderRepository.update).mockResolvedValue(providerRow({ priority: 5 }) as never);

    await updateProvider(actor, "provider-1", { priority: 5 });

    const [, data] = vi.mocked(AIProviderRepository.update).mock.calls[0];
    expect(data).not.toHaveProperty("apiKeyEncrypted");
  });

  it("an explicit empty string clears the stored key", async () => {
    vi.mocked(AIProviderRepository.findAnyById).mockResolvedValue(providerRow() as never);
    vi.mocked(AIProviderRepository.update).mockResolvedValue(providerRow({ apiKeyEncrypted: null }) as never);

    await updateProvider(actor, "provider-1", { apiKey: "" });

    const [, data] = vi.mocked(AIProviderRepository.update).mock.calls[0];
    expect(data).toMatchObject({ apiKeyEncrypted: null });
  });

  it("a non-empty apiKey replaces the stored key, encrypted", async () => {
    vi.mocked(AIProviderRepository.findAnyById).mockResolvedValue(providerRow() as never);
    vi.mocked(AIProviderRepository.update).mockResolvedValue(providerRow() as never);

    await updateProvider(actor, "provider-1", { apiKey: "sk-new-key" });

    const [, data] = vi.mocked(AIProviderRepository.update).mock.calls[0];
    expect(data).toMatchObject({ apiKeyEncrypted: "enc:sk-new-key" });
  });

  it("404s for a provider that does not belong to this company", async () => {
    vi.mocked(AIProviderRepository.findAnyById).mockResolvedValue(null);

    await expect(updateProvider(actor, "provider-x", { priority: 1 })).rejects.toMatchObject({ code: "NOT_FOUND" });
  });
});

describe("deleteProvider / getProviderById", () => {
  it("404s deleting a provider that does not belong to this company", async () => {
    vi.mocked(AIProviderRepository.findAnyById).mockResolvedValue(null);
    await expect(deleteProvider(actor, "provider-x")).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("getProviderById returns the masked shape, not the raw row", async () => {
    vi.mocked(AIProviderRepository.findAnyById).mockResolvedValue(providerRow() as never);
    const result = await getProviderById("co-1", "provider-1");
    expect(result).not.toHaveProperty("apiKeyEncrypted");
  });
});

describe("testConnection", () => {
  it("delegates to the real connection-test module for the owned provider row", async () => {
    vi.mocked(AIProviderRepository.findAnyById).mockResolvedValue(providerRow() as never);
    vi.mocked(testProviderConnection).mockResolvedValue({ success: true, modelAvailable: true, capabilitySupported: true, message: "Connected." });

    const result = await testConnection(actor, "provider-1");

    expect(result.success).toBe(true);
    expect(testProviderConnection).toHaveBeenCalledWith(expect.objectContaining({ id: "provider-1" }));
  });
});

describe("getUsageDashboard", () => {
  it("never fabricates a provider-side credit balance — providerBalance is always null", async () => {
    vi.mocked(AIProviderRepository.findMany).mockResolvedValue([providerRow()] as never);
    vi.mocked(AIProviderUsageRepository.countSince).mockResolvedValue(3);

    const dashboard = await getUsageDashboard("co-1");

    expect(dashboard[0].providerBalance).toBeNull();
    expect(dashboard[0].usedToday).toBe(3);
    expect(dashboard[0].usedThisMonth).toBe(3);
  });
});
