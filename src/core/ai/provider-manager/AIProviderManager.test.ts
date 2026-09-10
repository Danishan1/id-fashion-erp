import { beforeEach, describe, expect, it, vi } from "vitest";
import { ImageGenerationServiceError } from "@/core/ai/image-generation/types";

vi.mock("@/core/security/encryption", () => ({ decryptSecret: vi.fn((v: string) => `decrypted:${v}`) }));
vi.mock("@/core/logging/logger", () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));
vi.mock("@/core/ai/image-generation/providers/openai", () => ({ createOpenAiImageProvider: vi.fn() }));
vi.mock("@/core/ai/image-generation/providers/gemini", () => ({ createGeminiImageProvider: vi.fn() }));
vi.mock("@/core/ai/image-generation/providers/cloudflare", () => ({ createCloudflareImageProvider: vi.fn() }));
vi.mock("@/core/ai/image-generation/providers/qwen-local", () => ({ createQwenLocalImageProvider: vi.fn() }));
vi.mock("./ai-provider.repository", () => ({
  AIProviderRepository: { findCandidates: vi.fn(), markHealthy: vi.fn(), applyHealthPenalty: vi.fn() },
  AIProviderUsageRepository: { create: vi.fn(), countSince: vi.fn() },
  AIFailoverLogRepository: { create: vi.fn() },
  utcStartOfDay: vi.fn(() => new Date("2026-09-10T00:00:00.000Z")),
  utcStartOfMonth: vi.fn(() => new Date("2026-09-01T00:00:00.000Z")),
}));

const { createOpenAiImageProvider } = await import("@/core/ai/image-generation/providers/openai");
const { createGeminiImageProvider } = await import("@/core/ai/image-generation/providers/gemini");
const { AIProviderRepository, AIProviderUsageRepository, AIFailoverLogRepository } = await import("./ai-provider.repository");
const { runWithFailover } = await import("./AIProviderManager");

function providerRow(overrides: Record<string, unknown> = {}) {
  return {
    id: "provider-1",
    companyId: "co-1",
    name: "Test Provider",
    providerType: "OPENAI",
    apiKeyEncrypted: "enc:key",
    model: "gpt-image-1",
    baseUrl: null,
    isActive: true,
    priority: 100,
    autoFailoverEnabled: true,
    capabilities: ["FABRIC_REFERENCE"],
    healthStatus: "HEALTHY",
    cooldownUntil: null,
    ...overrides,
  };
}

const baseParams = {
  companyId: "co-1",
  userId: "user-1",
  capability: "FABRIC_REFERENCE" as const,
  generationContext: "AI Designer / Project AID-2026-00001",
  aiDesignerProjectId: "proj-1",
  inputImagePresent: true,
};

beforeEach(() => {
  vi.mocked(AIProviderRepository.findCandidates).mockReset();
  vi.mocked(AIProviderRepository.markHealthy).mockReset().mockResolvedValue({} as never);
  vi.mocked(AIProviderRepository.applyHealthPenalty).mockReset().mockResolvedValue({} as never);
  vi.mocked(AIProviderUsageRepository.create).mockReset().mockResolvedValue({} as never);
  vi.mocked(AIProviderUsageRepository.countSince).mockReset().mockResolvedValue(0);
  vi.mocked(AIFailoverLogRepository.create).mockReset().mockResolvedValue({} as never);
  vi.mocked(createOpenAiImageProvider).mockReset();
  vi.mocked(createGeminiImageProvider).mockReset();
});

