import type { ChannelProvider, ChannelType } from "./CommunicationProvider";
import { genericWebhookProvider } from "./providers/generic-webhook.provider";

/**
 * Every channel provider the app knows. Adding a provider (email service,
 * SMS gateway, WhatsApp Business API, Messenger / Instagram, website chat)
 * = implement ChannelProvider in ./providers and add it here. Nothing in the
 * CRM conversation layer changes.
 */
const PROVIDERS: Record<string, ChannelProvider> = {
  [genericWebhookProvider.key]: genericWebhookProvider,
};

export function getChannelProvider(key: string): ChannelProvider | null {
  return Object.prototype.hasOwnProperty.call(PROVIDERS, key) ? PROVIDERS[key] : null;
}

/** Providers that can serve a channel type (for the channel settings screen). */
export function channelProvidersFor(channelType?: ChannelType): { key: string; label: string; channelTypes: readonly ChannelType[] }[] {
  return Object.values(PROVIDERS)
    .filter((p) => !channelType || p.channelTypes.includes(channelType))
    .map((p) => ({ key: p.key, label: p.label, channelTypes: p.channelTypes }));
}
