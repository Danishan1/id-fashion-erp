import type { AIProvider as AIProviderRow, AIProviderCapability, AIProviderHealthStatus, AIUsageErrorCategory } from "@prisma/client";
import { BusinessRuleError } from "@/core/errors/BusinessRuleError";
import { decryptSecret } from "@/core/security/encryption";
import { logger } from "@/core/logging/logger";
import { createOpenAiImageProvider } from "@/core/ai/image-generation/providers/openai";
import { createGeminiImageProvider } from "@/core/ai/image-generation/providers/gemini";
import { createCloudflareImageProvider } from "@/core/ai/image-generation/providers/cloudflare";
import { createQwenLocalImageProvider } from "@/core/ai/image-generation/providers/qwen-local";
import { resolveCloudflareImg2ImgModel } from "@/core/ai/image-generation/config";
import type { GenerateImagesResult, ImageGenerationProvider } from "@/core/ai/image-generation/types";
import { AIProviderRepository, AIProviderUsageRepository, AIFailoverLogRepository, utcStartOfDay, utcStartOfMonth } from "./ai-provider.repository";
import { classifyImageGenError, isFailoverEligible } from "./error-classification";

/**
 * The real automatic-failover engine every AI Designer generation call now
 * routes through, instead of calling a single hardcoded provider directly:
 *
 *   AI Designer -> AIProviderManager -> capability filter -> priority sort
 *     -> try candidate #1 -> (failure, failover-eligible?) -> try #2 -> ...
 *     -> success, or a clear "no provider could complete this" error.
 *
 * Deliberately does NOT reimplement any provider's own HTTP/SDK call logic
 * — `buildProviderInstance` below constructs the exact same
 * `ImageGenerationProvider` objects `src/core/ai/image-generation/factory.ts`
 * already builds from env vars, just parameterized from a decrypted
 * database row instead. The caller supplies which single method on that
 * interface to invoke (`generate`/`generateVariation`/`applyFabric`/
 * `generateFromFabricReference`/`generateTechnicalFlat`) via the `call`
 * callback, since only the caller (AI Designer's own service) knows which
 * operation it actually needs — this manager only knows WHICH PROVIDER to
 * hand it to, never WHAT to ask that provider to do.
 */

export interface RunWithFailoverParams {
  companyId: string;
  userId: string;
  capability: AIProviderCapability;
  /** Human-readable context for the audit trail, e.g. "AI Designer / Project AID-2026-00001". */
  generationContext: string;
  aiDesignerProjectId?: string;
  /** A genuinely different project table from AiDesignerProject (Replicate Design's own), so it needs its own FK rather than overloading aiDesignerProjectId with an id the existing FK constraint would reject. */
  replicateDesignProjectId?: string;
  inputImagePresent: boolean;
  call: (provider: ImageGenerationProvider) => Promise<GenerateImagesResult>;
}

export interface RunWithFailoverResult {
  images: GenerateImagesResult["images"];
  model: string;
  raw: unknown;
  providerId: string;
  providerName: string;
}

// Cooldown durations per health penalty — short enough that a genuinely
// transient blip (a rate limit, a brief outage) recovers on its own within
// a reasonable session, long enough that a real outage/exhausted quota
// does not get hammered with repeat attempts every request.
const RATE_LIMIT_COOLDOWN_MS = 60_000; // 1 minute — rate limits are typically per-minute windows
const QUOTA_EXHAUSTED_COOLDOWN_MS = 15 * 60_000; // 15 minutes
const UNAVAILABLE_COOLDOWN_MS = 2 * 60_000; // 2 minutes — a transient outage/timeout

function computeHealthPenalty(category: ReturnType<typeof classifyImageGenError>["category"]): { healthStatus: AIProviderHealthStatus; cooldownUntil: Date | null } | null {
  const now = Date.now();
  switch (category) {
    case "RATE_LIMITED":
      return { healthStatus: "RATE_LIMITED", cooldownUntil: new Date(now + RATE_LIMIT_COOLDOWN_MS) };
    case "QUOTA_EXHAUSTED":
      return { healthStatus: "QUOTA_EXHAUSTED", cooldownUntil: new Date(now + QUOTA_EXHAUSTED_COOLDOWN_MS) };
    case "PROVIDER_UNAVAILABLE":
    case "TIMEOUT":
      return { healthStatus: "UNAVAILABLE", cooldownUntil: new Date(now + UNAVAILABLE_COOLDOWN_MS) };
    case "AUTH_ERROR":
      // No timed recovery — a bad/expired credential needs a human to fix
      // it (edit the provider or click Reset), not a clock. Deliberately
      // excluded from findCandidates() regardless of cooldownUntil.
      return { healthStatus: "AUTH_ERROR", cooldownUntil: null };
    // INVALID_REQUEST / CONTENT_POLICY / INTERNAL_ERROR are properties of
    // THIS request, not evidence the provider itself is unwell — the same
    // provider may work fine for the very next, different request, so its
    // health state is left untouched.
    default:
      return null;
  }
}

