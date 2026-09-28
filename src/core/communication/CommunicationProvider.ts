/**
 * Server-side extension point for real outbound messaging (spec §19/§20).
 *
 * Today no paid provider is configured: the CRM's Call/Email/WhatsApp quick
 * actions open the user's own apps (tel:/mailto:/wa.me links, see
 * src/lib/communication.ts) and the salesperson logs the interaction as a
 * CrmActivity. When a WhatsApp Business API / email service / telephony
 * provider is added, it implements this interface and is returned by
 * getCommunicationProvider(); credentials stay in server env vars and never
 * reach the browser.
 */
export type CommunicationChannel = "WHATSAPP" | "EMAIL" | "CALL";

export interface OutboundMessage {
  channel: CommunicationChannel;
  to: string;
  subject?: string;
  body: string;
}

export interface SendResult {
  delivered: boolean;
  providerMessageId?: string;
  /** Human-readable reason when not delivered. */
  message?: string;
}

export interface CommunicationProvider {
  readonly name: string;
  supports(channel: CommunicationChannel): boolean;
  send(message: OutboundMessage): Promise<SendResult>;
}

/** The default: nothing is sent automatically — the UI falls back to the
 * device-app links and a manually logged activity. */
class ManualCommunicationProvider implements CommunicationProvider {
  readonly name = "manual";
  supports(): boolean {
    return false;
  }
  async send(): Promise<SendResult> {
    return { delivered: false, message: "No messaging provider is configured — use the Call / Email / WhatsApp buttons and log the activity." };
  }
}

export function getCommunicationProvider(): CommunicationProvider {
  return new ManualCommunicationProvider();
}
