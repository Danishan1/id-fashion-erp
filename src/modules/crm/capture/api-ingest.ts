import { LEAD_TARGET_FIELD_KEYS, suggestLeadMapping } from "../ingestion/lead-field-catalog";
import { ingestRequestSchema } from "./crm-capture.schema";

const RESERVED = new Set(["lead", "customFields", "channel", "externalLeadId", "externalEventId", "duplicatePolicy"]);

/**
 * Body of POST /api/v1/crm/leads/ingest → mapped lead record. Lead fields
 * may be sent flat or under `lead`; exact CRM field keys (firstName, email,
 * mobile, companyName, requirement, source, tags, utmSource…) are used
 * as-is and common alternatives ("name", "mobile_no", "Email ID") are mapped
 * like import headers. Unknown keys are reported back, never fatal.
 */
export function mapApiBody(raw: unknown) {
  const body = ingestRequestSchema.parse(raw);
  const fields: Record<string, unknown> = body.lead ?? Object.fromEntries(Object.entries(body).filter(([k]) => !RESERVED.has(k)));
  const exact = Object.keys(fields).filter((k) => LEAD_TARGET_FIELD_KEYS.has(k));
  const others = Object.keys(fields).filter((k) => !LEAD_TARGET_FIELD_KEYS.has(k) && !k.startsWith("cf:"));
  const suggested = suggestLeadMapping(others);
  const mapped: Record<string, unknown> = {};
  for (const k of exact) mapped[k] = fields[k];
  const unmappedFields: string[] = [];
  for (const k of others) {
    const target = suggested[k];
    if (target && !(target in mapped)) mapped[target] = fields[k];
    else unmappedFields.push(k);
  }
  for (const [k, v] of Object.entries(fields)) if (k.startsWith("cf:")) mapped[k] = v;
  for (const [k, v] of Object.entries(body.customFields ?? {})) mapped[`cf:${k}`] = v;
  const externalLeadId = body.externalLeadId ?? (typeof mapped.externalId === "string" ? mapped.externalId : null);
  delete mapped.externalId;
  return { mapped, unmappedFields, externalLeadId, externalEventId: body.externalEventId ?? null, channel: body.channel ?? "API", duplicatePolicy: body.duplicatePolicy };
}