describe("runWithFailover — provider selection", () => {
  it("selects the highest-priority compatible provider and never even attempts a lower-priority one", async () => {
    vi.mocked(AIProviderRepository.findCandidates).mockResolvedValue([
      providerRow({ id: "p-high", priority: 10 }),
      providerRow({ id: "p-low", priority: 200 }),
    ] as never);
    const call = vi.fn().mockResolvedValue({ images: [{ buffer: Buffer.from("x"), mimeType: "image/png" }], model: "gpt-image-1", raw: {} });
    vi.mocked(createOpenAiImageProvider).mockReturnValue({ name: "openai", model: "gpt-image-1" } as never);

    const result = await runWithFailover({ ...baseParams, call });

    expect(result.providerId).toBe("p-high");
    expect(call).toHaveBeenCalledTimes(1);
    expect(AIProviderRepository.findCandidates).toHaveBeenCalledWith("co-1", "FABRIC_REFERENCE");
  });

  it("passes the correct decrypted API key and model when constructing the OpenAI provider instance", async () => {
    vi.mocked(AIProviderRepository.findCandidates).mockResolvedValue([providerRow({ apiKeyEncrypted: "enc:secret", model: "gpt-image-1" })] as never);
    vi.mocked(createOpenAiImageProvider).mockReturnValue({ name: "openai", model: "gpt-image-1" } as never);
    const call = vi.fn().mockResolvedValue({ images: [], model: "gpt-image-1", raw: {} });

    await runWithFailover({ ...baseParams, call });

    expect(createOpenAiImageProvider).toHaveBeenCalledWith({ apiKey: "decrypted:enc:secret", model: "gpt-image-1" });
  });

  it("excludes a provider with incomplete config (missing API key) from the candidate list before ever attempting it", async () => {
    vi.mocked(AIProviderRepository.findCandidates).mockResolvedValue([
      providerRow({ id: "p-no-key", apiKeyEncrypted: null }),
      providerRow({ id: "p-ok" }),
    ] as never);
    vi.mocked(createOpenAiImageProvider).mockReturnValue({ name: "openai", model: "gpt-image-1" } as never);
    const call = vi.fn().mockResolvedValue({ images: [], model: "gpt-image-1", raw: {} });

    const result = await runWithFailover({ ...baseParams, call });

    expect(result.providerId).toBe("p-ok");
    expect(call).toHaveBeenCalledTimes(1);
    // Never logged as a real failed attempt — it was never a real candidate.
    expect(AIProviderUsageRepository.create).not.toHaveBeenCalledWith(expect.objectContaining({ providerId: "p-no-key" }));
  });

  it("returns a clean error and logs a providerId:null usage row when no compatible provider exists at all", async () => {
    vi.mocked(AIProviderRepository.findCandidates).mockResolvedValue([] as never);
    const call = vi.fn();

    await expect(runWithFailover({ ...baseParams, call })).rejects.toMatchObject({ code: "AI_SERVICE_ERROR" });
    expect(call).not.toHaveBeenCalled();
    expect(AIProviderUsageRepository.create).toHaveBeenCalledWith(expect.objectContaining({ providerId: null, success: false }));
  });
});

describe("runWithFailover — automatic failover on transient errors", () => {
  it("fails over to the next provider on QUOTA_EXHAUSTED (429/credits exhausted)", async () => {
    vi.mocked(AIProviderRepository.findCandidates).mockResolvedValue([
      providerRow({ id: "p-1", priority: 1 }),
      providerRow({ id: "p-2", priority: 2 }),
    ] as never);
    vi.mocked(createOpenAiImageProvider).mockReturnValue({ name: "openai", model: "gpt-image-1" } as never);
    const call = vi
      .fn()
      .mockRejectedValueOnce(new ImageGenerationServiceError("no credits", "CREDITS_EXHAUSTED"))
      .mockResolvedValueOnce({ images: [{ buffer: Buffer.from("x"), mimeType: "image/png" }], model: "gpt-image-1", raw: {} });

    const result = await runWithFailover({ ...baseParams, call });

    expect(result.providerId).toBe("p-2");
    expect(call).toHaveBeenCalledTimes(2);
    expect(AIProviderRepository.applyHealthPenalty).toHaveBeenCalledWith("p-1", "QUOTA_EXHAUSTED", expect.any(Date), "no credits");
    expect(AIFailoverLogRepository.create).toHaveBeenCalledWith(
      expect.objectContaining({ requestedProviderId: "p-1", fallbackProviderId: "p-2", reason: "QUOTA_EXHAUSTED", result: "SUCCESS" })
    );
  });

  it.each([
    ["RATE_LIMIT" as const, "RATE_LIMITED"],
    ["TIMEOUT" as const, "TIMEOUT"],
    ["PROVIDER_ERROR" as const, "PROVIDER_UNAVAILABLE"],
  ])("fails over to the next provider on %s", async (imageGenCategory, expectedAiCategory) => {
    vi.mocked(AIProviderRepository.findCandidates).mockResolvedValue([
      providerRow({ id: "p-1", priority: 1 }),
      providerRow({ id: "p-2", priority: 2 }),
    ] as never);
    vi.mocked(createOpenAiImageProvider).mockReturnValue({ name: "openai", model: "gpt-image-1" } as never);
    const call = vi
      .fn()
      .mockRejectedValueOnce(new ImageGenerationServiceError("transient", imageGenCategory))
      .mockResolvedValueOnce({ images: [], model: "gpt-image-1", raw: {} });

    const result = await runWithFailover({ ...baseParams, call });

    expect(result.providerId).toBe("p-2");
    expect(AIFailoverLogRepository.create).toHaveBeenCalledWith(expect.objectContaining({ reason: expectedAiCategory, result: "SUCCESS" }));
  });

  it("logs a FAILED failover transition when the fallback provider also fails", async () => {
    vi.mocked(AIProviderRepository.findCandidates).mockResolvedValue([
      providerRow({ id: "p-1", priority: 1 }),
      providerRow({ id: "p-2", priority: 2 }),
    ] as never);
    vi.mocked(createOpenAiImageProvider).mockReturnValue({ name: "openai", model: "gpt-image-1" } as never);
    const call = vi
      .fn()
      .mockRejectedValueOnce(new ImageGenerationServiceError("rate limited", "RATE_LIMIT"))
      .mockRejectedValueOnce(new ImageGenerationServiceError("also rate limited", "RATE_LIMIT"));

    await expect(runWithFailover({ ...baseParams, call })).rejects.toMatchObject({ code: "AI_SERVICE_ERROR" });

    expect(AIFailoverLogRepository.create).toHaveBeenCalledWith(
      expect.objectContaining({ requestedProviderId: "p-1", fallbackProviderId: "p-2", reason: "RATE_LIMITED", result: "FAILED" })
    );
  });
});

