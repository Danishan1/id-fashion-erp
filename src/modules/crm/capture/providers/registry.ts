import { genericWebhookAdapter } from "./generic-webhook.adapter";
import type { LeadProviderAdapter } from "./lead-provider-adapter";

/**
 * Registered lead-source adapters. Only "generic" exists in Phase 03 — Meta,
 * IndiaMART, Google, LinkedIn and trade-portal adapters are added in their
 * own phases (they need provider credentials and API access), each as one
 * file implementing LeadProviderAdapter plus one entry here.
 */
const ADAPTERS: Record<string, LeadProviderAdapter> = {
  [genericWebhookAdapter.provider]: genericWebhookAdapter,
};

export function getLeadProviderAdapter(provider: string): LeadProviderAdapter | null {
  return Object.prototype.hasOwnProperty.call(ADAPTERS, provider) ? ADAPTERS[provider] : null;
}

export function listLeadProviderAdapters() {
  return Object.values(ADAPTERS).map((a) => ({ provider: a.provider, label: a.label, channel: a.channel }));
}
