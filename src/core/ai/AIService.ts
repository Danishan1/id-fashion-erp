/**
 * Provider-agnostic AI capability interface for AI Garment Flow (and any
 * future AI-driven area of this app). Every method returns a structured
 * "not connected" result today — no paid AI API is called, and no
 * fabricated/simulated result is ever synthesized, per explicit product
 * instruction. Kept in `src/core/` (not inside the ai-garment-flow module)
 * since this is a genuinely cross-cutting concern, matching this codebase's
 * existing convention (auth/rbac/attachments/file-storage all live here
 * too).
 *
 * To wire up a real provider later: implement `AIService` against
 * OpenAI/Claude/Gemini/a fashion-specific vision API, then swap what
 * `getAIService()` returns — nothing calling into this interface (any
 * AI Garment Flow step component, or a future module) needs to change.
 */

export interface AIResult<T = unknown> {
  available: boolean;
  message: string;
  data?: T;
}

const NOT_CONNECTED_MESSAGE = "AI integration not connected.";

function notConnected<T>(): AIResult<T> {
  return { available: false, message: NOT_CONNECTED_MESSAGE };
}

export interface AIService {
  analyseReference(input: { attachmentId: string; notes?: string }): Promise<AIResult>;
  analyseFabric(input: { attachmentId: string; notes?: string }): Promise<AIResult>;
  createDevelopmentBrief(input: { projectId: string }): Promise<AIResult>;
  generateDesigns(input: { projectId: string; count?: number }): Promise<AIResult>;
  compareDesigns(input: { designOptionIds: string[] }): Promise<AIResult>;
  applyFabric(input: { projectId: string; fabricDetailId: string }): Promise<AIResult>;
  createTechnicalFlat(input: { designOptionId: string }): Promise<AIResult>;
  generateDraftBOM(input: { productId: string }): Promise<AIResult>;
  analyseCost(input: { projectId: string }): Promise<AIResult>;
}

/**
 * The default (and today, only) provider — deliberately does nothing but
 * report itself as unavailable. Every method is async and shaped exactly
 * like a real provider's would be, so swapping this out later is a
 * drop-in replacement, not a rewrite of any caller.
 */
export class NullAIProvider implements AIService {
  async analyseReference(): Promise<AIResult> {
    return notConnected();
  }
  async analyseFabric(): Promise<AIResult> {
    return notConnected();
  }
  async createDevelopmentBrief(): Promise<AIResult> {
    return notConnected();
  }
  async generateDesigns(): Promise<AIResult> {
    return notConnected();
  }
  async compareDesigns(): Promise<AIResult> {
    return notConnected();
  }
  async applyFabric(): Promise<AIResult> {
    return notConnected();
  }
  async createTechnicalFlat(): Promise<AIResult> {
    return notConnected();
  }
  async generateDraftBOM(): Promise<AIResult> {
    return notConnected();
  }
  async analyseCost(): Promise<AIResult> {
    return notConnected();
  }
}

let cachedService: AIService | null = null;

/**
 * Returns the configured AI provider — env-var driven so a real provider
 * can be switched in later without touching any caller. No AI_PROVIDER
 * value is currently wired to anything but the null provider; this is the
 * one place that would change.
 */
export function getAIService(): AIService {
  if (!cachedService) {
    cachedService = new NullAIProvider();
  }
  return cachedService;
}