function buildProviderInstance(row: AIProviderRow): ImageGenerationProvider {
  const apiKey = row.apiKeyEncrypted ? decryptSecret(row.apiKeyEncrypted) : undefined;

  switch (row.providerType) {
    case "OPENAI":
      if (!apiKey) throw new BusinessRuleError("AI_SERVICE_ERROR", `AI provider "${row.name}" has no API key configured.`);
      return createOpenAiImageProvider({ apiKey, model: row.model });
    case "GEMINI":
      if (!apiKey) throw new BusinessRuleError("AI_SERVICE_ERROR", `AI provider "${row.name}" has no API key configured.`);
      return createGeminiImageProvider({ apiKey, model: row.model });
    case "CLOUDFLARE":
      // Cloudflare Workers AI needs two credential parts (account id + API
      // token); the admin schema has no dedicated "account id" field (not
      // in the required field list), so it is deliberately stored in the
      // generic `baseUrl` column for this provider type only — documented
      // here and surfaced with a dynamic "Account ID" label in the admin UI
      // when Provider Type = Cloudflare, rather than adding a column no
      // other provider type would ever use.
      if (!apiKey || !row.baseUrl) {
        throw new BusinessRuleError("AI_SERVICE_ERROR", `AI provider "${row.name}" is missing its Cloudflare Account ID or API token.`);
      }
      return createCloudflareImageProvider({
        accountId: row.baseUrl,
        apiToken: apiKey,
        model: row.model,
        img2imgModel: resolveCloudflareImg2ImgModel(),
      });
    case "QWEN_LOCAL":
      if (!row.baseUrl) throw new BusinessRuleError("AI_SERVICE_ERROR", `AI provider "${row.name}" has no base URL configured.`);
      return createQwenLocalImageProvider({ baseUrl: row.baseUrl, model: row.model, apiKey });
    default: {
      const exhaustive: never = row.providerType;
      throw new BusinessRuleError("AI_SERVICE_ERROR", `Unknown provider type "${exhaustive}".`);
    }
  }
}

/** True only for a row whose stored config is actually complete enough to attempt — excluded from the candidate list otherwise, never attempted-and-failed. */
function hasCompleteConfig(row: AIProviderRow): boolean {
  switch (row.providerType) {
    case "OPENAI":
    case "GEMINI":
      return !!row.apiKeyEncrypted;
    case "CLOUDFLARE":
      return !!row.apiKeyEncrypted && !!row.baseUrl;
    case "QWEN_LOCAL":
      return !!row.baseUrl;
    default:
      return false;
  }
}

/**
 * Read-only pre-check: does this company have at least one active,
 * fully-configured provider with `capability` ticked? Lets a caller pick
 * the best capability it can actually use (e.g. AI Designer's New Design
 * falls back from DESIGN_REPLICATION to MULTI_FABRIC) before calling
 * runWithFailover, instead of parsing its "no provider" error message.
 * Ignores health cooldowns/limits on purpose — those are runWithFailover's
 * job and produce their own clear error.
 */
export async function hasProviderForCapability(companyId: string, capability: AIProviderCapability): Promise<boolean> {
  const candidates = await AIProviderRepository.findCandidates(companyId, capability);
  return candidates.some(hasCompleteConfig);
}

/**
 * Real enforcement of the admin-configured Daily/Monthly Generation Limit
 * fields — a provider whose real, locally-tracked usage has already
 * reached its own limit is excluded from the candidate list for the rest
 * of that period, the same way a health-cooldown provider is. Checked
 * against `AIProviderUsage` rows this app itself wrote (never a
 * provider-side balance — none of the 4 integrations expose one, see
 * AI_PROVIDER_MANAGEMENT.md).
 */
async function withinGenerationLimits(row: AIProviderRow): Promise<boolean> {
  if (row.dailyGenerationLimit != null) {
    const usedToday = await AIProviderUsageRepository.countSince(row.id, utcStartOfDay());
    if (usedToday >= row.dailyGenerationLimit) return false;
  }
  if (row.monthlyGenerationLimit != null) {
    const usedThisMonth = await AIProviderUsageRepository.countSince(row.id, utcStartOfMonth());
    if (usedThisMonth >= row.monthlyGenerationLimit) return false;
  }
  return true;
}

const NO_COMPATIBLE_PROVIDER_MESSAGE =
  "No configured AI provider currently supports fabric-reference generation. Please configure OpenAI, Gemini, Qwen Image Edit, or another compatible provider.";

function capabilityLabel(capability: AIProviderCapability): string {
  switch (capability) {
    case "FABRIC_REFERENCE":
      return "fabric-reference generation";
    case "IMAGE_EDIT":
      return "image editing";
    case "TEXT_TO_IMAGE":
      return "image generation";
    case "MULTI_FABRIC":
      return "multi-fabric application";
    case "TECHNICAL_FLAT":
      return "technical flat sketch generation";
    case "DESIGN_REPLICATION":
      return "design replication with a new material";
    case "MASK_EDIT":
      return "drawing-based (mask) editing";
  }
}

