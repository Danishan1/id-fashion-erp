import { BusinessRuleError } from "@/core/errors/BusinessRuleError";
import type { MarketingProviderKeyT } from "../delivery-registry";
import { brevoAdapter } from "./brevo";
import { msg91Adapter } from "./msg91";
import type { MarketingProviderAdapter, ProviderDeps } from "./provider-contract";
import { smtpAdapter } from "./smtp";
import { whatsappCloudAdapter } from "./whatsapp-cloud";

/** Provider adapters by key (server only). */
const ADAPTERS: Record<MarketingProviderKeyT, MarketingProviderAdapter> = {
  SMTP: smtpAdapter,
  BREVO: brevoAdapter,
  MSG91: msg91Adapter,
  WHATSAPP_CLOUD: whatsappCloudAdapter,
};

export function getProviderAdapter(key: string): MarketingProviderAdapter {
  const a = ADAPTERS[key as MarketingProviderKeyT];
  if (!a) throw new BusinessRuleError("VALIDATION_ERROR", `Unknown provider "${key}".`);
  return a;
}

/** Real network access; tests pass their own deps. */
export const defaultProviderDeps: ProviderDeps = { fetch: (...args) => fetch(...args), now: () => new Date() };

export type { MarketingProviderAdapter, ProviderDeps };
