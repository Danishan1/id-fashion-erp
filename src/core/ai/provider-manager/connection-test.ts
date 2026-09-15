import type { AIProvider as AIProviderRow } from "@prisma/client";
import { BusinessRuleError } from "@/core/errors/BusinessRuleError";
import { decryptSecret } from "@/core/security/encryption";
import { testOpenAiConnection } from "@/core/ai/image-generation/providers/openai";
import { testGeminiConnection } from "@/core/ai/image-generation/providers/gemini";
import { testCloudflareConnection } from "@/core/ai/image-generation/providers/cloudflare";
import { testQwenLocalConnection } from "@/core/ai/image-generation/providers/qwen-local";
import { createOpenAiImageProvider } from "@/core/ai/image-generation/providers/openai";
import { createGeminiImageProvider } from "@/core/ai/image-generation/providers/gemini";
import { createCloudflareImageProvider } from "@/core/ai/image-generation/providers/cloudflare";
import { createQwenLocalImageProvider } from "@/core/ai/image-generation/providers/qwen-local";
import { resolveCloudflareImg2ImgModel } from "@/core/ai/image-generation/config";
import type { ImageGenerationProvider } from "@/core/ai/image-generation/types";
import { classifyImageGenError } from "./error-classification";

export interface TestConnectionResult {
  success: boolean;
  modelAvailable: boolean;
  capabilitySupported: boolean;
  message: string;
}

/** Which method on ImageGenerationProvider a given capability actually needs — used only for the static "does this provider's own code support the capability" check, never a real network call. */
function methodForCapability(capability: string): keyof ImageGenerationProvider {
  switch (capability) {
    case "FABRIC_REFERENCE":
      return "generateFromFabricReference";
    case "IMAGE_EDIT":
      return "generateVariation";
    default:
      return "generate";
  }
}

/**
 * The real "Test Connection" action every configured provider gets in the
 * admin UI — checks, in order: (1) are the credentials valid and the
 * provider reachable, (2) is the configured model actually available on
 * that account, (3) does this provider's own code declare the capability
 * the admin says it supports. All via a free/cheap real API call, never a
 * paid generation — see each provider file's own `testXConnection` for why
 * that is possible for every provider type.
 */
export async function testProviderConnection(row: AIProviderRow): Promise<TestConnectionResult> {
  const apiKey = row.apiKeyEncrypted ? decryptSecret(row.apiKeyEncrypted) : undefined;

  try {
    let modelAvailable: boolean;
    let providerInstance: ImageGenerationProvider;

    switch (row.providerType) {
      case "OPENAI": {
        if (!apiKey) throw new BusinessRuleError("VALIDATION_ERROR", "No API key is configured for this provider.");
        const result = await testOpenAiConnection({ apiKey, model: row.model });
        modelAvailable = result.modelAvailable;
        providerInstance = createOpenAiImageProvider({ apiKey, model: row.model });
        break;
      }
      case "GEMINI": {
        if (!apiKey) throw new BusinessRuleError("VALIDATION_ERROR", "No API key is configured for this provider.");
        const result = await testGeminiConnection({ apiKey, model: row.model });
        modelAvailable = result.modelAvailable;
        providerInstance = createGeminiImageProvider({ apiKey, model: row.model });
        break;
      }
      case "CLOUDFLARE": {
        if (!apiKey || !row.baseUrl) {
          throw new BusinessRuleError("VALIDATION_ERROR", "The Cloudflare Account ID and/or API token is missing.");
        }
        const img2imgModel = resolveCloudflareImg2ImgModel();
        const needsImg2Img = row.capabilities.some((cap) => cap === "IMAGE_EDIT" || cap === "FABRIC_REFERENCE");
        const result = await testCloudflareConnection(
          { accountId: row.baseUrl, apiToken: apiKey, model: row.model, img2imgModel },
          { needsImg2Img }
        );
        modelAvailable = result.modelAvailable;
        providerInstance = createCloudflareImageProvider({ accountId: row.baseUrl, apiToken: apiKey, model: row.model, img2imgModel });
        break;
      }
      case "QWEN_LOCAL": {
        if (!row.baseUrl) throw new BusinessRuleError("VALIDATION_ERROR", "No base URL is configured for this provider.");
        const result = await testQwenLocalConnection({ baseUrl: row.baseUrl, model: row.model, apiKey });
        modelAvailable = result.modelAvailable;
        providerInstance = createQwenLocalImageProvider({ baseUrl: row.baseUrl, model: row.model, apiKey });
        break;
      }
      default: {
        const exhaustive: never = row.providerType;
        throw new BusinessRuleError("VALIDATION_ERROR", `Unknown provider type "${exhaustive}".`);
      }
    }

    const unsupportedCapabilities = row.capabilities.filter((cap) => typeof providerInstance[methodForCapability(cap)] !== "function");
    const capabilitySupported = unsupportedCapabilities.length === 0;

    const messageParts = ["Connected.", modelAvailable ? "Model available." : "Model NOT found on this account/server."];
    if (row.capabilities.length > 0) {
      messageParts.push(
        capabilitySupported
          ? `${row.capabilities.join(", ")} supported.`
          : `${unsupportedCapabilities.join(", ")} declared but NOT actually supported by this provider type.`
      );
    }

    return {
      success: modelAvailable && capabilitySupported,
      modelAvailable,
      capabilitySupported,
      message: messageParts.join(" "),
    };
  } catch (err) {
    if (err instanceof BusinessRuleError) {
      return { success: false, modelAvailable: false, capabilitySupported: false, message: err.message };
    }
    const { message } = classifyImageGenError(err);
    return { success: false, modelAvailable: false, capabilitySupported: false, message };
  }
}
