import type { CrmLeadCaptureChannel } from "@prisma/client";

/**
 * Contract every lead-source connector implements (CRM_INTEGRATION_AWARENESS
 * §2: CRM Feature → Adapter → Provider). An adapter only authenticates the
 * delivery and translates the provider's payload into mapped lead records
 * (CRM field key → value). Validation, duplicates, policies and writes are
 * the Lead Ingestion Service's job — adapters never create leads themselves.
 *
 * Adding a provider later (Meta Lead Ads, IndiaMART, Google, LinkedIn, a
 * trade portal) = one new adapter file + one line in the registry. Provider
 * credentials (app secrets, access tokens) will live encrypted per company,
 * like the webhook signing secret does today.
 */
export interface AdapterLeadRecord {
  /** CRM field key (see lead-field-catalog.ts, custom fields as cf:<key>) → raw value. */
  mapped: Record<string, unknown>;
  externalLeadId: string | null;
  externalEventId: string | null;
  /** Payload keys that weren't mapped to any CRM field (reported back, never an error). */
  unmappedKeys: string[];
  /** This record as received, for the submission log (secrets are redacted before storing). */
  raw: unknown;
}


export type SignatureCheck = { ok: true } | { ok: false; reason: string };

export class AdapterPayloadError extends Error {}

export interface LeadProviderAdapter {
  provider: string;
  label: string;
  channel: CrmLeadCaptureChannel;
  /** Lead source key used when the endpoint has no default source. */
  defaultSourceKey: string;
  verifySignature(input: { headers: Headers; rawBody: string; secret: string; now: Date }): SignatureCheck;
  parse(input: { headers: Headers; rawBody: string; fieldMapping: Record<string, string> }): AdapterLeadRecord[];
}
