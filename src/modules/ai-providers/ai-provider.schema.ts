import { z } from "zod";

export const PROVIDER_TYPE_VALUES = ["OPENAI", "GEMINI", "CLOUDFLARE", "QWEN_LOCAL"] as const;
export const CAPABILITY_VALUES = ["TEXT_TO_IMAGE", "IMAGE_EDIT", "FABRIC_REFERENCE", "MULTI_FABRIC", "TECHNICAL_FLAT"] as const;

export const createAIProviderSchema = z.object({
  name: z.string().min(1, "Name is required").max(100),
  providerType: z.enum(PROVIDER_TYPE_VALUES),
  // Plaintext in, encrypted before it ever reaches the database — see
  // ai-provider-admin.service.ts. Optional only because QWEN_LOCAL may be a
  // genuinely unauthenticated local server.
  apiKey: z.string().max(2000).optional().or(z.literal("")),
  model: z.string().min(1, "Model is required").max(200),
  // For CLOUDFLARE this field holds the Account ID, not a URL — see
  // AIProviderManager's buildProviderInstance for why (documented there).
  baseUrl: z.string().max(500).optional().or(z.literal("")),
  isActive: z.boolean().default(true),
  priority: z.coerce.number().int().min(0).max(10000).default(100),
  autoFailoverEnabled: z.boolean().default(true),
  dailyGenerationLimit: z.coerce.number().int().positive().optional(),
  monthlyGenerationLimit: z.coerce.number().int().positive().optional(),
  requestTimeoutMs: z.coerce.number().int().min(1000).max(600000).default(120000),
  maxRetryCount: z.coerce.number().int().min(0).max(10).default(1),
  capabilities: z.array(z.enum(CAPABILITY_VALUES)).min(1, "At least one capability is required"),
});

export type CreateAIProviderInput = z.infer<typeof createAIProviderSchema>;

/**
 * `apiKey` on update is a genuine 3-state field, not a plain optional:
 * omitted/undefined = keep the existing stored key unchanged; a non-empty
 * string = replace it; an explicit empty string = clear it (only
 * meaningful for QWEN_LOCAL, where no key is a valid configuration). Zod
 * itself can't express "omitted vs empty string are different intents" any
 * more precisely than this — the service layer is what actually branches
 * on the distinction (see updateProvider).
 */
export const updateAIProviderSchema = createAIProviderSchema.partial();

export type UpdateAIProviderInput = z.infer<typeof updateAIProviderSchema>;