export async function runWithFailover(params: RunWithFailoverParams): Promise<RunWithFailoverResult> {
  const allCandidates = await AIProviderRepository.findCandidates(params.companyId, params.capability);
  const configuredCandidates = allCandidates.filter(hasCompleteConfig);
  const limitChecks = await Promise.all(configuredCandidates.map(withinGenerationLimits));
  const candidates = configuredCandidates.filter((_, i) => limitChecks[i]);

  if (candidates.length === 0) {
    await AIProviderUsageRepository.create({
      companyId: params.companyId,
      providerId: null,
      userId: params.userId,
      aiDesignerProjectId: params.aiDesignerProjectId ?? null,
      replicateDesignProjectId: params.replicateDesignProjectId ?? null,
      generationType: params.capability,
      success: false,
      errorCategory: "PROVIDER_UNAVAILABLE",
      errorMessage: `No compatible/configured provider available for ${params.capability}.`,
      inputImagePresent: params.inputImagePresent,
    });
    throw new BusinessRuleError(
      "AI_SERVICE_ERROR",
      params.capability === "FABRIC_REFERENCE"
        ? NO_COMPATIBLE_PROVIDER_MESSAGE
        : `No configured AI provider currently supports ${capabilityLabel(params.capability)}. ` +
            `Tick the "${params.capability}" capability on a provider that supports it (e.g. OpenAI) in Administration → AI Configuration.`
    );
  }

  let pendingFailoverFrom: { providerId: string; reason: AIUsageErrorCategory } | null = null;

  for (let i = 0; i < candidates.length; i++) {
    const providerRow = candidates[i];
    const startedAt = Date.now();

    try {
      const providerInstance = buildProviderInstance(providerRow);
      const result = await params.call(providerInstance);
      const durationMs = Date.now() - startedAt;

      await AIProviderUsageRepository.create({
        companyId: params.companyId,
        providerId: providerRow.id,
        userId: params.userId,
        aiDesignerProjectId: params.aiDesignerProjectId ?? null,
        replicateDesignProjectId: params.replicateDesignProjectId ?? null,
        generationType: params.capability,
        durationMs,
        success: true,
        outputCount: result.images.length,
        inputImagePresent: params.inputImagePresent,
      });
      await AIProviderRepository.markHealthy(providerRow.id);

      if (pendingFailoverFrom) {
        await AIFailoverLogRepository.create({
          companyId: params.companyId,
          requestedProviderId: pendingFailoverFrom.providerId,
          fallbackProviderId: providerRow.id,
          reason: pendingFailoverFrom.reason,
          generationContext: params.generationContext,
          result: "SUCCESS",
        });
      }

      return { images: result.images, model: result.model, raw: result.raw, providerId: providerRow.id, providerName: providerRow.name };
    } catch (err) {
      const { category, message } = classifyImageGenError(err);
      const durationMs = Date.now() - startedAt;

      await AIProviderUsageRepository.create({
        companyId: params.companyId,
        providerId: providerRow.id,
        userId: params.userId,
        aiDesignerProjectId: params.aiDesignerProjectId ?? null,
        replicateDesignProjectId: params.replicateDesignProjectId ?? null,
        generationType: params.capability,
        durationMs,
        success: false,
        errorCategory: category,
        errorMessage: message,
        inputImagePresent: params.inputImagePresent,
      });

      const penalty = computeHealthPenalty(category);
      if (penalty) {
        await AIProviderRepository.applyHealthPenalty(providerRow.id, penalty.healthStatus, penalty.cooldownUntil, message);
      }

      if (pendingFailoverFrom) {
        await AIFailoverLogRepository.create({
          companyId: params.companyId,
          requestedProviderId: pendingFailoverFrom.providerId,
          fallbackProviderId: providerRow.id,
          reason: pendingFailoverFrom.reason,
          generationContext: params.generationContext,
          result: "FAILED",
        });
      }

      const eligible = isFailoverEligible(category) && providerRow.autoFailoverEnabled;
      const hasNext = i < candidates.length - 1;

      logger.info("AI provider attempt failed", { provider: providerRow.name, category, eligible, hasNext, message });

      if (!eligible || !hasNext) {
        throw new BusinessRuleError(
          "AI_SERVICE_ERROR",
          !eligible
            ? message
            : `All configured AI providers failed for ${capabilityLabel(params.capability)}. Last error (${providerRow.name}): ${message}`
        );
      }

      pendingFailoverFrom = { providerId: providerRow.id, reason: category };
    }
  }

  // Unreachable — the loop above always either returns or throws — kept only to satisfy TypeScript's control-flow analysis.
  throw new BusinessRuleError("AI_SERVICE_ERROR", "AI generation failed for an unknown reason.");
}