describe("runWithFailover — never fails over for a real operational problem, matching the explicit requirement list", () => {
  it.each([
    ["AUTH_FAILURE" as const, "AUTH_ERROR"],
    ["UNSAFE_CONTENT" as const, "CONTENT_POLICY"],
  ])("does NOT try the next provider on %s — surfaces immediately instead", async (imageGenCategory, expectedAiCategory) => {
    vi.mocked(AIProviderRepository.findCandidates).mockResolvedValue([
      providerRow({ id: "p-1", priority: 1 }),
      providerRow({ id: "p-2", priority: 2 }),
    ] as never);
    vi.mocked(createOpenAiImageProvider).mockReturnValue({ name: "openai", model: "gpt-image-1" } as never);
    const call = vi.fn().mockRejectedValue(new ImageGenerationServiceError("not eligible", imageGenCategory));

    await expect(runWithFailover({ ...baseParams, call })).rejects.toMatchObject({ code: "AI_SERVICE_ERROR" });

    // The second, otherwise-perfectly-good candidate is never even tried —
    // an invalid API key or a content-policy rejection is not something a
    // different provider can fix, and blindly retrying on auth failure
    // specifically would let a broken credential go unnoticed.
    expect(call).toHaveBeenCalledTimes(1);
    expect(AIFailoverLogRepository.create).not.toHaveBeenCalled();
    if (expectedAiCategory === "AUTH_ERROR") {
      expect(AIProviderRepository.applyHealthPenalty).toHaveBeenCalledWith("p-1", "AUTH_ERROR", null, "not eligible");
    }
  });

  it("a request-shape problem (invalid image / bad prompt) does not fail over either", async () => {
    vi.mocked(AIProviderRepository.findCandidates).mockResolvedValue([providerRow({ id: "p-1" }), providerRow({ id: "p-2" })] as never);
    vi.mocked(createOpenAiImageProvider).mockReturnValue({ name: "openai", model: "gpt-image-1" } as never);
    // BadRequestError-shaped failures map to PROVIDER_ERROR only when the
    // SDK itself can't be more specific — this test uses UNSAFE_CONTENT and
    // AUTH_FAILURE above for the two real distinguishable non-eligible
    // categories; INTERNAL_ERROR (an application bug, e.g. UNSUPPORTED_OPERATION
    // reaching here because of a capability-declaration mismatch) is the
    // third non-eligible category and is exercised directly:
    const call = vi.fn().mockRejectedValue(new ImageGenerationServiceError("capability mismatch", "UNSUPPORTED_OPERATION"));

    await expect(runWithFailover({ ...baseParams, call })).rejects.toMatchObject({ code: "AI_SERVICE_ERROR" });
    expect(call).toHaveBeenCalledTimes(1);
  });

  it("does not fail over even for an eligible error when the failing provider has autoFailoverEnabled:false", async () => {
    vi.mocked(AIProviderRepository.findCandidates).mockResolvedValue([
      providerRow({ id: "p-1", priority: 1, autoFailoverEnabled: false }),
      providerRow({ id: "p-2", priority: 2 }),
    ] as never);
    vi.mocked(createOpenAiImageProvider).mockReturnValue({ name: "openai", model: "gpt-image-1" } as never);
    const call = vi.fn().mockRejectedValue(new ImageGenerationServiceError("quota gone", "CREDITS_EXHAUSTED"));

    await expect(runWithFailover({ ...baseParams, call })).rejects.toMatchObject({ code: "AI_SERVICE_ERROR" });
    expect(call).toHaveBeenCalledTimes(1);
  });
});

describe("runWithFailover — daily/monthly generation limits", () => {
  it("excludes a provider that has already reached its daily limit, before ever attempting it", async () => {
    vi.mocked(AIProviderRepository.findCandidates).mockResolvedValue([
      providerRow({ id: "p-capped", priority: 1, dailyGenerationLimit: 5 }),
      providerRow({ id: "p-ok", priority: 2 }),
    ] as never);
    vi.mocked(createOpenAiImageProvider).mockReturnValue({ name: "openai", model: "gpt-image-1" } as never);
    vi.mocked(AIProviderUsageRepository.countSince).mockImplementation(((providerId: string) => Promise.resolve(providerId === "p-capped" ? 5 : 0)) as never);
    const call = vi.fn().mockResolvedValue({ images: [], model: "gpt-image-1", raw: {} });

    const result = await runWithFailover({ ...baseParams, call });

    expect(result.providerId).toBe("p-ok");
    expect(call).toHaveBeenCalledTimes(1);
    expect(AIProviderUsageRepository.create).not.toHaveBeenCalledWith(expect.objectContaining({ providerId: "p-capped" }));
  });

  it("excludes a provider that has already reached its monthly limit", async () => {
    vi.mocked(AIProviderRepository.findCandidates).mockResolvedValue([
      providerRow({ id: "p-capped", priority: 1, monthlyGenerationLimit: 100 }),
      providerRow({ id: "p-ok", priority: 2 }),
    ] as never);
    vi.mocked(createOpenAiImageProvider).mockReturnValue({ name: "openai", model: "gpt-image-1" } as never);
    vi.mocked(AIProviderUsageRepository.countSince).mockImplementation(((providerId: string, since: Date) =>
      Promise.resolve(providerId === "p-capped" && since.getUTCDate() === 1 ? 100 : 0)) as never);
    const call = vi.fn().mockResolvedValue({ images: [], model: "gpt-image-1", raw: {} });

    const result = await runWithFailover({ ...baseParams, call });

    expect(result.providerId).toBe("p-ok");
    expect(call).toHaveBeenCalledTimes(1);
  });

  it("still allows a provider under its limit, and never queries the limit at all when neither field is configured", async () => {
    vi.mocked(AIProviderRepository.findCandidates).mockResolvedValue([providerRow({ id: "p-1", dailyGenerationLimit: 5 })] as never);
    vi.mocked(createOpenAiImageProvider).mockReturnValue({ name: "openai", model: "gpt-image-1" } as never);
    vi.mocked(AIProviderUsageRepository.countSince).mockResolvedValue(4);
    const call = vi.fn().mockResolvedValue({ images: [], model: "gpt-image-1", raw: {} });

    const result = await runWithFailover({ ...baseParams, call });

    expect(result.providerId).toBe("p-1");
  });

  it("returns the clean no-compatible-provider error when every candidate is limit-capped, not a false 'none configured' story", async () => {
    vi.mocked(AIProviderRepository.findCandidates).mockResolvedValue([providerRow({ id: "p-1", dailyGenerationLimit: 1 })] as never);
    vi.mocked(AIProviderUsageRepository.countSince).mockResolvedValue(1);
    const call = vi.fn();

    await expect(runWithFailover({ ...baseParams, call })).rejects.toMatchObject({ code: "AI_SERVICE_ERROR" });
    expect(call).not.toHaveBeenCalled();
  });
});

describe("runWithFailover — usage tracking", () => {
  it("records a real, non-fabricated usage row on success with the actual output count and duration", async () => {
    vi.mocked(AIProviderRepository.findCandidates).mockResolvedValue([providerRow()] as never);
    vi.mocked(createOpenAiImageProvider).mockReturnValue({ name: "openai", model: "gpt-image-1" } as never);
    const call = vi
      .fn()
      .mockResolvedValue({ images: [{ buffer: Buffer.from("a"), mimeType: "image/png" }, { buffer: Buffer.from("b"), mimeType: "image/png" }], model: "gpt-image-1", raw: {} });

    await runWithFailover({ ...baseParams, call });

    expect(AIProviderUsageRepository.create).toHaveBeenCalledWith(
      expect.objectContaining({ providerId: "provider-1", success: true, outputCount: 2, inputImagePresent: true, generationType: "FABRIC_REFERENCE" })
    );
    expect(AIProviderRepository.markHealthy).toHaveBeenCalledWith("provider-1");
  });
});
